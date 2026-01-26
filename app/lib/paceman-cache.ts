import { createDb } from "./db";
import { pacemanPaces, users } from "./schema";
import { eq, and, gte, desc, sql } from "drizzle-orm";
import type { PaceManRecentRun } from "./paceman";

// 2nd Structure以降と判定するタイムライン
const SECOND_STRUCTURE_OR_LATER = [
  "Obtain Blaze Rods",
  "Enter Stronghold",
  "Enter End",
  "Complete",
];

// ネザーイン判定
const isNetherEnter = (timeline: string): boolean => {
  return timeline === "Enter Nether";
};

// 2nd Structure以降判定
const is2ndStructureOrLater = (timeline: string): boolean => {
  return SECOND_STRUCTURE_OR_LATER.includes(timeline);
};

/**
 * PaceManの最近のペース情報をDBにキャッシュする
 * @param recentPaces PaceManから取得したペース情報
 */
export async function cachePacemanPaces(recentPaces: PaceManRecentRun[]): Promise<void> {
  const db = createDb();

  // MCIDからuserIdのマッピングを取得
  const mcids = [...new Set(recentPaces.map((p) => p.nickname.toLowerCase()))];
  const userRecords = await db
    .select({ id: users.id, mcid: users.mcid })
    .from(users)
    .where(sql`lower(${users.mcid}) IN (${sql.join(mcids.map((m) => sql`${m}`), sql`, `)})`);


  const mcidToUserId = new Map(
    userRecords.map((u) => [u.mcid!.toLowerCase(), u.id])
  );

  // 過去1週間の開始時刻
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // 各ペース情報をDBに保存
  const pacesToInsert = recentPaces.map((pace) => {
    const mcidLower = pace.nickname.toLowerCase();
    const userId = mcidToUserId.get(mcidLower) || null;

    return {
      mcid: pace.nickname,
      userId,
      timeline: pace.timeline,
      rta: pace.time,
      igt: pace.igt ?? null,
      date: new Date(pace.date),
      isNetherEnter: isNetherEnter(pace.timeline),
      is2ndStructureOrLater: is2ndStructureOrLater(pace.timeline),
    };
  });

  // 一括挿入（重複は無視）
  if (pacesToInsert.length > 0) {
    await db.insert(pacemanPaces).values(pacesToInsert).onConflictDoNothing();
  }

  // 1週間より古いデータを削除
  await db.delete(pacemanPaces).where(sql`${pacemanPaces.date} < ${oneWeekAgo}`);
}

/**
 * キャッシュから最近のペース情報を取得
 * @param limit 取得件数
 */
export async function getRecentPacesFromCache(limit: number = 20): Promise<PaceManRecentRun[]> {
  const db = createDb();

  const paces = await db.query.pacemanPaces.findMany({
    orderBy: [desc(pacemanPaces.date)],
    limit,
    columns: {
      mcid: true,
      timeline: true,
      rta: true,
      igt: true,
      date: true,
    },
  });

  return paces.map((p) => ({
    id: 0, // キャッシュには不要だが型に合わせる
    nickname: p.mcid,
    timeline: p.timeline,
    time: p.rta,
    igt: p.igt ?? undefined,
    date: p.date.toISOString(),
    sessionMarker: "",
  }));
}

/**
 * 特定ユーザーの過去1週間のネザーイン回数を取得
 * @param mcid プレイヤーのMCID
 */
export async function getNetherEnterCount(mcid: string): Promise<number> {
  const db = createDb();
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(pacemanPaces)
    .where(
      and(
        sql`lower(${pacemanPaces.mcid}) = ${mcid.toLowerCase()}`,
        eq(pacemanPaces.isNetherEnter, true),
        gte(pacemanPaces.date, oneWeekAgo)
      )
    );

  return result[0]?.count ?? 0;
}

/**
 * 特定ユーザーの過去1週間の主なペース（2nd Structure以降）を取得
 * @param mcid プレイヤーのMCID
 * @param limit 取得件数
 */
export async function getMainPaces(mcid: string, limit: number = 10): Promise<PaceManRecentRun[]> {
  const db = createDb();
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const paces = await db.query.pacemanPaces.findMany({
    where: and(
      sql`lower(${pacemanPaces.mcid}) = ${mcid.toLowerCase()}`,
      eq(pacemanPaces.is2ndStructureOrLater, true),
      gte(pacemanPaces.date, oneWeekAgo)
    ),
    orderBy: [desc(pacemanPaces.date)],
    limit,
    columns: {
      mcid: true,
      timeline: true,
      rta: true,
      igt: true,
      date: true,
    },
  });

  return paces.map((p) => ({
    id: 0,
    nickname: p.mcid,
    timeline: p.timeline,
    time: p.rta,
    igt: p.igt ?? undefined,
    date: p.date.toISOString(),
    sessionMarker: "",
  }));
}
