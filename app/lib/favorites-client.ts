// お気に入りのクライアント側保存先（localStorage / sessionStorage）
// SSR時は no-op／空配列を返す。Cookie同意の確認は呼び出し側の責務。

const LOCAL_KEY = "minefolio_favorites";
const SESSION_KEY = "minefolio_favorites_cache";
const MAX_FAVORITES = 50;

function readArray(storage: Storage | null, key: string): string[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    return [];
  }
}

function writeArray(storage: Storage | null, key: string, slugs: string[]): void {
  if (!storage) return;
  try {
    const trimmed = slugs.slice(0, MAX_FAVORITES);
    storage.setItem(key, JSON.stringify(trimmed));
  } catch {
    // QuotaExceeded など無視
  }
}

function safeLocal(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function safeSession(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

// ============================================
// localStorage（一般ユーザー用、Cookie同意必要）
// ============================================

export function getLocalFavorites(): string[] {
  return readArray(safeLocal(), LOCAL_KEY);
}

export function setLocalFavorites(slugs: string[]): void {
  writeArray(safeLocal(), LOCAL_KEY, slugs);
}

export function clearLocalFavorites(): void {
  const storage = safeLocal();
  if (!storage) return;
  try {
    storage.removeItem(LOCAL_KEY);
  } catch {
    // 無視
  }
}

export function addLocalFavorite(slug: string): string[] {
  const current = getLocalFavorites();
  if (current.includes(slug)) return current;
  const next = [slug, ...current].slice(0, MAX_FAVORITES);
  setLocalFavorites(next);
  return next;
}

export function removeLocalFavorite(slug: string): string[] {
  const current = getLocalFavorites();
  const next = current.filter((s) => s !== slug);
  setLocalFavorites(next);
  return next;
}

// ============================================
// sessionStorage（ログインユーザーのDBキャッシュ）
// ============================================

export function getSessionFavorites(): string[] {
  return readArray(safeSession(), SESSION_KEY);
}

export function setSessionFavorites(slugs: string[]): void {
  writeArray(safeSession(), SESSION_KEY, slugs);
}

export function clearSessionFavorites(): void {
  const storage = safeSession();
  if (!storage) return;
  try {
    storage.removeItem(SESSION_KEY);
  } catch {
    // 無視
  }
}

export const FAVORITES_LIMIT = MAX_FAVORITES;
