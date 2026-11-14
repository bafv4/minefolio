// ホームの「お気に入りの動き」（お気に入りの人のペース・動画・プロフィール更新・ガイド公開を新しい順に10件）。
// ログイン済みはサーバーのお気に入り、未ログインはブラウザのお気に入り（POST 本文の slug）を呼び出し側が渡す。
// 対象は公開プロフィール（視聴者除外）のみ。各種別を1クエリずつ（お気に入りの userId 群に対して）取得する。

import { and, desc, eq, gte, inArray, isNotNull } from "drizzle-orm";
import type { Database } from "./db";
import {
  users,
  pacemanPaces,
  guides,
  playerRankings,
  speedrunCategories,
  rankedEloSnapshots,
  configHistory,
} from "./schema";
import { getRankTier, rankTierOrder, type RankTier } from "./mcsr-ranked-tiers";
import { parseRunIdList } from "./run-id-list";
import { isRankedStatsVisible, listedRunnerCondition } from "./users-filter";
import { isHiddenOnHome } from "./home-visibility.server";
import { publicConfigChangeCondition } from "./config-history";
import { groupByUserId } from "./group-by-user";
import { toUtcDateString } from "./time-utils";
import { getPublicVideoFeed } from "./videos-feed.server";
import { getPaceRetentionStart } from "./paceman-cache";
import { splitStage } from "./home-live";
import {
  DAY_MS,
  FAVORITE_ACTIVITY_LIMIT,
  FAVORITE_ACTIVITY_MAX_LIMIT,
  FAVORITE_ACTIVITY_MAX_WINDOW_DAYS,
  FAVORITE_ACTIVITY_WINDOW_DAYS,
  FAVORITE_SLUGS_MAX,
} from "./home-favorite-activity-shared";

/** rankedEloSnapshots は期間より前の基準を探すため、この日数ぶん余分に遡って読む */
const SNAPSHOT_LOOKBACK_DAYS = 14;

export type FavoriteActivityKind =
  | "pace"
  | "video"
  | "profile"
  | "guide"
  | "rankTierUp"
  | "rankedPb"
  | "srcSubmit"
  | "settings";

/** settings の label に入る config_history.change_type */
export type FavoriteSettingsChangeType = (typeof configHistory.changeType.enumValues)[number];

/** 変更履歴の種別ごとの遷移先プロフィールタブ */
const SETTINGS_TAB: Record<FavoriteSettingsChangeType, string> = {
  keybinding: "keybindings",
  remap: "keybindings",
  preset_switch: "keybindings",
  device: "devices",
  // アイテム配置・サーチクラフト・プリセット保存などが混在する種別なので、文面は汎用にして遷移先はキー配置タブにする
  game_setting: "keybindings",
};

export interface FavoriteActivityItem {
  kind: FavoriteActivityKind;
  /** 出来事の時刻（ms） */
  at: number;
  slug: string;
  mcid: string | null;
  uuid: string | null;
  displayName: string | null;
  displayNameAlphabet: string | null;
  customSkinUrl: string | null;
  /** 遷移先（アプリ内パス） */
  href: string;
  /** pace: 到達区間名 / video・guide: タイトル / rankTierUp: 到達階級（"Emerald I" 等）/ srcSubmit: カテゴリ名 / settings: change_type */
  label: string | null;
  /** pace: 区間IGT / rankedPb・srcSubmit: タイム（ミリ秒） */
  timeMs: number | null;
  /** pace: PaceMan のラン ID（タイムラインモーダル用） */
  runId: number | null;
  /** 日付までしか分からない出来事（rankTierUp・rankedPb）。at は UTC 正午（now は超えない）。時刻は表示しない */
  dateOnly: boolean;
}

export interface FavoriteActivityResult {
  /** 公開プロフィールとして解決できたお気に入りの人数 */
  favoritesCount: number;
  items: FavoriteActivityItem[];
}

export interface FavoriteActivityOptions {
  /** 何日前までの動きを対象にするか（既定 7、最大 30） */
  windowDays?: number;
  /** 返す最大件数（既定 10、最大 100） */
  limit?: number;
  now?: number;
}

