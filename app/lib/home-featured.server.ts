// ホームの「注目の走者」のデータ取得（DB）。ロケール非依存の結果を10分キャッシュする。
// 候補は直近7日の出来事（speedrun.com の新規申請 / Ranked の PB 更新 / Ranked のレート上昇 / 新しい動画）から
// 点数順に最大5人。点数・選定は home-featured.ts（純粋ロジック）。外部 API は使わず、cron が取得済みの DB だけを読む。

import { and, eq, gte, inArray, isNotNull, ne, sql } from "drizzle-orm";
import type { Database } from "./db";
import {
  users,
  playerRankings,
  speedrunCategories,
  rankedEloSnapshots,
  playstyles,
  categoryRecords,
  playerConfigs,
  keybindings,
  keyRemaps,
} from "./schema";
import { excludeViewersCondition } from "./users-filter";
import { getCached, setCached } from "./cache";
import { getPublicVideoFeed } from "./videos-feed.server";
import { pickHighlightPb } from "./profile-highlights";
import { calculateCm360, isValidSensitivity, toSensitivityPercent } from "./mouse-settings";
import { filterRemapsForTrigger, isSpecialRemapTarget } from "./remap-utils";
import { normalizeKeyCode } from "./keybindings";
import {
  FEATURED_HOTBAR_ACTIONS,
  FEATURED_KEY_ACTIONS,
  FEATURED_MIN_KEYS,
  dailyPickIndex,
  pickFeaturedCandidates,
  type FeaturedEvent,
  type FeaturedKey,
  type FeaturedReason,
  type FeaturedRunner,
} from "./home-featured";

const FEATURED_TTL = 10 * 60 * 1000;
const WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Ranked のレート上昇を出来事として扱う最小幅 */
const MIN_ELO_GAIN = 20;

export interface HomeSpotlight {
  /** 直近7日の出来事の候補（点数の高い順・最大5人） */
  candidates: FeaturedRunner[];
  /** 候補が0人のときの日替わりの1人（候補があるときは null） */
  fallback: FeaturedRunner | null;
}

/** UTC の日付キー（YYYY-MM-DD） */
function utcDateKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** 公開プロフィール（視聴者除外）の条件 */
const publicRunnerWhere = and(eq(users.profileVisibility, "public"), excludeViewersCondition);

