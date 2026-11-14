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
  seedConfigPreset,
  seedCategoryRecord,
  daysAgo,
  schema,
  type TestDb,
} from "./helpers/test-db";
import { eq } from "drizzle-orm";
import { calculateCm360, toSensitivityPercent } from "../mouse-settings";
import { invalidateCache } from "../cache";
import {
  FEATURED_POOL_CACHE_KEY,
  SPOTLIGHT_CACHE_KEY,
  getHomeSpotlight,
  getRandomFeaturedRunner,
} from "../home-featured.server";
import { HOME_HIDDEN_USERS_CACHE_KEY } from "../home-visibility.server";
import { clampFavoriteActivityOptions, getFavoriteActivity } from "../home-favorite-activity.server";

// ホームの注目の走者（候補・日替わり・ランダム）とお気に入りの動きを実DBで検証する。
// 結果はメモリキャッシュされるため毎テスト無効化する

const SHARED_URL = "file::memory:?cache=shared";
const CACHE_KEYS = [SPOTLIGHT_CACHE_KEY, FEATURED_POOL_CACHE_KEY, HOME_HIDDEN_USERS_CACHE_KEY, "videos:feed:all"];

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

/** メインプリセットのスナップショット（keys は [action, keyCode]） */
function presetSnapshot(keys: [string, string][] | null, config: Record<string, unknown> | null) {
  return {
    keybindingsData: keys ? JSON.stringify(keys.map(([action, keyCode]) => ({ action, keyCode, category: "movement" }))) : null,
    playerConfigData: config ? JSON.stringify(config) : null,
    remapsData: null,
  };
}

const SNAPSHOT_KEYS: [string, string][] = [
  ["forward", "KeyI"],
  ["back", "KeyK"],
  ["left", "KeyJ"],
  ["right", "KeyL"],
  ["jump", "Space"],
];

