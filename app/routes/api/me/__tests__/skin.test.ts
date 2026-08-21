// POST/DELETE /api/me/skin の認可・入力検証の配線テスト。
//
// 対象は「境界の配線」に絞る（CRUD の網羅は目的ではない）:
//   - 未ログインで users 行に触れないこと
//   - 保存前に isVercelBlobUrl を通していること（判定ロジック自体は blob-url.test.ts）
//   - DELETE で列が null に戻り、Blob 実体の削除（@vercel/blob の del）が呼ばれること
//
// このルートは @/lib/session を経由せず auth.api.getSession を直接呼ぶため、
// セッションのモックは @/lib/auth の createAuth 差し替えで行う（他のルートテストの
// vi.mock("@/lib/session") とは対象が異なる）。DB は実DBのまま検証する。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  createTestDbAt,
  seedUser,
  SHARED_MEMORY_URL,
  type TestDb,
} from "@/lib/__tests__/helpers/test-db";
import { users } from "@/lib/schema";

const authMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  createAuth: () => ({ api: { getSession: authMocks.getSession } }),
}));

// Blob 実体の削除は外部サービス呼び出しなのでモックする
const blobMocks = vi.hoisted(() => ({
  del: vi.fn(),
}));

vi.mock("@vercel/blob", () => blobMocks);

import { action } from "../skin";

const OLD_BLOB_URL = "https://store123.public.blob.vercel-storage.com/skins/old/skin.png";
const NEW_BLOB_URL = "https://store123.public.blob.vercel-storage.com/skins/new/skin.png";

const ENV_KEYS = ["TURSO_DATABASE_URL", "BETTER_AUTH_SECRET", "APP_URL"] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

let db: TestDb;

function makeRequest(method: string, body?: unknown): Request {
  return new Request("https://minefolio.app/api/me/skin", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function callAction(method: string, body?: unknown): Promise<Response> {
  return action({ request: makeRequest(method, body), params: {}, context: {} } as never);
}

/** 指定 discordId でログイン中にする */
function signInAs(discordId: string) {
  authMocks.getSession.mockResolvedValue({ user: { id: discordId } });
}

/** カスタムスキン設定済みのユーザーを用意してログインする */
async function setupUser(customSkinUrl: string | null = OLD_BLOB_URL) {
  const user = await seedUser(db, {
    slug: "runner",
    discordId: "discord-runner",
    customSkinUrl,
    customSkinModel: customSkinUrl ? "slim" : null,
    customSkinUpdatedAt: customSkinUrl ? new Date() : null,
  });
  signInAs("discord-runner");
  return user;
}

async function findUser(userId: string) {
  return db.query.users.findFirst({ where: eq(users.id, userId) });
}

beforeEach(async () => {
  vi.clearAllMocks();
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
  process.env.TURSO_DATABASE_URL = SHARED_MEMORY_URL;
  process.env.BETTER_AUTH_SECRET = "test-secret";
  process.env.APP_URL = "https://minefolio.app";
  db = await createTestDbAt(SHARED_MEMORY_URL);
  authMocks.getSession.mockResolvedValue(null);
  blobMocks.del.mockResolvedValue(undefined);
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe("認証ゲート", () => {
  it("未ログインの POST は 401 で users 行に触れない", async () => {
    const user = await seedUser(db, {
      slug: "runner",
      discordId: "discord-runner",
      customSkinUrl: OLD_BLOB_URL,
    });

    const res = await callAction("POST", { url: NEW_BLOB_URL });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect((await findUser(user.id))?.customSkinUrl).toBe(OLD_BLOB_URL);
    expect(blobMocks.del).not.toHaveBeenCalled();
  });

  it("未ログインの DELETE も 401（Blob を消させない）", async () => {
    const user = await seedUser(db, {
      slug: "runner",
      discordId: "discord-runner",
      customSkinUrl: OLD_BLOB_URL,
    });

    const res = await callAction("DELETE");

    expect(res.status).toBe(401);
    expect((await findUser(user.id))?.customSkinUrl).toBe(OLD_BLOB_URL);
    expect(blobMocks.del).not.toHaveBeenCalled();
  });

  it("セッションはあるが users 行が無い（未オンボーディング）は 404", async () => {
    signInAs("discord-unknown");

    const res = await callAction("POST", { url: NEW_BLOB_URL });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "User not found" });
  });
});

describe("POST の URL 検証（isVercelBlobUrl の配線）", () => {
  it.each([
    ["別ドメイン", "https://evil.example/skin.png"],
    ["正規ホストを接尾に付けた別ドメイン", "https://blob.vercel-storage.com.evil.example/s.png"],
    ["クエリに正規ホスト名を混ぜたURL", "https://evil.example/s.png?x=blob.vercel-storage.com"],
    ["IPリテラル + フラグメント偽装", "https://169.254.169.254/#blob.vercel-storage.com"],
    ["http スキーム", "http://store123.public.blob.vercel-storage.com/skins/a/skin.png"],
  ])("%s は 400 で DB を更新しない", async (_label, url) => {
    const user = await setupUser(OLD_BLOB_URL);

    const res = await callAction("POST", { url });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid blob URL" });

    const row = await findUser(user.id);
    expect(row?.customSkinUrl).toBe(OLD_BLOB_URL);
    expect(row?.customSkinModel).toBe("slim");
    expect(blobMocks.del).not.toHaveBeenCalled();
  });

  it("url 欠落は 400（検証前の必須チェック）", async () => {
    const user = await setupUser(OLD_BLOB_URL);

    const res = await callAction("POST", { model: "slim" });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "URL is required" });
    expect((await findUser(user.id))?.customSkinUrl).toBe(OLD_BLOB_URL);
  });

  it("正規の Blob URL は保存され、旧 Blob が削除される（対照）", async () => {
    const user = await setupUser(OLD_BLOB_URL);

    const res = await callAction("POST", { url: NEW_BLOB_URL, model: "slim" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      customSkinUrl: NEW_BLOB_URL,
      customSkinModel: "slim",
    });

    const row = await findUser(user.id);
    expect(row?.customSkinUrl).toBe(NEW_BLOB_URL);
    expect(row?.customSkinModel).toBe("slim");
    expect(blobMocks.del).toHaveBeenCalledWith(OLD_BLOB_URL);
  });
});

