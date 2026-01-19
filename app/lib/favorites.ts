// お気に入りプレイヤーをCookieまたはDBで管理するユーティリティ

import { eq, and } from "drizzle-orm";
import { favorites } from "./schema";
import type { Database } from "./db";

const FAVORITES_COOKIE_NAME = "minefolio_favorites";
const MAX_FAVORITES = 50;

/**
 * Cookieからお気に入りリストを取得
 */
export function getFavoritesFromCookie(cookieHeader: string | null): string[] {
  if (!cookieHeader) return [];

  const cookies = parseCookies(cookieHeader);
  const favoritesStr = cookies[FAVORITES_COOKIE_NAME];

  if (!favoritesStr) return [];

  try {
    const decoded = decodeURIComponent(favoritesStr);
    const parsed = JSON.parse(decoded);
    if (Array.isArray(parsed)) {
      return parsed.filter((id) => typeof id === "string");
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * お気に入りリストをCookieに設定するためのヘッダー値を生成
 */
export function createFavoritesCookieValue(favorites: string[]): string {
  const trimmed = favorites.slice(0, MAX_FAVORITES);
  const value = encodeURIComponent(JSON.stringify(trimmed));
  // 1年間有効、SameSite=Lax
  return `${FAVORITES_COOKIE_NAME}=${value}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

/**
 * お気に入りに追加
 */
export function addToFavorites(current: string[], mcid: string): string[] {
  if (current.includes(mcid)) return current;
  return [mcid, ...current].slice(0, MAX_FAVORITES);
}

/**
 * お気に入りから削除
 */
export function removeFromFavorites(current: string[], mcid: string): string[] {
  return current.filter((id) => id !== mcid);
}

/**
 * お気に入りかどうかをチェック
 */
export function isFavorite(favorites: string[], mcid: string): boolean {
  return favorites.includes(mcid);
}

/**
 * Cookie文字列をパース
 */
function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  const parts = cookieHeader.split(";");

  for (const part of parts) {
    const [name, ...rest] = part.trim().split("=");
    if (name) {
      cookies[name] = rest.join("=");
    }
  }

  return cookies;
}

// ============================================
// DB同期機能（認証済みユーザー用）
// ============================================

/**
 * DBからお気に入りリストを取得（認証済みユーザー）
 * @param db - データベース
 * @param userId - ユーザーID
 * @returns お気に入りMCIDの配列
 */
export async function getFavoritesFromDb(
  db: Database,
  userId: string
): Promise<string[]> {
  const results = await db
    .select({ favoriteMcid: favorites.favoriteMcid })
    .from(favorites)
    .where(eq(favorites.userId, userId))
    .all();

  return results.map((r) => r.favoriteMcid);
}

/**
 * DBにお気に入りを追加（認証済みユーザー）
 * @param db - データベース
 * @param userId - ユーザーID
 * @param mcid - 追加するMCID
 */
export async function addFavoriteToDb(
  db: Database,
  userId: string,
  mcid: string
): Promise<void> {
  // 既に存在するかチェック
  const existing = await db
    .select()
    .from(favorites)
    .where(and(eq(favorites.userId, userId), eq(favorites.favoriteMcid, mcid)))
    .get();

  if (existing) {
    return; // 既に追加済み
  }

  // 追加
  await db.insert(favorites).values({
    userId,
    favoriteMcid: mcid,
  });
}

/**
 * DBからお気に入りを削除（認証済みユーザー）
 * @param db - データベース
 * @param userId - ユーザーID
 * @param mcid - 削除するMCID
 */
export async function removeFavoriteFromDb(
  db: Database,
  userId: string,
  mcid: string
): Promise<void> {
  await db
    .delete(favorites)
    .where(and(eq(favorites.userId, userId), eq(favorites.favoriteMcid, mcid)));
}

/**
 * Cookieのお気に入りをDBに同期（ログイン時）
 * @param db - データベース
 * @param userId - ユーザーID
 * @param cookieFavorites - Cookieから取得したお気に入り
 */
export async function syncCookieFavoritesToDb(
  db: Database,
  userId: string,
  cookieFavorites: string[]
): Promise<void> {
  if (cookieFavorites.length === 0) {
    return;
  }

  // DBの既存のお気に入りを取得
  const dbFavorites = await getFavoritesFromDb(db, userId);
  const dbFavoritesSet = new Set(dbFavorites);

  // CookieにあってDBにないものを追加
  for (const mcid of cookieFavorites) {
    if (!dbFavoritesSet.has(mcid)) {
      await addFavoriteToDb(db, userId, mcid);
    }
  }
}

/**
 * お気に入りを取得（認証状態に応じてCookieまたはDBから）
 * @param db - データベース（認証済みの場合）
 * @param userId - ユーザーID（認証済みの場合）
 * @param cookieHeader - Cookieヘッダー（未認証の場合）
 * @returns お気に入りMCIDの配列
 */
export async function getFavorites(
  db: Database | null,
  userId: string | null,
  cookieHeader: string | null
): Promise<string[]> {
  if (db && userId) {
    // 認証済み: DBから取得
    return await getFavoritesFromDb(db, userId);
  } else {
    // 未認証: Cookieから取得
    return getFavoritesFromCookie(cookieHeader);
  }
}
