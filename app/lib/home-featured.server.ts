// ホームの「注目の走者」のデータ取得（DB）。ロケール非依存の結果を10分キャッシュする。
// 候補は直近7日の出来事（speedrun.com の新規申請 / Ranked の PB 更新 / Ranked のレート上昇 / 新しい動画）から
// 点数順に最大5人。点数・選定は home-featured.ts（純粋ロジック）。外部 API は使わず、cron が取得済みの DB だけを読む。

import { and, eq, gte, inArray, isNotNull, ne, notExists, or, sql } from "drizzle-orm";
import type { Database } from "./db";
import {
  users,
  playerRankings,
  speedrunCategories,
  rankedEloSnapshots,
  playstyles,
  categoryRecords,
  configPresets,
  playerConfigs,
  keybindings,
  keyRemaps,
} from "./schema";
import { listedRunnerCondition, rankedStatsVisibleCondition } from "./users-filter";
import { getCached, setCached } from "./cache";
import { getPublicVideoFeed } from "./videos-feed.server";
import { calculateCm360, isValidSensitivity, toSensitivityPercent } from "./mouse-settings";
import { filterRemapsForTrigger, isSpecialRemapTarget } from "./remap-utils";
import { UNBOUND_KEY, isControllerKeyCode, isUnbound, keysEqual, normalizeKeyCode } from "./keybindings";
import { decodePresetConfig, shouldUsePresetSnapshot } from "./preset-read";
import { parseRunIdList } from "./run-id-list";
import { isVersionKey } from "./playstyle";
import { groupByUserId } from "./group-by-user";
import { toUtcDateString } from "./time-utils";
import { DAY_MS } from "./home-favorite-activity-shared";
import {
  FEATURED_HOTBAR_ACTIONS,
  FEATURED_KEY_ACTIONS,
  FEATURED_MIN_KEYS,
  dailyPickIndex,
  officialCategorySlug,
  pickFeaturedCandidates,
  pickOfficialPb,
  type FeaturedEvent,
  type FeaturedKey,
  type FeaturedReason,
  type FeaturedRunner,
} from "./home-featured";

const FEATURED_TTL = 10 * 60 * 1000;
const WINDOW_DAYS = 7;
/** Ranked のレート上昇を出来事として扱う最小幅 */
const MIN_ELO_GAIN = 20;

/** キャッシュキー。形状・選定規則を変えたら版数を上げる（テストからも参照する） */
export const SPOTLIGHT_CACHE_KEY = "home:spotlight:v7";
export const FEATURED_POOL_CACHE_KEY = "home:featured-pool:v2";

export interface HomeSpotlight {
  /** 直近7日の出来事の候補（点数の高い順・最大5人） */
  candidates: FeaturedRunner[];
  /** 候補が0人のときの日替わりの1人（候補があるときは null） */
  fallback: FeaturedRunner | null;
}

/** 注目カードの表示に使う設定の入力（公開用の設定: メインのスナップショット、または編集中ならライブテーブル） */
interface RunnerSettings {
  config: {
    mouseDpi: number | null;
    gameSensitivity: number | null;
    rawInput: boolean | null;
    windowsSpeed: number | null;
    windowsSpeedMultiplier: number | null;
  } | null;
  keys: { action: string; keyCode: string }[];
  remaps: { sourceKey: string; targetKey: string | null; remapType?: string | null }[];
}

/** メインプリセット（isMain）の行。公開面の設定の唯一の情報源の判定に使う */
type MainPresetRow = {
  userId: string;
  isActive: boolean;
  keybindingsData: string | null;
  playerConfigData: string | null;
  remapsData: string | null;
};

const MAIN_PRESET_COLUMNS = {
  userId: configPresets.userId,
  isActive: configPresets.isActive,
  keybindingsData: configPresets.keybindingsData,
  playerConfigData: configPresets.playerConfigData,
  remapsData: configPresets.remapsData,
};

/** メインのスナップショットを設定の入力へ展開する（null の種別は空。ライブへはフォールバックしない） */
function settingsFromSnapshot(preset: MainPresetRow): RunnerSettings {
  const decoded = decodePresetConfig(preset, preset.userId);
  const c = decoded.playerConfig;
  return {
    config: c
      ? {
          mouseDpi: c.mouseDpi ?? null,
          gameSensitivity: c.gameSensitivity ?? null,
          rawInput: c.rawInput ?? null,
          windowsSpeed: c.windowsSpeed ?? null,
          windowsSpeedMultiplier: c.windowsSpeedMultiplier ?? null,
        }
      : null,
    keys: decoded.keybindings,
    remaps: decoded.keyRemaps,
  };
}

