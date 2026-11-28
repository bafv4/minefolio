// ホームの「閲覧者・ロケールに依存しない」一覧（最近更新・よく見られている・新着ガイド・公開人数・ゲストのヒーローの顔）。
// 表示のたびに DB を引かないよう、60秒のキャッシュ（インスタンスごとのメモリ）に包む。
// 公開→非公開・削除の操作を処理したインスタンスでは invalidateHomeDiscoveryCache() で即座に消えるが、
// ほかのインスタンスには届かないので、そちらは最大でこの秒数遅れる（getHomeHiddenUsers / getUserData と同じ割り切り）。
// キャッシュに入れるのは DB の素の行だけ。ガイドの自動翻訳（ロケール依存）や、自分自身・重複の除外（閲覧者依存）は
// 呼び出し側（home.tsx）がキャッシュの外で行う。

import { and, desc, eq, isNotNull, or, sql } from "drizzle-orm";
import type { Database } from "./db";
import { guides, pageViewStats, playstyles, users } from "./schema";
import { listedRunnerCondition } from "./users-filter";
import { guideLikeCountSql } from "./likes.server";
import { getCached, invalidateCache, setCached } from "./cache";

const HOME_DISCOVERY_TTL = 60 * 1000;

/** キャッシュキー。形状を変えたら版数を上げる（テストからも参照する） */
export const HOME_DISCOVERY_CACHE_KEYS = {
  recentProfiles: "home:discovery:recent-profiles:v1",
  popularProfiles: "home:discovery:popular-profiles:v1",
  newGuides: "home:discovery:new-guides:v1",
  publicCount: "home:discovery:public-count:v1",
  heroFaces: "home:discovery:hero-faces:v1",
} as const;

/** 実際に set したキー（`:<limit>` 等の接尾辞付き）。invalidateHomeDiscoveryCache が全部消すための記録 */
const usedCacheKeys = new Set<string>();

/**
 * ホームの一覧キャッシュを（このインスタンスの分だけ）全部消す。
 * プロフィールの公開範囲・ロールの変更、アカウント・ガイドの削除、ガイドの公開状態の変更の後に呼ぶ
 */
export async function invalidateHomeDiscoveryCache(): Promise<void> {
  const keys = [...usedCacheKeys];
  usedCacheKeys.clear();
  await Promise.all(keys.map((key) => invalidateCache(key)));
}

/** 同じ取得を並列に来ても、キャッシュが温まるまで1回ずつは引く（単純な get → load → set） */
async function cachedQuery<T>(key: string, load: () => Promise<T>): Promise<T> {
  const cached = await getCached<T>(key);
  if (cached !== null) return cached;
  const fresh = await load();
  usedCacheKeys.add(key);
  await setCached(key, fresh, HOME_DISCOVERY_TTL);
  return fresh;
}

// プロフィール一覧の select 列（更新順・PV順で共通）
const profileFeedColumns = {
  inputMethod: users.inputMethod,
  mcid: users.mcid,
  uuid: users.uuid,
  slug: users.slug,
  displayName: users.displayName,
  displayNameAlphabet: users.displayNameAlphabet,
  pronouns: users.pronouns,
  role: users.role,
  mainEdition: users.mainEdition,
  mainPlatform: users.mainPlatform,
  updatedAt: users.updatedAt,
  shortBio: users.shortBio,
  customSkinUrl: users.customSkinUrl,
  // カードのタグ用（メインカテゴリ）。playstyles.userId は一意なので leftJoin しても行は増えない
  mainCategory: playstyles.mainCategory,
};

