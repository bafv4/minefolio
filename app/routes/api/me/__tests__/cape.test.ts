// POST/DELETE /api/me/cape の認可・入力検証の配線テスト（/api/me/skin のテストと同じ構成）。
//
// 対象は「境界の配線」に絞る（CRUD の網羅は目的ではない）:
//   - 未ログインで users 行に触れないこと
//   - 保存前に isVercelBlobUrl を通していること（判定ロジック自体は blob-url.test.ts）
//   - DELETE で列が null に戻り、Blob 実体の削除（@vercel/blob の del）が呼ばれること
//   - capeDisplay はこのルートでは触らない（me/edit の保存フォーム側の責務）
//
// このルートは @/lib/session を経由せず auth.api.getSession を直接呼ぶため、
// セッションのモックは @/lib/auth の createAuth 差し替えで行う。DB は実DBのまま検証する。
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

import { action } from "../cape";

const OLD_BLOB_URL = "https://store123.public.blob.vercel-storage.com/capes/u-runner/old.png";
const NEW_BLOB_URL = "https://store123.public.blob.vercel-storage.com/capes/u-runner/new.png";

const ENV_KEYS = ["TURSO_DATABASE_URL", "BETTER_AUTH_SECRET", "APP_URL", "BLOB_READ_WRITE_TOKEN"] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

let db: TestDb;

function makeRequest(method: string, body?: unknown): Request {
  return new Request("https://minefolio.app/api/me/cape", {
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

/** カスタムマント設定済みのユーザーを用意してログインする */
async function setupUser(customCapeUrl: string | null = OLD_BLOB_URL) {
  const user = await seedUser(db, {
    id: "u-runner",
    slug: "runner",
    discordId: "discord-runner",
    customCapeUrl,
    customCapeUpdatedAt: customCapeUrl ? new Date() : null,
    capeDisplay: "elytra",
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
  delete process.env.BLOB_READ_WRITE_TOKEN;
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
      customCapeUrl: OLD_BLOB_URL,
    });

    const res = await callAction("POST", { url: NEW_BLOB_URL });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect((await findUser(user.id))?.customCapeUrl).toBe(OLD_BLOB_URL);
    expect(blobMocks.del).not.toHaveBeenCalled();
  });

  it("未ログインの DELETE も 401（Blob を消させない）", async () => {
    const user = await seedUser(db, {
      slug: "runner",
      discordId: "discord-runner",
      customCapeUrl: OLD_BLOB_URL,
    });

    const res = await callAction("DELETE");

    expect(res.status).toBe(401);
    expect((await findUser(user.id))?.customCapeUrl).toBe(OLD_BLOB_URL);
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
    ["別ドメイン", "https://evil.example/cape.png"],
    ["正規ホストを接尾に付けた別ドメイン", "https://blob.vercel-storage.com.evil.example/c.png"],
    ["クエリに正規ホスト名を混ぜたURL", "https://evil.example/c.png?x=blob.vercel-storage.com"],
    ["IPリテラル + フラグメント偽装", "https://169.254.169.254/#blob.vercel-storage.com"],
    ["http スキーム", "http://store123.public.blob.vercel-storage.com/capes/a/cape.png"],
  ])("%s は 400 で DB を更新しない", async (_label, url) => {
    const user = await setupUser(OLD_BLOB_URL);

    const res = await callAction("POST", { url });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid blob URL" });

    const row = await findUser(user.id);
    expect(row?.customCapeUrl).toBe(OLD_BLOB_URL);
    expect(blobMocks.del).not.toHaveBeenCalled();
  });

  it("url 欠落は 400（検証前の必須チェック）", async () => {
    const user = await setupUser(OLD_BLOB_URL);

    const res = await callAction("POST", {});

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "URL is required" });
    expect((await findUser(user.id))?.customCapeUrl).toBe(OLD_BLOB_URL);
  });

  it("url が文字列でない場合も 400", async () => {
    const user = await setupUser(OLD_BLOB_URL);

    const res = await callAction("POST", { url: 123 });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "URL is required" });
    expect((await findUser(user.id))?.customCapeUrl).toBe(OLD_BLOB_URL);
  });

  it("正規の Blob URL は保存され、旧 Blob が削除される（対照）", async () => {
    const user = await setupUser(OLD_BLOB_URL);

    const res = await callAction("POST", { url: NEW_BLOB_URL });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, customCapeUrl: NEW_BLOB_URL });

    const row = await findUser(user.id);
    expect(row?.customCapeUrl).toBe(NEW_BLOB_URL);
    expect(row?.customCapeUpdatedAt).toBeInstanceOf(Date);
    expect(blobMocks.del).toHaveBeenCalledWith(OLD_BLOB_URL);
  });

  it("初回アップロード（旧 URL なし）では del を呼ばない", async () => {
    const user = await setupUser(null);

    const res = await callAction("POST", { url: NEW_BLOB_URL });

    expect(res.status).toBe(200);
    expect((await findUser(user.id))?.customCapeUrl).toBe(NEW_BLOB_URL);
    expect(blobMocks.del).not.toHaveBeenCalled();
  });

  it("旧 URL と同じ URL の再保存では del を呼ばない（保存したばかりの Blob を消さない）", async () => {
    const user = await setupUser(OLD_BLOB_URL);

    const res = await callAction("POST", { url: OLD_BLOB_URL });

    expect(res.status).toBe(200);
    expect((await findUser(user.id))?.customCapeUrl).toBe(OLD_BLOB_URL);
    expect(blobMocks.del).not.toHaveBeenCalled();
  });

  it("旧 Blob の削除に失敗しても保存は完了する", async () => {
    const user = await setupUser(OLD_BLOB_URL);
    blobMocks.del.mockRejectedValue(new Error("blob not found"));

    const res = await callAction("POST", { url: NEW_BLOB_URL });

    expect(res.status).toBe(200);
    expect((await findUser(user.id))?.customCapeUrl).toBe(NEW_BLOB_URL);
  });

  it("capeDisplay は変更しない（表示形式は me/edit の保存フォームの責務）", async () => {
    const user = await setupUser(OLD_BLOB_URL);

    await callAction("POST", { url: NEW_BLOB_URL, capeDisplay: "hidden" });

    expect((await findUser(user.id))?.capeDisplay).toBe("elytra");
  });
});

