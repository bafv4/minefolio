// Vercel Web Analytics API クライアント（path 別のページビュー取得）。
//
// クライアント計測（`<Analytics />`）で溜まったデータを読み出す唯一の経路。
// 呼び出し元は cron（/api/cron/update-page-views）→ page-view-stats.server.ts のみで、
// ここは「HTTP を叩いて { path, pageviews } の配列にする」までを責務とする。
//
// 【レスポンス形状について】このエンドポイントの公開ドキュメントは薄く、行のキー名
// （requestPath / key、visits / pageviews / total / count）が将来変わり得る。形が変わったときに
// **黙って 0 件になる**のが最悪なので、
// - data が配列でなければ本文の先頭を添えて throw（＝ cron が失敗として記録する）
// - 行単位では候補キーを順に探し、取れない行は warn してスキップ
// という二段構えにしている。

import type { Env } from "../env";

const ANALYTICS_ENDPOINT =
  "https://api.vercel.com/v1/query/web-analytics/visits/aggregate";

/** 1 リクエストで取得する上位パス件数 */
const TOP_PATHS_LIMIT = 100;

/** 外部 API の応答待ち上限。cron 全体を巻き込んで固まらせない */
const REQUEST_TIMEOUT_MS = 15000;

/** 上位 N 件に入らなかったパスをまとめた集約行の名前（実在パスではない） */
const OTHERS_ROW_KEY = "Others";

/** エラーメッセージへ載せる本文・JSON の最大長 */
const ERROR_BODY_MAX_CHARS = 300;

/** 行から探す path のキー（先に見つかったものを採用） */
const PATH_KEYS = ["requestPath", "key"] as const;

/** 行から探すページビュー数のキー（先に見つかった有限数値を採用） */
const PAGEVIEW_KEYS = ["visits", "pageviews", "total", "count"] as const;

export interface TopPathRow {
  /** Analytics が記録した requestPath（クエリ等が付いたままのことがある） */
  path: string;
  pageviews: number;
}

export interface FetchTopPathsArgs {
  /** 集計窓の開始（ミリ秒エポック） */
  sinceMs: number;
  /** 集計窓の終了（ミリ秒エポック） */
  untilMs: number;
  /** 取得対象のパス接頭辞（例: "/player/"）。API 側の filter で絞る */
  pathPrefix: string;
}

/**
 * ページビュー同期に必要な環境変数が揃っているか。
 * ローカル開発では未設定が普通なので、未設定＝機能ごと無効（エラーにしない）。
 */
export function isPageViewSyncConfigured(env: Env): boolean {
  return !!env.VERCEL_API_TOKEN && !!env.VERCEL_PROJECT_ID;
}

/** ログ・エラー用に本文を短く切り詰める */
function truncate(value: string): string {
  return value.length > ERROR_BODY_MAX_CHARS
    ? `${value.slice(0, ERROR_BODY_MAX_CHARS)}…`
    : value;
}

/** 候補キーから最初の非空文字列を取り出す */
function pickString(row: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

/** 候補キーから最初の有限数値を取り出す（数値文字列も受ける） */
function pickNumber(row: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

/**
 * 指定窓・指定接頭辞の上位パスとページビュー数を取得する。
 *
 * 未設定（isPageViewSyncConfigured が false）や非 2xx 応答、想定外のレスポンス形状は
 * すべて throw する。呼び出し側は接頭辞ごとに try/catch し、片側の失敗が
 * もう片側のスナップショットを壊さないようにする。
 */
export async function fetchTopPaths(
  env: Env,
  args: FetchTopPathsArgs,
): Promise<TopPathRow[]> {
  const token = env.VERCEL_API_TOKEN;
  const projectId = env.VERCEL_PROJECT_ID;
  if (!token || !projectId) {
    throw new Error(
      "Vercel Web Analytics is not configured (VERCEL_API_TOKEN / VERCEL_PROJECT_ID)",
    );
  }

  const params = new URLSearchParams({
    projectId,
    since: String(Math.floor(args.sinceMs)),
    until: String(Math.floor(args.untilMs)),
    by: "requestPath",
    limit: String(TOP_PATHS_LIMIT),
    // OData 風のフィルタ式。接頭辞で絞ることで limit の枠を対象ページだけに使える
    filter: `startswith(requestPath, '${args.pathPrefix}')`,
  });
  // 個人アカウントのプロジェクトでは teamId を付けてはいけないため、設定時のみ付与する
  if (env.VERCEL_TEAM_ID) params.set("teamId", env.VERCEL_TEAM_ID);

  const response = await fetch(`${ANALYTICS_ENDPOINT}?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Vercel Web Analytics API error: ${response.status} ${truncate(body)}`,
    );
  }

  const json: unknown = await response.json();
  const rows = (json as { data?: unknown } | null)?.data;
  if (!Array.isArray(rows)) {
    throw new Error(
      `Unexpected Vercel Web Analytics response shape: ${truncate(JSON.stringify(json))}`,
    );
  }

  const result: TopPathRow[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") {
      console.warn("[page-views] skipped non-object analytics row:", truncate(JSON.stringify(row)));
      continue;
    }
    const record = row as Record<string, unknown>;
    const path = pickString(record, PATH_KEYS);
    const pageviews = pickNumber(record, PAGEVIEW_KEYS);
    if (path === null || pageviews === null) {
      console.warn("[page-views] skipped unparsable analytics row:", truncate(JSON.stringify(row)));
      continue;
    }
    // 上位以外をまとめた集約行は実在パスではないので落とす
    if (path === OTHERS_ROW_KEY) continue;

    result.push({ path, pageviews });
  }

  return result;
}
