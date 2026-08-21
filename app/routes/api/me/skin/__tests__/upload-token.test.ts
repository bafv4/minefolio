// POST /api/me/skin/upload-token のアップロード認可の回帰テスト。
//
// このエンドポイントは「クライアントが直接 Vercel Blob へ書き込むための署名トークン」を発行する。
// つまり onBeforeGenerateToken が最後の関門で、ここを緩めると他人の skins/<userId>/ 配下や
// 任意パスへ書き込めるトークンを配ってしまう（発行後はサーバーを経由しないので取り返せない）。
//
// handleUpload（@vercel/blob/client）は外部サービスへの署名処理なのでモックし、
// ルートが渡したコールバックを取り出して直接評価する。DB とユーザー解決は実DBのまま。
// セッションは @/lib/session ではなく auth.api.getSession の直呼びなので、
// @/lib/auth の createAuth を差し替える。
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

import { action } from "../upload-token";

// 実装（app/routes/api/me/skin/upload-token.ts）と同じ値
const SKIN_MAX_BYTES = 1 * 1024 * 1024;

const ENV_KEYS = ["TURSO_DATABASE_URL", "BETTER_AUTH_SECRET", "APP_URL"] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

let db: TestDb;

function makeRequest(pathname: string): Request {
  return new Request("https://minefolio.app/api/me/skin/upload-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "blob.generate-client-token",
      payload: {
        pathname,
        callbackUrl: "https://minefolio.app/api/me/skin/upload-token",
        clientPayload: null,
        multipart: false,
      },
    }),
  });
}

async function callAction(pathname = "skins/anything/skin.png"): Promise<Response> {
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
  const user = await seedUser(db, { slug: "runner", discordId: "discord-runner" });
  signInAs("discord-runner");
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
    const res = await callAction();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(blobClientMocks.handleUpload).not.toHaveBeenCalled();
  });

  it("セッションはあるが users 行が無ければ 404 でトークン発行処理に入らない", async () => {
    signInAs("discord-unknown");

    const res = await callAction();

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "User not found" });
    expect(blobClientMocks.handleUpload).not.toHaveBeenCalled();
  });

  it("ログイン済みなら handleUpload に処理を委譲する", async () => {
    await setupUser();

    const res = await callAction();

    expect(res.status).toBe(200);
    expect(blobClientMocks.handleUpload).toHaveBeenCalledTimes(1);
    expect(await res.json()).toEqual({
      type: "blob.generate-client-token",
      clientToken: "test-token",
    });
  });
});

describe("onBeforeGenerateToken のパス検証", () => {
  it("他ユーザーの skins 配下は拒否する", async () => {
    const user = await setupUser();
    const other = await seedUser(db, { slug: "other", discordId: "discord-other" });
    expect(other.id).not.toBe(user.id);

    await expect(generateTokenFor(`skins/${other.id}/skin.png`)).rejects.toThrow(
      "Invalid upload path",
    );
  });

  it("'..' セグメントを含むパスは拒否する（パストラバーサル）", async () => {
    const user = await setupUser();

    await expect(generateTokenFor(`skins/${user.id}/../other/skin.png`)).rejects.toThrow(
      "Invalid upload path",
    );
  });

  it("末尾に '..' を付けたパスも拒否する", async () => {
    const user = await setupUser();

    await expect(generateTokenFor(`skins/${user.id}/..`)).rejects.toThrow("Invalid upload path");
  });

  it("接頭辞が別ディレクトリのパスは拒否する", async () => {
    const user = await setupUser();

    await expect(generateTokenFor(`guides/${user.id}/cover.png`)).rejects.toThrow(
      "Invalid upload path",
    );
  });

  it("ユーザーIDが前方一致するだけの別ディレクトリは拒否する", async () => {
    const user = await setupUser();

    await expect(generateTokenFor(`skins/${user.id}-evil/skin.png`)).rejects.toThrow(
      "Invalid upload path",
    );
  });

  it("先頭スラッシュ付きの絶対パスは拒否する", async () => {
    const user = await setupUser();

    await expect(generateTokenFor(`/skins/${user.id}/skin.png`)).rejects.toThrow(
      "Invalid upload path",
    );
  });

  it("自分の skins 配下なら PNG・1MB 上限のトークン設定を返す", async () => {
    const user = await setupUser();

    const result = await generateTokenFor(`skins/${user.id}/skin.png`);

    expect(result).toMatchObject({
      allowedContentTypes: ["image/png"],
      maximumSizeInBytes: SKIN_MAX_BYTES,
      addRandomSuffix: true,
    });
    expect(JSON.parse(String(result.tokenPayload))).toEqual({ userId: user.id });
  });
});
