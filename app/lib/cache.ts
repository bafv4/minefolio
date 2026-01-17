// シンプルなインメモリキャッシュ（開発用）とCloudflare Cache API（本番用）
// ユーザーごとにキャッシュを管理

const CACHE_TTL = 60 * 1000; // 1分

// インメモリキャッシュ（開発環境用）
const memoryCache = new Map<string, { data: unknown; expires: number }>();

export function getCacheKey(userId: string, page: string): string {
  return `minefolio:${userId}:${page}`;
}

export async function getCached<T>(key: string): Promise<T | null> {
  const cached = memoryCache.get(key);
  if (cached && cached.expires > Date.now()) {
    return cached.data as T;
  }
  memoryCache.delete(key);
  return null;
}

export async function setCached<T>(key: string, data: T, ttl = CACHE_TTL): Promise<void> {
  memoryCache.set(key, {
    data,
    expires: Date.now() + ttl,
  });
}

export async function invalidateCache(key: string): Promise<void> {
  memoryCache.delete(key);
}

export async function invalidateUserCache(userId: string): Promise<void> {
  const prefix = `minefolio:${userId}:`;
  for (const key of memoryCache.keys()) {
    if (key.startsWith(prefix)) {
      memoryCache.delete(key);
    }
  }
}
