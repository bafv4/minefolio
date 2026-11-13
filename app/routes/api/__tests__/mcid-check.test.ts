// /api/me/mcid-check（/me/edit の MCID 変更ダイアログ用の事前照合）の回帰テスト。
// 認証必須・DB 非変更・status の出し分け（invalid / taken / not_found / error / ok）を検証する。
// taken には、大文字小文字違いで mcid 列の比較をすり抜ける uuid 衝突も含む。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  createTestDbAt,
  seedUser,
  SHARED_MEMORY_URL,
  schema,
  type TestDb,
} from "@/lib/__tests__/helpers/test-db";

const authMocks = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ createAuth: () => ({ api: { getSession: authMocks.getSession } }) }));

const mojangMocks = vi.hoisted(() => ({ fetchUuidFromMcid: vi.fn() }));
vi.mock("@/lib/mojang", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mojang")>();
  return { ...actual, fetchUuidFromMcid: mojangMocks.fetchUuidFromMcid };
});

import { loader } from "../me/mcid-check";
import { MojangError } from "@/lib/mojang";

const ENV_KEYS = ["TURSO_DATABASE_URL", "BETTER_AUTH_SECRET", "APP_URL"] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
let db: TestDb;

async function call(mcid: string) {
  const request = new Request(`https://minefolio.app/api/me/mcid-check?mcid=${encodeURIComponent(mcid)}`);
  const res = (await loader({ request, params: {}, context: {} } as never)) as Response;
  return { status: res.status, body: await res.json() };
}

beforeEach(async () => {
  vi.clearAllMocks();
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
  process.env.TURSO_DATABASE_URL = SHARED_MEMORY_URL;
  process.env.BETTER_AUTH_SECRET = "test-secret";
  process.env.APP_URL = "https://minefolio.app";
  db = await createTestDbAt(SHARED_MEMORY_URL);
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe("GET /api/me/mcid-check", () => {
  it("未認証は 401（Mojang を呼ばない）", async () => {
    authMocks.getSession.mockResolvedValue(null);
    const res = await call("Notch");
    expect(res.status).toBe(401);
    expect(mojangMocks.fetchUuidFromMcid).not.toHaveBeenCalled();
  });

  it("形式不正（短すぎる）は invalid", async () => {
    await seedUser(db, { discordId: "d1" });
    authMocks.getSession.mockResolvedValue({ user: { id: "d1" } });
    expect((await call("ab")).body).toEqual({ status: "invalid" });
    expect(mojangMocks.fetchUuidFromMcid).not.toHaveBeenCalled();
  });

  it("他ユーザーが使用中の MCID は taken", async () => {
    await seedUser(db, { discordId: "d-other", mcid: "Taken", slug: "Taken" });
    await seedUser(db, { discordId: "d2" });
    authMocks.getSession.mockResolvedValue({ user: { id: "d2" } });
    expect((await call("Taken")).body).toEqual({ status: "taken" });
  });

  it("大文字小文字違いで uuid が他ユーザーと衝突する場合も taken", async () => {
    await seedUser(db, { discordId: "d-owner", mcid: "Notch", slug: "Notch", uuid: "uuid-notch" });
    await seedUser(db, { discordId: "d3" });
    authMocks.getSession.mockResolvedValue({ user: { id: "d3" } });
    mojangMocks.fetchUuidFromMcid.mockResolvedValue("uuid-notch");
    expect((await call("NOTCH")).body).toEqual({ status: "taken" });
  });

  it("Mojang に存在しなければ not_found、API 障害なら error", async () => {
    await seedUser(db, { discordId: "d4" });
    authMocks.getSession.mockResolvedValue({ user: { id: "d4" } });
    mojangMocks.fetchUuidFromMcid.mockRejectedValueOnce(new MojangError("MCID_NOT_FOUND", "nf"));
    expect((await call("Ghost")).body).toEqual({ status: "not_found" });
    mojangMocks.fetchUuidFromMcid.mockRejectedValueOnce(new MojangError("API_ERROR", "down"));
    expect((await call("Whoever")).body).toEqual({ status: "error" });
  });

  it("照合できれば ok（mcid と uuid を返し、users テーブルは変更しない）", async () => {
    const me = await seedUser(db, { discordId: "d5", mcid: "Before", slug: "Before", uuid: "uuid-before" });
    authMocks.getSession.mockResolvedValue({ user: { id: "d5" } });
    mojangMocks.fetchUuidFromMcid.mockResolvedValue("uuid-new");

    expect((await call("NewName")).body).toEqual({ status: "ok", mcid: "NewName", uuid: "uuid-new" });

    const after = await db.query.users.findFirst({ where: eq(schema.users.id, me.id) });
    expect(after?.mcid).toBe("Before");
    expect(after?.uuid).toBe("uuid-before");
  });
});
