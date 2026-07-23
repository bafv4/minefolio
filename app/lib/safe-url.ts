// 外部リンク URL のスキーム許可リスト（クライアント/サーバー共用）。
// ユーザー入力の URL をそのまま <a href> に流すと javascript: / data: /
// vbscript: などの実行可能スキームで stored XSS になるため、href に置く前・
// DB に保存する前に必ずここで http/https のみへ絞る。

/**
 * 値が http:／https: スキームの絶対 URL なら true。
 * それ以外（javascript:, data:, vbscript:, mailto:, ftp:, 相対URL, パース不能）は false。
 */
export function isHttpUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:";
}

/**
 * href に安全に置ける外部リンク URL を返す。http/https 以外は undefined。
 * （href に undefined を渡すと React は href 属性自体を出力しないため、
 *   実行可能スキームが DOM に到達しない）
 */
export function safeExternalHref(value: string | null | undefined): string | undefined {
  return isHttpUrl(value) ? (value as string) : undefined;
}
