import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createTestDbAt,
  seedUser,
  schema,
  type TestDb,
} from "./helpers/test-db";

// Twitch API層はモックし、蓄積（upsert）・存在確認・クリーンアップのDB挙動を実DBで検証する
const twitchMocks = vi.hoisted(() => ({
  getTwitchAppToken: vi.fn(),
  getRecentVods: vi.fn(),
  getVodsByIds: vi.fn(),
}));

vi.mock("../twitch", () => twitchMocks);

import {
  fetchAndCacheNewVods,
  verifyVodsExistence,
  cleanupOldVods,
} from "../twitch-vod-cache";
import { eq } from "drizzle-orm";

const SHARED_URL = "file::memory:?cache=shared";

let db: TestDb;
let originalUrl: string | undefined;

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function makeApiVod(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "111",
    userLogin: "runnertv",
    userName: "RunnerTV",
    title: "Any% practice",
    url: "https://www.twitch.tv/videos/111",
    thumbnailUrl: "https://example.com/thumb.jpg",
    publishedAt: daysAgo(1).toISOString(),
    durationSeconds: 3600,
    ...overrides,
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  originalUrl = process.env.TURSO_DATABASE_URL;
  process.env.TURSO_DATABASE_URL = SHARED_URL;
  db = await createTestDbAt(SHARED_URL);

  twitchMocks.getTwitchAppToken.mockResolvedValue("test-app-token");
  twitchMocks.getRecentVods.mockResolvedValue([]);
  twitchMocks.getVodsByIds.mockResolvedValue(new Set());
});

afterEach(() => {
  if (originalUrl === undefined) delete process.env.TURSO_DATABASE_URL;
  else process.env.TURSO_DATABASE_URL = originalUrl;
});

async function seedTwitchUser(slug: string, login: string) {
  const user = await seedUser(db, {
    slug,
    mcid: slug,
    uuid: `uuid-${slug}`,
    role: "runner",
    profileVisibility: "public",
  });
  await db.insert(schema.socialLinks).values({
    userId: user.id,
    platform: "twitch",
    identifier: login,
  });
  return user;
}

describe("fetchAndCacheNewVods", () => {
  it("新規VODを挿入し、既存VODは更新する（配信時間の確定など）", async () => {
    await seedTwitchUser("runner1", "runnertv");
    twitchMocks.getRecentVods.mockResolvedValue([
      makeApiVod({ id: "111", durationSeconds: 600 }),
    ]);

    const first = await fetchAndCacheNewVods("cid", "secret");
    expect(first).toMatchObject({ added: 1, updated: 0, channels: 1 });

    // 同じVODが配信終了後に duration 確定・タイトル変更されたケース
    twitchMocks.getRecentVods.mockResolvedValue([
      makeApiVod({ id: "111", durationSeconds: 7200, title: "Renamed" }),
    ]);
    const second = await fetchAndCacheNewVods("cid", "secret");
    expect(second).toMatchObject({ added: 0, updated: 1 });

    const rows = await db.query.twitchVodCache.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      vodId: "111",
      title: "Renamed",
      durationSeconds: 7200,
      isAvailable: true,
    });
  });

  it("公開Twitchリンクが無ければ外部APIを呼ばない", async () => {
    const result = await fetchAndCacheNewVods("cid", "secret");
    expect(result).toMatchObject({ added: 0, updated: 0, channels: 0 });
    expect(twitchMocks.getTwitchAppToken).not.toHaveBeenCalled();
    expect(twitchMocks.getRecentVods).not.toHaveBeenCalled();
  });
});

describe("verifyVodsExistence", () => {
  it("存在しないVODを isAvailable=false にマークし、存在するVODは検証日時を更新する", async () => {
    const stale = daysAgo(1); // VERIFICATION_INTERVAL(12h) より古い
    await db.insert(schema.twitchVodCache).values([
      { vodId: "alive", userLogin: "runnertv", title: "a", publishedAt: daysAgo(5), lastVerifiedAt: stale },
      { vodId: "deleted", userLogin: "runnertv", title: "b", publishedAt: daysAgo(5), lastVerifiedAt: stale },
    ]);
    twitchMocks.getVodsByIds.mockResolvedValue(new Set(["alive"]));

    const result = await verifyVodsExistence("cid", "secret");

    expect(result).toEqual({ verified: 1, removed: 1 });
    const aliveRow = await db.query.twitchVodCache.findFirst({
      where: eq(schema.twitchVodCache.vodId, "alive"),
    });
    const deletedRow = await db.query.twitchVodCache.findFirst({
      where: eq(schema.twitchVodCache.vodId, "deleted"),
    });
    expect(aliveRow?.isAvailable).toBe(true);
    expect(aliveRow!.lastVerifiedAt.getTime()).toBeGreaterThan(stale.getTime());
    expect(deletedRow?.isAvailable).toBe(false);
  });

  it("直近に検証済みのVODは再検証しない", async () => {
    await db.insert(schema.twitchVodCache).values({
      vodId: "fresh",
      userLogin: "runnertv",
      title: "a",
      publishedAt: daysAgo(1),
      lastVerifiedAt: new Date(),
    });

    const result = await verifyVodsExistence("cid", "secret");

    expect(result).toEqual({ verified: 0, removed: 0 });
    expect(twitchMocks.getVodsByIds).not.toHaveBeenCalled();
  });
});

describe("cleanupOldVods", () => {
  it("保持期間（90日）を超えた行のみ削除する", async () => {
    await db.insert(schema.twitchVodCache).values([
      { vodId: "keep", userLogin: "a", title: "a", publishedAt: daysAgo(89) },
      { vodId: "drop", userLogin: "a", title: "b", publishedAt: daysAgo(91) },
    ]);

    const removed = await cleanupOldVods();

    expect(removed).toBe(1);
    const rows = await db.query.twitchVodCache.findMany();
    expect(rows.map((r) => r.vodId)).toEqual(["keep"]);
  });
});
