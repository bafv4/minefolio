import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createTestDbAt,
  seedUser,
  seedKeybinding,
  seedPlayerConfig,
  seedPlayerRanking,
  seedSpeedrunCategory,
  seedPace,
  seedGuide,
  daysAgo,
  schema,
  type TestDb,
} from "./helpers/test-db";
import { eq } from "drizzle-orm";
import { invalidateCache } from "../cache";
import { getHomeSpotlight, getRandomFeaturedRunner } from "../home-featured.server";
import { getFavoriteActivity } from "../home-favorite-activity.server";

// ホームの注目の走者（候補・日替わり・ランダム）とお気に入りの動きを実DBで検証する。
// 結果はメモリキャッシュされるため毎テスト無効化する

const SHARED_URL = "file::memory:?cache=shared";
const CACHE_KEYS = ["home:spotlight:v5", "home:featured-pool:v1", "videos:feed:all"];

let db: TestDb;
let originalUrl: string | undefined;

beforeEach(async () => {
  originalUrl = process.env.TURSO_DATABASE_URL;
  process.env.TURSO_DATABASE_URL = SHARED_URL;
  db = await createTestDbAt(SHARED_URL);
  for (const k of CACHE_KEYS) await invalidateCache(k);
});

afterEach(async () => {
  for (const k of CACHE_KEYS) await invalidateCache(k);
  if (originalUrl === undefined) delete process.env.TURSO_DATABASE_URL;
  else process.env.TURSO_DATABASE_URL = originalUrl;
});

const KEY_ACTIONS: [string, string][] = [
  ["forward", "KeyW"],
  ["back", "KeyS"],
  ["left", "KeyA"],
  ["right", "KeyD"],
  ["jump", "Space"],
  ["sneak", "ShiftLeft"],
  ["sprint", "ControlLeft"],
  ["inventory", "KeyE"],
  ["swapHands", "KeyF"],
];

/** キー配置・感度・メインカテゴリが揃った公開プロフィールを作る */
async function seedCompleteRunner(slug: string) {
  const user = await seedUser(db, { slug, mcid: slug, uuid: `uuid-${slug}`, role: "runner", profileVisibility: "public" });
  await db.insert(schema.playstyles).values({ userId: user.id, mainCategory: "rsg" });
  await seedPlayerConfig(db, user.id, { mouseDpi: 800, gameSensitivity: 0.3, rawInput: true });
  for (const [action, keyCode] of KEY_ACTIONS) {
    await seedKeybinding(db, user.id, { action, keyCode, category: "movement" });
  }
  return user;
}

const asDb = (d: TestDb) => d as never;

