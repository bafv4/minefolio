// /random-player の母集団（/browse と同じ: 公開・視聴者以外・role 未設定は走者扱い）と、本人の除外の回帰テスト。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createTestDbAt,
  seedUser,
  SHARED_MEMORY_URL,
  type TestDb,
} from "@/lib/__tests__/helpers/test-db";

const sessionMocks = vi.hoisted(() => ({
  getOptionalSession: vi.fn(),
  getSession: vi.fn(),
  getCurrentUser: vi.fn(),
  getCurrentUserOrOnboarding: vi.fn(),
  isAuthenticated: vi.fn(),
}));

vi.mock("@/lib/session", () => sessionMocks);

import { loader } from "../random-player";

const ENV_KEYS = ["TURSO_DATABASE_URL", "BETTER_AUTH_SECRET", "APP_URL"] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

let db: TestDb;

async function destination(): Promise<string | null> {
  const res = (await loader({
    request: new Request("https://minefolio.app/random-player"),
    params: {},
    context: {},
  } as never)) as Response;
  return res.headers.get("Location");
}

beforeEach(async () => {
  vi.clearAllMocks();
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
  process.env.TURSO_DATABASE_URL = SHARED_MEMORY_URL;
  process.env.BETTER_AUTH_SECRET = "test-secret";
  process.env.APP_URL = "https://minefolio.app";
  db = await createTestDbAt(SHARED_MEMORY_URL);
  sessionMocks.getOptionalSession.mockResolvedValue(null);
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe("/random-player", () => {
  it("role 未設定（NULL）の公開走者も対象にする", async () => {
    await seedUser(db, { slug: "no-role", profileVisibility: "public", role: null });

    expect(await destination()).toBe("/player/no-role");
  });

  it("視聴者・非公開・限定公開は対象にしない（対象 0 人は /browse）", async () => {
    await seedUser(db, { slug: "viewer", profileVisibility: "public", role: "viewer" });
    await seedUser(db, { slug: "private", profileVisibility: "private", role: "runner" });
    await seedUser(db, { slug: "unlisted", profileVisibility: "unlisted", role: "runner" });

    expect(await destination()).toBe("/browse");
  });

  it("ログイン中は本人を除く（ほかに対象がいなければ /browse）", async () => {
    await seedUser(db, { slug: "me", discordId: "discord-me", profileVisibility: "public", role: "runner" });
    sessionMocks.getOptionalSession.mockResolvedValue({ user: { id: "discord-me" } });

    expect(await destination()).toBe("/browse");

    await seedUser(db, { slug: "other", profileVisibility: "public", role: "runner" });
    for (let i = 0; i < 10; i++) expect(await destination()).toBe("/player/other");
  });
});
