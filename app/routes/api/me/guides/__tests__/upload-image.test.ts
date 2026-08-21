// POST /api/me/guides/upload-image のアップロード認可の回帰テスト。
//
// スキンの upload-token（app/routes/api/me/skin/__tests__/upload-token.test.ts）と同型。
// クライアント直アップロード用の署名トークンを発行するため、onBeforeGenerateToken が
// 最後の関門になる。ここを緩めると他人の guides/<userId>/ 配下へ書き込めるトークンを配ってしまう。
//
// handleUpload（@vercel/blob/client）はモックし、ルートが渡したコールバックを取り出して
// 直接評価する。セッションは auth.api.getSession の直呼びなので @/lib/auth を差し替える。
// なお成功時はこのルートが handleUpload の戻り値をそのまま返すため、Response ではない。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { HandleUploadOptions } from "@vercel/blob/client";
import {
  createTestDbAt,
  seedUser,
  SHARED_MEMORY_URL,
  type TestDb,
} from "@/lib/__tests__/helpers/test-db";

const authMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  createAuth: () => ({ api: { getSession: authMocks.getSession } }),
}));

const blobClientMocks = vi.hoisted(() => ({
  handleUpload: vi.fn(),
}));

vi.mock("@vercel/blob/client", () => blobClientMocks);

import { action } from "../upload-image";

// 実装（app/routes/api/me/guides/upload-image.ts）と同じ値。
// 上限は use-image-upload の MAX_UPLOAD_BYTES と一致させている
const GUIDE_IMAGE_MAX_BYTES = 15 * 1024 * 1024;
const GUIDE_IMAGE_CONTENT_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

const ENV_KEYS = ["TURSO_DATABASE_URL", "BETTER_AUTH_SECRET", "APP_URL"] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

let db: TestDb;

function makeRequest(pathname: string): Request {
  return new Request("https://minefolio.app/api/me/guides/upload-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "blob.generate-client-token",
      payload: {
        pathname,
        callbackUrl: "https://minefolio.app/api/me/guides/upload-image",
        clientPayload: null,
        multipart: false,
      },
    }),
  });
}

async function callAction(pathname = "guides/anything/cover.png"): Promise<unknown> {
  return action({ request: makeRequest(pathname), params: {}, context: {} } as never);
}

/** ルートが handleUpload に渡したオプション（＝コールバック）を取り出す */
function lastHandleUploadOptions(): HandleUploadOptions {
  const call = blobClientMocks.handleUpload.mock.calls.at(-1);
  if (!call) throw new Error("handleUpload が呼ばれていない");
  return call[0] as HandleUploadOptions;
}

/** ルート経由で onBeforeGenerateToken を取り出し、指定パスで評価する */
async function generateTokenFor(pathname: string) {
  await callAction(pathname);
  return lastHandleUploadOptions().onBeforeGenerateToken(pathname, null, false);
}

function signInAs(discordId: string) {
  authMocks.getSession.mockResolvedValue({ user: { id: discordId } });
}

async function setupUser() {
  const user = await seedUser(db, { slug: "author", discordId: "discord-author" });
  signInAs("discord-author");
  return user;
}

beforeEach(async () => {
  vi.clearAllMocks();
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
  process.env.TURSO_DATABASE_URL = SHARED_MEMORY_URL;
  process.env.BETTER_AUTH_SECRET = "test-secret";
  process.env.APP_URL = "https://minefolio.app";
  db = await createTestDbAt(SHARED_MEMORY_URL);
  authMocks.getSession.mockResolvedValue(null);
  blobClientMocks.handleUpload.mockResolvedValue({
    type: "blob.generate-client-token",
    clientToken: "test-token",
  });
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe("認証ゲート", () => {
  it("未ログインは 401 でトークン発行処理に入らない", async () => {
    const res = (await callAction()) as Response;

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(blobClientMocks.handleUpload).not.toHaveBeenCalled();
  });

  it("セッションはあるが users 行が無ければ 404 でトークン発行処理に入らない", async () => {
    signInAs("discord-unknown");

    const res = (await callAction()) as Response;

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "User not found" });
    expect(blobClientMocks.handleUpload).not.toHaveBeenCalled();
  });

  it("ログイン済みなら handleUpload に処理を委譲する", async () => {
    await setupUser();

    const result = await callAction();

    expect(blobClientMocks.handleUpload).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ type: "blob.generate-client-token", clientToken: "test-token" });
  });
});

describe("POST のボディ検証", () => {
  it("壊れた JSON は 400 で handleUpload を呼ばない", async () => {
    await setupUser();

    const res = (await action({
      request: new Request("https://minefolio.app/api/me/guides/upload-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not valid json",
      }),
      params: {},
      context: {},
    } as never)) as Response;

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid JSON" });
    expect(blobClientMocks.handleUpload).not.toHaveBeenCalled();
  });

  it("ボディが null（JSON としては妥当）は 400 で handleUpload を呼ばない", async () => {
    await setupUser();

    const res = (await action({
      request: new Request("https://minefolio.app/api/me/guides/upload-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "null",
      }),
      params: {},
      context: {},
    } as never)) as Response;

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid request" });
    expect(blobClientMocks.handleUpload).not.toHaveBeenCalled();
  });
});

describe("onBeforeGenerateToken のパス検証", () => {
  it("他ユーザーの guides 配下は拒否する", async () => {
    const user = await setupUser();
    const other = await seedUser(db, { slug: "other", discordId: "discord-other" });
    expect(other.id).not.toBe(user.id);

    await expect(generateTokenFor(`guides/${other.id}/cover.png`)).rejects.toThrow("Invalid path");
  });

  it("'..' セグメントを含むパスは拒否する（パストラバーサル）", async () => {
    const user = await setupUser();

    await expect(generateTokenFor(`guides/${user.id}/../other/cover.png`)).rejects.toThrow(
      "Invalid path",
    );
  });

  it("接頭辞が別ディレクトリ（skins）のパスは拒否する", async () => {
    const user = await setupUser();

    await expect(generateTokenFor(`skins/${user.id}/skin.png`)).rejects.toThrow("Invalid path");
  });

  it("ユーザーIDが前方一致するだけの別ディレクトリは拒否する", async () => {
    const user = await setupUser();

    await expect(generateTokenFor(`guides/${user.id}-evil/cover.png`)).rejects.toThrow(
      "Invalid path",
    );
  });

  it("先頭スラッシュ付きの絶対パスは拒否する", async () => {
    const user = await setupUser();

    await expect(generateTokenFor(`/guides/${user.id}/cover.png`)).rejects.toThrow("Invalid path");
  });

  it("自分の guides 配下なら画像4種・15MB 上限のトークン設定を返す", async () => {
    const user = await setupUser();

    const result = await generateTokenFor(`guides/${user.id}/cover.png`);

    expect(result).toMatchObject({
      allowedContentTypes: GUIDE_IMAGE_CONTENT_TYPES,
      maximumSizeInBytes: GUIDE_IMAGE_MAX_BYTES,
      addRandomSuffix: true,
    });
  });
});