describe("getHomeSpotlight", () => {
  it("直近7日の speedrun.com 申請（new でも対象）を理由に候補へ入れ、期間外は入れない", async () => {
    const recent = await seedCompleteRunner("recent-runner");
    const old = await seedCompleteRunner("old-runner");
    const today = new Date().toISOString().slice(0, 10);
    await seedPlayerRanking(db, recent.id, {
      rankingType: "speedruncom",
      verificationStatus: "new",
      timeMs: 571000,
      recordDate: today,
    });
    await seedPlayerRanking(db, old.id, {
      rankingType: "speedruncom",
      timeMs: 600000,
      recordDate: daysAgo(30).toISOString().slice(0, 10),
    });

    const spotlight = await getHomeSpotlight(asDb(db));
    expect(spotlight.candidates.map((c) => c.slug)).toEqual(["recent-runner"]);
    expect(spotlight.candidates[0].reason).toEqual({
      type: "speedruncom",
      timeMs: 571000,
      categoryName: null,
      status: "new",
    });
    expect(spotlight.candidates[0].keys).toHaveLength(9);
    expect(spotlight.candidates[0].sensitivityPercent).toBe(60);
    expect(spotlight.fallback).toBeNull();
  });

  it("speedrun.com の理由にカテゴリ名と審査状態（new / verified）を持たせる", async () => {
    const pending = await seedCompleteRunner("pending-runner");
    const approved = await seedCompleteRunner("approved-runner");
    const cat = await seedSpeedrunCategory(db, { name: "Any% Glitchless RSG" });
    const today = new Date().toISOString().slice(0, 10);
    await seedPlayerRanking(db, pending.id, {
      rankingType: "speedruncom",
      verificationStatus: "new",
      categoryId: cat.id,
      timeMs: 571000,
      recordDate: today,
    });
    await seedPlayerRanking(db, approved.id, {
      rankingType: "speedruncom",
      verificationStatus: "verified",
      categoryId: cat.id,
      timeMs: 600000,
      recordDate: today,
    });

    const spotlight = await getHomeSpotlight(asDb(db));
    const bySlug = new Map(spotlight.candidates.map((c) => [c.slug, c.reason]));
    expect(bySlug.get("pending-runner")).toEqual({
      type: "speedruncom",
      timeMs: 571000,
      categoryName: "Any% Glitchless RSG",
      status: "new",
    });
    expect(bySlug.get("approved-runner")).toMatchObject({
      categoryName: "Any% Glitchless RSG",
      status: "verified",
    });
  });

  it("ホットバー1〜9は割り当てのあるスロットだけ返し、リマップは実際に押すキーにする", async () => {
    const user = await seedCompleteRunner("hotbar-runner");
    await seedKeybinding(db, user.id, { action: "hotbar1", keyCode: "Digit1", category: "inventory" });
    await seedKeybinding(db, user.id, { action: "hotbar2", keyCode: "Digit2", category: "inventory" });
    await seedKeybinding(db, user.id, { action: "hotbar3", keyCode: "_UNBOUND", category: "inventory" });
    await db.insert(schema.keyRemaps).values({
      userId: user.id,
      sourceKey: "KeyQ",
      targetKey: "Digit2",
      remapType: "trigger",
    } as never);
    const today = new Date().toISOString().slice(0, 10);
    await seedPlayerRanking(db, user.id, { rankingType: "speedruncom", timeMs: 571000, recordDate: today });

    const spotlight = await getHomeSpotlight(asDb(db));
    const hotbar = spotlight.candidates[0].hotbar;
    expect(hotbar.map((k) => k.action)).toEqual(["hotbar1", "hotbar2"]);
    expect(hotbar[0]).toEqual({ action: "hotbar1", keyCode: "Digit1" });
    expect(hotbar[1]).toEqual({ action: "hotbar2", keyCode: "KeyQ" });
  });

  it("主要操作は WASD を含む9個で、リマップは実際に押すキーにし、リマップ有無のフィールドは持たない", async () => {
    const user = await seedCompleteRunner("keys-runner");
    await db.insert(schema.keyRemaps).values({
      userId: user.id,
      sourceKey: "KeyV",
      targetKey: "ControlLeft",
      remapType: "trigger",
    } as never);
    const today = new Date().toISOString().slice(0, 10);
    await seedPlayerRanking(db, user.id, { rankingType: "speedruncom", timeMs: 571000, recordDate: today });

    const keys = (await getHomeSpotlight(asDb(db))).candidates[0].keys;
    expect(keys.map((k) => k.action)).toEqual([
      "forward", "back", "left", "right", "jump", "sneak", "sprint", "inventory", "swapHands",
    ]);
    expect(keys.find((k) => k.action === "sprint")).toEqual({ action: "sprint", keyCode: "KeyV" });
    expect(keys.find((k) => k.action === "back")).toEqual({ action: "back", keyCode: "KeyS" });
  });

  it("候補が0人なら、揃った公開プロフィールから日替わりの1人（理由なし）を出す", async () => {
    await seedCompleteRunner("only-runner");
    // 揃っていない人（キー配置なし）は母集団に入らない
    await seedUser(db, { slug: "no-keys", mcid: "nokeys", uuid: "uuid-nokeys", role: "runner" });

    const spotlight = await getHomeSpotlight(asDb(db));
    expect(spotlight.candidates).toEqual([]);
    expect(spotlight.fallback?.slug).toBe("only-runner");
    expect(spotlight.fallback?.reason).toBeNull();
  });

  it("ランダムな1人は表示中・直前の人を除き、母集団が尽きたら null", async () => {
    await seedCompleteRunner("a-runner");
    await seedCompleteRunner("b-runner");
    const picked = await getRandomFeaturedRunner(asDb(db), ["a-runner"]);
    expect(picked?.slug).toBe("b-runner");
    expect(await getRandomFeaturedRunner(asDb(db), ["a-runner", "b-runner"])).toBeNull();
  });
});

