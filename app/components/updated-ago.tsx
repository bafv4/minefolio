import { useT } from "@/hooks/use-locale";
import { useRelativeTimeFormatter } from "@/components/relative-time";

/**
 * マイガイド／マイテンプレートの行の「更新: …」。水和の前後で変わる暦日の判定をこの葉に閉じ込め、
 * 水和の直後に一覧全体が再描画されないようにする
 */
export function UpdatedAgo({ date }: { date: Date | string | number }) {
  const t = useT();
  const format = useRelativeTimeFormatter();
  return <span suppressHydrationWarning>{t("meGuides.updatedAgo", { time: format(date) })}</span>;
}