describe("POST のボディ検証", () => {
  it("ボディが null（JSON としては妥当）は 400 で DB を更新しない", async () => {
    const user = await setupUser(OLD_BLOB_URL);

    const res = await callAction("POST", null);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid request" });
    expect((await findUser(user.id))?.customCapeUrl).toBe(OLD_BLOB_URL);
    expect(blobMocks.del).not.toHaveBeenCalled();
  });

  it("壊れた JSON は 400 で DB を更新しない", async () => {
    const user = await setupUser(OLD_BLOB_URL);

    const res = await action({
      request: new Request("https://minefolio.app/api/me/cape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not valid json",
      }),
      params: {},
      context: {},
    } as never);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid JSON" });
    expect((await findUser(user.id))?.customCapeUrl).toBe(OLD_BLOB_URL);
    expect(blobMocks.del).not.toHaveBeenCalled();
  });
});

describe("DELETE", () => {
  it("カスタムマントの列が null に戻り、Blob 実体も削除される", async () => {
    const user = await setupUser(OLD_BLOB_URL);

    const res = await callAction("DELETE");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });

    const row = await findUser(user.id);
    expect(row?.customCapeUrl).toBeNull();
    expect(row?.customCapeUpdatedAt).toBeNull();
    expect(blobMocks.del).toHaveBeenCalledWith(OLD_BLOB_URL);
  });

  it("capeDisplay の設定は削除後も保持される", async () => {
    const user = await setupUser(OLD_BLOB_URL);

    await callAction("DELETE");

    expect((await findUser(user.id))?.capeDisplay).toBe("elytra");
  });

  it("Blob 削除が失敗しても DB のクリアは完了する（既に消えている場合の想定）", async () => {
    const user = await setupUser(OLD_BLOB_URL);
    blobMocks.del.mockRejectedValue(new Error("blob not found"));

    const res = await callAction("DELETE");

    expect(res.status).toBe(200);
    expect((await findUser(user.id))?.customCapeUrl).toBeNull();
  });

  it("カスタムマント未設定なら del を呼ばずに成功する", async () => {
    await setupUser(null);

    const res = await callAction("DELETE");

    expect(res.status).toBe(200);
    expect(blobMocks.del).not.toHaveBeenCalled();
  });
});

