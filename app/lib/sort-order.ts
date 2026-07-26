// 一覧・表のソート順で共有するルール。
//
// **NULL は昇順・降順いずれでも必ず最後に置く。**
// 値が無い行が先頭を占めると「並び替えたのに知りたい行が出てこない」状態になるため。
//
// SQLite の既定は昇順で NULL が先、降順で NULL が後という非対称な挙動なので、
// 並び替えたい列の手前にこのキーを差し込んで向きに依存しない順序にする。
import { sql, type SQL, type AnyColumn } from "drizzle-orm";

/**
 * ORDER BY の先頭に置く「NULL を最後へ送る」キー。
 *
 * `x IS NULL` は非 NULL が 0、NULL が 1 になるため、常に昇順で評価すれば
 * 後段の並び替えの向きに関係なく NULL が末尾へ落ちる。
 *
 * ```ts
 * orderBy: [nullsLast(users.mcid), asc(users.mcid)]
 * ```
 */
export function nullsLast(column: AnyColumn | SQL): SQL {
  return sql`(${column}) is null`;
}
