// URL用スラッグのユーティリティ
import type { Locale } from "./locale";

/**
 * MCIDまたはDiscord IDからスラッグを生成
 * - MCIDがある場合: そのままMCIDを使用
 * - MCIDがない場合: @プレフィックス + Discord ID
 */
export function generateSlug(mcid: string | null, discordId: string): string {
  if (mcid) {
    return mcid;
  }
  return `@${discordId}`;
}

/**
 * スラッグが自動生成されたもの（MCIDなし）かどうかを判定
 */
export function isGeneratedSlug(slug: string): boolean {
  return slug.startsWith("@");
}

/**
 * 表示名を取得（優先順位: displayName > mcid > slug）
 */
export function getDisplayName(
  displayName: string | null,
  mcid: string | null,
  slug: string
): string {
  return displayName || mcid || slug;
}

/** 表示名の解決に必要な最小フィールド（各クエリの select 結果をそのまま渡せる） */
export interface DisplayNameFields {
  displayName: string | null;
  /** アルファベット表記の表示名。クエリで未選択の場合は undefined */
  displayNameAlphabet?: string | null;
}

/**
 * ロケールに応じた表示名を選ぶ（優先順位: アルファベット表記 > displayName）。
 *
 * 日本語以外のロケールでは `displayNameAlphabet` を優先し、未入力なら `displayName`
 * にフォールバックする。呼び出し側は従来どおり `?? mcid ?? slug` を続ける。
 *
 * 解決は「表示する直前」で行うこと。ユーザーデータのキャッシュ（home-user-data 等）は
 * リクエスト間で共有されるため、キャッシュに入れる値をロケール依存にしてはいけない。
 */
export function pickDisplayName(
  user: DisplayNameFields,
  locale: Locale
): string | null {
  if (locale !== "ja" && user.displayNameAlphabet) {
    return user.displayNameAlphabet;
  }
  return user.displayName;
}

/**
 * ロケールに応じた表示名を、mcid / slug へのフォールバックまで含めて解決する。
 * `pickDisplayName` ＋ `getDisplayName` の定型的な組み合わせ。
 */
export function getLocalizedDisplayName(
  user: DisplayNameFields & { mcid: string | null; slug: string },
  locale: Locale
): string {
  return getDisplayName(pickDisplayName(user, locale), user.mcid, user.slug);
}

/**
 * メンション表示用の文字列を取得
 * - MCIDあり: @{mcid}
 * - MCIDなし: slugをそのまま表示（すでに@プレフィックスがある）
 */
export function getMentionDisplay(mcid: string | null, slug: string): string {
  if (mcid) {
    return `@${mcid}`;
  }
  return slug;
}
