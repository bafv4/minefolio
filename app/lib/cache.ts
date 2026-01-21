// DBキャッシュとインメモリキャッシュのハイブリッド実装
// Vercel環境ではDBキャッシュを使用し、インメモリはフォールバック

import { eq, lt } from "drizzle-orm";
import { createDb } from "./db";
import { apiCache } from "./schema";
import { createId } from "@paralleldrive/cuid2";

const CACHE_TTL = 60 * 1000; // 1分
const CACHE_TTL_15MIN = 15 * 60 * 1000; // 15分（外部API用）
const CACHE_TTL_1DAY = 24 * 60 * 60 * 1000; // 1日（Mojang API用）

// メモリキャッシュの設定
const MEMORY_CACHE_CONFIG = {
  MAX_SIZE: 1000, // 最大エントリ数
  CLEANUP_INTERVAL: 5 * 60 * 1000, // クリーンアップ間隔（5分）
};

// インメモリキャッシュ（開発環境用・フォールバック用）
const memoryCache = new Map<string, { data: unknown; expires: number; lastAccessed: number }>();
let lastCleanupTime = Date.now();

/**
 * 期限切れのメモリキャッシュエントリを削除し、サイズ制限を適用
 */
function cleanupMemoryCache(): void {
  const now = Date.now();

  // 期限切れエントリの削除
  for (const [key, value] of memoryCache.entries()) {
    if (value.expires <= now) {
      memoryCache.delete(key);
    }
  }

  // サイズ制限を超えている場合、最もアクセスが古いエントリから削除（LRU）
  if (memoryCache.size > MEMORY_CACHE_CONFIG.MAX_SIZE) {
    const entries = [...memoryCache.entries()].sort(
      (a, b) => a[1].lastAccessed - b[1].lastAccessed
    );
    const deleteCount = memoryCache.size - MEMORY_CACHE_CONFIG.MAX_SIZE;
    for (let i = 0; i < deleteCount; i++) {
      memoryCache.delete(entries[i][0]);
    }
  }

  lastCleanupTime = now;
}

/**
 * 必要に応じてクリーンアップを実行
 */
function maybeCleanup(): void {
  if (Date.now() - lastCleanupTime > MEMORY_CACHE_CONFIG.CLEANUP_INTERVAL) {
    cleanupMemoryCache();
  }
}

/**
 * ユーザー固有のキャッシュキーを生成
 * @param userId - ユーザーID
 * @param page - ページ識別子
 * @returns キャッシュキー文字列
 */
export function getCacheKey(userId: string, page: string): string {
  return `minefolio:${userId}:${page}`;
}

/**
 * キャッシュからデータを取得（インメモリ）
 * @param key - キャッシュキー
 * @returns キャッシュされたデータ、または有効期限切れ/存在しない場合はnull
 */
export async function getCached<T>(key: string): Promise<T | null> {
  maybeCleanup();

  const cached = memoryCache.get(key);
  if (cached && cached.expires > Date.now()) {
    // LRU: 最終アクセス時間を更新
    cached.lastAccessed = Date.now();
    return cached.data as T;
  }
  memoryCache.delete(key);
  return null;
}

/**
 * データをキャッシュに保存（インメモリ）
 * @param key - キャッシュキー
 * @param data - 保存するデータ
 * @param ttl - Time To Live（ミリ秒）、デフォルト: 1分
 */
export async function setCached<T>(key: string, data: T, ttl = CACHE_TTL): Promise<void> {
  maybeCleanup();

  const now = Date.now();
  memoryCache.set(key, {
    data,
    expires: now + ttl,
    lastAccessed: now,
  });
}

/**
 * 特定のキャッシュエントリを削除
 * @param key - キャッシュキー
 */
export async function invalidateCache(key: string): Promise<void> {
  memoryCache.delete(key);
}

/**
 * ユーザーに関連するすべてのキャッシュを削除
 * @param userId - ユーザーID
 */
export async function invalidateUserCache(userId: string): Promise<void> {
  const prefix = `minefolio:${userId}:`;
  for (const key of memoryCache.keys()) {
    if (key.startsWith(prefix)) {
      memoryCache.delete(key);
    }
  }
}

/**
 * 外部API用のキャッシュTTLプリセット
 * - SHORT: 1分（ライブデータ用）
 * - MEDIUM: 15分（外部API用）
 * - LONG: 1日（Mojang API用）
 */
export const CacheTTL = {
  SHORT: CACHE_TTL, // 1分
  MEDIUM: CACHE_TTL_15MIN, // 15分
  LONG: CACHE_TTL_1DAY, // 1日
} as const;

/**
 * Mojang API用のキャッシュキーを生成
 * @param identifier - MCID、UUID、またはその他の識別子
 * @returns キャッシュキー
 */
export function getMojangCacheKey(identifier: string): string {
  return `mojang:${identifier}`;
}

