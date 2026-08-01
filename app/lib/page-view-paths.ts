// Vercel Web Analytics が返す requestPath を、Minefolio の対象（プロフィール / ガイド）へ
// 解釈する純粋関数。
//
// 集計側（page-view-stats.server.ts）だけでなくテストからも使うため、React にも
// サーバー専用モジュールにも依存させない（`.server` ではない場所に置く）。
//
// Analytics の path は「実際にブラウザが踏んだ URL」なので、以下が混ざってくる:
// - クエリ・フラグメント付き（`/guides/foo/bar?utm_source=...`）
// - パーセントエンコード済みの日本語スラッグ
// - 末尾スラッシュ付き
// - 上位 N 件以外をまとめた集約行（`Others` のように `/` で始まらない）
// これらをすべて「対象 or 対象外(null)」へ落とし込むのがこのモジュールの責務。

/**
 * 「人気順」が見る窓（日数）。Analytics 側の保持期間より十分短くしておく。
 *
 * 集計側（page-view-stats.server.ts）だけでなく、i18n 文言の補間（「直近{days}日」）にも
 * 描画側（home.tsx・guide-list-views.tsx 等）から使うため、`.server` ではないここに置く。
 */
export const PAGE_VIEW_WINDOW_DAYS = 7;

/** プロフィールの詳細ページのパス接頭辞。URL 形状の知識はここに集約する */
export const PROFILE_PATH_PREFIX = "/player/";

/** ガイドの詳細ページのパス接頭辞。URL 形状の知識はここに集約する */
export const GUIDE_PATH_PREFIX = "/guides/";

/** requestPath の解釈結果。どの一覧の並び替えに効くかで型を分ける */
export type AnalyticsPathTarget =
  | { type: "profile"; slugLower: string }
  | { type: "guide"; authorSlugLower: string; guideSlug: string };

/**
 * Analytics の requestPath を対象へ解釈する。対象外なら null。
 *
 * - プロフィール: `/player/:slug`（`/player/:slug/stats` のような下層は対象外）
 * - ガイド: `/guides/:authorSlug/:guideSlug`（`/guides/templates/:templateId` は対象外）
 *
 * slug の大小文字はユーザー側（`/player/Runner` と `/player/runner` の両方が踏まれる）だけ
 * 揺れるため、著者・プロフィールの slug は小文字化して合算できるようにする。ガイドの slug は
 * 著者が決めた文字列そのもので一意なので、原文のまま完全一致に使う。
 */
export function parseAnalyticsPath(rawPath: string): AnalyticsPathTarget | null {
  if (typeof rawPath !== "string") return null;

  // クエリ・フラグメントを落とす（`?` `#` 以降は同じページ）
  const pathOnly = rawPath.split(/[?#]/, 1)[0];

  // `/` で始まらない行は実在パスではない（Vercel の集約行 "Others" など）
  if (!pathOnly.startsWith("/")) return null;

  let decoded: string;
  try {
    decoded = decodeURIComponent(pathOnly);
  } catch {
    // 不正なパーセントエンコードは復元できないので捨てる
    return null;
  }

  // 末尾スラッシュを除去（`/player/foo/` と `/player/foo` は同じページ）
  const trimmed = decoded.replace(/\/+$/, "");
  const segments = trimmed.split("/").slice(1);

  // 空セグメント（`//` の混入）を含むパスは正規形でないので扱わない
  if (segments.length === 0 || segments.some((segment) => segment.length === 0)) {
    return null;
  }

  if (segments.length === 2 && segments[0] === "player") {
    return { type: "profile", slugLower: segments[1].toLowerCase() };
  }

  if (segments.length === 3 && segments[0] === "guides" && segments[1] !== "templates") {
    return {
      type: "guide",
      authorSlugLower: segments[1].toLowerCase(),
      guideSlug: segments[2],
    };
  }

  return null;
}