describe("他人の Blob の保存・削除（所有判定）", () => {
  const HOST = "https://store123.public.blob.vercel-storage.com";
  const OTHER_STORE = "https://other999.public.blob.vercel-storage.com";
  const OTHERS_URL = `${HOST}/capes/u-other/x.png`;

  it.each([
    ["他人のディレクトリ", `${HOST}/capes/u-other/x.png`],
    ["他人のガイド画像", `${HOST}/guides/u-other/g1/cover.png`],
    ["別種別のディレクトリ", `${HOST}/skins/u-runner/x.png`],
    [".. を含むパス", `${HOST}/capes/u-runner/%2e%2e/u-other/x.png`],
    ["自分のディレクトリ直下に名前が無い", `${HOST}/capes/u-runner/`],
  ])("%s は 400 で DB・Blob に触れない", async (_label, url) => {
    const user = await setupUser(OLD_BLOB_URL);

    const res = await callAction("POST", { url });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid blob URL" });
    expect((await findUser(user.id))?.customCapeUrl).toBe(OLD_BLOB_URL);
    expect(blobMocks.del).not.toHaveBeenCalled();
  });

  describe("BLOB_READ_WRITE_TOKEN があるとき（ストア ID の確認）", () => {
    beforeEach(() => {
      process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_store123_secret";
    });

    it("他ストアのホストは自分のパスでも 400", async () => {
      const user = await setupUser(OLD_BLOB_URL);

      const res = await callAction("POST", { url: `${OTHER_STORE}/capes/u-runner/x.png` });

      expect(res.status).toBe(400);
      expect((await findUser(user.id))?.customCapeUrl).toBe(OLD_BLOB_URL);
      expect(blobMocks.del).not.toHaveBeenCalled();
    });

    it("自ストア・自分のパスは通り、旧 Blob を削除する", async () => {
      const user = await setupUser(OLD_BLOB_URL);

      const res = await callAction("POST", { url: NEW_BLOB_URL });

      expect(res.status).toBe(200);
      expect((await findUser(user.id))?.customCapeUrl).toBe(NEW_BLOB_URL);
      expect(blobMocks.del).toHaveBeenCalledWith(OLD_BLOB_URL);
    });

    it("他ストアの既存 URL は DELETE でも del() せず、列だけクリアする", async () => {
      const user = await setupUser(`${OTHER_STORE}/capes/u-runner/x.png`);

      const res = await callAction("DELETE");

      expect(res.status).toBe(200);
      expect((await findUser(user.id))?.customCapeUrl).toBeNull();
      expect(blobMocks.del).not.toHaveBeenCalled();
    });
  });

  it("既存の行が他人のパスなら、解除（DELETE）で del() を呼ばず列だけクリアする", async () => {
    const user = await setupUser(OTHERS_URL);

    const res = await callAction("DELETE");

    expect(res.status).toBe(200);
    expect((await findUser(user.id))?.customCapeUrl).toBeNull();
    expect(blobMocks.del).not.toHaveBeenCalled();
  });

  it("既存の行が他人のパスなら、差し替え（POST）で del() を呼ばず新しい URL を保存する", async () => {
    const user = await setupUser(OTHERS_URL);

    const res = await callAction("POST", { url: NEW_BLOB_URL });

    expect(res.status).toBe(200);
    expect((await findUser(user.id))?.customCapeUrl).toBe(NEW_BLOB_URL);
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
