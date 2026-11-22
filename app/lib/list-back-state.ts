/**
 * 一覧から詳細へ来たときの「一覧へ戻る」ための location.state の読み取り。
 * state は履歴に残る任意の値なので、形を検証してから使う。
 */

function readStateValue(state: unknown, key: string): unknown {
  return (state as Record<string, unknown> | null | undefined)?.[key];
}

/** state[key] が "?" で始まる文字列ならそれを返す（一覧の絞り込み）。それ以外は空文字 */
export function readListSearchState(state: unknown, key: string): string {
  const value = readStateValue(state, key);
  return typeof value === "string" && value.startsWith("?") ? value : "";
}

/**
 * state[key] が basePath そのもの、または basePath + "?…" ならそれを返す。それ以外は null。
 * URL の slug は大文字小文字を区別しないので、比べるときだけ小文字にそろえる
 */
export function readListPathState(state: unknown, key: string, basePath: string): string | null {
  const value = readStateValue(state, key);
  if (typeof value !== "string") return null;
  const base = basePath.toLowerCase();
  const lower = value.toLowerCase();
  return lower === base || lower.startsWith(`${base}?`) ? value : null;
}
