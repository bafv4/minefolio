import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createTestDbAt,
  seedUser,
  daysAgo,
  schema,
  type TestDb,
} from "./helpers/test-db";
import { invalidateCache } from "../cache";
import {
  getPublicVideoFeed,
  parseVideoSearchParams,
} from "../videos-feed.server";

// /videos の共通ロジック: 両テーブルのマージ・可視性・検索フィルタを実DBで検証する。
// フィード全体はメモリキャッシュ（videos:feed:all）されるため毎テスト無効化する

const SHARED_URL = "file::memory:?cache=shared";
const FEED_CACHE_KEY = "videos:feed:all";

let db: TestDb;
let originalUrl: string | undefined;

beforeEach(async () => {
  originalUrl = process.env.TURSO_DATABASE_URL;
  process.env.TURSO_DATABASE_URL = SHARED_URL;
  db = await createTestDbAt(SHARED_URL);
  await invalidateCache(FEED_CACHE_KEY);
});

afterEach(async () => {
  await invalidateCache(FEED_CACHE_KEY);
  if (originalUrl === undefined) delete process.env.TURSO_DATABASE_URL;
  else process.env.TURSO_DATABASE_URL = originalUrl;
});

async function seedLinkedUser(slug: string, { login, mcid }: { login?: string; mcid?: string }) {
  const user = await seedUser(db, {
    slug,
    mcid: mcid ?? slug,
    uuid: `uuid-${slug}`,
    displayName: `Name-${slug}`,
    role: "runner",
    profileVisibility: "public",
  });
  if (login) {
    await db.insert(schema.socialLinks).values({
      userId: user.id,
      platform: "twitch",
      identifier: login,
    });
  }
  return user;
}

async function seedYtVideo(overrides: Partial<typeof schema.youtubeVideoCache.$inferInsert> = {}) {
  await db.insert(schema.youtubeVideoCache).values({
    videoId: overrides.videoId ?? `yt-${Math.random().toString(36).slice(2, 10)}`,
    channelId: "UCtest",
    title: "YT video",
    publishedAt: daysAgo(1),
    ...overrides,
  });
}

async function seedVod(overrides: Partial<typeof schema.twitchVodCache.$inferInsert> = {}) {
  await db.insert(schema.twitchVodCache).values({
    vodId: overrides.vodId ?? `vod-${Math.random().toString(36).slice(2, 10)}`,
    userLogin: "runnertv",
    title: "VOD",
    publishedAt: daysAgo(1),
    ...overrides,
  });
}

describe("getPublicVideoFeed", () => {
  it("両テーブルをマージして新しい順に返し、ユーザー情報を紐付ける", async () => {
    await seedLinkedUser("runner1", { login: "runnertv" });
    await seedYtVideo({ videoId: "y1", minefolioMcid: "runner1", publishedAt: daysAgo(2) });
    await seedVod({ vodId: "t1", publishedAt: daysAgo(1) });

    const items = await getPublicVideoFeed(db);

    expect(items.map((v) => `${v.platform}:${v.videoId}`)).toEqual([
      "twitch:t1",
      "youtube:y1",
    ]);
    expect(items[0]).toMatchObject({ slug: "runner1", minefolioMcid: "runner1" });
    expect(items[1]).toMatchObject({ slug: "runner1", uuid: "uuid-runner1" });
  });

  it("保持期間外・削除済み・非公開ユーザー紐付けの動画を除外する", async () => {
    await seedLinkedUser("runner1", { login: "runnertv" });
    const hidden = await seedUser(db, {
      slug: "hidden",
      mcid: "hidden",
      role: "runner",
      profileVisibility: "private",
    });
    await db.insert(schema.socialLinks).values({
      userId: hidden.id,
      platform: "twitch",
      identifier: "hiddentv",
    });

    await seedYtVideo({ videoId: "keep", minefolioMcid: "runner1" });
    await seedYtVideo({ videoId: "too-old", minefolioMcid: "runner1", publishedAt: daysAgo(91) });
    await seedYtVideo({ videoId: "unavailable", minefolioMcid: "runner1", isAvailable: false });
    await seedYtVideo({ videoId: "private-user", minefolioMcid: "hidden" });
    await seedVod({ vodId: "private-vod", userLogin: "hiddentv" });
    await seedVod({ vodId: "keep-vod" });

    const items = await getPublicVideoFeed(db);

    expect(items.map((v) => v.videoId).sort()).toEqual(["keep", "keep-vod"]);
  });

  it("プラットフォーム・プレイヤー・時期フィルタが適用される", async () => {
    await seedLinkedUser("runner1", { login: "runnertv" });
    await seedLinkedUser("runner2", { login: "othertv" });
    await seedYtVideo({ videoId: "y1", minefolioMcid: "runner1", publishedAt: daysAgo(10) });
    await seedVod({ vodId: "t1", userLogin: "runnertv", publishedAt: daysAgo(5) });
    await seedVod({ vodId: "t2", userLogin: "othertv", publishedAt: daysAgo(1) });

    const platformFiltered = await getPublicVideoFeed(db, { platform: "twitch" });
    expect(platformFiltered.map((v) => v.videoId)).toEqual(["t2", "t1"]);

    await invalidateCache(FEED_CACHE_KEY);
    const playerFiltered = await getPublicVideoFeed(db, { player: "runner2" });
    expect(playerFiltered.map((v) => v.videoId)).toEqual(["t2"]);

    await invalidateCache(FEED_CACHE_KEY);
    const dateFiltered = await getPublicVideoFeed(db, { from: daysAgo(7), to: daysAgo(3) });
    expect(dateFiltered.map((v) => v.videoId)).toEqual(["t1"]);
  });
});

describe("parseVideoSearchParams", () => {
  it("有効な値を解析し、不正値は無視する", () => {
    const params = new URLSearchParams({
      q: "  Runner ",
      platform: "twitch",
      from: "2026-07-01",
      to: "2026-07-31",
    });
    const filters = parseVideoSearchParams(params);
    expect(filters.player).toBe("runner");
    expect(filters.platform).toBe("twitch");
    expect(filters.from).toBeInstanceOf(Date);
    expect(filters.to).toBeInstanceOf(Date);

    const invalid = parseVideoSearchParams(
      new URLSearchParams({ platform: "vimeo", from: "not-a-date" })
    );
    expect(invalid.platform).toBeUndefined();
    expect(invalid.from).toBeUndefined();
  });
});
