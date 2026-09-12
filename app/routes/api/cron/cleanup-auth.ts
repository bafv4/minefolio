// 期限切れ認証データ削除用のCronエンドポイント
// better-auth が無効扱いにするだけで DB から削除しない auth_sessions（IPアドレス・
// User-Agent を含む）・auth_verifications の期限切れ行を、日次で物理削除する。

import { createDb } from "@/lib/db";
import { requireCronAuth } from "@/lib/cron-auth.server";
import { cleanupExpiredAuthRows } from "@/lib/auth-cleanup.server";

export async function loader({ request }: { request: Request }) {
  const authError = requireCronAuth(request);
  if (authError) return authError;

  try {
    const db = createDb();
    const { deletedSessions, deletedVerifications } = await cleanupExpiredAuthRows(db);

    console.log(
      `Auth cleanup: deletedSessions=${deletedSessions} deletedVerifications=${deletedVerifications}`,
    );

    return Response.json({
      success: true,
      deletedSessions,
      deletedVerifications,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Failed to cleanup expired auth rows:", error);
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}
