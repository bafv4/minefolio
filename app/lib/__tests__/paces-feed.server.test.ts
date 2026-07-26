import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getPublicPaceFeed,
  paceFeedCacheKey,
  parsePaceSearchParams,
} from "../paces-feed.server";
import { invalidateCache } from "../cache";
import { PACE_FEED_SPLITS } from "../pace-splits";
import { createTestDbAt, seedUser, seedPace, type TestDb } from "./helpers/test-db";

// getPublicPaceFeed は渡された db で users を引くが、pacemanPaces は内部で createDb()
// （＝ process.env.TURSO_DATABASE_URL）を使う。両者を同一の共有メモリ DB に向けることで
// 実結合を検証する。libSQL の共有メモリ（file::memory:?cache=shared）はプロセス内で
// 単一の DB を共有するため、beforeEach でスキーマを貼り直して（DROP→CREATE）テスト間を隔離する。
const SHARED_URL = "file::memory:?cache=shared";

let db: TestDb;
let originalUrl: string | undefined;

// getPaceFeedBase のフィード全体キャッシュ（区間キー毎）を毎テスト消す
async function clearFeedCache() {
  await invalidateCache(paceFeedCacheKey());
  for (const split of PACE_FEED_SPLITS) {
    await invalidateCache(paceFeedCacheKey(split));
  }
}

beforeEach(async () => {
  originalUrl = process.env.TURSO_DATABASE_URL;
  process.env.TURSO_DATABASE_URL = SHARED_URL;
  db = await createTestDbAt(SHARED_URL);
  await clearFeedCache();
});

afterEach(async () => {
  await clearFeedCache();
  if (originalUrl === undefined) delete process.env.TURSO_DATABASE_URL;
  else process.env.TURSO_DATABASE_URL = originalUrl;
});

describe("getPublicPaceFeed - 可視性（F12 回帰）", () => {
  it("public ユーザーのペースのみ露出し、private / unlisted は一切漏れない", async () => {
    const pub = await seedUser(db, {
      slug: "pubby",
      mcid: "Pubby",
      uuid: "uuid-pub",
      displayName: "PubDisplay",
      customSkinUrl: "https://skins/pub.png",
      role: "runner",
      profileVisibility: "public",
    });
    const prv = await seedUser(db, {
      slug: "privy",
      mcid: "Privy",
      uuid: "uuid-prv",
      displayName: "PrivDisplay",
      customSkinUrl: "https://skins/prv.png",
      role: "runner",
      profileVisibility: "private",
    });
    const unl = await seedUser(db, {
      slug: "unl",
      mcid: "Unlisted",
      uuid: "uuid-unl",
      role: "runner",
      profileVisibility: "unlisted",
    });

    // 3 者ともペースを持つ
    await seedPace(db, { mcid: "Pubby", userId: pub.id, pacemanRunId: 1, rta: 300_000 });
    await seedPace(db, { mcid: "Privy", userId: prv.id, pacemanRunId: 2, rta: 200_000 });
    await seedPace(db, { mcid: "Unlisted", userId: unl.id, pacemanRunId: 3, rta: 250_000 });

    const feed = await getPublicPaceFeed(db, {});

    // items には public の Pubby のみ
    expect(feed.items.map((i) => i.mcid)).toEqual(["Pubby"]);

    // マップ類（表示名・UUID・スキン）に private/unlisted の mcid が現れない
    expect(Object.keys(feed.mcidToUuid)).toEqual(["pubby"]);
    expect(feed.mcidToUuid).not.toHaveProperty("privy");
    expect(feed.mcidToUuid).not.toHaveProperty("unlisted");
    expect(feed.mcidToDisplayName).not.toHaveProperty("privy");
    expect(feed.mcidToSkinUrl).not.toHaveProperty("privy");
    expect(feed.mcidToDisplayName["pubby"]).toBe("PubDisplay");
    expect(feed.mcidToSkinUrl["pubby"]).toBe("https://skins/pub.png");
  });

  it("mcid / uuid が null の public ユーザーは対象外", async () => {
    await seedUser(db, {
      slug: "nouuid",
      mcid: "NoUuid",
      uuid: null,
      role: "runner",
      profileVisibility: "public",
    });
    const feed = await getPublicPaceFeed(db, {});
    expect(feed.mcidToUuid).not.toHaveProperty("nouuid");
  });

  it("viewer ロールの public ユーザーは除外される", async () => {
    const viewer = await seedUser(db, {
      slug: "viewer",
      mcid: "Viewer",
      uuid: "uuid-viewer",
      role: "viewer",
      profileVisibility: "public",
    });
    await seedPace(db, { mcid: "Viewer", userId: viewer.id, pacemanRunId: 9 });

    const feed = await getPublicPaceFeed(db, {});
    expect(feed.items).toEqual([]);
    expect(feed.mcidToUuid).not.toHaveProperty("viewer");
  });
});

describe("getPublicPaceFeed - フィルタ", () => {
  it("player 検索で mcid の部分一致に絞る", async () => {
    const dream = await seedUser(db, {
      slug: "dream", mcid: "Dream", uuid: "u-dream", role: "runner", profileVisibility: "public",
    });
    const bob = await seedUser(db, {
      slug: "bob", mcid: "Bob", uuid: "u-bob", role: "runner", profileVisibility: "public",
    });
    await seedPace(db, { mcid: "Dream", userId: dream.id, pacemanRunId: 11 });
    await seedPace(db, { mcid: "Bob", userId: bob.id, pacemanRunId: 12 });

    const feed = await getPublicPaceFeed(db, { player: "dre" });
    expect(feed.items.map((i) => i.mcid)).toEqual(["Dream"]);
  });

  it("maxRta でタイム上限を超えるペースを除外する", async () => {
    const u = await seedUser(db, {
      slug: "u", mcid: "U", uuid: "u-u", role: "runner", profileVisibility: "public",
    });
    await seedPace(db, { mcid: "U", userId: u.id, pacemanRunId: 21, rta: 100_000 });
    await seedPace(db, { mcid: "U", userId: u.id, pacemanRunId: 22, rta: 900_000 });

    const feed = await getPublicPaceFeed(db, { maxRta: 500_000 });
    expect(feed.items.map((i) => i.rta)).toEqual([100_000]);
  });
});

describe("parsePaceSearchParams", () => {
  it("q は小文字化され、maxTime は m:ss をミリ秒に変換する", () => {
    const sp = new URLSearchParams({ q: "Dream", maxTime: "10:00" });
    const filters = parsePaceSearchParams(sp);
    expect(filters.player).toBe("dream");
    expect(filters.maxRta).toBe(600_000);
  });

  it("split は許可された区間のみ採用し、不正値は無視する", () => {
    expect(parsePaceSearchParams(new URLSearchParams({ split: "Fortress" })).timeline).toBe("Fortress");
    expect(parsePaceSearchParams(new URLSearchParams({ split: "Bogus" })).timeline).toBeUndefined();
  });

  it("from / to の日付を解釈し、不正な maxTime は undefined", () => {
    const sp = new URLSearchParams({ from: "2026-01-01", to: "2026-02-01", maxTime: "bad" });
    const filters = parsePaceSearchParams(sp);
    expect(filters.from).toBeInstanceOf(Date);
    expect(filters.to).toBeInstanceOf(Date);
    expect(filters.maxRta).toBeUndefined();
  });
});
