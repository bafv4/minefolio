// シンプルなインメモリキャッシュ（開発用）とCloudflare Cache API（本番用）
// ユーザーごとにキャッシュを管理

const CACHE_TTL = 60 * 1000; // 1分
const CACHE_TTL_15MIN = 15 * 60 * 1000; // 15分（外部API用）
const CACHE_TTL_1DAY = 24 * 60 * 60 * 1000; // 1日（Mojang API用）

// インメモリキャッシュ（開発環境用）
const memoryCache = new Map<string, { data: unknown; expires: number }>();

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
 * キャッシュからデータを取得
 * @param key - キャッシュキー
 * @returns キャッシュされたデータ、または有効期限切れ/存在しない場合はnull
 */
export async function getCached<T>(key: string): Promise<T | null> {
  const cached = memoryCache.get(key);
  if (cached && cached.expires > Date.now()) {
    return cached.data as T;
  }
  memoryCache.delete(key);
  return null;
}

/**
 * データをキャッシュに保存
 * @param key - キャッシュキー
 * @param data - 保存するデータ
 * @param ttl - Time To Live（ミリ秒）、デフォルト: 1分
 */
export async function setCached<T>(key: string, data: T, ttl = CACHE_TTL): Promise<void> {
  memoryCache.set(key, {
    data,
    expires: Date.now() + ttl,
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
