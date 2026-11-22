/**
 * サーバーログ用に、エラーを「入力値を含まない要約」にする。
 *
 * drizzle のクエリエラー（DrizzleQueryError）は message に `Failed query: <SQL>\nparams: <値>` を持つ。
 * そのまま `console.error("...", error)` すると、失敗したクエリのパラメータ（表示名・自己紹介・所在地などの
 * 入力値）が Vercel のログに残る（.claude/rules/general.md「データ最小化」）。
 * ここでは SQL 文（プレースホルダのまま）と原因（ドライバのエラー文。値は含まない）だけを返す。
 *
 * 使い方: `console.error("Save error:", errorSummary(error));`
 */
export function errorSummary(error: unknown): string {
  if (!(error instanceof Error)) {
    return typeof error === "string" ? error : "non-Error value thrown";
  }
  const queryError = error as Error & { query?: unknown; params?: unknown; cause?: unknown };
  if (typeof queryError.query === "string" && "params" in queryError) {
    const cause = queryError.cause;
    const causeText = cause instanceof Error ? `${cause.name}: ${cause.message}` : cause == null ? "unknown cause" : String(cause);
    return `Failed query (params omitted): ${queryError.query} — ${causeText}`;
  }
  return `${error.name}: ${error.message}`;
}
