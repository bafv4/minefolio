// ページビュー集計（Vercel Web Analytics → page_view_stats）の同期と、
// 「人気順」で使う相関サブクエリ。
//
// 方針:
// - 取得は cron のみ（/api/cron/update-page-views）。ページのローダーは DB だけを読む
// - 対象種別（profile / guide）ごとに独立して処理し、**片側の失敗でもう片側を壊さない**。
//   API 失敗時はその種別の旧スナップショットを残す（stale > empty。順序がいきなり
//   更新順へ落ちるより、少し古い人気順の方が体験がよい）
// - 公開状態（isPublished / profileVisibility）はここでは絞らない。読み手の一覧が
//   必ず WHERE で絞るため、集計側は「見えた path をそのまま数える」に徹する

import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { guides, pageViewStats, users, type NewPageViewStat } from "./schema";
import { parseAnalyticsPath } from "./page-view-paths";
import { fetchTopPaths } from "./vercel-analytics.server";
import type { Database } from "./db";
import type { Env } from "../env";

/** 「人気順」が見る窓（日数）。Analytics 側の保持期間より十分短くしておく */
export const PAGE_VIEW_WINDOW_DAYS = 7;

/** 1 文で挿入する行数。libSQL の 1 リクエストが肥大化しないよう分割する */
const INSERT_CHUNK_SIZE = 50;

const PROFILE_PATH_PREFIX = "/player/";
const GUIDE_PATH_PREFIX = "/guides/";

// ============================================
// 読み取り（一覧の並び替え用）
// ============================================

// ── 相関サブクエリの書き方について（重要） ────────────────────────
// likes.server.ts と同じ理由で、内側テーブルは `(select 必要な列だけ from ...)` で包む。
// 素直に `from page_view_stats where target_id = ${guides.id}` と書くと、drizzle が
// 外側の参照を修飾なしで描画する形（FROM が 1 テーブルの select / RQB）のときに
// **内側の page_view_stats.id** へ解決され、SQL エラーにならないまま常に 0 になる。
// 内側から id を消しておけば、修飾あり・なしのどちらで描画されても外側の行に解決される。

/** ガイドの直近ウィンドウのページビュー数（データが無ければ 0）。 */
export function guidePageViewsSql(): SQL<number> {
  return sql<number>`coalesce((select pageviews from (select target_type, target_id, pageviews from ${pageViewStats}) where target_type = 'guide' and target_id = ${guides.id}), 0)`;
}

/** プロフィールの直近ウィンドウのページビュー数（データが無ければ 0）。 */
export function profilePageViewsSql(): SQL<number> {
  return sql<number>`coalesce((select pageviews from (select target_type, target_id, pageviews from ${pageViewStats}) where target_type = 'profile' and target_id = ${users.id}), 0)`;
}

// ============================================
// 同期（cron）
// ============================================

/** 対象種別 1 つ分の同期結果 */
export interface PageViewSyncSideResult {
  ok: boolean;
  /** 書き込んだ行数（成功時のみ） */
  count?: number;
  /** 失敗理由（失敗時のみ。旧スナップショットは残っている） */
  error?: string;
}

export interface PageViewSyncResult {
  profiles: PageViewSyncSideResult;
  guides: PageViewSyncSideResult;
}

interface SyncWindow {
  sinceMs: number;
  untilMs: number;
  windowStart: Date;
  windowEnd: Date;
  fetchedAt: Date;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 対象種別 1 つ分のスナップショットを差し替える（delete → insert を 1 トランザクションで）。
 *
 * 差分更新にしないのは、Analytics 側の上位 N 件から落ちたパスを「0 になった」と判別できず、
 * 古い数値が残り続けるため。取得できた行が空でも全置換する（＝窓内にアクセスが無かった）。
 */
async function replaceSnapshot(
  db: Database,
  targetType: "profile" | "guide",
  values: NewPageViewStat[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(pageViewStats).where(eq(pageViewStats.targetType, targetType));
    for (const rows of chunk(values, INSERT_CHUNK_SIZE)) {
      await tx.insert(pageViewStats).values(rows);
    }
  });
}

/** プロフィール（/player/:slug）の同期 */
async function syncProfilePageViews(
  db: Database,
  env: Env,
  syncWindow: SyncWindow,
): Promise<PageViewSyncSideResult> {
  try {
    const rows = await fetchTopPaths(env, {
      sinceMs: syncWindow.sinceMs,
      untilMs: syncWindow.untilMs,
      pathPrefix: PROFILE_PATH_PREFIX,
    });

    // 大小文字違いのパス（/player/Runner と /player/runner）は同じ走者なので合算する
    const pageviewsBySlug = new Map<string, number>();
    for (const row of rows) {
      const parsed = parseAnalyticsPath(row.path);
      if (parsed?.type !== "profile") continue;
      pageviewsBySlug.set(
        parsed.slugLower,
        (pageviewsBySlug.get(parsed.slugLower) ?? 0) + row.pageviews,
      );
    }

    const slugs = [...pageviewsBySlug.keys()];
    const userRows = slugs.length
      ? await db
          .select({ id: users.id, slug: users.slug })
          .from(users)
          .where(inArray(sql`lower(${users.slug})`, slugs))
      : [];
    const idBySlugLower = new Map(userRows.map((row) => [row.slug.toLowerCase(), row.id]));

    const values = buildRows("profile", pageviewsBySlug, idBySlugLower, syncWindow);
    await replaceSnapshot(db, "profile", values);
    return { ok: true, count: values.length };
  } catch (error) {
    console.error("[page-views] profile sync failed:", error);
    return { ok: false, error: errorMessage(error) };
  }
}

