import { Skeleton } from "@/components/ui/skeleton";

/**
 * タブ切替中にコンテンツ領域へ表示する汎用スケルトン。
 * variant は遷移先のレイアウトに合わせて選ぶ:
 * - cards: カードグリッド（ビジュアルビュー・統計・ガイドカード等）
 * - list:  行リスト（ガイド管理・テンプレート一覧等）
 * - table: 表（キーバインド表等）
 */
export function TabContentSkeleton({
  variant = "cards",
}: {
  variant?: "cards" | "list" | "table";
}) {
  if (variant === "list") {
    return (
      <div className="space-y-3" aria-busy="true">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 rounded-xl border p-4">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="h-8 w-20" />
          </div>
        ))}
      </div>
    );
  }
  if (variant === "table") {
    return (
      <div className="space-y-2" aria-busy="true">
        <Skeleton className="h-9 w-full" />
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="overflow-hidden rounded-xl border">
          <Skeleton className="h-36 w-full" />
          <div className="space-y-2 p-4">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}
