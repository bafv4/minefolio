// ホームの action（欄の並び・表示の保存）。セッションはモックし、実DBで検証する（favorites.test.ts と同じ方針）。
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

const save = (order: unknown, hidden: unknown = []) =>
  callAction({ _action: "saveHomeSectionOrder", order: JSON.stringify(order), hidden: JSON.stringify(hidden) });

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

  it("正規化した並び・表示を新形式 JSON で保存し、updatedAt は変えない", async () => {
    const user = await seedUser(db, { discordId: "d1" });
    sessionMocks.getOptionalSession.mockResolvedValue({ user: { id: "d1" } });
    const before = (await storedOrder(user.id))!.updatedAt;

    const res = await save(["profiles", "bogus", "live"]);

    expect(res).toEqual({ success: true, action: "saveHomeSectionOrder" });
    const row = (await storedOrder(user.id))!;
    expect(JSON.parse(row.homeSectionOrder!)).toEqual({
      order: ["profiles", "live", "favoriteActivity", "featured", "videos", "guides"],
      hidden: [],
    });
    expect(row.updatedAt.getTime()).toBe(before.getTime());
  });

  it("既定順なら null に戻す", async () => {
    const user = await seedUser(db, { discordId: "d1", homeSectionOrder: '["live"]' });
    sessionMocks.getOptionalSession.mockResolvedValue({ user: { id: "d1" } });

    const res = await save(["favoriteActivity", "live", "featured", "videos", "guides", "profiles"]);

    expect(res).toEqual({ success: true, action: "saveHomeSectionOrder" });
    expect((await storedOrder(user.id))?.homeSectionOrder).toBeNull();
  });

  it("hidden を新形式で保存する（未知 ID・重複は除く）", async () => {
    const user = await seedUser(db, { discordId: "d1" });
    sessionMocks.getOptionalSession.mockResolvedValue({ user: { id: "d1" } });

    const res = await save(["favoriteActivity", "live", "featured", "videos", "guides", "profiles"], ["videos", "bogus", "videos"]);

    expect(res).toEqual({ success: true, action: "saveHomeSectionOrder" });
    expect(JSON.parse((await storedOrder(user.id))!.homeSectionOrder!)).toEqual({
      order: ["favoriteActivity", "live", "featured", "videos", "guides", "profiles"],
      hidden: ["videos"],
    });
  });

  it("旧形式（配列）が入っている行も、既定に戻す保存で null になる", async () => {
    const user = await seedUser(db, { discordId: "d1", homeSectionOrder: '["profiles","live"]' });
    sessionMocks.getOptionalSession.mockResolvedValue({ user: { id: "d1" } });

    await save(["favoriteActivity", "live", "featured", "videos", "guides", "profiles"], []);

    expect((await storedOrder(user.id))?.homeSectionOrder).toBeNull();
  });

  it("全欄を非表示にする保存は 400 で拒否し、DB 無変更", async () => {
    const stored = '{"order":["live"],"hidden":["videos"]}';
    const user = await seedUser(db, { discordId: "d1", homeSectionOrder: stored });
    sessionMocks.getOptionalSession.mockResolvedValue({ user: { id: "d1" } });

    const res = (await save(
      ["favoriteActivity", "live", "featured", "videos", "guides", "profiles"],
      ["favoriteActivity", "live", "featured", "videos", "guides", "profiles"],
    )) as { init: { status: number }; data: { error: string } };

    expect(res.init.status).toBe(400);
    expect(res.data.error).toBeTruthy();
    expect((await storedOrder(user.id))?.homeSectionOrder).toBe(stored);
  });

  it("不正な JSON は 400", async () => {
    await seedUser(db, { discordId: "d1" });
    sessionMocks.getOptionalSession.mockResolvedValue({ user: { id: "d1" } });
    const res = (await callAction({ _action: "saveHomeSectionOrder", order: "{bad", hidden: "[]" })) as {
      init: { status: number };
    };
    expect(res.init.status).toBe(400);
  });

  it("他ユーザーの行は変えない", async () => {
    await seedUser(db, { discordId: "d1" });
    const other = await seedUser(db, { discordId: "d2" });
    sessionMocks.getOptionalSession.mockResolvedValue({ user: { id: "d1" } });
    await save(["profiles"]);
    expect((await storedOrder(other.id))?.homeSectionOrder).toBeNull();
  });
});