/** ガイド（/guides/:authorSlug/:guideSlug）の同期 */
async function syncGuidePageViews(
  db: Database,
  env: Env,
  syncWindow: SyncWindow,
): Promise<PageViewSyncSideResult> {
  try {
    const rows = await fetchTopPaths(env, {
      sinceMs: syncWindow.sinceMs,
      untilMs: syncWindow.untilMs,
      pathPrefix: GUIDE_PATH_PREFIX,
    });

    // 著者 slug は小文字化して合算、ガイド slug は原文のまま（完全一致で引く）
    const pageviewsByKey = new Map<string, number>();
    const authorSlugs = new Set<string>();
    const guideSlugs = new Set<string>();
    for (const row of rows) {
      const parsed = parseAnalyticsPath(row.path);
      if (parsed?.type !== "guide") continue;
      const key = guideKey(parsed.authorSlugLower, parsed.guideSlug);
      pageviewsByKey.set(key, (pageviewsByKey.get(key) ?? 0) + row.pageviews);
      authorSlugs.add(parsed.authorSlugLower);
      guideSlugs.add(parsed.guideSlug);
    }

    // 著者 slug 群 × ガイド slug 群で粗く引き、(著者, ガイド) の組は JS 側で完全一致させる。
    // SQL で組ごとの OR を並べると slug 数に比例して式が膨らむため。
    const guideRows =
      authorSlugs.size && guideSlugs.size
        ? await db
            .select({ id: guides.id, slug: guides.slug, authorSlug: users.slug })
            .from(guides)
            .innerJoin(users, eq(guides.authorId, users.id))
            .where(
              and(
                inArray(sql`lower(${users.slug})`, [...authorSlugs]),
                inArray(guides.slug, [...guideSlugs]),
              ),
            )
        : [];
    const idByKey = new Map(
      guideRows.map((row) => [guideKey(row.authorSlug.toLowerCase(), row.slug), row.id]),
    );

    const values = buildRows("guide", pageviewsByKey, idByKey, syncWindow);
    await replaceSnapshot(db, "guide", values);
    return { ok: true, count: values.length };
  } catch (error) {
    console.error("[page-views] guide sync failed:", error);
    return { ok: false, error: errorMessage(error) };
  }
}

/** (著者slug小文字, ガイドslug) の組を 1 つのキーにする */
function guideKey(authorSlugLower: string, guideSlug: string): string {
  return `${authorSlugLower}/${guideSlug}`;
}

/**
 * 「キー → PV」と「キー → 対象 id」から挿入行を組み立てる。
 * 解決できなかったキー（削除済み・改名済み・存在しない slug）は捨てる。
 */
function buildRows(
  targetType: "profile" | "guide",
  pageviewsByKey: Map<string, number>,
  idByKey: Map<string, string>,
  syncWindow: SyncWindow,
): NewPageViewStat[] {
  const pageviewsByTargetId = new Map<string, number>();
  let unresolved = 0;

  for (const [key, pageviews] of pageviewsByKey) {
    const targetId = idByKey.get(key);
    if (!targetId) {
      unresolved++;
      continue;
    }
    // 別キーが同じ id へ解決されることがある（slug の大小文字違いなど）ので加算する
    pageviewsByTargetId.set(targetId, (pageviewsByTargetId.get(targetId) ?? 0) + pageviews);
  }

  if (unresolved > 0) {
    console.warn(`[page-views] ${unresolved} ${targetType} path(s) could not be resolved`);
  }

  return [...pageviewsByTargetId].map(([targetId, pageviews]) => ({
    targetType,
    targetId,
    pageviews,
    windowStart: syncWindow.windowStart,
    windowEnd: syncWindow.windowEnd,
    fetchedAt: syncWindow.fetchedAt,
  }));
}

/**
 * Vercel Web Analytics から直近ウィンドウのページビューを取得し、page_view_stats を更新する。
 * 種別ごとに独立して成否を返すので、呼び出し側（cron）は片側失敗を 500 として報告できる。
 */
export async function syncPageViewStats(db: Database, env: Env): Promise<PageViewSyncResult> {
  const untilMs = Date.now();
  const sinceMs = untilMs - PAGE_VIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const syncWindow: SyncWindow = {
    sinceMs,
    untilMs,
    windowStart: new Date(sinceMs),
    windowEnd: new Date(untilMs),
    fetchedAt: new Date(),
  };

  // 直列に実行する（Analytics 側のレート制限に優しく、失敗時のログも読みやすい）
  const profiles = await syncProfilePageViews(db, env, syncWindow);
  const guideStats = await syncGuidePageViews(db, env, syncWindow);

  return { profiles, guides: guideStats };
}
