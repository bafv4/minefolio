import { TrendingUp } from "lucide-react";
import { useT } from "@/hooks/use-locale";
import { PAGE_VIEW_WINDOW_DAYS } from "@/lib/page-view-paths";

/**
 * 直近7日のページビュー数（人気順の根拠数値）。ガイドカード（`guide-list-views.tsx`）・
 * プロフィールカード（`profile-feed-card.tsx`）で共有する小さな表示パーツ。
 * 0 でも表示する（なぜ下位にいるのかが分かるため）。
 */
export function PageViews7dMeta({ count }: { count: number }) {
  const t = useT();
  const label = t("common.pageViews7d", { days: PAGE_VIEW_WINDOW_DAYS });
  return (
    <span className="flex shrink-0 items-center gap-1" title={label}>
      <TrendingUp className="h-3 w-3" aria-hidden />
      <span className="sr-only">{label}</span>
      {count}
    </span>
  );
}