// ガイド一覧の select 列
const guideListColumns = {
  id: guides.id,
  slug: guides.slug,
  title: guides.title,
  summary: guides.summary,
  tags: guides.tags,
  coverImageUrl: guides.coverImageUrl,
  viewCount: guides.viewCount,
  likeCount: guideLikeCountSql(),
  updatedAt: guides.updatedAt,
  authorSlug: users.slug,
  authorDisplayName: users.displayName,
  authorDisplayNameAlphabet: users.displayNameAlphabet,
  authorMcid: users.mcid,
  // 著者の顔（GuideCardGrid の著者名の左）。同じ users との JOIN で取れるので追加クエリは無い
  authorUuid: users.uuid,
  authorCustomSkinUrl: users.customSkinUrl,
};

/** 最近更新されたプロフィール（公開設定のみ、視聴者ロール除外） */
export function getRecentProfiles(db: Database, limit: number) {
  return cachedQuery(`${HOME_DISCOVERY_CACHE_KEYS.recentProfiles}:${limit}`, () =>
    db
      .select(profileFeedColumns)
      .from(users)
      .leftJoin(playstyles, eq(playstyles.userId, users.id))
      .where(listedRunnerCondition)
      .orderBy(desc(users.updatedAt))
      .limit(limit),
  );
}

/**
 * よく見られているプロフィール（直近7日PV順）。
 * page_view_stats のスナップショット行を直接引くため、集計未稼働の環境では自然に0件になる
 */
export function getPopularProfiles(db: Database, limit: number) {
  return cachedQuery(`${HOME_DISCOVERY_CACHE_KEYS.popularProfiles}:${limit}`, () =>
    db
      .select({ ...profileFeedColumns, pageViews7d: pageViewStats.pageviews })
      .from(pageViewStats)
      .innerJoin(users, eq(pageViewStats.targetId, users.id))
      .leftJoin(playstyles, eq(playstyles.userId, users.id))
      .where(and(eq(pageViewStats.targetType, "profile"), listedRunnerCondition))
      .orderBy(desc(pageViewStats.pageviews))
      .limit(limit),
  );
}

/** 新着ガイド（公開済み・更新日時順）。同じ著者は1件までにして count 件。翻訳は含めない（ロケール依存のため呼び出し側） */
export function getNewGuides(db: Database, count: number) {
  return cachedQuery(`${HOME_DISCOVERY_CACHE_KEYS.newGuides}:${count}`, async () => {
    const raw = await db
      .select(guideListColumns)
      .from(guides)
      .innerJoin(users, eq(guides.authorId, users.id))
      // 非公開・限定公開の著者のガイドはホームの一覧（discovery）に出さない（視聴者ロールの著者は除外しない）
      .where(and(eq(guides.isPublished, true), eq(users.profileVisibility, "public")))
      .orderBy(desc(guides.updatedAt))
      .limit(count * 6);
    // 同じ著者は1件まで
    const seenAuthors = new Set<string>();
    return raw
      .filter((g) => {
        if (seenAuthors.has(g.authorSlug)) return false;
        seenAuthors.add(g.authorSlug);
        return true;
      })
      .slice(0, count);
  });
}

/** 公開されている走者の人数 */
export function getPublicProfileCount(db: Database): Promise<number> {
  return cachedQuery(HOME_DISCOVERY_CACHE_KEYS.publicCount, async () => {
    const [row] = await db.select({ total: sql<number>`count(*)` }).from(users).where(listedRunnerCondition);
    return row?.total ?? 0;
  });
}

/** ゲストのヒーローの「顔ぶれ」の帯用。公開一覧に出ている項目のうち表示に要る列だけ */
export function getHeroFaces(db: Database, limit: number) {
  return cachedQuery(`${HOME_DISCOVERY_CACHE_KEYS.heroFaces}:${limit}`, () =>
    db
      .select({
        slug: users.slug,
        mcid: users.mcid,
        uuid: users.uuid,
        customSkinUrl: users.customSkinUrl,
        displayName: users.displayName,
        displayNameAlphabet: users.displayNameAlphabet,
      })
      .from(users)
      .where(and(listedRunnerCondition, or(isNotNull(users.uuid), isNotNull(users.customSkinUrl))))
      .orderBy(desc(users.updatedAt))
      .limit(limit),
  );
}
