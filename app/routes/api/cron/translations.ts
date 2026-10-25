// 利用者コンテンツ自動翻訳の取りこぼし掃除用のCronエンドポイント
// 保存時のバックグラウンド翻訳（waitUntil）が失敗・未実行だった対象を拾い直す。
// 翻訳本体は @/lib/content-translation.server。ANTHROPIC_API_KEY 未設定なら
// processPendingTranslations が何もせず全件 0 を返す（DB の走査・書き込みもしない）。

import { createDb } from "@/lib/db";
import { requireCronAuth } from "@/lib/cron-auth.server";
import {
  DEFAULT_CRON_LIMIT,
  processPendingTranslations,
} from "@/lib/content-translation.server";

// Vercel の関数実行時間上限（秒）。@vercel/react-router が葉ルートの export const config を読む
export const config = { maxDuration: 60 };

// 新しい対象に着手しなくなる時間（ms）。maxDuration の 80%
const TIME_BUDGET_MS = 48_000;

export async function loader({ request }: { request: Request }) {
  const authError = requireCronAuth(request);
  if (authError) return authError;

  try {
    const db = createDb();
    const result = await processPendingTranslations(db, {
      limit: DEFAULT_CRON_LIMIT,
      timeBudgetMs: TIME_BUDGET_MS,
    });

    console.log(
      `Translations: processed=${result.processed} translated=${result.translated} upToDate=${result.upToDate} failed=${result.failed} skipped=${result.skipped} removed=${result.removed}`,
    );

    return Response.json({
      success: true,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Failed to process pending translations:", error);
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
