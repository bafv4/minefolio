/** プロフィールのホットバー項目の群（人物系 / セットアップ系）。群が変わる位置に区切りを置く */
export type ProfileHotbarGroup = "person" | "setup";

export interface HotbarKeyEvent {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/**
 * 数字キー 1〜9 に対応するタブ値を返す。`values[n-1]` が無い・修飾キー押下中・数字以外は null。
 */
export function hotbarTabForKey(
  event: HotbarKeyEvent,
  values: readonly string[],
): string | null {
  if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return null;
  if (!/^[1-9]$/.test(event.key)) return null;
  return values[Number(event.key) - 1] ?? null;
}
