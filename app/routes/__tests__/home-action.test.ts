// ホームの action（欄の並び順の保存）。セッションはモックし、実DBで検証する（favorites.test.ts と同じ方針）。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  createTestDbAt,
  seedUser,
  schema,
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

import { action } from "../home";

const ENV_KEYS = ["TURSO_DATABASE_URL", "BETTER_AUTH_SECRET", "APP_URL"] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

let db: TestDb;

async function callAction(fields: Record<string, string>) {
  const body = new URLSearchParams(fields);
  const request = new Request("https://minefolio.app/", { method: "POST", body });
  return (await action({ request, params: {}, context: {} } as never)) as unknown;
}

const save = (order: unknown) =>
  callAction({ _action: "saveHomeSectionOrder", order: typeof order === "string" ? order : JSON.stringify(order) });

async function storedOrder(id: string) {
  const row = await db.query.users.findFirst({ where: eq(schema.users.id, id) });
  return row;
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

describe("action - saveHomeSectionOrder", () => {
  it("未ログインは 401 で DB 無変更", async () => {
    const user = await seedUser(db, { discordId: "d1" });
    const res = (await save(["live"])) as { init: { status: number }; data: { error: string } };
    expect(res.init.status).toBe(401);
    expect(res.data.error).toBeTruthy();
    expect((await storedOrder(user.id))?.homeSectionOrder).toBeNull();
  });

  it("正規化した並びを JSON で保存し、updatedAt は変えない", async () => {
    const user = await seedUser(db, { discordId: "d1" });
    sessionMocks.getOptionalSession.mockResolvedValue({ user: { id: "d1" } });
    const before = (await storedOrder(user.id))!.updatedAt;

    const res = await save(["profiles", "bogus", "live"]);

    expect(res).toEqual({ success: true, action: "saveHomeSectionOrder" });
    const row = (await storedOrder(user.id))!;
    expect(JSON.parse(row.homeSectionOrder!)).toEqual([
      "profiles",
      "live",
      "favoriteActivity",
      "videos",
      "guides",
      "featured",
    ]);
    expect(row.updatedAt.getTime()).toBe(before.getTime());
  });

  it("既定順なら null に戻す", async () => {
    const user = await seedUser(db, { discordId: "d1", homeSectionOrder: '["live"]' });
    sessionMocks.getOptionalSession.mockResolvedValue({ user: { id: "d1" } });

    const res = await save(["favoriteActivity", "live", "videos", "guides", "featured", "profiles"]);

    expect(res).toEqual({ success: true, action: "saveHomeSectionOrder" });
    expect((await storedOrder(user.id))?.homeSectionOrder).toBeNull();
  });

  it("他ユーザーの行は変えない", async () => {
    await seedUser(db, { discordId: "d1" });
    const other = await seedUser(db, { discordId: "d2" });
    sessionMocks.getOptionalSession.mockResolvedValue({ user: { id: "d1" } });
    await save(["profiles"]);
    expect((await storedOrder(other.id))?.homeSectionOrder).toBeNull();
  });
});
