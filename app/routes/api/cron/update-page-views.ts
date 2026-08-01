// ページビュー集計更新用のCronエンドポイント
// Vercel Web Analytics から直近ウィンドウの path 別 PV を取得し、page_view_stats を全置換する。
// ガイド一覧・走者一覧の「人気順」がこのスナップショットを読む。

import { createDb } from "@/lib/db";
import { getEnv } from "@/lib/env.server";
import { requireCronAuth } from "@/lib/cron-auth.server";
import { syncPageViewStats } from "@/lib/page-view-stats.server";
import { isPageViewSyncConfigured } from "@/lib/vercel-analytics.server";

export async function loader({ request }: { request: Request }) {
  const authError = requireCronAuth(request);
  if (authError) return authError;

  const env = getEnv();
  if (!isPageViewSyncConfigured(env)) {
    return Response.json(
      {
        success: false,
        error: "Vercel Web Analytics is not configured (VERCEL_API_TOKEN / VERCEL_PROJECT_ID)",
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }

  try {
    const db = createDb();
    const { profiles, guides } = await syncPageViewStats(db, env);

    // 片側だけ失敗した場合も 500 にして Vercel 側のログで気づけるようにする。
    // （失敗した種別は旧スナップショットが残るので、一覧の並びは壊れない）
    const success = profiles.ok && guides.ok;
    console.log(
      `Page view stats sync: profiles=${JSON.stringify(profiles)} guides=${JSON.stringify(guides)}`,
    );

    return Response.json(
      { success, profiles, guides, timestamp: new Date().toISOString() },
      { status: success ? 200 : 500 },
    );
  } catch (error) {
    console.error("Failed to sync page view stats:", error);
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