describe("注目の走者の設定の取得元（公開用のメインプリセット）", () => {
  async function addRecentRanking(userId: string) {
    const today = new Date().toISOString().slice(0, 10);
    await seedPlayerRanking(db, userId, { rankingType: "speedruncom", timeMs: 571000, recordDate: today });
  }

  it("メインが非アクティブならスナップショットのキー・感度を出し、ライブ（編集中）の値は出さない", async () => {
    const user = await seedCompleteRunner("snap-runner"); // ライブ: W/S/A/D・感度0.3
    await seedConfigPreset(db, user.id, {
      isMain: true,
      isActive: false,
      ...presetSnapshot(SNAPSHOT_KEYS, { mouseDpi: 400, gameSensitivity: 0.5, rawInput: true }),
    });
    await addRecentRanking(user.id);

    const runner = (await getHomeSpotlight(asDb(db))).candidates[0];
    expect(runner.keys.find((k) => k.action === "forward")?.keyCode).toBe("KeyI");
    expect(runner.keys.find((k) => k.action === "back")?.keyCode).toBe("KeyK");
    expect(runner.sensitivityPercent).toBe(toSensitivityPercent(0.5));
    expect(runner.cm180).toBeCloseTo(calculateCm360(400, 0.5, true, null, null) as number, 5);
  });

  it("メインが編集中（isActive）ならライブテーブルの値を出す（スナップショットは古い可能性がある）", async () => {
    const user = await seedCompleteRunner("active-main");
    await seedConfigPreset(db, user.id, {
      isMain: true,
      isActive: true,
      ...presetSnapshot(SNAPSHOT_KEYS, { mouseDpi: 400, gameSensitivity: 0.5, rawInput: true }),
    });
    await addRecentRanking(user.id);

    const runner = (await getHomeSpotlight(asDb(db))).candidates[0];
    expect(runner.keys.find((k) => k.action === "forward")?.keyCode).toBe("KeyW");
    expect(runner.sensitivityPercent).toBe(toSensitivityPercent(0.3));
  });

  it("スナップショットに無い種別は空として扱い、ライブへフォールバックしない", async () => {
    const user = await seedCompleteRunner("empty-snap");
    await seedConfigPreset(db, user.id, { isMain: true, isActive: false, ...presetSnapshot(null, null) });
    await addRecentRanking(user.id);

    const runner = (await getHomeSpotlight(asDb(db))).candidates[0];
    expect(runner.keys).toEqual([]);
    expect(runner.hotbar).toEqual([]);
    expect(runner.sensitivityPercent).toBeNull();
    expect(runner.cm180).toBeNull();
  });

  it("リマップもメインのスナップショットのものだけを使い、ライブ（編集中）のリマップは当てない", async () => {
    const user = await seedCompleteRunner("remap-snap");
    // ライブにだけある編集中のリマップ（forward=KeyW の物理キーを KeyZ にしている）
    await db.insert(schema.keyRemaps).values({ userId: user.id, sourceKey: "KeyZ", targetKey: "KeyI", remapType: "trigger" } as never);
    await seedConfigPreset(db, user.id, {
      isMain: true,
      isActive: false,
      ...presetSnapshot(SNAPSHOT_KEYS, { mouseDpi: 400, gameSensitivity: 0.5 }),
      // スナップショット側のリマップ: ゲーム内 KeyK（back）を物理 KeyX で押す
      remapsData: JSON.stringify([{ sourceKey: "KeyX", targetKey: "KeyK", software: null, notes: null, remapType: "trigger" }]),
    });
    await addRecentRanking(user.id);

    const keys = (await getHomeSpotlight(asDb(db))).candidates[0].keys;
    expect(keys.find((k) => k.action === "back")?.keyCode).toBe("KeyX"); // スナップショットのリマップ
    expect(keys.find((k) => k.action === "forward")?.keyCode).toBe("KeyI"); // ライブの KeyZ→KeyI は当てない
  });

  it("母集団の判定も同じ取得元: ライブは揃っていてもスナップショットが空の人は入らず、スナップショットだけ揃った人は入る", async () => {
    const stale = await seedCompleteRunner("stale-live");
    await seedConfigPreset(db, stale.id, { isMain: true, isActive: false, ...presetSnapshot(null, null) });

    const snapOnly = await seedUser(db, { slug: "snap-only", mcid: "snaponly", uuid: "uuid-snaponly", role: "runner", profileVisibility: "public" });
    await db.insert(schema.playstyles).values({ userId: snapOnly.id, mainCategory: "rsg" });
    await seedConfigPreset(db, snapOnly.id, {
      isMain: true,
      isActive: false,
      ...presetSnapshot(SNAPSHOT_KEYS, { mouseDpi: 800, gameSensitivity: 0.4 }),
    });

    const picked = await getRandomFeaturedRunner(asDb(db), []);
    expect(picked?.slug).toBe("snap-only");
    expect(picked?.keys.find((k) => k.action === "forward")?.keyCode).toBe("KeyI");
    expect(await getRandomFeaturedRunner(asDb(db), ["snap-only"])).toBeNull();
  });
});

