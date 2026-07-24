import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// VODキャッシュ層はDB/スキーマを取り込むため、認証ゲートのみを検証できるようモック化する。
// 認証で拒否された場合にこれらが呼ばれないことも併せて確認する。
const vodCacheMocks = vi.hoisted(() => ({
  fetchAndCacheNewVods: vi.fn(),
  verifyVodsExistence: vi.fn(),
  cleanupOldVods: vi.fn(),
}));

vi.mock("@/lib/twitch-vod-cache", () => vodCacheMocks);

import { loader } from "../twitch-update";

function makeRequest(authHeader?: string, action?: string) {
  const url = action
    ? `https://minefolio.app/api/cron/twitch-update?action=${action}`
    : "https://minefolio.app/api/cron/twitch-update";
  const headers = new Headers();
  if (authHeader !== undefined) {
    headers.set("Authorization", authHeader);
  }
  return new Request(url, { headers });
}

const ENV_KEYS = ["CRON_SECRET", "TWITCH_CLIENT_ID", "TWITCH_CLIENT_SECRET"] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

describe("twitch-update cron auth gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of ENV_KEYS) {
      originalEnv[key] = process.env[key];
    }
    process.env.TWITCH_CLIENT_ID = "test-twitch-id";
    process.env.TWITCH_CLIENT_SECRET = "test-twitch-secret";
    vodCacheMocks.fetchAndCacheNewVods.mockResolvedValue({ added: 0, updated: 0, channels: 0 });
    vodCacheMocks.verifyVodsExistence.mockResolvedValue({ verified: 0, removed: 0 });
    vodCacheMocks.cleanupOldVods.mockResolvedValue(0);
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  });

  it("CRON_SECRET 未設定時は 503 でフェイルクローズし、Twitch API を呼ばない", async () => {
    delete process.env.CRON_SECRET;

    const res = await loader({ request: makeRequest(undefined, "update") });

    expect(res.status).toBe(503);
    expect(vodCacheMocks.fetchAndCacheNewVods).not.toHaveBeenCalled();
    expect(vodCacheMocks.verifyVodsExistence).not.toHaveBeenCalled();
  });

  it("CRON_SECRET 設定済みでトークン欠落・不一致なら 401", async () => {
    process.env.CRON_SECRET = "s3cret";

    const missing = await loader({ request: makeRequest(undefined, "update") });
    expect(missing.status).toBe(401);

    const wrong = await loader({ request: makeRequest("Bearer wrong", "verify") });
    expect(wrong.status).toBe(401);

    expect(vodCacheMocks.fetchAndCacheNewVods).not.toHaveBeenCalled();
    expect(vodCacheMocks.verifyVodsExistence).not.toHaveBeenCalled();
  });

  it("正しいトークン + action=update で取得とクリーンアップを実行する", async () => {
    process.env.CRON_SECRET = "s3cret";
    vodCacheMocks.fetchAndCacheNewVods.mockResolvedValue({ added: 2, updated: 1, channels: 3 });
    vodCacheMocks.cleanupOldVods.mockResolvedValue(5);

    const res = await loader({ request: makeRequest("Bearer s3cret", "update") });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: true,
      action: "update",
      added: 2,
      updated: 1,
      channels: 3,
      cleaned: 5,
    });
    expect(vodCacheMocks.verifyVodsExistence).not.toHaveBeenCalled();
  });

  it("正しいトークン + action=verify で存在確認を実行する", async () => {
    process.env.CRON_SECRET = "s3cret";
    vodCacheMocks.verifyVodsExistence.mockResolvedValue({ verified: 4, removed: 2 });

    const res = await loader({ request: makeRequest("Bearer s3cret", "verify") });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: true,
      action: "verify",
      verified: 4,
      removed: 2,
    });
    expect(vodCacheMocks.fetchAndCacheNewVods).not.toHaveBeenCalled();
  });

  it("Twitch認証情報が未設定なら 500", async () => {
    process.env.CRON_SECRET = "s3cret";
    delete process.env.TWITCH_CLIENT_ID;
    delete process.env.TWITCH_CLIENT_SECRET;

    const res = await loader({ request: makeRequest("Bearer s3cret", "update") });

    expect(res.status).toBe(500);
    expect(vodCacheMocks.fetchAndCacheNewVods).not.toHaveBeenCalled();
  });
});
