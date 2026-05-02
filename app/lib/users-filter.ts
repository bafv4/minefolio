import { or, isNull, ne } from "drizzle-orm";
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