/** 指定ユーザーの表示用データ（プレイスタイル・PB・感度・主要キー）を1クエリずつ一括取得して組み立てる */
async function hydrateRunners(
  db: Database,
  picks: { userId: string; reason: FeaturedReason | null }[],
): Promise<FeaturedRunner[]> {
  if (picks.length === 0) return [];
  const ids = picks.map((p) => p.userId);

  const [userRows, styleRows, recordRows, configRows, keyRows, remapRows] = await Promise.all([
    db
      .select({
        id: users.id,
        slug: users.slug,
        mcid: users.mcid,
        uuid: users.uuid,
        displayName: users.displayName,
        displayNameAlphabet: users.displayNameAlphabet,
        customSkinUrl: users.customSkinUrl,
      })
      .from(users)
      .where(and(inArray(users.id, ids), publicRunnerWhere)),
    db
      .select({ userId: playstyles.userId, mainCategory: playstyles.mainCategory })
      .from(playstyles)
      .where(inArray(playstyles.userId, ids)),
    db
      .select({
        userId: categoryRecords.userId,
        category: categoryRecords.category,
        categoryDisplayName: categoryRecords.categoryDisplayName,
        personalBest: categoryRecords.personalBest,
      })
      .from(categoryRecords)
      .where(
        and(
          inArray(categoryRecords.userId, ids),
          eq(categoryRecords.isVisible, true),
          isNotNull(categoryRecords.personalBest),
        ),
      ),
    db
      .select({
        userId: playerConfigs.userId,
        mouseDpi: playerConfigs.mouseDpi,
        gameSensitivity: playerConfigs.gameSensitivity,
        rawInput: playerConfigs.rawInput,
        windowsSpeed: playerConfigs.windowsSpeed,
        windowsSpeedMultiplier: playerConfigs.windowsSpeedMultiplier,
      })
      .from(playerConfigs)
      .where(inArray(playerConfigs.userId, ids)),
    db
      .select({ userId: keybindings.userId, action: keybindings.action, keyCode: keybindings.keyCode })
      .from(keybindings)
      .where(and(inArray(keybindings.userId, ids), inArray(keybindings.action, [...FEATURED_KEY_ACTIONS, ...FEATURED_HOTBAR_ACTIONS]))),
    db
      .select({
        userId: keyRemaps.userId,
        sourceKey: keyRemaps.sourceKey,
        targetKey: keyRemaps.targetKey,
        remapType: keyRemaps.remapType,
      })
      .from(keyRemaps)
      .where(inArray(keyRemaps.userId, ids)),
  ]);

  const userById = new Map(userRows.map((u) => [u.id, u]));
  const styleById = new Map(styleRows.map((s) => [s.userId, s.mainCategory]));
  const configById = new Map(configRows.map((c) => [c.userId, c]));
  const recordsById = new Map<string, typeof recordRows>();
  for (const r of recordRows) {
    const list = recordsById.get(r.userId);
    if (list) list.push(r);
    else recordsById.set(r.userId, [r]);
  }
  const keysById = new Map<string, typeof keyRows>();
  for (const k of keyRows) {
    const list = keysById.get(k.userId);
    if (list) list.push(k);
    else keysById.set(k.userId, [k]);
  }
  const remapsById = new Map<string, typeof remapRows>();
  for (const r of remapRows) {
    const list = remapsById.get(r.userId);
    if (list) list.push(r);
    else remapsById.set(r.userId, [r]);
  }

  const result: FeaturedRunner[] = [];
  for (const pick of picks) {
    const u = userById.get(pick.userId);
    if (!u) continue; // 非公開化・視聴者化・退会した人は出さない
    const mainCategory = styleById.get(u.id) ?? null;
    const pb = pickHighlightPb(mainCategory, recordsById.get(u.id) ?? []);
    const config = configById.get(u.id);
    const sensitivityPercent =
      config && isValidSensitivity(config.gameSensitivity) ? toSensitivityPercent(config.gameSensitivity) : null;
    const cm180 = config
      ? calculateCm360(config.mouseDpi, config.gameSensitivity, config.rawInput, config.windowsSpeed, config.windowsSpeedMultiplier)
      : null;

    // リマップ: ゲーム内キー（target）を出すために実際に押す物理キー（source）へ置き換える（trigger 文脈のみ）
    const remaps = filterRemapsForTrigger(remapsById.get(u.id) ?? []).filter(
      (r) => r.targetKey != null && !r.sourceKey.includes("+") && !isSpecialRemapTarget(r.targetKey),
    );
    const bound = new Map((keysById.get(u.id) ?? []).map((k) => [k.action, k.keyCode]));
    const buildKeys = (actions: readonly FeaturedKey["action"][]): FeaturedKey[] => {
      const out: FeaturedKey[] = [];
      for (const action of actions) {
        const gameKey = bound.get(action);
        if (!gameKey || gameKey.startsWith("Gamepad") || gameKey === "_UNBOUND") continue;
        const normalized = normalizeKeyCode(gameKey);
        const remap = remaps.find((r) => normalizeKeyCode(r.targetKey as string) === normalized);
        out.push({
          action,
          keyCode: remap ? normalizeKeyCode(remap.sourceKey) : normalized,
        });
      }
      return out;
    };
    const keys = buildKeys(FEATURED_KEY_ACTIONS);
    const hotbar = buildKeys(FEATURED_HOTBAR_ACTIONS);

    result.push({
      slug: u.slug,
      mcid: u.mcid,
      uuid: u.uuid,
      displayName: u.displayName,
      displayNameAlphabet: u.displayNameAlphabet,
      customSkinUrl: u.customSkinUrl,
      mainCategory,
      pbMs: pb?.record.personalBest ?? null,
      sensitivityPercent,
      cm180,
      keys,
      hotbar,
      reason: pick.reason,
    });
  }
  return result;
}

