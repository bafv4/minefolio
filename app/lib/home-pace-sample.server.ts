import { and, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import type { Database } from "./db";
import { pacemanPaces, users } from "./schema";
import { getPaceRetentionStart } from "./paceman-cache";
import { PACE_FEED_SPLITS } from "./pace-splits";
import { excludeViewersCondition } from "./users-filter";
import { getCached, setCached } from "./cache";
import type { PaceFeedRun } from "@/components/pace-feed-card";

// 結果は10分キャッシュ（ホーム全リクエストで JOIN を走らせないため。表示名の選択はクライアント側のためロケール非依存）
const HOME_PACE_SAMPLE_TTL = 10 * 60 * 1000;
const SAMPLE_CACHE_KEY = "home:pace-sample:v1";
const COUNT_CACHE_KEY = "home:pace-count:v1";

// ホームのヒーロー用: 実データの見本（最深区間のペース1件）と記録ペース総数
// /paces と同じ公開ルール（公開プロフィール・視聴者除外・Enter Nether 除外・保持期間内）に揃える。

export interface HomeSamplePace {
  run: PaceFeedRun;
  uuid: string;
  displayName: string | null;
  displayNameAlphabet: string | null;
  skinUrl: string | null;
}

// 区間の深さ（PACE_FEED_SPLITS の進行順。Finish が最大）。固定リテラルのみから組み立てる
const timelineDepthSql = sql`CASE ${pacemanPaces.timeline} ${sql.join(
  PACE_FEED_SPLITS.map((s, i) => sql`WHEN ${s} THEN ${i + 1}`),
  sql` `,
)} ELSE 0 END`;

const baseConditions = () => [
  eq(pacemanPaces.isNetherEnter, false),
  gte(pacemanPaces.date, getPaceRetentionStart()),
  eq(users.profileVisibility, "public"),
  excludeViewersCondition,
  isNotNull(users.uuid),
];

/** 保持期間内で最も深い区間（同深度なら新しい方）に到達した公開走者のペース1件。無ければ null */
export async function getHomeSamplePace(db: Database): Promise<HomeSamplePace | null> {
  const cached = await getCached<{ sample: HomeSamplePace | null }>(SAMPLE_CACHE_KEY);
  if (cached) return cached.sample;
  const sample = await queryHomeSamplePace(db);
  await setCached(SAMPLE_CACHE_KEY, { sample }, HOME_PACE_SAMPLE_TTL);
  return sample;
}

async function queryHomeSamplePace(db: Database): Promise<HomeSamplePace | null> {
  const [row] = await db
    .select({
      mcid: pacemanPaces.mcid,
      timeline: pacemanPaces.timeline,
      rta: pacemanPaces.rta,
      date: pacemanPaces.date,
      pacemanRunId: pacemanPaces.pacemanRunId,
      uuid: users.uuid,
      displayName: users.displayName,
      displayNameAlphabet: users.displayNameAlphabet,
      customSkinUrl: users.customSkinUrl,
    })
    .from(pacemanPaces)
    .innerJoin(users, eq(users.id, pacemanPaces.userId))
    .where(and(...baseConditions()))
    .orderBy(desc(timelineDepthSql), desc(pacemanPaces.date))
    .limit(1);
  if (!row || !row.uuid) return null;
  return {
    run: {
      mcid: row.mcid,
      nickname: row.mcid,
      timeline: row.timeline,
      rta: row.rta,
      time: Math.floor(row.date.getTime() / 1000),
      pacemanRunId: row.pacemanRunId,
    },
    uuid: row.uuid,
    displayName: row.displayName,
    displayNameAlphabet: row.displayNameAlphabet,
    skinUrl: row.customSkinUrl,
  };
}

/** 保持期間内の記録ペース総数（ラン単位。公開走者のみ） */
export async function countHomeRecordedPaces(db: Database): Promise<number> {
  const cached = await getCached<{ total: number }>(COUNT_CACHE_KEY);
  if (cached) return cached.total;
  const total = await queryRecordedPaceCount(db);
  await setCached(COUNT_CACHE_KEY, { total }, HOME_PACE_SAMPLE_TTL);
  return total;
}

async function queryRecordedPaceCount(db: Database): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(distinct ${pacemanPaces.pacemanRunId})` })
    .from(pacemanPaces)
    .innerJoin(users, eq(users.id, pacemanPaces.userId))
    .where(and(...baseConditions()));
  return Number(row?.total ?? 0);
}
