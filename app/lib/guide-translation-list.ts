// 一覧用: ガイド行のタイトル・要約を自動翻訳の訳文へ差し替える純関数（docs/translation.md）。
// 訳文の取得は getGuideTranslations（content-translation.server）をローダーで 1 回呼び、
// その結果をこの関数で各行へ適用する。サーバー専用モジュールを import しないので
// コンポーネント側からも使える（型のみ参照）。
import type { Locale } from "@/lib/locale";

export interface GuideTranslationSummary {
  title: string;
  summary: string | null;
  sourceLocale: Locale;
}

/**
 * 訳文があれば title / summary を差し替え、`autoTranslated: true` を付ける。
 * 訳文が無い行は何も変えず `autoTranslated: false`（原文のまま）。
 */
export function applyGuideTranslation<T extends { id: string; title: string; summary: string | null }>(
  guide: T,
  translations: ReadonlyMap<string, GuideTranslationSummary>,
): T & { autoTranslated: boolean } {
  const translated = translations.get(guide.id);
  if (!translated) return { ...guide, autoTranslated: false };
  return {
    ...guide,
    title: translated.title,
    summary: translated.summary ?? guide.summary,
    autoTranslated: true,
  };
}
