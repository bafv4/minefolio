/** userId ごとに行をまとめる（入力の並びは各グループ内で保つ） */
export function groupByUserId<T extends { userId: string }>(rows: readonly T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const list = map.get(row.userId);
    if (list) list.push(row);
    else map.set(row.userId, [row]);
  }
  return map;
}