/** 「キー配置・感度・メインカテゴリが揃った」公開プロフィールの id・slug 一覧（日替わり・ランダム用の母集団） */
async function getEligiblePool(db: Database): Promise<{ id: string; slug: string }[]> {
  const cacheKey = "home:featured-pool:v1";
  const cached = await getCached<{ id: string; slug: string }[]>(cacheKey);
  if (cached) return cached;

  const actions = sql.join(
    FEATURED_KEY_ACTIONS.map((a) => sql`${a}`),
    sql`, `,
  );
  const rows = await db
    .select({ id: users.id, slug: users.slug })
    .from(users)
    .innerJoin(playstyles, eq(playstyles.userId, users.id))
    .innerJoin(playerConfigs, eq(playerConfigs.userId, users.id))
    .where(
      and(
        publicRunnerWhere,
        isNotNull(playstyles.mainCategory),
        isNotNull(playerConfigs.gameSensitivity),
        sql`(SELECT count(*) FROM ${keybindings} WHERE ${keybindings.userId} = ${users.id} AND ${keybindings.action} IN (${actions}) AND ${keybindings.keyCode} <> '_UNBOUND') >= ${FEATURED_MIN_KEYS}`,
      ),
    )
    .orderBy(users.slug);
  const pool = rows.map((r) => ({ id: r.id, slug: r.slug }));
  await setCached(cacheKey, pool, FEATURED_TTL);
  return pool;
}

/** 直近7日の出来事を集める（各取得は独立に失敗しても他へ影響させない） */
async function collectEvents(db: Database, now: number): Promise<FeaturedEvent[]> {
  const startMs = now - WINDOW_DAYS * DAY_MS;
  const startDate = utcDateKey(startMs);
  const events: FeaturedEvent[] = [];

  // speedrun.com の新規申請（verificationStatus が new でも対象）/ Ranked の PB 更新。recordDate が期間内
  const rankingRows = await db
    .select({
      userId: playerRankings.userId,
      type: playerRankings.rankingType,
      timeMs: playerRankings.timeMs,
      recordDate: playerRankings.recordDate,
      verificationStatus: playerRankings.verificationStatus,
      categoryName: speedrunCategories.name,
      showRankedStats: users.showRankedStats,
    })
    .from(playerRankings)
    .innerJoin(users, eq(playerRankings.userId, users.id))
    .leftJoin(speedrunCategories, eq(playerRankings.categoryId, speedrunCategories.id))
    .where(
      and(
        inArray(playerRankings.rankingType, ["speedruncom", "ranked_pb"]),
        isNotNull(playerRankings.recordDate),
        gte(playerRankings.recordDate, startDate),
        isNotNull(playerRankings.timeMs),
        ne(playerRankings.verificationStatus, "rejected"),
        publicRunnerWhere,
      ),
    )
    .catch(() => []);
  for (const r of rankingRows) {
    if (!r.timeMs || !r.recordDate) continue;
    const at = Date.parse(r.recordDate);
    if (r.type === "speedruncom") {
      events.push({
        userId: r.userId,
        reason: {
          type: "speedruncom",
          timeMs: r.timeMs,
          categoryName: r.categoryName ?? null,
          status: r.verificationStatus === "new" ? "new" : "verified",
        },
        at,
      });
    } else if (r.showRankedStats !== false) {
      events.push({ userId: r.userId, reason: { type: "rankedPb", timeMs: r.timeMs }, at });
    }
  }

  // Ranked のレート上昇幅: 期間内の最古のスナップショット（7日前に近い日）と最新の差。
  // 7日分たまるまで（最古が6日以上前でない間）は対象外
  const snapRows = await db
    .select({
      userId: rankedEloSnapshots.userId,
      date: rankedEloSnapshots.snapshotDate,
      elo: rankedEloSnapshots.eloRate,
      showRankedStats: users.showRankedStats,
    })
    .from(rankedEloSnapshots)
    .innerJoin(users, eq(rankedEloSnapshots.userId, users.id))
    .where(and(gte(rankedEloSnapshots.snapshotDate, startDate), publicRunnerWhere))
    .catch(() => []);
  const baselineLimit = utcDateKey(now - (WINDOW_DAYS - 1) * DAY_MS);
  const byUser = new Map<string, { first: (typeof snapRows)[number]; last: (typeof snapRows)[number] }>();
  for (const s of snapRows) {
    if (s.showRankedStats === false) continue;
    const cur = byUser.get(s.userId);
    if (!cur) byUser.set(s.userId, { first: s, last: s });
    else {
      if (s.date < cur.first.date) cur.first = s;
      if (s.date > cur.last.date) cur.last = s;
    }
  }
  for (const [userId, { first, last }] of byUser) {
    if (first.date > baselineLimit) continue;
    const gain = last.elo - first.elo;
    if (gain >= MIN_ELO_GAIN) events.push({ userId, reason: { type: "eloGain", gain }, at: Date.parse(last.date) });
  }

  // 新しい動画（YouTube / Twitch のキャッシュ。公開日時が期間内。ホーム表示をオフにした人の動画は forHome で除く）
  const videos = await getPublicVideoFeed(db, {}, { forHome: true }).catch(() => []);
  const videoSlugs = new Map<string, number>();
  for (const v of videos) {
    const at = new Date(v.publishedAt).getTime();
    if (at < startMs) break; // 新しい順なので以降は期間外
    if (v.slug && !videoSlugs.has(v.slug)) videoSlugs.set(v.slug, at);
  }
  if (videoSlugs.size > 0) {
    const rows = await db
      .select({ id: users.id, slug: users.slug })
      .from(users)
      .where(and(inArray(users.slug, [...videoSlugs.keys()]), publicRunnerWhere));
    for (const r of rows) {
      events.push({ userId: r.id, reason: { type: "video" }, at: videoSlugs.get(r.slug) ?? now });
    }
  }
  return events;
}

