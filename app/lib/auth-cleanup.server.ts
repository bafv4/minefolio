// 期限切れ認証データ（auth_sessions / auth_verifications）の削除。
//
// better-auth は expiresAt を過ぎたセッション・検証トークンを「無効」として扱うだけで、
// DB からは削除しない。ip_address / user_agent（PII）を含む auth_sessions が無効化後も
// 残り続けるため、日次 cron（/api/cron/cleanup-auth）から呼び出して削除する。
// updateAge（1日ごとに expiresAt を延長）により現役セッションの expiresAt は常に未来なので、
// expiresAt < now の一括削除で現役ユーザーが誤ってログアウトされることはない。

import { lt } from "drizzle-orm";
import type { Database } from "./db";
import { authSessions, authVerifications } from "./schema";

export interface AuthCleanupResult {
  deletedSessions: number;
  deletedVerifications: number;
}

/** 期限切れの auth_sessions / auth_verifications を削除する。 */
export async function cleanupExpiredAuthRows(
  db: Database,
  now: Date = new Date(),
): Promise<AuthCleanupResult> {
  const sessionsResult = await db.delete(authSessions).where(lt(authSessions.expiresAt, now));
  const verificationsResult = await db
    .delete(authVerifications)
    .where(lt(authVerifications.expiresAt, now));

  return {
    deletedSessions: sessionsResult.rowsAffected,
    deletedVerifications: verificationsResult.rowsAffected,
  };
}
