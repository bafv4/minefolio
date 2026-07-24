// Vercel Cron エンドポイント共通の認証ガード。
// CRON_SECRET は getEnv() の返却に含まれないため process.env から直接参照する

/**
 * Cronリクエストの Bearer 認証を検証する。
 * 拒否時はそのまま返すべき Response を、通過時は null を返す。
 * CRON_SECRET が未設定なら認証不能としてフェイルクローズする
 * （スキップすると未認証の呼び出しで外部APIのクォータを消費できてしまう）
 */
export function requireCronAuth(request: Request): Response | null {
  const authHeader = request.headers.get("Authorization");
  const expectedToken = process.env.CRON_SECRET;

  if (!expectedToken) {
    return Response.json(
      { error: "Cron authentication is not configured" },
      { status: 503 }
    );
  }

  if (authHeader !== `Bearer ${expectedToken}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}
