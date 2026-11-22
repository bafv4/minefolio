// mcid（小文字キー）→ 表示名マップから、閲覧ロケールに合わせた表示名を選ぶ共通ヘルパー。
// ホーム・/paces・ライブペース一覧で重複していた「英語表示ではアルファベット表記を優先する」処理。
// クライアントからも使うため `.server` にしない。

import type { Locale } from "@/lib/locale";

/** ロケールに応じて表示名を選ぶ（日本語以外はアルファベット表記があればそれを優先） */
export function pickLocalizedName(
  alphabet: string | null | undefined,
  name: string | null | undefined,
  locale: Locale,
): string | undefined {
  return (locale !== "ja" ? alphabet : undefined) || name || undefined;
}

export interface McidDisplayNameMaps {
  mcidToDisplayName?: Record<string, string>;
  /** アルファベット表記の表示名（入力済みのユーザーのみ） */
  mcidToDisplayNameAlphabet?: Record<string, string>;
}

/** mcid（大文字小文字不問）の表示名を選ぶ。マップに無ければ undefined */
export function pickMcidDisplayName(
  maps: McidDisplayNameMaps,
  mcid: string,
  locale: Locale,
): string | undefined {
  const key = mcid.toLowerCase();
  return pickLocalizedName(maps.mcidToDisplayNameAlphabet?.[key], maps.mcidToDisplayName?.[key], locale);
}