/** ホームの注目の走者（候補5人 ＋ 候補0人のときの日替わり1人）。10分キャッシュ */
export async function getHomeSpotlight(db: Database, now: number = Date.now()): Promise<HomeSpotlight> {
  const cacheKey = "home:spotlight:v5";
  const cached = await getCached<HomeSpotlight>(cacheKey);
  if (cached) return cached;

  const events = await collectEvents(db, now);
  const picks = pickFeaturedCandidates(events);
  // 非公開化などで落ちる人がいるため、点数順を保ったまま hydrate する
  const candidates = await hydrateRunners(db, picks);

  let fallback: FeaturedRunner | null = null;
  if (candidates.length === 0) {
    const pool = await getEligiblePool(db);
    const idx = dailyPickIndex(utcDateKey(now), pool.length);
    if (idx >= 0) {
      const [runner] = await hydrateRunners(db, [{ userId: pool[idx].id, reason: null }]);
      fallback = runner ?? null;
    }
  }

  const result: HomeSpotlight = { candidates, fallback };
  await setCached(cacheKey, result, FEATURED_TTL);
  return result;
}

/**
 * 「別の走者」用のランダムな1人（理由なし）。母集団は「キー配置・感度・メインカテゴリが揃った公開プロフィール」。
 * exclude（表示中・直前に出した slug）を除き、残りが無ければ null
 */
export async function getRandomFeaturedRunner(db: Database, excludeSlugs: string[]): Promise<FeaturedRunner | null> {
  const pool = (await getEligiblePool(db)).filter((p) => !excludeSlugs.includes(p.slug));
  if (pool.length === 0) return null;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  const [runner] = await hydrateRunners(db, [{ userId: pick.id, reason: null }]);
  return runner ?? null;
}
