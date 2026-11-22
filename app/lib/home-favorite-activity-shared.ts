// お気に入りの動き（ホーム / 一覧ページ）の期間・件数の定数。クライアントからも値として使うため .server にしない。

export const DAY_MS = 24 * 60 * 60 * 1000;
/** ホーム欄の既定 */
export const FAVORITE_ACTIVITY_LIMIT = 10;
export const FAVORITE_ACTIVITY_WINDOW_DAYS = 7;
/** 一覧ページ（/favorites/activity）の指定値。ペースの保持期間（2か月）に収まる範囲 */
export const FAVORITE_ACTIVITY_PAGE_LIMIT = 100;
export const FAVORITE_ACTIVITY_PAGE_WINDOW_DAYS = 30;
/** クライアント指定の上限（これを超える指定はサーバーでクランプする） */
export const FAVORITE_ACTIVITY_MAX_LIMIT = 100;
export const FAVORITE_ACTIVITY_MAX_WINDOW_DAYS = 30;
/** 1回の問い合わせで扱うお気に入りの上限（POST 本文の肥大化対策） */
export const FAVORITE_SLUGS_MAX = 100;
