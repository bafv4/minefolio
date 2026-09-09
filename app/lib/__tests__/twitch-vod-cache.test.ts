import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createTestDbAt,
  seedUser,
  daysAgo,
  schema,
  type TestDb,
} from "./helpers/test-db";
import { invalidateCache } from "../cache";

// Twitch API層はモックし、蓄積（upsert）・存在確認・クリーンアップのDB挙動を実DBで検証する
const twitchMocks = vi.hoisted(() => ({
  getTwitchAppToken: vi.fn(),
  getRecentVods: vi.fn(),
  getVodsByIds: vi.fn(),
}));

vi.mock("../twitch", () => twitchMocks);

import {
  applyFetchedVods,
  fetchAndCacheNewVods,
  verifyVodsExistence,
  cleanupOldVods,
} from "../twitch-vod-cache";
import { eq } from "drizzle-orm";
import type { TwitchVod } from "../twitch";

const SHARED_URL = "file::memory:?cache=shared";

let db: TestDb;
let originalUrl: string | undefined;

function makeApiVod(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "111",
    userLogin: "runnertv",
    userName: "RunnerTV",
    title: "Any% practice",
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
  await invalidateCache("videos:feed:all");

  twitchMocks.getTwitchAppToken.mockResolvedValue("test-app-token");
  twitchMocks.getRecentVods.mockResolvedValue({ vods: new Map(), failedLogins: new Set() });
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
    twitchMocks.getRecentVods.mockResolvedValue({
      vods: new Map([["runnertv", [makeApiVod({ id: "111", durationSeconds: 600 })]]]),
      failedLogins: new Set(),
    });

    const first = await fetchAndCacheNewVods("cid", "secret");
    expect(first).toMatchObject({ added: 1, updated: 0, channels: 1 });

    // 同じVODが配信終了後に duration 確定・タイトル変更されたケース
    twitchMocks.getRecentVods.mockResolvedValue({
      vods: new Map([["runnertv", [makeApiVod({ id: "111", durationSeconds: 7200, title: "Renamed" })]]]),
      failedLogins: new Set(),
    });
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

  it("公開Twitchリンクが無ければVOD取得APIを呼ばない", async () => {
    const result = await fetchAndCacheNewVods("cid", "secret");
    expect(result).toMatchObject({ added: 0, updated: 0, channels: 0 });
    // トークン取得はリンク一覧と並列のため呼ばれ得るが、VOD取得までは進まない
    expect(twitchMocks.getRecentVods).not.toHaveBeenCalled();
  });
});

// applyFetchedVods は差分削除ロジックの本体。fetchAndCacheNewVods（cron 全チャンネル一括）と
// targeted-refresh.server.ts の refreshTwitchVodsForLogin（1チャンネル即時）の両方から呼ばれる
// 共通部品のため、getRecentVods の Map/Set をモックではなく直接組み立てて検証する
describe("applyFetchedVods", () => {
  it("判定不能（vodsにキーが無い）チャンネルは差分削除の対象にならない", async () => {
    // API失敗チャンネル分の既存キャッシュ行（保持期間内）
    await db.insert(schema.twitchVodCache).values({
      vodId: "old1",
      userLogin: "faileduser",
      title: "t",
      publishedAt: daysAgo(1),
    });

    // vods マップに faileduser のキーが無い＝判定不能（フェイルオープン）
    const result = await applyFetchedVods(new Map());

    expect(result).toEqual({ added: 0, updated: 0, deleted: 0 });
    const rows = await db.query.twitchVodCache.findMany();
    expect(rows.map((r) => r.vodId)).toEqual(["old1"]);
  });

  it("成功チャンネルでは応答に無い行（保持期間内）が削除される", async () => {
    await db.insert(schema.twitchVodCache).values([
      { vodId: "keep", userLogin: "runner1", title: "a", publishedAt: daysAgo(1) },
      { vodId: "gone", userLogin: "runner1", title: "b", publishedAt: daysAgo(2) },
    ]);

    const vods = new Map<string, TwitchVod[]>([["runner1", [makeApiVod({ id: "keep" })]]]);
    const result = await applyFetchedVods(vods);

    expect(result).toMatchObject({ deleted: 1 });
    const rows = await db.query.twitchVodCache.findMany();
    expect(rows.map((r) => r.vodId)).toEqual(["keep"]);
  });

  it("チャンネル全非公開（空応答成功）で保持期間内の全行が削除される", async () => {
    await db.insert(schema.twitchVodCache).values([
      { vodId: "gone1", userLogin: "runner1", title: "a", publishedAt: daysAgo(1) },
      { vodId: "gone2", userLogin: "runner1", title: "b", publishedAt: daysAgo(2) },
    ]);

    // 取得自体は成功したが0件（=全VODが非公開化された）を表す
    const vods = new Map<string, TwitchVod[]>([["runner1", []]]);
    const result = await applyFetchedVods(vods);

    expect(result).toMatchObject({ deleted: 2 });
    const rows = await db.query.twitchVodCache.findMany();
    expect(rows).toHaveLength(0);
  });

  it("ページング打ち切り（incompleteLogins）チャンネルは upsert はされるが差分削除されない", async () => {
    await db.insert(schema.twitchVodCache).values({
      vodId: "old-beyond-pages",
      userLogin: "runner1",
      title: "501件目以降で今回取得できなかったVOD",
      publishedAt: daysAgo(30),
    });

    const vods = new Map<string, TwitchVod[]>([["runner1", [makeApiVod({ id: "new1" })]]]);
    const result = await applyFetchedVods(vods, new Set(["runner1"]));

    // 取得分は追加されるが、応答に無い既存行は削除されない
    expect(result).toMatchObject({ added: 1, deleted: 0 });
    const rows = await db.query.twitchVodCache.findMany();
    expect(rows.map((r) => r.vodId).sort()).toEqual(["new1", "old-beyond-pages"]);
  });

  it("保持期間を超えた行は差分削除の対象にならない（cleanupOldVods の担当のため）", async () => {
    await db.insert(schema.twitchVodCache).values({
      vodId: "expired",
      userLogin: "runner1",
      title: "old",
      publishedAt: daysAgo(91), // 保持期間（90日）超過
    });

    const vods = new Map<string, TwitchVod[]>([["runner1", []]]);
    const result = await applyFetchedVods(vods);

    expect(result).toMatchObject({ deleted: 0 });
    const rows = await db.query.twitchVodCache.findMany();
    expect(rows.map((r) => r.vodId)).toEqual(["expired"]);
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
