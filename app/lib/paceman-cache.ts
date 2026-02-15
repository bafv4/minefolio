import { createDb } from "./db";
import { pacemanPaces, users } from "./schema";
import { eq, and, gte, lt, desc, sql } from "drizzle-orm";
import type { PaceManRecentRun } from "./paceman";

// スプリットタイムをタイムラインに変換する型定義
interface PaceEntry {
  timeline: string;
  rta: number;
  isNetherEnter: boolean;
  is2ndStructureOrLater: boolean;
}

// キャッシュから取得されるペースエントリの型
export interface CachedPaceEntry {
  id: number;
  mcid: string;
  timeline: string;
  rta: number;
  igt: number | null;
  date: string; // ISO string
}

// グループ化されたペース（同じランの複数スプリットをまとめたもの）
export interface GroupedPaceEntry {
  mcid: string;
  pacemanRunId: number; // PaceMan APIのランID
  date: string; // ISO string
  latestSplit: {
    timeline: string;
    rta: number;
  };
  splits: Array<{
    timeline: string;
    rta: number;
  }>;
}

// スプリットの進行順序
const SPLIT_ORDER: Record<string, number> = {
  "Enter Nether": 1,
  "Bastion": 2,
  "Fortress": 3,
  "First Portal": 4,
  "Obtain Blaze Rods": 5,
  "Enter Stronghold": 6,
  "Enter End": 7,
  "Finish": 8,
};

// PaceManRecentRunから個別のペースエントリを抽出
function extractPaceEntries(run: PaceManRecentRun): PaceEntry[] {
  const entries: PaceEntry[] = [];

  // 各スプリットをチェックして、値があればエントリを追加
  if (run.nether !== null) {
    entries.push({
      timeline: "Enter Nether",
      rta: run.nether,
      isNetherEnter: true,
      is2ndStructureOrLater: false,
    });
  }

  if (run.bastion !== null) {
    entries.push({
      timeline: "Bastion",
      rta: run.bastion,
      isNetherEnter: false,
      is2ndStructureOrLater: false,
    });
  }

  if (run.fortress !== null) {
    entries.push({
      timeline: "Fortress",
      rta: run.fortress,
      isNetherEnter: false,
      is2ndStructureOrLater: false,
    });
  }

  if (run.first_portal !== null) {
    entries.push({
      timeline: "First Portal",
      rta: run.first_portal,
      isNetherEnter: false,
      is2ndStructureOrLater: false,
    });
  }

  if (run.second_structure !== null) {
    entries.push({
      timeline: "Obtain Blaze Rods",
      rta: run.second_structure,
      isNetherEnter: false,
      is2ndStructureOrLater: true,
    });
  }

  if (run.stronghold !== null) {
    entries.push({
      timeline: "Enter Stronghold",
      rta: run.stronghold,
      isNetherEnter: false,
      is2ndStructureOrLater: true,
    });
  }

  if (run.end !== null) {
    entries.push({
      timeline: "Enter End",
      rta: run.end,
      isNetherEnter: false,
      is2ndStructureOrLater: true,
    });
  }

  if (run.finish !== null) {
    entries.push({
      timeline: "Finish",
      rta: run.finish,
      isNetherEnter: false,
      is2ndStructureOrLater: true,
    });
  }

  return entries;
}

/**
 * PaceManの最近のペース情報をDBにキャッシュする
 * @param recentPaces PaceManから取得したペース情報
 */
