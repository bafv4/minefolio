import { useT } from "@/hooks/use-locale";
import { useHydrated } from "@/hooks/use-hydrated";
import { formatRelativeDate, formatRelativeTimeInHours, formatRelativeTimeInMinutes } from "@/lib/relative-time";

type RelativeTimeUnit = "date" | "hours" | "minutes";

type RelativeTimeProps = {
  date: Date | string | number;
  /** date: 日単位 / hours: 時間単位（24時間以上は暦日）/ minutes: 分単位（24時間以上は暦日）。既定は minutes */
  unit?: RelativeTimeUnit;
  className?: string;
};

/**
 * SSR 安全な相対時刻の整形関数を返す。`t(...)` に文字列として埋め込む所（部品にできない所）で使う。
 * 水和済みかどうか（`useHydrated()`）と `calendar` オプションを束ねているので、呼び出し側は渡し忘れない。
 */
export function useRelativeTimeFormatter(): (date: Date | string | number, unit?: RelativeTimeUnit) => string {
  const t = useT();
  const options = { calendar: useHydrated() };
  return (date, unit = "minutes") =>
    unit === "date"
      ? formatRelativeDate(t, date, options)
      : unit === "hours"
        ? formatRelativeTimeInHours(t, new Date(date), options)
        : formatRelativeTimeInMinutes(t, new Date(date), options);
}

/**
 * SSR 安全な相対時刻。暦日はタイムゾーンに依存するため、SSR と水和は経過日数で描き（サーバー UTC とクライアントで一致）、
 * 水和後に端末の暦日へ切り替える。呼び出し側で suppressHydrationWarning や mounted を書かない。
 */
export function RelativeTime({ date, unit = "minutes", className }: RelativeTimeProps) {
  const format = useRelativeTimeFormatter();
  return (
    <span className={className} suppressHydrationWarning>
      {format(date, unit)}
    </span>
  );
}