describe("POST のボディ検証", () => {
  it("ボディが null（JSON としては妥当）は 400 で DB を更新しない", async () => {
    const user = await setupUser(OLD_BLOB_URL);

    const res = await callAction("POST", null);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid request" });
    const row = await findUser(user.id);
    expect(row?.customSkinUrl).toBe(OLD_BLOB_URL);
    expect(blobMocks.del).not.toHaveBeenCalled();
  });

  it("壊れた JSON は 400 で DB を更新しない", async () => {
    const user = await setupUser(OLD_BLOB_URL);

    const res = await action({
      request: new Request("https://minefolio.app/api/me/skin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not valid json",
      }),
      params: {},
      context: {},
    } as never);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid JSON" });
    const row = await findUser(user.id);
    expect(row?.customSkinUrl).toBe(OLD_BLOB_URL);
    expect(blobMocks.del).not.toHaveBeenCalled();
  });

  it("model が許可リスト外の文字列は 400 で DB を更新しない", async () => {
    const user = await setupUser(OLD_BLOB_URL);

    const res = await callAction("POST", { url: NEW_BLOB_URL, model: "evil" });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid model" });
    const row = await findUser(user.id);
    expect(row?.customSkinUrl).toBe(OLD_BLOB_URL);
    expect(row?.customSkinModel).toBe("slim");
    expect(blobMocks.del).not.toHaveBeenCalled();
  });
});

describe("DELETE", () => {
  it("カスタムスキンの列が null に戻り、Blob 実体も削除される", async () => {
    const user = await setupUser(OLD_BLOB_URL);

    const res = await callAction("DELETE");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });

    const row = await findUser(user.id);
    expect(row?.customSkinUrl).toBeNull();
    expect(row?.customSkinModel).toBeNull();
    expect(row?.customSkinUpdatedAt).toBeNull();
    expect(blobMocks.del).toHaveBeenCalledWith(OLD_BLOB_URL);
  });

  it("Blob 削除が失敗しても DB のクリアは完了する（既に消えている場合の想定）", async () => {
    const user = await setupUser(OLD_BLOB_URL);
    blobMocks.del.mockRejectedValue(new Error("blob not found"));

    const res = await callAction("DELETE");

    expect(res.status).toBe(200);
    expect((await findUser(user.id))?.customSkinUrl).toBeNull();
  });

  it("カスタムスキン未設定なら del を呼ばずに成功する", async () => {
    await setupUser(null);

    const res = await callAction("DELETE");

    expect(res.status).toBe(200);
    expect(blobMocks.del).not.toHaveBeenCalled();
  });
});

describe("メソッド", () => {
  it("POST / DELETE 以外は 405", async () => {
    await setupUser(OLD_BLOB_URL);

    const res = await callAction("PUT", { url: NEW_BLOB_URL });

    expect(res.status).toBe(405);
    expect(await res.json()).toEqual({ error: "Method not allowed" });
  });
});
