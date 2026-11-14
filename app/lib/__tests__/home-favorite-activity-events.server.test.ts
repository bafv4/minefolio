import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDbAt, seedUser, seedPlayerRanking, seedSpeedrunCategory, schema, type TestDb } from "./helpers/test-db";
import { invalidateCache } from "../cache";
import { getFavoriteActivity } from "../home-favorite-activity.server";

// お気に入りの動きの「レート帯 UP / Ranked PB / speedrun.com 申請 / 操作設定の変更」を実DBで検証する。
// 日付の境界を固定するため now を明示する（2026-11-14 15:00 UTC。7日窓の開始日は 2026-11-07）

const SHARED_URL = "file::memory:?cache=shared";
const NOW = Date.parse("2026-11-14T15:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

let db: TestDb;
let originalUrl: string | undefined;

beforeEach(async () => {
  originalUrl = process.env.TURSO_DATABASE_URL;
  process.env.TURSO_DATABASE_URL = SHARED_URL;
  db = await createTestDbAt(SHARED_URL);
  await invalidateCache("videos:feed:all");
});

afterEach(async () => {
  await invalidateCache("videos:feed:all");
  if (originalUrl === undefined) delete process.env.TURSO_DATABASE_URL;
  else process.env.TURSO_DATABASE_URL = originalUrl;
});

const asDb = (d: TestDb) => d as never;
const opts = { now: NOW, windowDays: 7, limit: 100 };

async function seedRunner(slug: string, overrides: Parameters<typeof seedUser>[1] = {}) {
  return seedUser(db, {
    slug,
    mcid: slug,
    uuid: `uuid-${slug}`,
    role: "runner",
    profileVisibility: "public",
    updatedAt: new Date(NOW - 60 * DAY),
    ...overrides,
  });
}

async function seedSnapshot(userId: string, snapshotDate: string, eloRate: number) {
  await db.insert(schema.rankedEloSnapshots).values({ userId, snapshotDate, eloRate });
}

describe("お気に入りの動き: rankTierUp", () => {
  it("基準（期間前の最新）から最高階級を更新した日だけを出し、境目の行き来では増やさない", async () => {
    const u = await seedRunner("climber");
    await seedSnapshot(u.id, "2026-11-05", 1190); // 基準: Gold III
    await seedSnapshot(u.id, "2026-11-08", 1210); // Emerald I へ昇格 -> イベント
    await seedSnapshot(u.id, "2026-11-09", 1190); // Gold III へ降格
    await seedSnapshot(u.id, "2026-11-10", 1215); // 再び Emerald I（最高更新ではない）
    await seedSnapshot(u.id, "2026-11-12", 1310); // Emerald II -> イベント
    const result = await getFavoriteActivity(asDb(db), ["climber"], opts);
    const ups = result.items.filter((i) => i.kind === "rankTierUp");
    expect(ups.map((i) => i.label)).toEqual(["Emerald II", "Emerald I"]);
    expect(ups.every((i) => i.dateOnly)).toBe(true);
    expect(ups[0].href).toBe("/player/climber?tab=stats");
    expect(ups.every((i) => i.at <= NOW)).toBe(true);
  });

  it("ホーム既定（limit 10）は1人1件（最新の昇格）", async () => {
    const u = await seedRunner("climber");
    await seedSnapshot(u.id, "2026-11-05", 1190);
    await seedSnapshot(u.id, "2026-11-08", 1210);
    await seedSnapshot(u.id, "2026-11-12", 1310);
    const result = await getFavoriteActivity(asDb(db), ["climber"], { now: NOW });
    expect(result.items.filter((i) => i.kind === "rankTierUp").map((i) => i.label)).toEqual(["Emerald II"]);
  });

  it("期間前のスナップショットが無ければ期間内の最初を基準にし、同じ階級のままなら出さない", async () => {
    const u = await seedRunner("flat");
    await seedSnapshot(u.id, "2026-11-08", 1210);
    await seedSnapshot(u.id, "2026-11-12", 1250);
    const result = await getFavoriteActivity(asDb(db), ["flat"], opts);
    expect(result.items.filter((i) => i.kind === "rankTierUp")).toEqual([]);
  });

  it("showRankedStats が false の人は rankTierUp・rankedPb とも出さない", async () => {
    const u = await seedRunner("hidden-ranked", { showRankedStats: false });
    await seedSnapshot(u.id, "2026-11-05", 1190);
    await seedSnapshot(u.id, "2026-11-12", 1310);
    await seedPlayerRanking(db, u.id, { rankingType: "ranked_pb", timeMs: 600000, recordDate: "2026-11-12" });
    const result = await getFavoriteActivity(asDb(db), ["hidden-ranked"], opts);
    expect(result.items.filter((i) => i.kind === "rankTierUp" || i.kind === "rankedPb")).toEqual([]);
  });
});

describe("お気に入りの動き: rankedPb", () => {
  it("recordDate が期間内の ranked_pb だけを日付のみのイベントにする（null・期間外は出さない）", async () => {
    const a = await seedRunner("pb-new");
    const b = await seedRunner("pb-old");
    const c = await seedRunner("pb-null");
    await seedPlayerRanking(db, a.id, { rankingType: "ranked_pb", timeMs: 612000, recordDate: "2026-11-14" });
    await seedPlayerRanking(db, b.id, { rankingType: "ranked_pb", timeMs: 612000, recordDate: "2026-10-01" });
    await seedPlayerRanking(db, c.id, { rankingType: "ranked_pb", timeMs: 612000, recordDate: null });
    const result = await getFavoriteActivity(asDb(db), ["pb-new", "pb-old", "pb-null"], opts);
    const pbs = result.items.filter((i) => i.kind === "rankedPb");
    expect(pbs).toHaveLength(1);
    expect(pbs[0]).toMatchObject({ slug: "pb-new", timeMs: 612000, dateOnly: true, href: "/player/pb-new?tab=stats" });
    // 今日の UTC 正午はまだ来ていないので now にクランプされる
    expect(pbs[0].at).toBeLessThanOrEqual(NOW);
  });
});

describe("お気に入りの動き: srcSubmit", () => {
  it("審査中・createdAt と recordDate がともに期間内のものだけ。時刻は createdAt、却下・承認済みは出さない", async () => {
    const u = await seedRunner("submitter");
    const cat = await seedSpeedrunCategory(db, { name: "Any% RSG" });
    const created = new Date(NOW - 1 * DAY);
    await seedPlayerRanking(db, u.id, {
      rankingType: "speedruncom",
      verificationStatus: "new",
      timeMs: 580000,
      categoryId: cat.id,
      recordDate: "2026-11-12",
      createdAt: created,
    });
    // 連携直後に検知された古い審査中記録（ランの日付が期間外）
    await seedPlayerRanking(db, u.id, {
      rankingType: "speedruncom",
      verificationStatus: "new",
      timeMs: 590000,
      categoryId: cat.id,
      recordDate: "2026-06-01",
      createdAt: created,
    });
    await seedPlayerRanking(db, u.id, {
      rankingType: "speedruncom",
      verificationStatus: "rejected",
      timeMs: 570000,
      categoryId: cat.id,
      recordDate: "2026-11-12",
      createdAt: created,
    });
    await seedPlayerRanking(db, u.id, {
      rankingType: "speedruncom",
      verificationStatus: "verified",
      timeMs: 560000,
      categoryId: cat.id,
      recordDate: "2026-11-12",
      createdAt: created,
    });
    const result = await getFavoriteActivity(asDb(db), ["submitter"], opts);
    const subs = result.items.filter((i) => i.kind === "srcSubmit");
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({
      timeMs: 580000,
      label: "Any% RSG",
      dateOnly: false,
      at: created.getTime(),
      href: "/player/submitter?tab=stats&srcPending=1",
    });
  });

  it("非表示にした run は出さない", async () => {
    const u = await seedRunner("hider", { hiddenSpeedrunRecords: JSON.stringify(["run-hidden"]) });
    await seedPlayerRanking(db, u.id, {
      rankingType: "speedruncom",
      verificationStatus: "new",
      timeMs: 580000,
      speedruncomRunId: "run-hidden",
      recordDate: "2026-11-12",
      createdAt: new Date(NOW - DAY),
    });
    const result = await getFavoriteActivity(asDb(db), ["hider"], opts);
    expect(result.items.filter((i) => i.kind === "srcSubmit")).toEqual([]);
  });
});

describe("お気に入りの動き: settings", () => {
  it("1人・1日（UTC）・changeType ごとに最新1件へまとめ、種別ごとに遷移先タブが変わる", async () => {
    const u = await seedRunner("tweaker");
    const day = Date.parse("2026-11-13T00:00:00Z");
    const insert = (changeType: "keybinding" | "device" | "game_setting", offsetMin: number) =>
      db.insert(schema.configHistory).values({
        userId: u.id,
        changeType,
        changeDescription: "x",
        createdAt: new Date(day + offsetMin * 60_000),
      });
    await insert("keybinding", 60);
    await insert("keybinding", 120); // 同じ日・同じ種別 -> 新しい方だけ
    await insert("device", 90);
    await insert("game_setting", 30);
    const result = await getFavoriteActivity(asDb(db), ["tweaker"], opts);
    const settings = result.items.filter((i) => i.kind === "settings");
    expect(settings.map((i) => i.label)).toEqual(["keybinding", "device", "game_setting"]);
    expect(settings[0].at).toBe(day + 120 * 60_000);
    expect(settings.map((i) => i.href)).toEqual([
      "/player/tweaker?tab=keybindings",
      "/player/tweaker?tab=devices",
      "/player/tweaker?tab=keybindings",
    ]);
    // ホーム既定（limit 10）は1人1件
    const home = await getFavoriteActivity(asDb(db), ["tweaker"], { now: NOW });
    expect(home.items.filter((i) => i.kind === "settings")).toHaveLength(1);
  });
});
