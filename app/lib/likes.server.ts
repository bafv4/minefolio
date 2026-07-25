// いいね（ガイド／サーチクラフトテンプレート）のサーバー側ロジック。
//
// 方針（docs/likes.md）:
// - ログイン必須。未ログインは閲覧のみ（件数はローダーがSSRで返す）
// - 自分の投稿にはいいねできない（適用回数の既存方針と一致）
// - いいね数は非正規化列を持たず COUNT(*) で都度算出する
// - db を第一引数に取り、Request / セッションはここでは扱わない（favorites.ts と同じ）

import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import {
  guides,
  guideLikes,
  searchCraftTemplates,
  searchCraftTemplateLikes,
  users,
} from "./schema";
import { publiclyReferencableCondition } from "./users-filter";
import type { Database } from "./db";

export type LikeTargetType = "guide" | "template";

export type LikeResult =
  | { ok: true; liked: boolean; count: number }
  /** not_found: 不存在・未公開・著者が非公開。呼び出し側は列挙オラクルを避けるため区別せず404にする */
  | { ok: false; reason: "not_found" | "self" };

/**
 * `_layout` が返す「閲覧者のいいね済み id」の上限。
 * SSRペイロードの暴走を防ぐための保険で、通常の利用では到達しない。
 */
export const VIEWER_LIKED_IDS_LIMIT = 2000;

// ============================================
// 読み取り（一覧ローダー用）
// ============================================

/**
 * ガイドのいいね数を返す相関サブクエリ。`.select()` と RQB の `extras` の両方で使える。
 * guide_likes_guide_user_uniq(guide_id, user_id) がカバリング索引になる。
 */
export function guideLikeCountSql(): SQL<number> {
  return sql<number>`(select count(*) from ${guideLikes} where ${guideLikes.guideId} = ${guides.id})`;
}

/** テンプレートのいいね数を返す相関サブクエリ。 */
export function templateLikeCountSql(): SQL<number> {
  return sql<number>`(select count(*) from ${searchCraftTemplateLikes} where ${searchCraftTemplateLikes.templateId} = ${searchCraftTemplates.id})`;
}

/**
 * 閲覧者がいいね済みの id 一覧（`_layout` で一括取得し LikesProvider に渡す）。
 * userId が null（未ログイン）なら SQL を発行せず空を返す。
 */
export async function getViewerLikedIds(
  db: Database,
  userId: string | null,
): Promise<{ guideIds: string[]; templateIds: string[] }> {
  if (!userId) return { guideIds: [], templateIds: [] };

  const [guideRows, templateRows] = await Promise.all([
    db
      .select({ id: guideLikes.guideId })
      .from(guideLikes)
      .where(eq(guideLikes.userId, userId))
      .limit(VIEWER_LIKED_IDS_LIMIT),
    db
      .select({ id: searchCraftTemplateLikes.templateId })
      .from(searchCraftTemplateLikes)
      .where(eq(searchCraftTemplateLikes.userId, userId))
      .limit(VIEWER_LIKED_IDS_LIMIT),
  ]);

  return {
    guideIds: guideRows.map((r) => r.id),
    templateIds: templateRows.map((r) => r.id),
  };
}

/** ガイド1件のいいね数。 */
export async function getGuideLikeCount(db: Database, guideId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(guideLikes)
    .where(eq(guideLikes.guideId, guideId));
  return Number(row?.count ?? 0);
}

/** テンプレート1件のいいね数。 */
export async function getTemplateLikeCount(db: Database, templateId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(searchCraftTemplateLikes)
    .where(eq(searchCraftTemplateLikes.templateId, templateId));
  return Number(row?.count ?? 0);
}

/**
 * id 群 → いいね数のマップ。いいねが 0 件の id はマップに含まれない（呼び出し側で `?? 0`）。
 * 空配列なら SQL を発行しない。
 */
export async function getGuideLikeCounts(
  db: Database,
  guideIds: string[],
): Promise<Map<string, number>> {
  if (guideIds.length === 0) return new Map();
  const rows = await db
    .select({ id: guideLikes.guideId, count: sql<number>`count(*)` })
    .from(guideLikes)
    .where(inArray(guideLikes.guideId, guideIds))
    .groupBy(guideLikes.guideId);
  return new Map(rows.map((r) => [r.id, Number(r.count)]));
}

