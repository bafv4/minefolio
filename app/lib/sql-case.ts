import { sql, type AnyColumn, type SQL } from "drizzle-orm";

/**
 * `CASE id WHEN ... THEN 値 END`。行ごとに値が違う UPDATE を、1 文（1 往復）にまとめるときの SET 句。
 * 呼び出し側は WHERE に同じ id 群（`inArray`）と所有者の条件を付けること（付けないと対象外の行が NULL になる）。
 * 手本: app/routes/me/keybindings.tsx の persistKeybindingUpdates
 */
export function caseById(
  idColumn: AnyColumn,
  entries: ReadonlyArray<readonly [string, string | number | null]>,
): SQL {
  return sql.join(
    [sql`CASE ${idColumn}`, ...entries.map(([id, value]) => sql`WHEN ${id} THEN ${value}`), sql`END`],
    sql` `,
  );
}
