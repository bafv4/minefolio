// URL用スラッグのユーティリティ

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
