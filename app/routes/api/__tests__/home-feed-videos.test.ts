import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createTestDbAt,
  seedUser,
  daysAgo,
  schema,
  type TestDb,
} from "@/lib/__tests__/helpers/test-db";
import { invalidateCache } from "@/lib/cache";
import { loader } from "../home-feed";

// youtube-videos / twitch-vods ケースはどちらもキャッシュテーブル（cron蓄積）からの読み出しで、
// getPublicVideoFeed に委譲される。外部APIは呼ばれないため、実DBに行をシードして
// 可視性join・保持期間・件数・FeedVideo形式のレスポンスを検証する。

const SHARED_URL = "file::memory:?cache=shared";

let db: TestDb;
let originalUrl: string | undefined;

async function callLoader(type: "twitch-vods" | "youtube-videos" = "twitch-vods"): Promise<Response> {
  const request = new Request(`https://minefolio.app/api/home-feed?type=${type}`);
  return loader({ request, params: {}, context: {} } as never);
}

beforeEach(async () => {
  originalUrl = process.env.TURSO_DATABASE_URL;
  process.env.TURSO_DATABASE_URL = SHARED_URL;
  db = await createTestDbAt(SHARED_URL);
  // getPublicVideoFeed のメモリキャッシュを毎テスト無効化する
  await invalidateCache("videos:feed:all");
});

afterEach(() => {
  if (originalUrl === undefined) delete process.env.TURSO_DATABASE_URL;
  else process.env.TURSO_DATABASE_URL = originalUrl;
});

async function seedTwitchUser(slug: string, login: string, overrides: Record<string, unknown> = {}) {
  const user = await seedUser(db, {
    slug,
    mcid: slug,
    uuid: `uuid-${slug}`,
    role: "runner",
    profileVisibility: "public",
    ...overrides,
  });
  await db.insert(schema.socialLinks).values({
    userId: user.id,
    platform: "twitch",
    identifier: login,
  });
  return user;
}

async function seedVod(overrides: Partial<typeof schema.twitchVodCache.$inferInsert> = {}) {
  const [row] = await db
    .insert(schema.twitchVodCache)
    .values({
      vodId: overrides.vodId ?? String(Math.floor(Math.random() * 1_000_000_000)),
      userLogin: "runnertv",
      title: "Any% practice",
      channelTitle: "RunnerTV",
      thumbnailUrl: "https://example.com/thumb.jpg",
      durationSeconds: 3600,
      publishedAt: daysAgo(1),
      ...overrides,
    })
    .returning();
  return row;
}

describe("/api/home-feed?type=twitch-vods（キャッシュテーブル読み）", () => {
  it("VODをユーザー情報付きで新しい順に返す", async () => {
    await seedTwitchUser("runner1", "runnertv", { displayName: "Runner One" });
    await seedVod({ vodId: "111", publishedAt: daysAgo(2) });
    await seedVod({ vodId: "222", title: "RSG run", publishedAt: daysAgo(1) });

    const res = await callLoader();

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=900");
    const body = await res.json();
    expect(body.recentVods.map((v: { videoId: string }) => v.videoId)).toEqual(["222", "111"]);
    expect(body.recentVods[0]).toMatchObject({
      platform: "twitch",
      videoId: "222",
      title: "RSG run",
      channelTitle: "RunnerTV",
      durationSeconds: 3600,
      minefolioMcid: "runner1",
      uuid: "uuid-runner1",
      slug: "runner1",
      displayName: "Runner One",
    });
  });

  it("保持期間（90日）より古いVOD・削除済みマークのVODは含めない", async () => {
    await seedTwitchUser("runner1", "runnertv");
    await seedVod({ vodId: "recent", publishedAt: daysAgo(89) });
    await seedVod({ vodId: "old", publishedAt: daysAgo(91) });
    await seedVod({ vodId: "gone", publishedAt: daysAgo(1), isAvailable: false });

    const res = await callLoader();
    const body = await res.json();

    expect(body.recentVods.map((v: { videoId: string }) => v.videoId)).toEqual(["recent"]);
  });

  it("非公開プロフィール・リンク未登録のVODは出さない", async () => {
    await seedTwitchUser("hidden", "hiddentv", { profileVisibility: "private" });
    await seedVod({ vodId: "h1", userLogin: "hiddentv" });
    await seedVod({ vodId: "n1", userLogin: "nolink" });

    const res = await callLoader();
    const body = await res.json();

    expect(body.recentVods).toEqual([]);
  });

  it("最大10件に制限される", async () => {
    await seedTwitchUser("runner1", "runnertv");
    for (let i = 0; i < 12; i++) {
      await seedVod({ vodId: `vod-${i}`, publishedAt: daysAgo(i / 24 + 0.01) });
    }

    const res = await callLoader();
    const body = await res.json();

    expect(body.recentVods).toHaveLength(10);
  });
});

describe("/api/home-feed?type=youtube-videos（キャッシュテーブル読み・FeedVideo形式）", () => {
  async function seedYtVideo(overrides: Partial<typeof schema.youtubeVideoCache.$inferInsert> = {}) {
    await db.insert(schema.youtubeVideoCache).values({
      videoId: overrides.videoId ?? `yt-${Math.random().toString(36).slice(2, 10)}`,
      channelId: "UCtest",
      title: "YT video",
      publishedAt: daysAgo(1),
      ...overrides,
    });
  }

  it("動画を FeedVideo 形式・ユーザー情報付きで新しい順に返す", async () => {
    await seedUser(db, {
      slug: "runner1",
      mcid: "runner1",
      uuid: "uuid-runner1",
      displayName: "Runner One",
      role: "runner",
      profileVisibility: "public",
    });
    await seedYtVideo({ videoId: "y1", minefolioMcid: "runner1", title: "PB run", publishedAt: daysAgo(1) });
    await seedYtVideo({ videoId: "y2", minefolioMcid: "runner1", publishedAt: daysAgo(2) });

    const res = await callLoader("youtube-videos");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recentVideos.map((v: { videoId: string }) => v.videoId)).toEqual(["y1", "y2"]);
    expect(body.recentVideos[0]).toMatchObject({
      platform: "youtube",
      videoId: "y1",
      title: "PB run",
      minefolioMcid: "runner1",
      uuid: "uuid-runner1",
      slug: "runner1",
      displayName: "Runner One",
    });
  });

  it("非公開プロフィールに紐付く動画は出さない（可視性ゲートは /videos と共通）", async () => {
    await seedUser(db, {
      slug: "hidden",
      mcid: "hidden",
      role: "runner",
      profileVisibility: "private",
    });
    await seedYtVideo({ videoId: "h1", minefolioMcid: "hidden" });

    const res = await callLoader("youtube-videos");
    const body = await res.json();

    expect(body.recentVideos).toEqual([]);
  });
});
