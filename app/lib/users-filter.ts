import { or, isNull, ne, inArray } from "drizzle-orm";
import { users } from "./schema";

/**
 * 視聴者ロールを除外する WHERE 条件。
 * - role が null（未設定）→ 含む
 * - role が "runner" → 含む
 * - role が "viewer" → 除外
 *
 * 一覧表示・ペース表示・動画/ライブ表示等で使用。
 * `/browse` のロールフィルタで明示的に "viewer" を選択した場合は使わない（その場合は通常の eq() で絞り込み）。
 */
export const excludeViewersCondition = or(
  isNull(users.role),
  ne(users.role, "viewer"),
);

/**
 * 名指し参照（URL 指定・ガイド埋め込み等）で表示してよいプロフィールの WHERE 条件。
 * 非公開（private）のみ除外する。限定公開（unlisted）は一覧には出さないが、
 * 名指しで参照された場合は表示してよい。
 *
 * 比較ページ（?p1= / ?p2=）・ガイド埋め込みで使用。
 */
export const publiclyReferencableCondition = inArray(users.profileVisibility, [
  "public",
  "unlisted",
]);
