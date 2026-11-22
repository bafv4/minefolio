import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * マイガイド／マイテンプレートのタブ切替中に表示する行のスケルトン（Card ＋ 状態ピルのタイトル行 ＋ メタ行 ＋ 右端の操作。
 * 本物と同じ 80px）。`template` はマイテンプレートの行（メタ行が下に増え、モバイルは操作が下の段になる）。
 */
export function TabContentSkeleton({ template = false }: { template?: boolean }) {
  // 行の高さは my-guides/index.tsx・templates.tsx の本物の値から写している:
  // Card（py-0・border）＋ CardContent p-4 ＋ タイトル行（StatusPill の高さ 26px）＋ メタ行（text-xs の 16px）
  // ＋ 右端の操作（sm 以上は 32px 四方、モバイルは 44px 四方）。タイトル行とメタ行の間はガイドが mb-1、テンプレートが 6px
  return (
    <div className="space-y-3" aria-busy="true" aria-hidden>
      {Array.from({ length: 5 }).map((_, i) => (
        <Card key={i} className="py-0">
          <CardContent
            className={cn(
              "p-4",
              !template && "flex items-start gap-3 sm:items-center sm:gap-4",
            )}
          >
            <div
              className={cn(
                template && "flex flex-col gap-3 sm:flex-row sm:items-center",
                !template && "contents",
              )}
            >
              <div className={cn("min-w-0 flex-1", template && "space-y-1.5")}>
                <div className={cn("flex h-[26px] items-center gap-2", !template && "mb-1")}>
                  <Skeleton className="h-5 w-1/3" />
                  <Skeleton className="h-[26px] w-16 rounded-full" />
                </div>
                <Skeleton className={cn("h-4", template ? "w-2/3" : "w-1/2")} />
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
