// お気に入りプレイヤーの管理（slugベース、DBがマスター）
//
// - ログインユーザー: DB `favorites` テーブル
// - 一般ユーザー: クライアント側 localStorage（app/lib/favorites-client.ts）
// - 旧 Cookie `minefolio_favorites` は廃止。/api/favorites の応答で自動削除

import { eq, and } from "drizzle-orm";
import { favorites } from "./schema";
import type { Database } from "./db";

/** 旧 Cookie 名（互換削除のため使用） */
export const LEGACY_FAVORITES_COOKIE_NAME = "minefolio_favorites";

/** Set-Cookie ヘッダー値: 旧 Cookie を削除（Max-Age=0） */
export function buildLegacyFavoritesCookieDeletion(): string {
  return `${LEGACY_FAVORITES_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax`;
}

/**
 * DBからお気に入りリスト（slug配列）を取得
 */
export async function getFavoritesFromDb(
  db: Database,
  userId: string,
): Promise<string[]> {
  const results = await db
    .select({ favoriteSlug: favorites.favoriteSlug })
    .from(favorites)
    .where(eq(favorites.userId, userId))
    .all();
  return results.map((r) => r.favoriteSlug);
}

/**
 * DBにお気に入りを追加（重複は無視）
 */
export async function addFavoriteToDb(
  db: Database,
  userId: string,
  slug: string,
): Promise<void> {
  const existing = await db
    .select()
    .from(favorites)
    .where(and(eq(favorites.userId, userId), eq(favorites.favoriteSlug, slug)))
    .get();
  if (existing) return;

  await db.insert(favorites).values({
    userId,
    favoriteSlug: slug,
  });
}

/**
 * DBからお気に入りを削除
 */
export async function removeFavoriteFromDb(
  db: Database,
  userId: string,
  slug: string,
): Promise<void> {
  await db
    .delete(favorites)
    .where(and(eq(favorites.userId, userId), eq(favorites.favoriteSlug, slug)));
}

/**
 * 一括同期: localStorage から渡された slug 配列を DB に追加（重複は無視）
 * 既存分は SELECT 1 回で取得し、不足分のみ bulk INSERT で発行する。
 * uniqueIndex(idx_favorites_user_slug) があるため onConflictDoNothing で並行追加も安全。
 */
export async function syncLocalFavoritesToDb(
  db: Database,
  userId: string,
  localFavorites: string[],
): Promise<void> {
  if (localFavorites.length === 0) return;
  const existing = await getFavoritesFromDb(db, userId);
  const existingSet = new Set(existing);
  const toInsert = localFavorites.filter((slug) => !existingSet.has(slug));
  if (toInsert.length === 0) return;

  await db
    .insert(favorites)
    .values(toInsert.map((slug) => ({ userId, favoriteSlug: slug })))
    .onConflictDoNothing({
      target: [favorites.userId, favorites.favoriteSlug],
    });
}

/**
 * 配列ベースの便利関数（クライアント側でも使用可能）
 */
export function isFavorite(list: string[], slug: string): boolean {
  return list.includes(slug);
}