describe("注目の走者: speedrun.com の理由に出さない記録", () => {
  const today = () => new Date().toISOString().slice(0, 10);

  it("オーナーが非表示にした run（users.hiddenSpeedrunRecords）は理由にしない", async () => {
    const hiddenOwner = await seedCompleteRunner("hide-owner");
    await db.update(schema.users).set({ hiddenSpeedrunRecords: JSON.stringify(["run-hidden"]) }).where(eq(schema.users.id, hiddenOwner.id));
    const visible = await seedCompleteRunner("visible-owner");
    await seedPlayerRanking(db, hiddenOwner.id, { rankingType: "speedruncom", speedruncomRunId: "run-hidden", timeMs: 571000, recordDate: today() });
    await seedPlayerRanking(db, visible.id, { rankingType: "speedruncom", speedruncomRunId: "run-visible", timeMs: 580000, recordDate: today() });

    const spotlight = await getHomeSpotlight(asDb(db));
    expect(spotlight.candidates.map((c) => c.slug)).toEqual(["visible-owner"]);
  });

  it("記録ページで非表示（category_records.isVisible=false）のカテゴリの記録は理由にしない", async () => {
    const cat = await seedSpeedrunCategory(db, { name: "Any% RSG" });
    const hiddenCat = await seedCompleteRunner("hidden-cat");
    const shownCat = await seedCompleteRunner("shown-cat");
    await seedCategoryRecord(db, hiddenCat.id, { categoryRefId: cat.id, isVisible: false });
    await seedCategoryRecord(db, shownCat.id, { categoryRefId: cat.id, isVisible: true });
    await seedPlayerRanking(db, hiddenCat.id, { rankingType: "speedruncom", categoryId: cat.id, timeMs: 571000, recordDate: today() });
    await seedPlayerRanking(db, shownCat.id, { rankingType: "speedruncom", categoryId: cat.id, timeMs: 580000, recordDate: today() });

    const spotlight = await getHomeSpotlight(asDb(db));
    expect(spotlight.candidates.map((c) => c.slug)).toEqual(["shown-cat"]);
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
    expect(result.items[0]).toMatchObject({ kind: "pace", label: "Fortress", timeMs: 200000, runId: 1, mcid: "Fav" });
    // ペース以外は runId を持たない
    expect(result.items.slice(1).every((i) => i.runId === null)).toBe(true);
  });

  it("お気に入りが空・解決できなければ favoritesCount 0", async () => {
    expect(await getFavoriteActivity(asDb(db), [])).toEqual({ favoritesCount: 0, items: [] });
    expect(await getFavoriteActivity(asDb(db), ["nobody"])).toEqual({ favoritesCount: 0, items: [] });
  });
});

describe("getFavoriteActivity: 期間・件数のオプション", () => {
  it("既定は直近7日・10件。windowDays を広げると古い動きも含め、limit で件数を絞る", async () => {
    const fav = await seedUser(db, { slug: "fav", mcid: "Fav", uuid: "uuid-fav", role: "runner", updatedAt: daysAgo(60) });
    await seedGuide(db, fav.id, { slug: "g-old", title: "Old", isPublished: true, updatedAt: daysAgo(20) });
    await seedGuide(db, fav.id, { slug: "g-new", title: "New", isPublished: true, updatedAt: daysAgo(1) });
    await seedGuide(db, fav.id, { slug: "g-mid", title: "Mid", isPublished: true, updatedAt: daysAgo(10) });

    const def = await getFavoriteActivity(asDb(db), ["fav"]);
    expect(def.items.map((i) => i.label)).toEqual(["New"]);

    const wide = await getFavoriteActivity(asDb(db), ["fav"], { windowDays: 30, limit: 100 });
    expect(wide.items.map((i) => i.label)).toEqual(["New", "Mid", "Old"]);

    const limited = await getFavoriteActivity(asDb(db), ["fav"], { windowDays: 30, limit: 2 });
    expect(limited.items.map((i) => i.label)).toEqual(["New", "Mid"]);
  });

  it("上限を超える指定（windowDays 9999）でも30日でクランプされる", async () => {
    const fav = await seedUser(db, { slug: "fav", mcid: "Fav", uuid: "uuid-fav", role: "runner", updatedAt: daysAgo(60) });
    await seedGuide(db, fav.id, { slug: "g-40", title: "Forty", isPublished: true, updatedAt: daysAgo(40) });
    const result = await getFavoriteActivity(asDb(db), ["fav"], { windowDays: 9999 });
    expect(result.items).toEqual([]);
  });

  it("一覧向け（limit>10）は1人あたりのペースを5件まで、ホーム既定は2件まで", async () => {
    const fav = await seedUser(db, { slug: "fav", mcid: "Fav", uuid: "uuid-fav", role: "runner", updatedAt: daysAgo(60) });
    for (let i = 1; i <= 6; i++) {
      await seedPace(db, { userId: fav.id, mcid: "Fav", pacemanRunId: i, timeline: "Bastion", rta: 100000 + i, date: daysAgo(i / 10) });
    }
    expect((await getFavoriteActivity(asDb(db), ["fav"])).items).toHaveLength(2);
    expect((await getFavoriteActivity(asDb(db), ["fav"], { windowDays: 30, limit: 100 })).items).toHaveLength(5);
  });
});

