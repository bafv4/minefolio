// ホームの閲覧者非依存クエリ: 60秒キャッシュ（公開→非公開の反映遅延の根拠）と、翻訳をキャッシュに含めないこと
import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedUser, schema, type TestDb } from "./helpers/test-db";
import { invalidateCache } from "../cache";
import {
  HOME_DISCOVERY_CACHE_KEYS,
  getHeroFaces,
  getNewGuides,
  getPublicProfileCount,
  getRecentProfiles,
  invalidateHomeDiscoveryCache,
} from "../home-discovery.server";

let db: TestDb;
const asDb = (d: TestDb) => d as never;

async function clear() {
  for (const base of Object.values(HOME_DISCOVERY_CACHE_KEYS)) {
    await invalidateCache(base);
    for (const n of [4, 12]) await invalidateCache(`${base}:${n}`);
  }
}

beforeEach(async () => {
  db = await createTestDb();
  await clear();
});

describe("home-discovery", () => {
  it("公開人数は60秒キャッシュされ、キーを消すと再集計される", async () => {
    const user = await seedUser(db, { slug: "a", mcid: "A" });
    const before = await getPublicProfileCount(asDb(db));
    expect(before).toBeGreaterThan(0);

    await db.update(schema.users).set({ profileVisibility: "private" }).where(eq(schema.users.id, user.id));
    expect(await getPublicProfileCount(asDb(db))).toBe(before); // キャッシュ

    await invalidateCache(HOME_DISCOVERY_CACHE_KEYS.publicCount);
    expect(await getPublicProfileCount(asDb(db))).toBe(before - 1);
  });

  it("最近の更新は件数ごとのキーでキャッシュされる", async () => {
    await seedUser(db, { slug: "a", mcid: "A" });
    expect(await getRecentProfiles(asDb(db), 4)).toHaveLength(1);
    await seedUser(db, { slug: "b", mcid: "B" });
    expect(await getRecentProfiles(asDb(db), 4)).toHaveLength(1); // キャッシュ
    expect(await getRecentProfiles(asDb(db), 12)).toHaveLength(2); // 別キー
  });

  it("invalidateHomeDiscoveryCache は件数の接尾辞付きのキーまで全部消す", async () => {
    const user = await seedUser(db, { slug: "a", mcid: "A", uuid: "00000000000000000000000000000001" });
    expect(await getRecentProfiles(asDb(db), 4)).toHaveLength(1);
    expect(await getRecentProfiles(asDb(db), 12)).toHaveLength(1);
    expect(await getHeroFaces(asDb(db), 12)).toHaveLength(1);
    expect(await getPublicProfileCount(asDb(db))).toBe(1);

    await db.update(schema.users).set({ profileVisibility: "private" }).where(eq(schema.users.id, user.id));
    expect(await getRecentProfiles(asDb(db), 4)).toHaveLength(1); // まだキャッシュ

    await invalidateHomeDiscoveryCache();
    expect(await getRecentProfiles(asDb(db), 4)).toHaveLength(0);
    expect(await getRecentProfiles(asDb(db), 12)).toHaveLength(0);
    expect(await getHeroFaces(asDb(db), 12)).toHaveLength(0);
    expect(await getPublicProfileCount(asDb(db))).toBe(0);
  });

  it("ゲストのヒーローの顔・新着ガイドも空配列をキャッシュする（翻訳は含まれない）", async () => {
    expect(await getHeroFaces(asDb(db), 12)).toEqual([]);
    expect(await getNewGuides(asDb(db), 4)).toEqual([]);
    await seedUser(db, { slug: "a", mcid: "A", uuid: "00000000000000000000000000000001" });
    expect(await getHeroFaces(asDb(db), 12)).toEqual([]); // キャッシュ
    await invalidateCache(`${HOME_DISCOVERY_CACHE_KEYS.heroFaces}:12`);
    expect(await getHeroFaces(asDb(db), 12)).toHaveLength(1);
  });
});
