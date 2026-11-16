// /api/me/guide（/me の初回ツアー・チェックリストの記録）の回帰テスト。
// 認証必須・kind の検証・自分の行だけを更新することを確認する。
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

import { action } from "../me/guide";

const ENV_KEYS = ["TURSO_DATABASE_URL", "BETTER_AUTH_SECRET", "APP_URL"] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
let db: TestDb;

async function post(kind?: string, method = "POST") {
  const body = new FormData();
  if (kind !== undefined) body.set("kind", kind);
  const request = new Request("https://minefolio.app/api/me/guide", {
    method,
    ...(method === "POST" ? { body } : {}),
  });
  const res = (await action({ request, params: {}, context: {} } as never)) as Response;
  return { status: res.status, body: await res.json() };
}

async function row(id: string) {
  return db.query.users.findFirst({ where: eq(schema.users.id, id) });
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

describe("POST /api/me/guide", () => {
  it("未認証は 401", async () => {
    authMocks.getSession.mockResolvedValue(null);
    expect((await post("tour")).status).toBe(401);
  });

  it("POST 以外は 405", async () => {
    const me = await seedUser(db, { discordId: "d0" });
    authMocks.getSession.mockResolvedValue({ user: { id: "d0" } });
    expect((await post(undefined, "GET")).status).toBe(405);
    expect((await row(me.id))?.meTourCompletedAt).toBeNull();
  });

  it("未知の kind・未指定は 400 で何も更新しない", async () => {
    const me = await seedUser(db, { discordId: "d1" });
    authMocks.getSession.mockResolvedValue({ user: { id: "d1" } });
    expect((await post("bogus")).status).toBe(400);
    expect((await post("toString")).status).toBe(400);
    expect((await post()).status).toBe(400);
    const after = await row(me.id);
    expect(after?.meTourCompletedAt).toBeNull();
    expect(after?.meChecklistDismissedAt).toBeNull();
  });

  it("tour はツアーの列だけ、checklist はチェックリストの列だけを更新する", async () => {
    const me = await seedUser(db, { discordId: "d2" });
    authMocks.getSession.mockResolvedValue({ user: { id: "d2" } });

    expect((await post("tour")).status).toBe(200);
    let after = await row(me.id);
    expect(after?.meTourCompletedAt).toBeInstanceOf(Date);
    expect(after?.meChecklistDismissedAt).toBeNull();

    expect((await post("checklist")).status).toBe(200);
    after = await row(me.id);
    expect(after?.meChecklistDismissedAt).toBeInstanceOf(Date);
  });

  it("他のユーザーの行は更新しない", async () => {
    const other = await seedUser(db, { discordId: "d-other" });
    await seedUser(db, { discordId: "d3" });
    authMocks.getSession.mockResolvedValue({ user: { id: "d3" } });
    await post("tour");
    expect((await row(other.id))?.meTourCompletedAt).toBeNull();
  });
});
