import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// YouTube キャッシュ層は DB/スキーマを取り込むため、認証ゲートのみを検証できるよう
// モック化する。認証で拒否された場合にこれらが呼ばれないことも併せて確認する。
// vi.mock は先頭へ巻き上げられるため、モック関数は vi.hoisted で用意する。
const youtubeCacheMocks = vi.hoisted(() => ({
  fetchAndCacheNewVideos: vi.fn(),
  verifyVideosExistence: vi.fn(),
  getRegisteredYouTubeChannels: vi.fn(),
  fetchAndCacheLiveStreams: vi.fn(),
  cleanupOldLiveCache: vi.fn(),
}));

vi.mock("@/lib/youtube-cache", () => youtubeCacheMocks);

import { loader } from "../youtube-update";

function makeRequest(authHeader?: string, action?: string) {
  const url = action
    ? `https://minefolio.app/api/cron/youtube-update?action=${action}`
    : "https://minefolio.app/api/cron/youtube-update";
  const headers = new Headers();
  if (authHeader !== undefined) {
    headers.set("Authorization", authHeader);
  }
  return new Request(url, { headers });
}

const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;
const ORIGINAL_YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

describe("youtube-update cron auth gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // action ディスパッチまで到達した場合でも実 API を叩かないよう既定の戻り値を用意
    youtubeCacheMocks.getRegisteredYouTubeChannels.mockResolvedValue([]);
    process.env.YOUTUBE_API_KEY = "test-youtube-key";
  });

  afterEach(() => {
    if (ORIGINAL_CRON_SECRET === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
    }
    if (ORIGINAL_YOUTUBE_API_KEY === undefined) {
      delete process.env.YOUTUBE_API_KEY;
    } else {
      process.env.YOUTUBE_API_KEY = ORIGINAL_YOUTUBE_API_KEY;
    }
  });

  it("CRON_SECRET 未設定時は 503 でフェイルクローズし、YouTube API を呼ばない", async () => {
    delete process.env.CRON_SECRET;

    const res = await loader({ request: makeRequest(undefined, "update") });

    expect(res.status).toBe(503);
    expect(youtubeCacheMocks.getRegisteredYouTubeChannels).not.toHaveBeenCalled();
    expect(youtubeCacheMocks.fetchAndCacheNewVideos).not.toHaveBeenCalled();
    expect(youtubeCacheMocks.verifyVideosExistence).not.toHaveBeenCalled();
    expect(youtubeCacheMocks.fetchAndCacheLiveStreams).not.toHaveBeenCalled();
  });

  it("CRON_SECRET 空文字も未設定扱いで 503", async () => {
    process.env.CRON_SECRET = "";

    const res = await loader({ request: makeRequest("Bearer ", "verify") });

    expect(res.status).toBe(503);
    expect(youtubeCacheMocks.verifyVideosExistence).not.toHaveBeenCalled();
  });

  it("CRON_SECRET 設定済みでトークン欠落なら 401、YouTube API を呼ばない", async () => {
    process.env.CRON_SECRET = "s3cret";

    const res = await loader({ request: makeRequest(undefined, "update") });

    expect(res.status).toBe(401);
    expect(youtubeCacheMocks.getRegisteredYouTubeChannels).not.toHaveBeenCalled();
    expect(youtubeCacheMocks.fetchAndCacheNewVideos).not.toHaveBeenCalled();
  });

  it("CRON_SECRET 設定済みでトークン不一致なら 401", async () => {
    process.env.CRON_SECRET = "s3cret";

    const res = await loader({ request: makeRequest("Bearer wrong", "live") });

    expect(res.status).toBe(401);
    expect(youtubeCacheMocks.fetchAndCacheLiveStreams).not.toHaveBeenCalled();
  });

  it("正しい Bearer トークンなら通過して処理へ進む", async () => {
    process.env.CRON_SECRET = "s3cret";

    const res = await loader({ request: makeRequest("Bearer s3cret", "update") });

    expect(res.status).toBe(200);
    // 認証を通過したので action ディスパッチ（チャンネル取得）まで到達している
    expect(youtubeCacheMocks.getRegisteredYouTubeChannels).toHaveBeenCalledTimes(1);
  });
});