/**
 * Twitch API用のキャッシュキーを生成
 * @param userLogins - Twitchユーザー名の配列
 * @returns キャッシュキー（ソート済み）
 */
export function getTwitchCacheKey(userLogins: string[]): string {
  return `twitch:${userLogins.sort().join(",")}`;
}

/**
 * YouTube API用のキャッシュキーを生成
 * @param channelIds - YouTubeチャンネルIDの配列
 * @returns キャッシュキー（ソート済み）
 */
export function getYouTubeCacheKey(channelIds: string[]): string {
  return `youtube:${channelIds.sort().join(",")}`;
}

/**
 * PaceMan API用のキャッシュキーを生成
 * @param type - データタイプ（例: "liveruns", "recent:nickname1,nickname2"）
 * @returns キャッシュキー
 */
export function getPaceManCacheKey(type: string): string {
  return `paceman:${type}`;
}

// ============================================
// DBキャッシュ関連の関数
// ============================================

type CacheType = "youtube_videos" | "recent_paces" | "twitch_streams" | "live_runs";

/**
 * DBからキャッシュを取得
 * @param cacheKey - キャッシュキー
 * @returns キャッシュされたデータ、または有効期限切れ/存在しない場合はnull
 */
export async function getDbCached<T>(cacheKey: string): Promise<T | null> {
  try {
    const db = createDb();
    const cached = await db.query.apiCache.findFirst({
      where: eq(apiCache.cacheKey, cacheKey),
    });

    if (!cached) {
      return null;
    }

    // 有効期限チェック
    if (cached.expiresAt < new Date()) {
      // 期限切れの場合は削除
      await db.delete(apiCache).where(eq(apiCache.cacheKey, cacheKey));
      return null;
    }

    return JSON.parse(cached.data) as T;
  } catch (error) {
    console.error("DB cache read error:", error);
    return null;
  }
}

/**
 * データをDBキャッシュに保存
 * @param cacheKey - キャッシュキー
 * @param cacheType - キャッシュタイプ
 * @param data - 保存するデータ
 * @param ttlMs - Time To Live（ミリ秒）
 */
export async function setDbCached<T>(
  cacheKey: string,
  cacheType: CacheType,
  data: T,
  ttlMs: number
): Promise<void> {
  try {
    const db = createDb();
    const expiresAt = new Date(Date.now() + ttlMs);
    const jsonData = JSON.stringify(data);

    // upsert: 存在すれば更新、なければ挿入
    const existing = await db.query.apiCache.findFirst({
      where: eq(apiCache.cacheKey, cacheKey),
    });

    if (existing) {
      await db
        .update(apiCache)
        .set({
          data: jsonData,
          expiresAt,
          updatedAt: new Date(),
        })
        .where(eq(apiCache.cacheKey, cacheKey));
    } else {
      await db.insert(apiCache).values({
        id: createId(),
        cacheKey,
        cacheType,
        data: jsonData,
        expiresAt,
      });
    }
  } catch (error) {
    console.error("DB cache write error:", error);
  }
}

/**
 * 特定のDBキャッシュを削除
 * @param cacheKey - キャッシュキー
 */
export async function invalidateDbCache(cacheKey: string): Promise<void> {
  try {
    const db = createDb();
    await db.delete(apiCache).where(eq(apiCache.cacheKey, cacheKey));
  } catch (error) {
    console.error("DB cache invalidation error:", error);
  }
}

/**
 * 特定タイプの全DBキャッシュを削除
 * @param cacheType - キャッシュタイプ
 */
export async function invalidateDbCacheByType(cacheType: CacheType): Promise<void> {
  try {
    const db = createDb();
    await db.delete(apiCache).where(eq(apiCache.cacheType, cacheType));
  } catch (error) {
    console.error("DB cache type invalidation error:", error);
  }
}

/**
 * 期限切れのDBキャッシュを削除
 */
export async function cleanupExpiredDbCache(): Promise<number> {
  try {
    const db = createDb();
    const result = await db
      .delete(apiCache)
      .where(lt(apiCache.expiresAt, new Date()));
    return result.rowsAffected;
  } catch (error) {
    console.error("DB cache cleanup error:", error);
    return 0;
  }
}

/**
 * DBキャッシュを取得、なければフェッチして保存
 * @param cacheKey - キャッシュキー
 * @param cacheType - キャッシュタイプ
 * @param fetcher - データ取得関数
 * @param ttlMs - Time To Live（ミリ秒）
 * @returns キャッシュまたは新規取得したデータ
 */
export async function getOrFetchDbCached<T>(
  cacheKey: string,
  cacheType: CacheType,
  fetcher: () => Promise<T>,
  ttlMs: number
): Promise<T> {
  // まずDBキャッシュを確認
  const cached = await getDbCached<T>(cacheKey);
  if (cached !== null) {
    return cached;
  }

  // キャッシュがなければ取得して保存
  const data = await fetcher();
  await setDbCached(cacheKey, cacheType, data, ttlMs);
  return data;
}
