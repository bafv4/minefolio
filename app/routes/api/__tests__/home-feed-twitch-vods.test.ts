import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createTestDbAt,
  seedUser,
  schema,
  type TestDb,
} from "@/lib/__tests__/helpers/test-db";
import { loader } from "../home-feed";

// twitch-vods ケースは twitch_vod_cache テーブル（cron蓄積）からの読み出し。
// 外部APIは呼ばれないため、実DBに行をシードして可視性join・保持期間・件数を検証する。

const SHARED_URL = "file::memory:?cache=shared";

let db: TestDb;
let originalUrl: string | undefined;

async function callLoader(): Promise<Response> {
  const request = new Request("https://minefolio.app/api/home-feed?type=twitch-vods");
  return loader({ request, params: {}, context: {} } as never);
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

beforeEach(async () => {
  originalUrl = process.env.TURSO_DATABASE_URL;
  process.env.TURSO_DATABASE_URL = SHARED_URL;
  db = await createTestDbAt(SHARED_URL);
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
