// 相対日付の表示ユーティリティ（日単位・時間単位）。
// player-card / profile-feed-card に重複していた実装を集約。
// ※ ライブペース等の分単位表示は用途が異なるため別実装（pace-feed-card 等）。

import type { Translator } from "@/lib/messages";

/** 日単位の相対表記（今日 / 昨日 / N日前 / N週間前 / Nヶ月前 / N年前）。 */
export function formatRelativeDate(t: Translator, date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - new Date(date).getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return t("relativeDate.today");
  if (diffDays === 1) return t("relativeDate.yesterday");
  if (diffDays < 7) return t("relativeDate.daysAgo", { count: diffDays });
  if (diffDays < 30) return t("relativeDate.weeksAgo", { count: Math.floor(diffDays / 7) });
  if (diffDays < 365) return t("relativeDate.monthsAgo", { count: Math.floor(diffDays / 30) });
  return t("relativeDate.yearsAgo", { count: Math.floor(diffDays / 365) });
}

/** 時間単位の相対表記（1時間以内 / N時間前 / N日前）。動画フィード等で使用。 */
export function formatRelativeTimeInHours(t: Translator, date: Date | string): string {
  const hoursAgo = Math.floor((Date.now() - new Date(date).getTime()) / (1000 * 60 * 60));
  if (hoursAgo < 1) return t("home.justWithinHour");
  if (hoursAgo < 24) return t("playerStats.hoursAgo", { count: hoursAgo });
  return t("playerStats.daysAgo", { count: Math.floor(hoursAgo / 24) });
}

/** 分単位の相対表記（たった今 / N分前 / N時間前 / N日前）。PaceMan統計カード等、分単位の精度が要る用途向け。 */
export function formatRelativeTimeInMinutes(t: Translator, date: Date | string): string {
  const diffMs = Date.now() - new Date(date).getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMinutes / 60);

  if (diffMinutes < 1) return t("playerStats.justNow");
  if (diffMinutes < 60) return t("playerStats.minutesAgo", { count: diffMinutes });
  if (diffHours < 24) return t("playerStats.hoursAgo", { count: diffHours });
  return t("playerStats.daysAgo", { count: Math.floor(diffHours / 24) });
}
