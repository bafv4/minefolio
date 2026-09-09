import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createTestDbAt,
  daysAgo,
  schema,
  type TestDb,
} from "./helpers/test-db";

// fetchChannelUploadsForCache / fetchAndCacheNewVideos が使う youtube.ts（アップロード再生リスト
// 方式）はモックし、蓄積（upsert）・公開フィルタ・マッピングのロジックを実DBで検証する
// （twitch-vod-cache.test.ts が ../twitch をモックする方針と同じ）
const youtubeMocks = vi.hoisted(() => ({
  resolveUploadsPlaylists: vi.fn(),
  fetchUploadsPlaylistItems: vi.fn(),
}));

vi.mock("../youtube", () => youtubeMocks);

import {
  verifyVideosExistence,
  fetchChannelUploadsForCache,
  fetchAndCacheNewVideos,
} from "../youtube-cache";

// verifyVideosExistence の存在確認: YouTube Data API はグローバル fetch 経由のためスタブする。
// 特に「API障害時に全件を削除済み扱いにしない」（フェイルオープン）の回帰を検証する

const SHARED_URL = "file::memory:?cache=shared";

let db: TestDb;
let originalUrl: string | undefined;

function makePlaylistItem(overrides: Record<string, unknown> = {}) {
  const {
    videoId = "vid1",
    title = "Any% Run",
    description = "desc",
    channelTitle = "Channel",
    publishedAt = daysAgo(1).toISOString(),
    privacyStatus = "public",
    thumbnailUrl = "https://example.com/thumb.jpg",
  } = overrides as Record<string, string>;
  return {
    snippet: {
      title,
      description,
      channelTitle,
      publishedAt,
      thumbnails: { medium: { url: thumbnailUrl } },
      resourceId: { videoId },
    },
    status: { privacyStatus },
  };
}

async function seedVideo(videoId: string, overrides: Partial<typeof schema.youtubeVideoCache.$inferInsert> = {}) {
  await db.insert(schema.youtubeVideoCache).values({
    videoId,
    channelId: "UCtest",
    title: `video ${videoId}`,
    publishedAt: daysAgo(5),
    lastVerifiedAt: daysAgo(1), // VERIFICATION_INTERVAL(12h) より古い＝検証対象
    ...overrides,
  });
}

function stubFetchWithPublicIds(ids: string[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: ids.map((id) => ({ id, status: { privacyStatus: "public" } })),
      }),
    }),
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  originalUrl = process.env.TURSO_DATABASE_URL;
  process.env.TURSO_DATABASE_URL = SHARED_URL;
  db = await createTestDbAt(SHARED_URL);
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalUrl === undefined) delete process.env.TURSO_DATABASE_URL;
  else process.env.TURSO_DATABASE_URL = originalUrl;
});

describe("verifyVideosExistence", () => {
  it("存在しない動画のみ isAvailable=false にマークし、存在する動画は検証日時を更新する", async () => {
    await seedVideo("alive");
    await seedVideo("deleted");
    stubFetchWithPublicIds(["alive"]);

    const result = await verifyVideosExistence("test-key");

    expect(result).toEqual({ verified: 1, removed: 1 });
    const rows = await db.query.youtubeVideoCache.findMany();
    const byId = new Map(rows.map((r) => [r.videoId, r]));
    expect(byId.get("alive")?.isAvailable).toBe(true);
    expect(byId.get("deleted")?.isAvailable).toBe(false);
  });

  it("API障害時は何もマークしない（フェイルオープン。全件削除済み扱いにしない）", async () => {
    await seedVideo("v1");
    await seedVideo("v2");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }),
    );

    const result = await verifyVideosExistence("test-key");

    expect(result).toEqual({ verified: 0, removed: 0 });
    const rows = await db.query.youtubeVideoCache.findMany();
    expect(rows.every((r) => r.isAvailable)).toBe(true);
  });

  it("fetch 例外時も何もマークしない", async () => {
    await seedVideo("v1");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const result = await verifyVideosExistence("test-key");

    expect(result).toEqual({ verified: 0, removed: 0 });
    const rows = await db.query.youtubeVideoCache.findMany();
    expect(rows.every((r) => r.isAvailable)).toBe(true);
  });
});

describe("fetchChannelUploadsForCache", () => {
  beforeEach(() => {
    youtubeMocks.resolveUploadsPlaylists.mockResolvedValue(
      new Map([["UCabc", { channelId: "UCabc", uploadsPlaylistId: "PLuploads" }]]),
    );
  });

  it("privacyStatus !== 'public' の動画は除外される", async () => {
    youtubeMocks.fetchUploadsPlaylistItems.mockResolvedValue([
      makePlaylistItem({ videoId: "public1", privacyStatus: "public" }),
      makePlaylistItem({ videoId: "unlisted1", privacyStatus: "unlisted" }),
      makePlaylistItem({ videoId: "private1", privacyStatus: "private" }),
    ]);

    const result = await fetchChannelUploadsForCache("api-key", "UCabc", "steve", 10);

    expect(result.map((v) => v.videoId)).toEqual(["public1"]);
  });

  it("videoId・publishedAt が応答から正しくマッピングされる", async () => {
    const publishedAt = daysAgo(3).toISOString();
    youtubeMocks.fetchUploadsPlaylistItems.mockResolvedValue([
      makePlaylistItem({ videoId: "abc123", publishedAt, title: "Ender Dragon Kill" }),
    ]);

    const result = await fetchChannelUploadsForCache("api-key", "UCabc", "steve", 10);

    expect(result).toEqual([
      expect.objectContaining({
        videoId: "abc123",
        channelId: "UCabc",
        mcid: "steve",
        title: "Ender Dragon Kill",
        publishedAt,
      }),
    ]);
  });

  it("アップロード再生リストが解決できないチャンネルは空配列を返す", async () => {
    youtubeMocks.resolveUploadsPlaylists.mockResolvedValue(new Map());

    const result = await fetchChannelUploadsForCache("api-key", "UCunknown", "steve", 10);

    expect(result).toEqual([]);
    expect(youtubeMocks.fetchUploadsPlaylistItems).not.toHaveBeenCalled();
  });
});

describe("fetchAndCacheNewVideos", () => {
  it("11件以上のチャンネルでも全チャンネルが処理される（slice(0,10)の撤廃）", async () => {
    const channels = Array.from({ length: 11 }, (_, i) => ({
      channelId: `UC${String(i).padStart(22, "0")}`,
      mcid: `user${i}`,
    }));

    youtubeMocks.resolveUploadsPlaylists.mockImplementation(async (_apiKey: string, identifiers: string[]) => {
      const map = new Map();
      for (const id of identifiers) {
        map.set(id, { channelId: id, uploadsPlaylistId: `PL-${id}` });
      }
      return map;
    });
    youtubeMocks.fetchUploadsPlaylistItems.mockImplementation(async (_apiKey: string, playlistId: string) => {
      return [makePlaylistItem({ videoId: `v-${playlistId}` })];
    });

    const result = await fetchAndCacheNewVideos("api-key", channels);

    expect(youtubeMocks.fetchUploadsPlaylistItems).toHaveBeenCalledTimes(11);
    expect(result.added).toBe(11);

    const rows = await db.query.youtubeVideoCache.findMany();
    expect(rows).toHaveLength(11);
  });

  it("チャンネルが0件ならAPIを呼ばない", async () => {
    const result = await fetchAndCacheNewVideos("api-key", []);

    expect(result).toEqual({ added: 0, updated: 0 });
    expect(youtubeMocks.resolveUploadsPlaylists).not.toHaveBeenCalled();
  });
});
