// 相対日付の表示ユーティリティ（日単位・時間単位）。相対時刻の単一の入口（date-fns の formatDistanceToNow は使わない）。
// 1日未満は分・時間の経過時間、日単位以上は暦日（昨日・N日前…）で数えて、同じ出来事が画面ごとに別の言い方にならないようにする。
// player-card / profile-feed-card に重複していた実装を集約。
// 分単位の表示は formatRelativeTimeInMinutes（ペースカード・PaceMan統計カード等）。
//
// 暦日は端末のタイムゾーンに依存する（SSR のサーバーは UTC、クライアントは JST 等で境界がずれる）。
// SSR で描く箇所は直接呼ばず <RelativeTime>（@/components/relative-time）を使う。SSR と水和は経過日数
// （タイムゾーンに依らない版: calendar: false）で描き、マウント後に暦日へ切り替える。

import type { Translator } from "@/lib/messages";

/** 端末のローカル暦日で、now が date の何日後か（未来は 0 にクランプ）。夏時間でずれないよう round で丸める。 */
function calendarDaysAgo(date: Date | string | number, now: Date = new Date()): number {
  const d = new Date(date);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  return Math.max(0, Math.round((startOf(now) - startOf(d)) / (1000 * 60 * 60 * 24)));
}

/** 経過日数（now - date を 24 時間単位で切り捨て。タイムゾーンに依らない。未来は 0）。SSR / 水和用。 */
function elapsedDaysAgo(date: Date | string | number, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(date).getTime()) / (1000 * 60 * 60 * 24)));
}

/** 日数の数え方。calendar: true（既定）は端末の暦日、false は経過日数（SSR・水和時に使う）。 */
export type RelativeTimeOptions = { calendar?: boolean };

/** 暦日数を表記にする（今日 / 昨日 / N日前 / N週間前 / Nか月前 / N年前）。日単位以上の表記はここに集約する。 */
function formatCalendarDays(t: Translator, days: number): string {
  if (days === 0) return t("relativeDate.today");
  if (days === 1) return t("relativeDate.yesterday");
  if (days < 7) return t("relativeDate.daysAgo", { count: days });
  if (days < 30) return t("relativeDate.weeksAgo", { count: Math.floor(days / 7) });
  if (days < 365) return t("relativeDate.monthsAgo", { count: Math.floor(days / 30) });
  return t("relativeDate.yearsAgo", { count: Math.floor(days / 365) });
}

/** 日単位の相対表記（今日 / 昨日 / N日前 / N週間前 / Nか月前 / N年前）。暦日（端末の日付変更）で数える。 */
export function formatRelativeDate(
  t: Translator,
  date: Date | string | number,
  { calendar = true }: RelativeTimeOptions = {},
): string {
  return formatCalendarDays(t, calendar ? calendarDaysAgo(date) : elapsedDaysAgo(date));
}

/** 時間単位の相対表記（1時間以内 / N時間前、24時間以上は暦日表記）。動画フィード等で使用。 */
export function formatRelativeTimeInHours(t: Translator, date: Date | string, options?: RelativeTimeOptions): string {
  const hoursAgo = Math.floor((Date.now() - new Date(date).getTime()) / (1000 * 60 * 60));
  if (hoursAgo < 1) return t("home.justWithinHour");
  if (hoursAgo < 24) return t("playerStats.hoursAgo", { count: hoursAgo });
  return formatRelativeDate(t, date, options);
}

/** 分単位の相対表記（たった今 / N分前 / N時間前、24時間以上は暦日表記）。PaceMan統計カード等、分単位の精度が要る用途向け。 */
export function formatRelativeTimeInMinutes(t: Translator, date: Date | string, options?: RelativeTimeOptions): string {
  const diffMs = Date.now() - new Date(date).getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMinutes / 60);

  if (diffMinutes < 1) return t("playerStats.justNow");
  if (diffMinutes < 60) return t("playerStats.minutesAgo", { count: diffMinutes });
  if (diffHours < 24) return t("playerStats.hoursAgo", { count: diffHours });
  return formatRelativeDate(t, date, options);
}
