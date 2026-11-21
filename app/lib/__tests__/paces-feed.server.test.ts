import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  comparePaceByProgress,
  getPublicPaceFeed,
  paceFeedCacheKey,
  parsePaceSearchParams,
  withPaceProfiles,
} from "../paces-feed.server";
import { USER_DATA_CACHE_KEY } from "../home-user-data.server";
import { invalidateCache } from "../cache";
import { PACE_FEED_SPLITS } from "../pace-splits";
import { createTestDbAt, seedUser, seedPace, type TestDb } from "./helpers/test-db";

// getPublicPaceFeed（getUserData 経由の users 取得）も pacemanPaces も内部で createDb()
// （＝ process.env.TURSO_DATABASE_URL）を使う。env を共有メモリ DB に向け、テストのシード用 db も
// 同じ DB に向けることで実結合を検証する。libSQL の共有メモリ（file::memory:?cache=shared）はプロセス内で
// 単一の DB を共有するため、beforeEach でスキーマを貼り直して（DROP→CREATE）テスト間を隔離する。
const SHARED_URL = "file::memory:?cache=shared";

let db: TestDb;
let originalUrl: string | undefined;

// getPaceFeedBase のフィード全体キャッシュ（区間キー毎）を毎テスト消す
async function clearFeedCache() {
  await invalidateCache(USER_DATA_CACHE_KEY);
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

    const feed = await getPublicPaceFeed({});

    // items には public の Pubby のみ
    expect(feed.items.map((i) => i.mcid)).toEqual(["Pubby"]);

    // 走者情報の取得元（共通ユーザーキャッシュ）に private/unlisted の mcid が現れない
    const { userData } = feed;
    expect(Object.keys(userData.mcidToUuid)).toEqual(["pubby"]);
    expect(userData.mcidToUuid).not.toHaveProperty("privy");
    expect(userData.mcidToUuid).not.toHaveProperty("unlisted");
    expect(userData.mcidToDisplayName).not.toHaveProperty("privy");
    expect(userData.mcidToSkinUrl).not.toHaveProperty("privy");
    expect(userData.mcidToDisplayName["pubby"]).toBe("PubDisplay");
    expect(userData.mcidToSkinUrl["pubby"]).toBe("https://skins/pub.png");

    // 応答に載せるペースへは、そのペースの mcid の走者情報だけが添えられる
    const withProfiles = withPaceProfiles(feed.items, userData);
    expect(withProfiles).toHaveLength(1);
    expect(withProfiles[0].profile).toEqual({
      uuid: "uuid-pub",
      displayName: "PubDisplay",
      skinUrl: "https://skins/pub.png",
    });
  });

  it("mcid / uuid が null の public ユーザーは対象外", async () => {
    await seedUser(db, {
      slug: "nouuid",
      mcid: "NoUuid",
      uuid: null,
      role: "runner",
      profileVisibility: "public",
    });
    const feed = await getPublicPaceFeed({});
    expect(feed.userData.mcidToUuid).not.toHaveProperty("nouuid");
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

    const feed = await getPublicPaceFeed({});
    expect(feed.items).toEqual([]);
    expect(feed.userData.mcidToUuid).not.toHaveProperty("viewer");
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

    const feed = await getPublicPaceFeed({ player: "dre" });
    expect(feed.items.map((i) => i.mcid)).toEqual(["Dream"]);
  });

  it("maxRta でタイム上限を超えるペースを除外する", async () => {
    const u = await seedUser(db, {
      slug: "u", mcid: "U", uuid: "u-u", role: "runner", profileVisibility: "public",
    });
    await seedPace(db, { mcid: "U", userId: u.id, pacemanRunId: 21, rta: 100_000 });
    await seedPace(db, { mcid: "U", userId: u.id, pacemanRunId: 22, rta: 900_000 });

    const feed = await getPublicPaceFeed({ maxRta: 500_000 });
    expect(feed.items.map((i) => i.rta)).toEqual([100_000]);
  });
});

describe("withPaceProfiles", () => {
  const userData = {
    registeredMcids: ["a", "b"],
    mcidToUuid: { a: "uuid-a", b: "uuid-b" },
    mcidToSlug: { a: "slug-a", b: "slug-b" },
    mcidToDisplayName: { a: "A名", b: "B名" },
    mcidToDisplayNameAlphabet: { a: "A-en" },
    mcidToSkinUrl: {},
  };
  const base = { timeline: "Fortress", rta: 1, pacemanRunId: 1, time: 1 };

  it("各ペースの mcid（大文字小文字不問）の走者情報だけを添え、無い mcid は profile なし", () => {
    const items = [
      { ...base, mcid: "A", nickname: "A" },
      { ...base, mcid: "Zed", nickname: "Zed" },
    ];
    const [a, zed] = withPaceProfiles(items, userData);
    expect(a.profile).toEqual({ uuid: "uuid-a", displayName: "A名", displayNameAlphabet: "A-en" });
    expect(zed.profile).toBeUndefined();
  });

  it("mcid が Object.prototype のプロパティ名でも他人の値を拾わない", () => {
    const [c] = withPaceProfiles([{ ...base, mcid: "constructor", nickname: "constructor" }], userData);
    expect(c.profile).toBeUndefined();
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

describe("comparePaceByProgress（sort=time）", () => {
  const mk = (timeline: string, rta: number, runId: number, time = 1) => ({
    mcid: "a",
    nickname: "a",
    timeline,
    rta,
    pacemanRunId: runId,
    time,
  });

  it("進んだ区間ほど上、同じ区間の中は IGT の速い順", () => {
    const items = [
      mk("Bastion", 150_000, 1),
      mk("Finish", 700_000, 2),
      mk("Enter End", 500_000, 3),
      mk("Finish", 600_000, 4),
      mk("Enter End", 450_000, 5),
    ];
    expect([...items].sort(comparePaceByProgress).map((i) => i.pacemanRunId)).toEqual([4, 2, 5, 3, 1]);
  });

  it("同区間・同IGTは新しい順→ランIDで決定的", () => {
    const items = [mk("Finish", 600_000, 1, 10), mk("Finish", 600_000, 2, 20), mk("Finish", 600_000, 3, 20)];
    expect([...items].sort(comparePaceByProgress).map((i) => i.pacemanRunId)).toEqual([3, 2, 1]);
  });
});
