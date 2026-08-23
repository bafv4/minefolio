// お気に入りプレイヤーの管理（slugベース、DBがマスター）
//
// - ログインユーザー: DB `favorites` テーブル
// - 一般ユーザー: クライアント側 localStorage（app/lib/favorites-client.ts）
// - 旧 Cookie `minefolio_favorites` は廃止。/api/favorites の応答で自動削除

import { eq, and } from "drizzle-orm";
import { favorites } from "./schema";
import type { Database } from "./db";

/** drizzle のトランザクション内外どちらでも使える最小インターフェース（slug-history.server.ts と同じ方式） */
type DatabaseOrTransaction = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

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
  // 重複を除いた挿入対象（入力側の重複も Set で除去）
  const toInsert = [...new Set(localFavorites.filter((slug) => !existingSet.has(slug)))];
  if (toInsert.length === 0) return;

  // 1回の INSERT が SQLite のバインド変数上限(32766)を超えないようチャンク分割する。
  // 1行あたり数バインドのため、500行/回なら十分な余裕がある。
  const CHUNK_SIZE = 500;
  for (let i = 0; i < toInsert.length; i += CHUNK_SIZE) {
    const batch = toInsert.slice(i, i + CHUNK_SIZE);
    await db
      .insert(favorites)
      .values(batch.map((slug) => ({ userId, favoriteSlug: slug })))
      .onConflictDoNothing({
        target: [favorites.userId, favorites.favoriteSlug],
      });
  }
}

/**
 * 配列ベースの便利関数（クライアント側でも使用可能）
 */
export function isFavorite(list: string[], slug: string): boolean {
  return list.includes(slug);
}

/**
 * MCID変更（set_mcid）・MCID削除（remove_mcid）で users.slug が変わる際に呼ぶ。
 * schema.ts の favorites ポリシーコメントに定める「slug 変更時はアプリケーション層で
 * 旧 slug → 新 slug の追従更新を行う」の実装。
 *
 * - oldSlug を favoriteSlug に持つ既存行を newSlug へ更新する（追従更新本体）
 * - newSlug を既に favoriteSlug に持つ行は、以前その slug を持っていた別ユーザーへの
 *   孤児参照（slug-history.server.ts の claimSlug と同じ意味論）なので先に削除する。
 *   これにより (userId, favoriteSlug) の UNIQUE 制約（idx_favorites_user_slug）との
 *   衝突も避けられる
 *
 * 比較は完全一致（大文字小文字を区別）で行う。favoriteSlug は登録時点の users.slug を
 * そのまま保存しており、favorites.tsx の解決も完全一致のため、lower() マッチにすると
 * 同一ユーザーの大文字小文字違い重複行が同じ newSlug に更新されてユニーク制約違反に
 * なりうる上、大文字小文字違いの行はそもそも現行の解決ロジックでも救済されない死に行
 * のため対象外でよい。大文字小文字だけの slug 変更（例: "alice" → "Alice"）でも
 * favorites の解決自体は完全一致で行われるため、この関数では追従させる
 * （recordSlugChange の小文字化 no-op とは判定基準が異なる点に注意）。
 */
export async function retargetFavoritesOnSlugChange(
  tx: DatabaseOrTransaction,
  { oldSlug, newSlug }: { oldSlug: string; newSlug: string },
): Promise<void> {
  if (oldSlug === newSlug) {
    return;
  }

  await tx.delete(favorites).where(eq(favorites.favoriteSlug, newSlug));

  await tx
    .update(favorites)
    .set({ favoriteSlug: newSlug })
    .where(eq(favorites.favoriteSlug, oldSlug));
}