/** id 群 → いいね数のマップ（テンプレート）。 */
export async function getTemplateLikeCounts(
  db: Database,
  templateIds: string[],
): Promise<Map<string, number>> {
  if (templateIds.length === 0) return new Map();
  const rows = await db
    .select({ id: searchCraftTemplateLikes.templateId, count: sql<number>`count(*)` })
    .from(searchCraftTemplateLikes)
    .where(inArray(searchCraftTemplateLikes.templateId, templateIds))
    .groupBy(searchCraftTemplateLikes.templateId);
  return new Map(rows.map((r) => [r.id, Number(r.count)]));
}

// ============================================
// 書き込み
// ============================================

// いいね可否の可視性ルール:
//   発見用一覧と同じ「public のみ」にすると、URL 共有で正当に閲覧できる unlisted 著者の投稿に
//   いいねできなくなる。逆に無検査だと private 著者の投稿が対象になる。
//   → 名指し参照と同じ publiclyReferencableCondition（public + unlisted）を使う。

/**
 * ガイドにいいねする（冪等）。
 * 未公開・不存在・著者が非公開なら not_found、自分のガイドなら self を返す。
 */
export async function likeGuide(
  db: Database,
  userId: string,
  guideId: string,
): Promise<LikeResult> {
  const [target] = await db
    .select({ authorId: guides.authorId, isPublished: guides.isPublished })
    .from(guides)
    .innerJoin(users, eq(guides.authorId, users.id))
    .where(and(eq(guides.id, guideId), publiclyReferencableCondition));

  if (!target || !target.isPublished) return { ok: false, reason: "not_found" };
  if (target.authorId === userId) return { ok: false, reason: "self" };

  // 連打による重複挿入を1文で吸収する（SELECT→INSERT だと TOCTOU が残る）。
  // ユニーク索引により 1ユーザー1対象1件が保証され、これがレート制限も兼ねる。
  await db
    .insert(guideLikes)
    .values({ guideId, userId })
    .onConflictDoNothing({ target: [guideLikes.guideId, guideLikes.userId] });

  return { ok: true, liked: true, count: await getGuideLikeCount(db, guideId) };
}

/**
 * ガイドのいいねを外す（冪等）。
 * 所有者・公開状態は検査しない（非公開化後に自分のいいねを外せなくなるのを防ぐ）。
 */
export async function unlikeGuide(
  db: Database,
  userId: string,
  guideId: string,
): Promise<LikeResult> {
  await db
    .delete(guideLikes)
    .where(and(eq(guideLikes.guideId, guideId), eq(guideLikes.userId, userId)));
  return { ok: true, liked: false, count: await getGuideLikeCount(db, guideId) };
}

/**
 * テンプレートにいいねする（冪等）。
 * ※ ガイドは authorId、テンプレートは userId と所有者列の名前が違うため個別に書いている。
 */
export async function likeTemplate(
  db: Database,
  userId: string,
  templateId: string,
): Promise<LikeResult> {
  const [target] = await db
    .select({
      ownerId: searchCraftTemplates.userId,
      isPublished: searchCraftTemplates.isPublished,
    })
    .from(searchCraftTemplates)
    .innerJoin(users, eq(searchCraftTemplates.userId, users.id))
    .where(and(eq(searchCraftTemplates.id, templateId), publiclyReferencableCondition));

  if (!target || !target.isPublished) return { ok: false, reason: "not_found" };
  if (target.ownerId === userId) return { ok: false, reason: "self" };

  await db
    .insert(searchCraftTemplateLikes)
    .values({ templateId, userId })
    .onConflictDoNothing({
      target: [searchCraftTemplateLikes.templateId, searchCraftTemplateLikes.userId],
    });

  return { ok: true, liked: true, count: await getTemplateLikeCount(db, templateId) };
}

/** テンプレートのいいねを外す（冪等・無検査）。 */
export async function unlikeTemplate(
  db: Database,
  userId: string,
  templateId: string,
): Promise<LikeResult> {
  await db
    .delete(searchCraftTemplateLikes)
    .where(
      and(
        eq(searchCraftTemplateLikes.templateId, templateId),
        eq(searchCraftTemplateLikes.userId, userId),
      ),
    );
  return { ok: true, liked: false, count: await getTemplateLikeCount(db, templateId) };
}

/** API ルート用のディスパッチャ。 */
export async function setLike(
  db: Database,
  userId: string,
  targetType: LikeTargetType,
  targetId: string,
  liked: boolean,
): Promise<LikeResult> {
  if (targetType === "guide") {
    return liked ? likeGuide(db, userId, targetId) : unlikeGuide(db, userId, targetId);
  }
  return liked ? likeTemplate(db, userId, targetId) : unlikeTemplate(db, userId, targetId);
}
