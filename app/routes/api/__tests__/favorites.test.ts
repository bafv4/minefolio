// /api/favorites の action（loader は lib 委譲のみ）のルート固有の回帰テスト。
// lib 側（addFavoriteToDb 等）の挙動は app/lib/__tests__/favorites.test.ts でカバー済みのため、
// ここでは認証ゲート・実在チェック・PUT 同期の入力フィルタ・メソッド分岐のみを対象にする。
//
// セッションはモックし、ルート本体を実DBで検証する（app/routes/api/__tests__/likes.test.ts と同じ方針）。
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

import { action } from "../favorites";

const ENV_KEYS = ["TURSO_DATABASE_URL", "BETTER_AUTH_SECRET", "APP_URL"] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

let db: TestDb;

function makeRequest(method: string, body?: unknown): Request {
  return new Request("https://minefolio.app/api/favorites", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function callAction(method: string, body?: unknown): Promise<Response> {
  return action({ request: makeRequest(method, body), params: {}, context: {} } as never);
}

function signInAs(discordId: string) {
  sessionMocks.getOptionalSession.mockResolvedValue({ user: { id: discordId } });
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

async function favoriteRows() {
  return db.query.favorites.findMany();
}

describe("action - 認証ゲート", () => {
  it("未認証の POST は 401、DB は無変更", async () => {
    await seedUser(db, { slug: "runner" });

    const res = await callAction("POST", { slug: "runner", action: "add" });

    expect(res.status).toBe(401);
    expect(await favoriteRows()).toHaveLength(0);
  });

  it("未認証の PUT は 401、DB は無変更", async () => {
    await seedUser(db, { slug: "runner" });

    const res = await callAction("PUT", { slugs: ["runner"] });

    expect(res.status).toBe(401);
    expect(await favoriteRows()).toHaveLength(0);
  });
});

describe("action - JSON null ボディ", () => {
  it("POST は 400、DB は無変更", async () => {
    await seedUser(db, { slug: "me", discordId: "discord-me" });
    signInAs("discord-me");

    const res = await callAction("POST", null);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid request" });
    expect(await favoriteRows()).toHaveLength(0);
  });

  it("PUT は 400、DB は無変更", async () => {
    await seedUser(db, { slug: "me", discordId: "discord-me" });
    signInAs("discord-me");

    const res = await callAction("PUT", null);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid request" });
    expect(await favoriteRows()).toHaveLength(0);
  });
});

describe("action - POST add/remove", () => {
  it("架空 slug への add は 404", async () => {
    await seedUser(db, { slug: "me", discordId: "discord-me" });
    signInAs("discord-me");

    const res = await callAction("POST", { slug: "no-such-user", action: "add" });

    expect(res.status).toBe(404);
    expect(await favoriteRows()).toHaveLength(0);
  });

  it("実在 slug への add は追加され、最新リストを返す", async () => {
    const me = await seedUser(db, { slug: "me", discordId: "discord-me" });
    await seedUser(db, { slug: "runner" });
    signInAs("discord-me");

    const res = await callAction("POST", { slug: "runner", action: "add" });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { favorites: string[] };
    expect(body.favorites).toEqual(["runner"]);
    const rows = await db.query.favorites.findMany({ where: eq(schema.favorites.userId, me.id) });
    expect(rows.map((r) => r.favoriteSlug)).toEqual(["runner"]);
  });
});

describe("action - PUT 同期の入力フィルタ", () => {
  it("string 以外・129文字・501件目は除外されて同期される", async () => {
    const me = await seedUser(db, { slug: "me", discordId: "discord-me" });
    signInAs("discord-me");

    const validSlugs = Array.from({ length: 500 }, (_, i) => `slug-${String(i).padStart(4, "0")}`);
    const overflowSlug = "overflow-slug";
    const tooLong = "a".repeat(129);
    const invalid = [123, null, {}, ["x"]];

    const res = await callAction("PUT", {
      slugs: [...validSlugs, overflowSlug, tooLong, ...invalid],
    });

    expect(res.status).toBe(200);
    const rows = await db.query.favorites.findMany({ where: eq(schema.favorites.userId, me.id) });
    expect(rows).toHaveLength(500);
    expect(rows.map((r) => r.favoriteSlug)).not.toContain(overflowSlug);
    expect(rows.map((r) => r.favoriteSlug)).not.toContain(tooLong);
  });
});

describe("action - メソッド", () => {
  it("GET/POST/PUT 以外（DELETE）は 405", async () => {
    await seedUser(db, { slug: "me", discordId: "discord-me" });
    signInAs("discord-me");

    const res = await callAction("DELETE");

    expect(res.status).toBe(405);
  });
});
