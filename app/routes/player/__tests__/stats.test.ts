// /player/:slug/stats の loader のうち、手入力のカスタム記録（categoryRecords）と本人判定の回帰テスト。
//
// 外部API（PaceMan / MCSR Ranked / Speedrun.com）は `player.mcid` があるときだけ呼ばれるので、
// mcid を持たないユーザーでシードする（profile.test.ts と同じ方針）。
// セッションはモックし、ルート本体は実DBで検証する。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createTestDbAt,
  seedUser,
  seedCategoryRecord,
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

import { loader } from "../stats";

const ENV_KEYS = ["TURSO_DATABASE_URL", "BETTER_AUTH_SECRET", "APP_URL"] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

let db: TestDb;

type LoaderData = {
  isOwner: boolean;
  categoryRecords: { id: string; category: string; isPinned: boolean }[];
};

async function callLoader(slug: string): Promise<LoaderData> {
  const request = new Request(`https://minefolio.app/player/${slug}/stats`);
  return loader({ request, params: { slug }, context: {} } as never) as never;
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

describe("カスタム記録（categoryRecords）", () => {
  it("表示する記録だけを、ピン留めを先頭・displayOrder 順で返す（他の走者の記録は含めない）", async () => {
    const runner = await seedUser(db, { slug: "runner", profileVisibility: "public", mcid: null });
    const other = await seedUser(db, { slug: "other", profileVisibility: "public", mcid: null });
    await seedCategoryRecord(db, runner.id, { category: "second", displayOrder: 2 });
    await seedCategoryRecord(db, runner.id, { category: "first", displayOrder: 1 });
    await seedCategoryRecord(db, runner.id, { category: "pinned", displayOrder: 3, isPinned: true });
    await seedCategoryRecord(db, runner.id, { category: "hidden", displayOrder: 0, isVisible: false });
    await seedCategoryRecord(db, other.id, { category: "others" });

    const result = await callLoader("runner");

    expect(result.categoryRecords.map((r) => r.category)).toEqual(["pinned", "first", "second"]);
  });

  it("記録が無ければ空配列", async () => {
    await seedUser(db, { slug: "runner", profileVisibility: "public", mcid: null });

    const result = await callLoader("runner");

    expect(result.categoryRecords).toEqual([]);
  });
});

describe("本人判定（isOwner）", () => {
  it("未ログインは false", async () => {
    await seedUser(db, { slug: "runner", discordId: "discord-runner", profileVisibility: "public", mcid: null });

    expect((await callLoader("runner")).isOwner).toBe(false);
  });

  it("別の走者がログインしていれば false", async () => {
    await seedUser(db, { slug: "runner", discordId: "discord-runner", profileVisibility: "public", mcid: null });
    sessionMocks.getOptionalSession.mockResolvedValue({ user: { id: "discord-someone" } });

    expect((await callLoader("runner")).isOwner).toBe(false);
  });

  it("本人がログインしていれば true（slug の大文字小文字が違っても）", async () => {
    await seedUser(db, { slug: "runner", discordId: "discord-runner", profileVisibility: "public", mcid: null });
    sessionMocks.getOptionalSession.mockResolvedValue({ user: { id: "discord-runner" } });

    expect((await callLoader("RUNNER")).isOwner).toBe(true);
  });

  it("非公開プロフィールでも本人なら記録を返し、本人以外には 404", async () => {
    const runner = await seedUser(db, {
      slug: "runner",
      discordId: "discord-runner",
      profileVisibility: "private",
      mcid: null,
    });
    await seedCategoryRecord(db, runner.id, { category: "mine" });

    const thrown = await callLoader("runner").then(
      () => null,
      (e: unknown) => e,
    );
    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(404);

    sessionMocks.getOptionalSession.mockResolvedValue({ user: { id: "discord-runner" } });
    const result = await callLoader("runner");
    expect(result.isOwner).toBe(true);
    expect(result.categoryRecords.map((r) => r.category)).toEqual(["mine"]);
  });
});
