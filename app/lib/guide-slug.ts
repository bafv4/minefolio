// ガイドのURLスラッグ正規化。作成時の自動生成と編集時のユーザー入力の両方で使う単一ソース。
// 許可文字: a-z / 0-9 / _（アンダースコア）/ -（ハイフン）。それ以外（日本語・記号・全角等）は除去する。

export const MAX_GUIDE_SLUG_LENGTH = 100;

/**
 * 入力文字列をガイドのスラッグ規定に正規化する。
 * 変換規則:
 *   1. 小文字化
 *   2. 許可外文字（`[^\w\s-]`）を除去（`\w` = `[A-Za-z0-9_]`）
 *   3. 空白（連続含む）→ ハイフン 1 個
 *   4. 連続ハイフンを 1 個に圧縮（アンダースコアは保持）
 *   5. 前後のハイフンを除去
 *   6. 先頭 MAX_GUIDE_SLUG_LENGTH 文字に切り詰め
 * 正規化の結果、空文字になり得る（例: 日本語のみの入力）。呼び出し側で空を弾く。
 */
export function normalizeSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_GUIDE_SLUG_LENGTH);
}
