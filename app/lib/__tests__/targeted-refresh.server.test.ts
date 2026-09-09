// targeted-refresh.server.ts の各即時リフレッシュ関数は、プロフィール編集の action から
// レスポンスを返した後にバックグラウンドで呼ばれる想定のため、必要な環境変数
// （TWITCH_CLIENT_ID/SECRET・YOUTUBE_API_KEY）が未設定でも action をブロック・失敗させては
// いけない（ファイル冒頭のコメント参照）。ここでは env 未設定時に外部APIを一切呼ばず
// no-op で完了する（throwしない）ことを検証する。
//
// 外部API層（twitch.ts / youtube.ts / twitch-vod-cache.ts / youtube-cache.ts）はモックし、
// env 未設定時にそれらが一切呼ばれないことを確認する。DBのみを触る箇所は実DBで検証する
// （twitch-vod-cache.test.ts / youtube-cache.test.ts と同じ方針）。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createTestDbAt,
  SHARED_MEMORY_URL,
  schema,
  type TestDb,
} from "./helpers/test-db";

const twitchMocks = vi.hoisted(() => ({
  getTwitchAppToken: vi.fn(),
  getRecentVods: vi.fn(),
}));
vi.mock("../twitch", () => twitchMocks);

const twitchVodCacheMocks = vi.hoisted(() => ({
  applyFetchedVods: vi.fn(),
}));
vi.mock("../twitch-vod-cache", () => twitchVodCacheMocks);

const youtubeMocks = vi.hoisted(() => ({
  resolveChannelId: vi.fn(),
}));
vi.mock("../youtube", () => youtubeMocks);

const youtubeCacheMocks = vi.hoisted(() => ({
  fetchChannelUploadsForCache: vi.fn(),
  upsertVideoCache: vi.fn(),
}));
vi.mock("../youtube-cache", () => youtubeCacheMocks);

import {
  refreshTwitchVodsForLogin,
  refreshYoutubeForChannel,
  deleteYoutubeVideosForChannelIdentifier,
  refreshSrcRankingsForUser,
} from "../targeted-refresh.server";

const ENV_KEYS = [
  "TURSO_DATABASE_URL",
  "TWITCH_CLIENT_ID",
  "TWITCH_CLIENT_SECRET",
  "YOUTUBE_API_KEY",
] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

let db: TestDb;

beforeEach(async () => {
  vi.clearAllMocks();
  for (const key of ENV_KEYS) {
    originalEnv[key] = process.env[key];
    delete process.env[key];
  }
  process.env.TURSO_DATABASE_URL = SHARED_MEMORY_URL;
  db = await createTestDbAt(SHARED_MEMORY_URL);
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe("refreshTwitchVodsForLogin", () => {
  it("TWITCH_CLIENT_ID/SECRET未設定時はAPIを一切呼ばずno-opで完了する（throwしない）", async () => {
    await expect(refreshTwitchVodsForLogin("someuser")).resolves.toBeUndefined();

    expect(twitchMocks.getTwitchAppToken).not.toHaveBeenCalled();
    expect(twitchMocks.getRecentVods).not.toHaveBeenCalled();
    expect(twitchVodCacheMocks.applyFetchedVods).not.toHaveBeenCalled();
  });

  it("トークン取得に失敗した場合もVOD取得へ進まずno-opで完了する（throwしない）", async () => {
    process.env.TWITCH_CLIENT_ID = "cid";
    process.env.TWITCH_CLIENT_SECRET = "secret";
    twitchMocks.getTwitchAppToken.mockResolvedValue(null);

    await expect(refreshTwitchVodsForLogin("someuser")).resolves.toBeUndefined();

    expect(twitchMocks.getRecentVods).not.toHaveBeenCalled();
    expect(twitchVodCacheMocks.applyFetchedVods).not.toHaveBeenCalled();
  });
});

describe("refreshYoutubeForChannel", () => {
  it("YOUTUBE_API_KEY未設定時はAPIを一切呼ばずno-opで完了する（throwしない）", async () => {
    await expect(refreshYoutubeForChannel("@somechannel", "mcid1")).resolves.toBeUndefined();

    expect(youtubeCacheMocks.fetchChannelUploadsForCache).not.toHaveBeenCalled();
    expect(youtubeCacheMocks.upsertVideoCache).not.toHaveBeenCalled();
  });
});

describe("deleteYoutubeVideosForChannelIdentifier", () => {
  it("ハンドル形式かつYOUTUBE_API_KEY未設定時はチャンネルIDを解決できずno-opで完了する（throwしない）", async () => {
    await db.insert(schema.youtubeVideoCache).values({
      videoId: "keep1",
      channelId: "UC000000000000000000keep",
      title: "t",
      publishedAt: new Date(),
    });

    await expect(deleteYoutubeVideosForChannelIdentifier("@somehandle")).resolves.toBeUndefined();

    // apiKeyが無ければハンドル解決（resolveChannelId）自体を試みない
    expect(youtubeMocks.resolveChannelId).not.toHaveBeenCalled();

    const rows = await db.query.youtubeVideoCache.findMany();
    expect(rows).toHaveLength(1);
  });

  it("UCチャンネルID形式ならYOUTUBE_API_KEY未設定でも解決不要のため削除できる", async () => {
    await db.insert(schema.youtubeVideoCache).values({
      videoId: "gone1",
      channelId: "UC000000000000000000gone",
      title: "t",
      publishedAt: new Date(),
    });

    await expect(
      deleteYoutubeVideosForChannelIdentifier("UC000000000000000000gone"),
    ).resolves.toBeUndefined();

    expect(youtubeMocks.resolveChannelId).not.toHaveBeenCalled();
    const rows = await db.query.youtubeVideoCache.findMany();
    expect(rows).toHaveLength(0);
  });
});

describe("refreshSrcRankingsForUser", () => {
  it("該当ユーザーが存在しない場合はno-opで完了する（throwしない）", async () => {
    await expect(refreshSrcRankingsForUser("nonexistent-user-id")).resolves.toBeUndefined();
  });
});
