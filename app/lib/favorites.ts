// お気に入りプレイヤーをCookieで管理するユーティリティ

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
