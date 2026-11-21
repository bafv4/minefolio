import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

/**
 * タブ切替中にコンテンツ領域へ表示する汎用スケルトン。
 * variant は遷移先のレイアウトに合わせて選ぶ:
 * - cards: カードグリッド（ビジュアルビュー・統計・ガイドカード等）
 * - list:  マイガイドの行（Card ＋ 状態ピルのタイトル行 ＋ メタ行 ＋ 右端の操作。本物と同じ 80px）
 * - templateList: マイテンプレートの行（同上。メタ行が下に増え、モバイルは操作が下の段になる）
 * - table: 表（キーバインド表等）
 */
export function TabContentSkeleton({
  variant = "cards",
}: {
  variant?: "cards" | "list" | "templateList" | "table";
}) {
  // 行の高さは my-guides/index.tsx・templates.tsx の本物の値から写している:
  // Card（py-0・border）＋ CardContent p-4 ＋ タイトル行（StatusPill の高さ 26px）＋ メタ行（text-xs の 16px）
  // ＋ 右端の操作（sm 以上は 32px 四方、モバイルは 44px 四方）。タイトル行とメタ行の間は list が mb-1、templateList が 6px
  if (variant === "list") {
    return (
      <div className="space-y-3" aria-busy="true" aria-hidden>
        {Array.from({ length: 5 }).map((_, i) => (
          <Card key={i} className="py-0">
            <CardContent className="flex items-start gap-3 p-4 sm:items-center sm:gap-4">
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex h-[26px] items-center gap-2">
                  <Skeleton className="h-5 w-1/3" />
                  <Skeleton className="h-[26px] w-16 rounded-full" />
                </div>
                <Skeleton className="h-4 w-1/2" />
              </div>
              <div className="flex shrink-0 items-center gap-3 sm:gap-2">
                <Skeleton className="size-11 sm:size-8" />
                <Skeleton className="size-11 sm:size-8" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }
  if (variant === "templateList") {
    return (
      <div className="space-y-3" aria-busy="true" aria-hidden>
        {Array.from({ length: 5 }).map((_, i) => (
          <Card key={i} className="py-0">
            <CardContent className="p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex h-[26px] items-center gap-2">
                    <Skeleton className="h-5 w-1/3" />
                    <Skeleton className="h-[26px] w-16 rounded-full" />
                  </div>
                  <Skeleton className="h-4 w-2/3" />
                </div>
                <div className="flex shrink-0 items-center gap-3 sm:gap-2">
                  <Skeleton className="size-11 sm:size-8" />
                  <Skeleton className="size-11 sm:size-8" />
                </div>
              </div>
            </CardContent>
          </Card>
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
        <div key={i} className="overflow-hidden rounded-xl border border-border/70 bg-background/80">
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
