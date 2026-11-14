import { and, asc, eq, isNotNull } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { playerRankings, speedrunCategories } from "@/lib/schema";

/** プロフィールに出す審査中（verificationStatus = "new"）の speedrun.com 記録 */
export type PendingSpeedrunRecord = {
  runId: string | null;
  categoryName: string;
  timeMs: number;
  timeFormatted: string | null;
  recordDate: string | null;
  /** speedrun.com のランページ。保存が無ければ runId から組み立て、どちらも無ければ null */
  runWeblink: string | null;
};

/**
 * 1ユーザーの審査中記録を、タイムの速い順に返す（cron が player_rankings に保存したものを読むだけ。
 * speedrun.com API は叩かない）。承認済み・却下（rejected）・他ユーザーの行は含めない。
 * 公開範囲の判定は呼び出し側（プロフィール loader）で済んでいる前提。
 * `hiddenRunIds` はオーナーが非表示にした run ID（承認済み記録の非表示設定と揃える）。
 */
export async function loadPendingSpeedrunRecords(
  db: Database,
  userId: string,
  hiddenRunIds: ReadonlySet<string> = new Set(),
): Promise<PendingSpeedrunRecord[]> {
  const rows = await db
    .select({
      runId: playerRankings.speedruncomRunId,
      categoryName: speedrunCategories.name,
      timeMs: playerRankings.timeMs,
      timeFormatted: playerRankings.timeFormatted,
      recordDate: playerRankings.recordDate,
      runWeblink: playerRankings.runWeblink,
    })
    .from(playerRankings)
    .innerJoin(speedrunCategories, eq(playerRankings.categoryId, speedrunCategories.id))
    .where(
      and(
        eq(playerRankings.userId, userId),
        eq(playerRankings.rankingType, "speedruncom"),
        eq(playerRankings.verificationStatus, "new"),
        isNotNull(playerRankings.timeMs),
      ),
    )
    .orderBy(asc(playerRankings.timeMs));

  const records: PendingSpeedrunRecord[] = [];
  for (const r of rows) {
    if (r.timeMs === null) continue;
    if (r.runId && hiddenRunIds.has(r.runId)) continue;
    records.push({
      runId: r.runId,
      categoryName: r.categoryName,
      timeMs: r.timeMs,
      timeFormatted: r.timeFormatted,
      recordDate: r.recordDate,
      runWeblink: r.runWeblink ?? (r.runId ? `https://www.speedrun.com/run/${r.runId}` : null),
    });
  }
  return records;
}