describe("getFavoriteActivity", () => {
  it("お気に入りの公開プロフィールのペース・ガイド・プロフィール更新を新しい順に返し、非お気に入り・非公開は含めない", async () => {
    const fav = await seedUser(db, { slug: "fav", mcid: "Fav", uuid: "uuid-fav", role: "runner", updatedAt: daysAgo(3) });
    const hidden = await seedUser(db, { slug: "hidden", mcid: "Hidden", role: "runner", profileVisibility: "private" });
    await seedUser(db, { slug: "other", mcid: "Other", role: "runner" });
    await seedPace(db, { userId: fav.id, mcid: "Fav", pacemanRunId: 1, timeline: "Bastion", rta: 120000, date: daysAgo(1) });
    await seedPace(db, { userId: fav.id, mcid: "Fav", pacemanRunId: 1, timeline: "Fortress", rta: 200000, date: daysAgo(1) });
    await seedGuide(db, fav.id, { slug: "g1", title: "Guide One", isPublished: true, updatedAt: daysAgo(2) });
    await seedPace(db, { userId: hidden.id, mcid: "Hidden", pacemanRunId: 2, timeline: "Bastion", date: daysAgo(1) });

    const result = await getFavoriteActivity(asDb(db), ["fav", "hidden", "other-not-favorited"]);
    expect(result.favoritesCount).toBe(1);
    expect(result.items.map((i) => i.kind)).toEqual(["pace", "guide", "profile"]);
    // 同じランは最も進んだ区間だけ
    expect(result.items[0]).toMatchObject({ kind: "pace", label: "Fortress", timeMs: 200000 });
  });

  it("お気に入りが空・解決できなければ favoritesCount 0", async () => {
    expect(await getFavoriteActivity(asDb(db), [])).toEqual({ favoritesCount: 0, items: [] });
    expect(await getFavoriteActivity(asDb(db), ["nobody"])).toEqual({ favoritesCount: 0, items: [] });
  });
});

describe("表示設定（ホーム画面に〜を表示）: 全員のホームから除外", () => {
  async function seedVideoUser(slug: string, flags: Record<string, unknown>) {
    const user = await seedCompleteRunner(slug);
    await db.update(schema.users).set(flags as never).where(eq(schema.users.id, user.id));
    return user;
  }
  async function seedYt(videoId: string, mcid: string) {
    await db.insert(schema.youtubeVideoCache).values({ videoId, channelId: "UCtest", title: `video ${videoId}`, publishedAt: daysAgo(1), minefolioMcid: mcid });
  }

  it("注目の走者: 動画理由はそのプラットフォームの設定がオフの人を候補にしない（null・true は候補）", async () => {
    await seedVideoUser("yt-off", { showYoutubeOnHome: false });
    await seedVideoUser("yt-on", { showYoutubeOnHome: true });
    await seedVideoUser("yt-null", { showYoutubeOnHome: null });
    await seedVideoUser("tw-off", { showTwitchOnHome: false }); // YouTube の設定には影響されない
    for (const slug of ["yt-off", "yt-on", "yt-null", "tw-off"]) await seedYt(`v-${slug}`, slug);

    const spotlight = await getHomeSpotlight(asDb(db));
    expect(spotlight.candidates.map((c) => c.slug).sort()).toEqual(["tw-off", "yt-null", "yt-on"]);
  });

  it("お気に入りの動き: ペースは showPacemanOnHome、動画はプラットフォーム別の設定で除く（他の種別は残す）", async () => {
    const off = await seedUser(db, { slug: "off", mcid: "Off", uuid: "uuid-off", role: "runner", showPacemanOnHome: false, showYoutubeOnHome: false, updatedAt: daysAgo(30) });
    const on = await seedUser(db, { slug: "on", mcid: "On", uuid: "uuid-on", role: "runner", updatedAt: daysAgo(30) });
    await seedPace(db, { userId: off.id, mcid: "Off", pacemanRunId: 1, timeline: "Bastion", date: daysAgo(1) });
    await seedPace(db, { userId: on.id, mcid: "On", pacemanRunId: 2, timeline: "Bastion", date: daysAgo(1) });
    await seedYt("v-off", "off");
    await seedYt("v-on", "on");
    await seedGuide(db, off.id, { slug: "g-off", title: "Guide", isPublished: true, updatedAt: daysAgo(2) });

    const result = await getFavoriteActivity(asDb(db), ["off", "on"]);
    const pairs = result.items.map((i) => `${i.kind}:${i.slug}`).sort();
    expect(pairs).toEqual(["guide:off", "pace:on", "video:on"]);
  });
});
