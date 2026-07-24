// 相対日付の表示ユーティリティ（日単位・時間単位）。
// player-card / profile-feed-card に重複していた実装を集約。
// ※ ライブペース等の分単位表示は用途が異なるため別実装（recent-pace-card 等）。

import { t } from "@/lib/messages";

/** 日単位の相対表記（今日 / 昨日 / N日前 / N週間前 / Nヶ月前 / N年前）。 */
export function formatRelativeDate(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - new Date(date).getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "今日";
  if (diffDays === 1) return "昨日";
  if (diffDays < 7) return `${diffDays}日前`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}週間前`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}ヶ月前`;
  return `${Math.floor(diffDays / 365)}年前`;
}

/** 時間単位の相対表記（1時間以内 / N時間前 / N日前）。動画フィード等で使用。 */
export function formatRelativeTimeInHours(date: Date | string): string {
  const hoursAgo = Math.floor((Date.now() - new Date(date).getTime()) / (1000 * 60 * 60));
  if (hoursAgo < 1) return t("home.justWithinHour");
  if (hoursAgo < 24) return t("playerStats.hoursAgo", { count: hoursAgo });
  return t("playerStats.daysAgo", { count: Math.floor(hoursAgo / 24) });
}