/** 指定ユーザーの表示用データ（プレイスタイル・PB・感度・主要キー）を1クエリずつ一括取得して組み立てる */
async function hydrateRunners(
  db: Database,
  picks: { userId: string; reason: FeaturedReason | null }[],
): Promise<FeaturedRunner[]> {
  if (picks.length === 0) return [];
  const ids = picks.map((p) => p.userId);

  const [userRows, styleRows, rankingRows, presetRows] = await Promise.all([
    db
      .select({
        id: users.id,
        slug: users.slug,
        mcid: users.mcid,
        uuid: users.uuid,
        displayName: users.displayName,
        displayNameAlphabet: users.displayNameAlphabet,
        customSkinUrl: users.customSkinUrl,
        showRankedStats: users.showRankedStats,
        hiddenSpeedrunRecords: users.hiddenSpeedrunRecords,
      })
      .from(users)
      .where(and(inArray(users.id, ids), listedRunnerCondition)),
    db
      .select({
        userId: playstyles.userId,
        mainCategory: playstyles.mainCategory,
        mainVersion: playstyles.mainVersion,
      })
      .from(playstyles)
      .where(inArray(playstyles.userId, ids)),
    // 公式記録だけ（cron が取得済みの player_rankings）。手入力の記録（category_records）は使わない
    db
      .select({
        userId: playerRankings.userId,
        type: playerRankings.rankingType,
        categoryId: playerRankings.categoryId,
        timeMs: playerRankings.timeMs,
        verificationStatus: playerRankings.verificationStatus,
        speedruncomRunId: playerRankings.speedruncomRunId,
      })
      .from(playerRankings)
      .where(
        and(
          inArray(playerRankings.userId, ids),
          isNotNull(playerRankings.timeMs),
          or(eq(playerRankings.rankingType, "ranked_pb_all_time"), eq(playerRankings.rankingType, "speedruncom")),
        ),
      ),
    db
      .select(MAIN_PRESET_COLUMNS)
      .from(configPresets)
      .where(and(inArray(configPresets.userId, ids), eq(configPresets.isMain, true))),
  ]);

  // 設定の取得元: メインが非アクティブならそのスナップショット。メイン無し / メインが編集中ならライブテーブル
  // （プロフィール・操作設定一覧と同じ規則。shouldUsePresetSnapshot が単一の決定点）
  const settingsById = new Map<string, RunnerSettings>();
  for (const preset of presetRows) {
    if (shouldUsePresetSnapshot(preset)) settingsById.set(preset.userId, settingsFromSnapshot(preset));
  }
  const liveIds = ids.filter((id) => !settingsById.has(id));
  if (liveIds.length > 0) {
    const [configRows, keyRows, remapRows] = await Promise.all([
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
        .where(inArray(playerConfigs.userId, liveIds)),
      db
        .select({ userId: keybindings.userId, action: keybindings.action, keyCode: keybindings.keyCode })
        .from(keybindings)
        .where(
          and(
            inArray(keybindings.userId, liveIds),
            inArray(keybindings.action, [...FEATURED_KEY_ACTIONS, ...FEATURED_HOTBAR_ACTIONS]),
          ),
        ),
      db
        .select({
          userId: keyRemaps.userId,
          sourceKey: keyRemaps.sourceKey,
          targetKey: keyRemaps.targetKey,
          remapType: keyRemaps.remapType,
        })
        .from(keyRemaps)
        .where(inArray(keyRemaps.userId, liveIds)),
    ]);
    const configById = new Map(configRows.map((c) => [c.userId, c]));
    const keysByUser = groupByUserId(keyRows);
    const remapsByUser = groupByUserId(remapRows);
    for (const id of liveIds) {
      settingsById.set(id, {
        config: configById.get(id) ?? null,
        keys: keysByUser.get(id) ?? [],
        remaps: remapsByUser.get(id) ?? [],
      });
    }
  }

  const userById = new Map(userRows.map((u) => [u.id, u]));
  const styleById = new Map(styleRows.map((s) => [s.userId, s]));
  const rankingsById = groupByUserId(rankingRows);
  // 対応する speedrun.com カテゴリ（slug → id）。選ばれた数人ぶんの対応 slug だけ引く
  const wantedSlugs = [
    ...new Set(
      styleRows
        .map((s) => officialCategorySlug(s.mainCategory, s.mainVersion))
        .filter((s): s is string => s != null),
    ),
  ];
  const categoryIdBySlug = new Map<string, string>();
  if (wantedSlugs.length > 0) {
    const catRows = await db
      .select({ id: speedrunCategories.id, slug: speedrunCategories.slug })
      .from(speedrunCategories)
      .where(and(inArray(speedrunCategories.slug, wantedSlugs), eq(speedrunCategories.categoryType, "speedruncom")));
    for (const c of catRows) categoryIdBySlug.set(c.slug, c.id);
  }

  const result: FeaturedRunner[] = [];
  for (const pick of picks) {
    const u = userById.get(pick.userId);
    if (!u) continue; // 非公開化・視聴者化・退会した人は出さない
    const style = styleById.get(u.id);
    const mainCategory = style?.mainCategory ?? null;
    const mainVersion = isVersionKey(style?.mainVersion) ? style.mainVersion : null;
    // 公式記録の自己ベスト。対応するカテゴリが slug から確実に1つ引けるときだけ speedrun.com を見る
    const userRankings = rankingsById.get(u.id) ?? [];
    const slug = officialCategorySlug(mainCategory, mainVersion);
    const categoryId = slug ? (categoryIdBySlug.get(slug) ?? null) : null;
    const hiddenRunIds = new Set(parseRunIdList(u.hiddenSpeedrunRecords));
    const pbMs = pickOfficialPb({
      mainCategory,
      showRankedStats: u.showRankedStats,
      rankedAllTimeMs: userRankings.find((r) => r.type === "ranked_pb_all_time")?.timeMs ?? null,
      srcRuns:
        categoryId == null
          ? []
          : userRankings.filter(
              (r) =>
                r.type === "speedruncom" &&
                r.categoryId === categoryId &&
                !(r.speedruncomRunId && hiddenRunIds.has(r.speedruncomRunId)),
            ),
    });
    const { config, keys: boundKeys, remaps: allRemaps } = settingsById.get(u.id) as RunnerSettings;
    const sensitivityPercent =
      config && isValidSensitivity(config.gameSensitivity) ? toSensitivityPercent(config.gameSensitivity) : null;
    const cm180 = config
      ? calculateCm360(config.mouseDpi, config.gameSensitivity, config.rawInput, config.windowsSpeed, config.windowsSpeedMultiplier)
      : null;

    // リマップ: ゲーム内キー（target）を出すために実際に押す物理キー（source）へ置き換える（trigger 文脈のみ）
    const remaps = filterRemapsForTrigger(allRemaps).filter(
      (r) => r.targetKey != null && !r.sourceKey.includes("+") && !isSpecialRemapTarget(r.targetKey),
    );
    const bound = new Map(boundKeys.map((k) => [k.action, k.keyCode]));
    const buildKeys = (actions: readonly FeaturedKey["action"][]): FeaturedKey[] => {
      const out: FeaturedKey[] = [];
      for (const action of actions) {
        const gameKey = bound.get(action);
        if (!gameKey || isControllerKeyCode(gameKey) || isUnbound(gameKey)) continue;
        const remap = remaps.find((r) => keysEqual(r.targetKey as string, gameKey));
        out.push({
          action,
          keyCode: normalizeKeyCode(remap ? remap.sourceKey : gameKey),
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
      mainVersion,
      pbMs,
      sensitivityPercent,
      cm180,
      keys,
      hotbar,
      reason: pick.reason,
    });
  }
  return result;
}

/**
 * 「キー配置・感度・メインカテゴリが揃った」公開プロフィールの id・slug 一覧（日替わり・ランダム用の母集団）。
 * 「揃った」の判定は表示と同じ設定の取得元（メインが非アクティブならスナップショット、それ以外はライブテーブル）で行う
 */
async function getEligiblePool(db: Database): Promise<{ id: string; slug: string }[]> {
  const cached = await getCached<{ id: string; slug: string }[]>(FEATURED_POOL_CACHE_KEY);
  if (cached) return cached;

  const actions = sql.join(
    FEATURED_KEY_ACTIONS.map((a) => sql`${a}`),
    sql`, `,
  );
  const [candidates, liveEligible, snapshotPresets] = await Promise.all([
    // メインカテゴリがある公開プロフィール（スラグ順）
    db
      .select({ id: users.id, slug: users.slug })
      .from(users)
      .innerJoin(playstyles, eq(playstyles.userId, users.id))
      .where(and(listedRunnerCondition, isNotNull(playstyles.mainCategory)))
      .orderBy(users.slug),
    // ライブテーブルでの判定（メイン無し / メインが編集中の人に適用する）
    db
      .select({ id: users.id })
      .from(users)
      .innerJoin(playerConfigs, eq(playerConfigs.userId, users.id))
      .where(
        and(
          isNotNull(playerConfigs.gameSensitivity),
          sql`(SELECT count(*) FROM ${keybindings} WHERE ${keybindings.userId} = ${users.id} AND ${keybindings.action} IN (${actions}) AND ${keybindings.keyCode} <> ${UNBOUND_KEY}) >= ${FEATURED_MIN_KEYS}`,
        ),
      ),
    // メインが非アクティブの人のスナップショット（判定はアプリ側。広めに取って絞る）
    db
      .select(MAIN_PRESET_COLUMNS)
      .from(configPresets)
      .innerJoin(users, eq(configPresets.userId, users.id))
      .innerJoin(playstyles, eq(playstyles.userId, users.id))
      .where(
        and(
          eq(configPresets.isMain, true),
          eq(configPresets.isActive, false),
          listedRunnerCondition,
          isNotNull(playstyles.mainCategory),
        ),
      ),
  ]);

  const liveEligibleIds = new Set(liveEligible.map((r) => r.id));
  const snapshotEligibleIds = new Map<string, boolean>();
  for (const preset of snapshotPresets) {
    const { config, keys } = settingsFromSnapshot(preset);
    const featuredKeys = keys.filter(
      (k) => (FEATURED_KEY_ACTIONS as readonly string[]).includes(k.action) && !isUnbound(k.keyCode),
    ).length;
    snapshotEligibleIds.set(preset.userId, config?.gameSensitivity != null && featuredKeys >= FEATURED_MIN_KEYS);
  }

  const pool = candidates.filter((c) => snapshotEligibleIds.get(c.id) ?? liveEligibleIds.has(c.id));
  await setCached(FEATURED_POOL_CACHE_KEY, pool, FEATURED_TTL);
  return pool;
}

/** 直近7日の出来事を集める（各取得は独立に失敗しても他へ影響させない） */
async function collectEvents(db: Database, now: number): Promise<FeaturedEvent[]> {
  const startMs = now - WINDOW_DAYS * DAY_MS;
  const startDate = toUtcDateString(new Date(startMs));

  // speedrun.com の新規申請（verificationStatus が new でも対象）/ Ranked の PB 更新。recordDate が期間内
  const collectRankingEvents = async (): Promise<FeaturedEvent[]> => {
    const rankingRows = await db
      .select({
        userId: playerRankings.userId,
        type: playerRankings.rankingType,
        timeMs: playerRankings.timeMs,
        recordDate: playerRankings.recordDate,
        verificationStatus: playerRankings.verificationStatus,
        speedruncomRunId: playerRankings.speedruncomRunId,
        categoryName: speedrunCategories.name,
        hiddenSpeedrunRecords: users.hiddenSpeedrunRecords,
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
          listedRunnerCondition,
          // Ranked の PB は「Ranked 統計を表示しない」人を除く。speedrun.com は設定なし
          or(eq(playerRankings.rankingType, "speedruncom"), rankedStatsVisibleCondition),
          // 非表示にした記録（記録ページの isVisible=false）は /rankings と同じく出さない。
          // ranked_pb 行は categoryId が null（NULL との比較は常に偽）なので影響せず、実質 speedrun.com の行にだけ効く
          notExists(
            db
              .select({ id: categoryRecords.id })
              .from(categoryRecords)
              .where(
                and(
                  eq(categoryRecords.userId, playerRankings.userId),
                  eq(categoryRecords.categoryRefId, playerRankings.categoryId),
                  eq(categoryRecords.isVisible, false),
                ),
              ),
          ),
        ),
      )
      .catch(() => []);

    const events: FeaturedEvent[] = [];
    // 走者の数だけ JSON を解析し直さない
    const hiddenRunIds = new Map<string, Set<string>>();
    for (const r of rankingRows) {
      if (!r.timeMs || !r.recordDate) continue;
      const at = Date.parse(r.recordDate);
      if (r.type === "speedruncom") {
        // オーナーが非表示にした run（users.hiddenSpeedrunRecords）は出さない
        let hidden = hiddenRunIds.get(r.userId);
        if (!hidden) {
          hidden = new Set(parseRunIdList(r.hiddenSpeedrunRecords));
          hiddenRunIds.set(r.userId, hidden);
        }
        if (r.speedruncomRunId && hidden.has(r.speedruncomRunId)) continue;
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
      } else {
        events.push({ userId: r.userId, reason: { type: "rankedPb", timeMs: r.timeMs }, at });
      }
    }
    return events;
  };

  // Ranked のレート上昇幅: 期間内の最古のスナップショット（7日前に近い日）と最新の差。
  // 7日分たまるまで（最古が6日以上前でない間）は対象外
  const collectEloEvents = async (): Promise<FeaturedEvent[]> => {
    const snapRows = await db
      .select({
        userId: rankedEloSnapshots.userId,
        date: rankedEloSnapshots.snapshotDate,
        elo: rankedEloSnapshots.eloRate,
      })
      .from(rankedEloSnapshots)
      .innerJoin(users, eq(rankedEloSnapshots.userId, users.id))
      .where(and(gte(rankedEloSnapshots.snapshotDate, startDate), listedRunnerCondition, rankedStatsVisibleCondition))
      .catch(() => []);
    const baselineLimit = toUtcDateString(new Date(now - (WINDOW_DAYS - 1) * DAY_MS));
    const byUser = new Map<string, { first: (typeof snapRows)[number]; last: (typeof snapRows)[number] }>();
    for (const s of snapRows) {
      const cur = byUser.get(s.userId);
      if (!cur) byUser.set(s.userId, { first: s, last: s });
      else {
        if (s.date < cur.first.date) cur.first = s;
        if (s.date > cur.last.date) cur.last = s;
      }
    }
    const events: FeaturedEvent[] = [];
    for (const [userId, { first, last }] of byUser) {
      if (first.date > baselineLimit) continue;
      const gain = last.elo - first.elo;
      if (gain >= MIN_ELO_GAIN) events.push({ userId, reason: { type: "eloGain", gain }, at: Date.parse(last.date) });
    }
    return events;
  };

  // 新しい動画（YouTube / Twitch のキャッシュ。公開日時が期間内。ホーム表示をオフにした人の動画は forHome で除く）
  const collectVideoEvents = async (): Promise<FeaturedEvent[]> => {
    const videos = await getPublicVideoFeed(db, {}, { forHome: true }).catch(() => []);
    const videoSlugs = new Map<string, number>();
    for (const v of videos) {
      const at = new Date(v.publishedAt).getTime();
      if (at < startMs) break; // 新しい順なので以降は期間外
      if (v.slug && !videoSlugs.has(v.slug)) videoSlugs.set(v.slug, at);
    }
    if (videoSlugs.size === 0) return [];
    const rows = await db
      .select({ id: users.id, slug: users.slug })
      .from(users)
      .where(and(inArray(users.slug, [...videoSlugs.keys()]), listedRunnerCondition));
    return rows.map((r) => ({ userId: r.id, reason: { type: "video" } as const, at: videoSlugs.get(r.slug) ?? now }));
  };

  // 3種の取得は互いに独立なので並列に走らせる
  const [rankingEvents, eloEvents, videoEvents] = await Promise.all([
    collectRankingEvents(),
    collectEloEvents(),
    collectVideoEvents(),
  ]);
  return [...rankingEvents, ...eloEvents, ...videoEvents];
}

/** ホームの注目の走者（候補5人 ＋ 候補0人のときの日替わり1人）。10分キャッシュ */
export async function getHomeSpotlight(db: Database, now: number = Date.now()): Promise<HomeSpotlight> {
  const cacheKey = SPOTLIGHT_CACHE_KEY;
  const cached = await getCached<HomeSpotlight>(cacheKey);
  if (cached) return cached;

  const events = await collectEvents(db, now);
  const picks = pickFeaturedCandidates(events);
  // 非公開化などで落ちる人がいるため、点数順を保ったまま hydrate する
  const candidates = await hydrateRunners(db, picks);

  let fallback: FeaturedRunner | null = null;
  if (candidates.length === 0) {
    const pool = await getEligiblePool(db);
    const idx = dailyPickIndex(toUtcDateString(new Date(now)), pool.length);
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