export async function cachePacemanPaces(recentPaces: PaceManRecentRun[]): Promise<void> {
  const db = createDb();

  // MCIDからuserIdのマッピングを取得
  const mcids = [...new Set(recentPaces.map((p) => p.nickname.toLowerCase()))];

  const userRecords = mcids.length > 0
    ? await db
        .select({ id: users.id, mcid: users.mcid })
        .from(users)
        .where(sql`lower(${users.mcid}) IN (${sql.join(mcids.map((m) => sql`${m}`), sql`, `)})`)
    : [];

  const mcidToUserId = new Map(
    userRecords.map((u) => [u.mcid!.toLowerCase(), u.id])
  );

  // 対象MCIDの既存キャッシュを削除（重複防止）
  for (const mcid of mcids) {
    await db.delete(pacemanPaces).where(
      sql`lower(${pacemanPaces.mcid}) = ${mcid}`
    );
  }

  // 過去1週間の開始時刻
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // 各ペース情報をDBに保存用に変換
  const pacesToInsert: Array<{
    pacemanRunId: number;
    mcid: string;
    userId: string | null;
    timeline: string;
    rta: number;
    igt: number | null;
    date: Date;
    isNetherEnter: boolean;
    is2ndStructureOrLater: boolean;
  }> = [];

  for (const run of recentPaces) {
    const mcidLower = run.nickname.toLowerCase();
    const userId = mcidToUserId.get(mcidLower) || null;
    const runDate = new Date(run.time * 1000); // Unix秒からミリ秒に変換

    // 1週間より古いデータはスキップ
    if (runDate < oneWeekAgo) continue;

    // 各スプリットからペースエントリを抽出
    const entries = extractPaceEntries(run);

    for (const entry of entries) {
      pacesToInsert.push({
        pacemanRunId: run.id, // PaceMan APIのランID
        mcid: run.nickname,
        userId,
        timeline: entry.timeline,
        rta: entry.rta,
        igt: null, // PaceManRecentRunにはIGTがないためnull
        date: runDate,
        isNetherEnter: entry.isNetherEnter,
        is2ndStructureOrLater: entry.is2ndStructureOrLater,
      });
    }
  }

  // バッチサイズを制限してインサート（SQLiteの変数上限対策）
  if (pacesToInsert.length > 0) {
    const batchSize = 50;
    for (let i = 0; i < pacesToInsert.length; i += batchSize) {
      const batch = pacesToInsert.slice(i, i + batchSize);
      await db.insert(pacemanPaces).values(batch);
    }
  }

  // 1週間より古いデータを削除（他ユーザーの古いデータも含む）
  await db.delete(pacemanPaces).where(lt(pacemanPaces.date, oneWeekAgo));
}

/**
 * キャッシュから最近のペース情報を取得
 * @param limit 取得件数
 */
export async function getRecentPacesFromCache(limit: number = 20): Promise<CachedPaceEntry[]> {
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
    mcid: p.mcid,
    timeline: p.timeline,
    rta: p.rta,
    igt: p.igt,
    date: p.date.toISOString(),
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
 * 同じランの複数スプリットをグループ化して返す
 * @param mcid プレイヤーのMCID
 * @param limit 取得するラン数
 */
export async function getMainPaces(mcid: string, limit: number = 10): Promise<GroupedPaceEntry[]> {
  const db = createDb();
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // 2nd Structure以降の全スプリットを取得
  const paces = await db.query.pacemanPaces.findMany({
    where: and(
      sql`lower(${pacemanPaces.mcid}) = ${mcid.toLowerCase()}`,
      eq(pacemanPaces.is2ndStructureOrLater, true),
      gte(pacemanPaces.date, oneWeekAgo)
    ),
    orderBy: [desc(pacemanPaces.date)],
    columns: {
      pacemanRunId: true,
      mcid: true,
      timeline: true,
      rta: true,
      date: true,
    },
  });

  // pacemanRunIdでグループ化
  const groupedMap = new Map<number, GroupedPaceEntry>();

  for (const pace of paces) {
    const runId = pace.pacemanRunId;

    if (!groupedMap.has(runId)) {
      groupedMap.set(runId, {
        mcid: pace.mcid,
        pacemanRunId: runId,
        date: pace.date.toISOString(),
        latestSplit: { timeline: pace.timeline, rta: pace.rta },
        splits: [],
      });
    }

    const group = groupedMap.get(runId)!;
    group.splits.push({ timeline: pace.timeline, rta: pace.rta });

    // 最も進んだスプリットを更新
    const currentOrder = SPLIT_ORDER[group.latestSplit.timeline] ?? 0;
    const newOrder = SPLIT_ORDER[pace.timeline] ?? 0;
    if (newOrder > currentOrder) {
      group.latestSplit = { timeline: pace.timeline, rta: pace.rta };
    }
  }

  // グループを配列に変換し、各グループのスプリットを進行順にソート
  const grouped = Array.from(groupedMap.values())
    .map((g) => ({
      ...g,
      splits: g.splits.sort((a, b) => (SPLIT_ORDER[a.timeline] ?? 0) - (SPLIT_ORDER[b.timeline] ?? 0)),
    }))
    .slice(0, limit);

  return grouped;
}