/** 1人あたりの件数上限を消費する。上限に達していれば false（消費しない） */
function takeQuota(counts: Map<string, number>, id: string, max: number): boolean {
  const used = counts.get(id) ?? 0;
  if (used >= max) return false;
  counts.set(id, used + 1);
  return true;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

/** クライアントから来た期間・件数を検証してクランプする（不正値は既定値）。 */
export function clampFavoriteActivityOptions(raw: { windowDays?: unknown; limit?: unknown }): {
  windowDays: number;
  limit: number;
} {
  return {
    windowDays: clampInt(raw.windowDays, FAVORITE_ACTIVITY_WINDOW_DAYS, 1, FAVORITE_ACTIVITY_MAX_WINDOW_DAYS),
    limit: clampInt(raw.limit, FAVORITE_ACTIVITY_LIMIT, 1, FAVORITE_ACTIVITY_MAX_LIMIT),
  };
}

export async function getFavoriteActivity(
  db: Database,
  slugs: readonly unknown[],
  options: FavoriteActivityOptions = {},
): Promise<FavoriteActivityResult> {
  const now = options.now ?? Date.now();
  const { windowDays, limit } = clampFavoriteActivityOptions(options);
  // 一覧ページ向け（件数が多い）のときは、1人あたりのペース件数も緩める
  const wide = limit > FAVORITE_ACTIVITY_LIMIT;
  const perPersonPaceMax = wide ? 5 : 2;
  // 新種別の1人あたり上限（ホームは控えめ、一覧は緩め）
  const perPersonNewKindMax = wide ? 3 : 1;
  // クライアント由来の値なので unknown として受け、ここで検証する（文字列・長さ・重複・上限）
  const unique = [
    ...new Set(slugs.filter((s): s is string => typeof s === "string" && s.length > 0 && s.length <= 100)),
  ].slice(0, FAVORITE_SLUGS_MAX);
  if (unique.length === 0) return { favoritesCount: 0, items: [] };

  const people = await db
    .select({
      id: users.id,
      slug: users.slug,
      mcid: users.mcid,
      uuid: users.uuid,
      displayName: users.displayName,
      displayNameAlphabet: users.displayNameAlphabet,
      customSkinUrl: users.customSkinUrl,
      updatedAt: users.updatedAt,
      showPacemanOnHome: users.showPacemanOnHome,
      showRankedStats: users.showRankedStats,
      hiddenSpeedrunRecords: users.hiddenSpeedrunRecords,
    })
    .from(users)
    .where(and(inArray(users.slug, unique), listedRunnerCondition));
  if (people.length === 0) return { favoritesCount: 0, items: [] };

  const since = new Date(now - windowDays * DAY_MS);
  const ids = people.map((p) => p.id);
  const bySlug = new Map(people.map((p) => [p.slug, p]));
  const byId = new Map(people.map((p) => [p.id, p]));
  const base = (p: (typeof people)[number]) => ({
    slug: p.slug,
    mcid: p.mcid,
    uuid: p.uuid,
    displayName: p.displayName,
    displayNameAlphabet: p.displayNameAlphabet,
    customSkinUrl: p.customSkinUrl,
  });

  const sinceDate = toUtcDateString(since);
  // Ranked 系は「Ranked 統計を表示しない」人を除く（プロフィールの Ranked 表示と同じ条件）
  const rankedIds = people.filter(isRankedStatsVisible).map((p) => p.id);

  const [paceRows, guideRows, videos, rankedPbRows, snapshotRows, srcRows, historyRows] = await Promise.all([
    db
      .select({
        userId: pacemanPaces.userId,
        runId: pacemanPaces.pacemanRunId,
        timeline: pacemanPaces.timeline,
        rta: pacemanPaces.rta,
        date: pacemanPaces.date,
      })
      .from(pacemanPaces)
      .where(
        and(
          inArray(pacemanPaces.userId, ids),
          eq(pacemanPaces.isNetherEnter, false),
          gte(pacemanPaces.date, new Date(Math.max(since.getTime(), getPaceRetentionStart().getTime()))),
        ),
      )
      .orderBy(desc(pacemanPaces.date))
      .limit(Math.max(300, limit * 10)),
    db
      .select({ authorId: guides.authorId, slug: guides.slug, title: guides.title, updatedAt: guides.updatedAt })
      .from(guides)
      .where(and(inArray(guides.authorId, ids), eq(guides.isPublished, true), gte(guides.updatedAt, since)))
      .orderBy(desc(guides.updatedAt))
      .limit(Math.max(30, limit)),
    getPublicVideoFeed(db, {}, { forHome: true }).catch(() => []),
    // Ranked PB の更新（recordDate = cron が改善を検知した UTC 日）
    rankedIds.length === 0
      ? Promise.resolve([])
      : db
          .select({ userId: playerRankings.userId, timeMs: playerRankings.timeMs, recordDate: playerRankings.recordDate })
          .from(playerRankings)
          .where(
            and(
              inArray(playerRankings.userId, rankedIds),
              eq(playerRankings.rankingType, "ranked_pb"),
              isNotNull(playerRankings.timeMs),
              isNotNull(playerRankings.recordDate),
              gte(playerRankings.recordDate, sinceDate),
            ),
          )
          .catch(() => []),
    // Ranked のレート日次スナップショット（期間前の基準を取るため少し前から読む）
    rankedIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            userId: rankedEloSnapshots.userId,
            date: rankedEloSnapshots.snapshotDate,
            elo: rankedEloSnapshots.eloRate,
          })
          .from(rankedEloSnapshots)
          .where(
            and(
              inArray(rankedEloSnapshots.userId, rankedIds),
              gte(rankedEloSnapshots.snapshotDate, toUtcDateString(new Date(since.getTime() - SNAPSHOT_LOOKBACK_DAYS * DAY_MS))),
            ),
          )
          .orderBy(rankedEloSnapshots.snapshotDate)
          .catch(() => []),
    // speedrun.com への新規申請（審査中）。cron が初めて検知した時刻が期間内、かつラン自体の日付も期間内
    db
      .select({
        userId: playerRankings.userId,
        timeMs: playerRankings.timeMs,
        runId: playerRankings.speedruncomRunId,
        createdAt: playerRankings.createdAt,
        categoryName: speedrunCategories.name,
      })
      .from(playerRankings)
      .leftJoin(speedrunCategories, eq(playerRankings.categoryId, speedrunCategories.id))
      .where(
        and(
          inArray(playerRankings.userId, ids),
          eq(playerRankings.rankingType, "speedruncom"),
          eq(playerRankings.verificationStatus, "new"),
          isNotNull(playerRankings.timeMs),
          gte(playerRankings.createdAt, since),
          isNotNull(playerRankings.recordDate),
          gte(playerRankings.recordDate, sinceDate),
        ),
      )
      .orderBy(desc(playerRankings.createdAt))
      .catch(() => []),
    // 操作設定の変更履歴
    db
      .select({ userId: configHistory.userId, changeType: configHistory.changeType, createdAt: configHistory.createdAt })
      .from(configHistory)
      // 公開面に影響した変更（メインプリセットへの切替・メイン＝編集中の公開設定の保存）だけ
      .where(and(inArray(configHistory.userId, ids), gte(configHistory.createdAt, since), publicConfigChangeCondition()))
      .orderBy(desc(configHistory.createdAt))
      .limit(Math.max(300, limit * 10))
      .catch(() => []),
  ]);

  const items: FavoriteActivityItem[] = [];
  /** 1件追加する。label / timeMs / runId / dateOnly の既定値は「なし」 */
  const push = (
    p: (typeof people)[number],
    item: Pick<FavoriteActivityItem, "kind" | "at" | "href"> &
      Partial<Pick<FavoriteActivityItem, "label" | "timeMs" | "runId" | "dateOnly">>,
  ) => {
    items.push({ ...base(p), label: null, timeMs: null, runId: null, dateOnly: false, ...item });
  };

  // ペース: 同じランは最も進んだ区間だけ。1人あたり2件まで
  const bestPerRun = new Map<string, (typeof paceRows)[number]>();
  for (const r of paceRows) {
    if (!r.userId) continue;
    const key = `${r.userId}:${r.runId}`;
    const cur = bestPerRun.get(key);
    if (!cur || splitStage(r.timeline) > splitStage(cur.timeline) || (splitStage(r.timeline) === splitStage(cur.timeline) && r.rta > cur.rta)) {
      bestPerRun.set(key, r);
    }
  }
  const paceCount = new Map<string, number>();
  for (const r of [...bestPerRun.values()].sort((a, b) => b.date.getTime() - a.date.getTime())) {
    const p = byId.get(r.userId as string);
    if (!p) continue;
    if (isHiddenOnHome(p, "paceman")) continue; // 「ホーム画面にPaceManのペースを表示」オフの人は全員のホームから除く
    if (!takeQuota(paceCount, p.id, perPersonPaceMax)) continue;
    push(p, { kind: "pace", at: r.date.getTime(), href: `/player/${p.slug}`, label: r.timeline, timeMs: r.rta, runId: r.runId });
  }

  for (const v of videos) {
    const at = new Date(v.publishedAt).getTime();
    if (at < since.getTime()) break;
    const p = v.slug ? bySlug.get(v.slug) : null;
    if (!p) continue;
    push(p, { kind: "video", at, href: `/player/${p.slug}`, label: v.title });
  }

  for (const g of guideRows) {
    const p = byId.get(g.authorId);
    if (!p) continue;
    push(p, { kind: "guide", at: g.updatedAt.getTime(), href: `/guides/${p.slug}/${g.slug}`, label: g.title });
  }

  for (const p of people) {
    if (p.updatedAt.getTime() < since.getTime()) continue;
    push(p, { kind: "profile", at: p.updatedAt.getTime(), href: `/player/${p.slug}` });
  }

  // 日付だけ分かる出来事の時刻: その UTC 日の正午（now は超えない）
  const dateOnlyAt = (date: string): number => Math.min(now, Date.parse(`${date}T12:00:00Z`));

  // Ranked のレート帯 UP: 基準（期間前の最新、無ければ期間内の最初）から見て、最高階級を更新した日だけ。到達階級を1日1件
  for (const [userId, snaps] of groupByUserId(snapshotRows)) {
    const p = byId.get(userId);
    if (!p) continue;
    const before = snaps.filter((s) => s.date < sinceDate);
    const inWindow = snaps.filter((s) => s.date >= sinceDate);
    const baseline = before.length > 0 ? before[before.length - 1] : inWindow[0];
    if (!baseline) continue;
    let best = rankTierOrder(getRankTier(baseline.elo));
    const ups: { date: string; tier: RankTier }[] = [];
    for (const s of inWindow) {
      if (s === baseline) continue;
      const tier = getRankTier(s.elo);
      const order = rankTierOrder(tier);
      if (order > best) {
        best = order;
        ups.push({ date: s.date, tier });
      }
    }
    for (const u of ups.reverse().slice(0, perPersonNewKindMax)) {
      push(p, { kind: "rankTierUp", at: dateOnlyAt(u.date), href: `/player/${p.slug}?tab=stats`, label: u.tier.label, dateOnly: true });
    }
  }

  for (const r of rankedPbRows) {
    const p = byId.get(r.userId);
    if (!p || !r.recordDate || r.timeMs == null) continue;
    push(p, { kind: "rankedPb", at: dateOnlyAt(r.recordDate), href: `/player/${p.slug}?tab=stats`, timeMs: r.timeMs, dateOnly: true });
  }

  // speedrun.com への申請: オーナーが非表示にした run はプロフィールの審査中カードにも出ないので除く
  const hiddenByUser = new Map(people.map((p) => [p.id, new Set(parseRunIdList(p.hiddenSpeedrunRecords))]));
  const srcCount = new Map<string, number>();
  for (const r of srcRows) {
    const p = byId.get(r.userId);
    if (!p || r.timeMs == null) continue;
    if (r.runId && hiddenByUser.get(p.id)?.has(r.runId)) continue;
    if (!takeQuota(srcCount, p.id, perPersonNewKindMax)) continue;
    push(p, {
      kind: "srcSubmit",
      at: Math.min(now, r.createdAt.getTime()),
      href: `/player/${p.slug}?tab=stats&srcPending=1`,
      label: r.categoryName ?? null,
      timeMs: r.timeMs,
    });
  }

  // 操作設定の変更: 1人・1日（UTC）・changeType ごとに最新1件（historyRows は新しい順）
  const seenSettings = new Set<string>();
  const settingsCount = new Map<string, number>();
  for (const h of historyRows) {
    const p = byId.get(h.userId);
    if (!p) continue;
    const key = `${h.userId}:${toUtcDateString(h.createdAt)}:${h.changeType}`;
    if (seenSettings.has(key)) continue;
    seenSettings.add(key);
    if (!takeQuota(settingsCount, p.id, perPersonNewKindMax)) continue;
    push(p, {
      kind: "settings",
      at: Math.min(now, h.createdAt.getTime()),
      href: `/player/${p.slug}?tab=${SETTINGS_TAB[h.changeType]}`,
      label: h.changeType,
    });
  }

  items.sort((a, b) => b.at - a.at);
  return { favoritesCount: people.length, items: items.slice(0, limit) };
}