describe("clampFavoriteActivityOptions", () => {
  it("未指定・不正値は既定（7日・10件）", () => {
    expect(clampFavoriteActivityOptions({})).toEqual({ windowDays: 7, limit: 10 });
    expect(clampFavoriteActivityOptions({ windowDays: "30", limit: NaN })).toEqual({ windowDays: 7, limit: 10 });
    expect(clampFavoriteActivityOptions({ windowDays: null, limit: Infinity })).toEqual({ windowDays: 7, limit: 10 });
  });

  it("上限（30日・100件）と下限（1）でクランプし、小数は切り捨てる", () => {
    expect(clampFavoriteActivityOptions({ windowDays: 9999, limit: 100000 })).toEqual({ windowDays: 30, limit: 100 });
    expect(clampFavoriteActivityOptions({ windowDays: 0, limit: -5 })).toEqual({ windowDays: 1, limit: 1 });
    expect(clampFavoriteActivityOptions({ windowDays: 14.9, limit: 50.5 })).toEqual({ windowDays: 14, limit: 50 });
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

  it("ネザーイン判定は専用列（isNetherEnter）で行う: 列が true の行は除き、false の行は区間名によらず出す", async () => {
    const fav = await seedUser(db, { slug: "nether-fav", mcid: "NetherFav", uuid: "uuid-nf", role: "runner" });
    await seedPace(db, { userId: fav.id, mcid: "NetherFav", pacemanRunId: 31, timeline: "Enter Nether", isNetherEnter: true, rta: 90000, date: daysAgo(1) });
    await seedPace(db, { userId: fav.id, mcid: "NetherFav", pacemanRunId: 32, timeline: "Obtain Blaze Rods", isNetherEnter: false, rta: 400000, date: daysAgo(1) });

    const { items } = await getFavoriteActivity(asDb(db), ["nether-fav"]);
    const runIds = items.filter((i) => i.kind === "pace").map((i) => i.runId);
    expect(runIds).toEqual([32]);
  });
});

describe("注目の走者の自己ベスト（公式記録だけ）", () => {
  const today = () => new Date().toISOString().slice(0, 10);

  /** メインカテゴリ・バージョンを設定した走者を作り、候補に入るよう直近の speedrun.com 行を1件足す */
  async function seedRunner(slug: string, main: { mainCategory: string; mainVersion?: string | null }, userOverrides = {}) {
    const user = await seedCompleteRunner(slug);
    await db
      .update(schema.playstyles)
      .set({ mainCategory: main.mainCategory, mainVersion: main.mainVersion ?? null })
      .where(eq(schema.playstyles.userId, user.id));
    if (Object.keys(userOverrides).length > 0) await db.update(schema.users).set(userOverrides).where(eq(schema.users.id, user.id));
    await seedPlayerRanking(db, user.id, { rankingType: "ranked_pb", timeMs: 999000, recordDate: today() });
    return user;
  }
  async function pbOf(slug: string) {
    const spotlight = await getHomeSpotlight(asDb(db));
    const runner = [...spotlight.candidates, spotlight.fallback].find((r) => r?.slug === slug);
    expect(runner).toBeTruthy();
    return runner;
  }

  it("ranked は ranked_pb_all_time（シーズンの ranked_pb ではない）を出し、手入力記録は使わない", async () => {
    const user = await seedRunner("pb-ranked", { mainCategory: "ranked" });
    await seedPlayerRanking(db, user.id, { rankingType: "ranked_pb_all_time", timeMs: 612345 });
    await seedCategoryRecord(db, user.id, { category: "ranked", personalBest: 400000, isVisible: true });
    const runner = await pbOf("pb-ranked");
    expect(runner?.pbMs).toBe(612345);
    expect(runner?.mainVersion).toBeNull();
  });

  it("ranked でも Ranked 統計を表示しない人は null", async () => {
    const user = await seedRunner("pb-ranked-hidden", { mainCategory: "ranked" }, { showRankedStats: false });
    await seedPlayerRanking(db, user.id, { rankingType: "ranked_pb_all_time", timeMs: 612345 });
    expect((await pbOf("pb-ranked-hidden"))?.pbMs).toBeNull();
  });

  it("rsg + 1.16-1.19 は対応カテゴリの verified の最速だけ（new・別カテゴリ・非表示の run・手入力は除く）", async () => {
    const cat = await seedSpeedrunCategory(db, { name: "Java: RSG 1.16-1.19", slug: "java-rsg-1.16-1.19" });
    const other = await seedSpeedrunCategory(db, { name: "Java: SSG 1.20+", slug: "java-ssg-1.20" });
    const user = await seedRunner(
      "pb-rsg",
      { mainCategory: "rsg", mainVersion: "java:1_16_1_19" },
      { hiddenSpeedrunRecords: JSON.stringify(["run-hidden"]) },
    );
    const base = { rankingType: "speedruncom" as const, verificationStatus: "verified" as const };
    await seedPlayerRanking(db, user.id, { ...base, categoryId: cat.id, timeMs: 700000, speedruncomRunId: "run-a" });
    await seedPlayerRanking(db, user.id, { ...base, categoryId: cat.id, timeMs: 650000, speedruncomRunId: "run-b" });
    await seedPlayerRanking(db, user.id, { ...base, categoryId: cat.id, timeMs: 500000, speedruncomRunId: "run-hidden" });
    await seedPlayerRanking(db, user.id, { ...base, verificationStatus: "new", categoryId: cat.id, timeMs: 400000, speedruncomRunId: "run-new" });
    await seedPlayerRanking(db, user.id, { ...base, categoryId: other.id, timeMs: 300000, speedruncomRunId: "run-other" });
    await seedCategoryRecord(db, user.id, { category: "rsg", personalBest: 200000, isVisible: true });
    const runner = await pbOf("pb-rsg");
    expect(runner?.pbMs).toBe(650000);
    expect(runner?.mainVersion).toBe("java:1_16_1_19");
  });

  it("バージョン未設定・対応の無い範囲・カテゴリ定義が無いときは null（手入力記録があっても出さない）", async () => {
    const cat = await seedSpeedrunCategory(db, { name: "Java: RSG 1.16-1.19", slug: "java-rsg-1.16-1.19" });
    const noVersion = await seedRunner("pb-nover", { mainCategory: "rsg" });
    const outOfRange = await seedRunner("pb-range", { mainCategory: "rsg", mainVersion: "java:1_20_plus" });
    const noCategory = await seedRunner("pb-nocat", { mainCategory: "ssg", mainVersion: "java:1_16_1_19" });
    for (const u of [noVersion, outOfRange, noCategory]) {
      await seedPlayerRanking(db, u.id, { rankingType: "speedruncom", verificationStatus: "verified", categoryId: cat.id, timeMs: 600000 });
      await seedCategoryRecord(db, u.id, { category: "rsg", personalBest: 500000, isVisible: true });
    }
    expect((await pbOf("pb-nover"))?.pbMs).toBeNull();
    expect((await pbOf("pb-range"))?.pbMs).toBeNull();
    expect((await pbOf("pb-nocat"))?.pbMs).toBeNull();
  });
});
