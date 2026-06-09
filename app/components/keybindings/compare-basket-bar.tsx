// 画面下部固定の「比較 (N) [見る]」バー。ids が 1 件以上で表示。
import { GitCompareArrows, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useCompareBasket } from "@/hooks/use-compare-basket";
import { useKeybindingsFilters } from "@/hooks/use-keybindings-filters";

export function CompareBasketBar() {
  const basket = useCompareBasket();
  const { setView, params } = useKeybindingsFilters();

  // 比較ビュー表示中は重複表示を避けて非表示
  if (basket.count === 0 || params.view === "compare") return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40">
      <div className="flex items-center gap-3 bg-card border shadow-lg rounded-full px-4 py-2">
        <Badge variant="default" className="gap-1">
          <GitCompareArrows className="h-3 w-3" />
          比較 {basket.count}
        </Badge>
        <div className="flex flex-wrap items-center gap-1 max-w-xs">
          {basket.ids.map((slug) => (
            <button
              key={slug}
              type="button"
              onClick={() => basket.remove(slug)}
              className="inline-flex items-center gap-1 bg-secondary text-secondary-foreground text-xs px-2 py-0.5 rounded-full hover:bg-secondary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`${slug} を比較から外す`}
            >
              {slug}
              <X className="h-3 w-3" aria-hidden />
            </button>
          ))}
        </div>
        <Button
          size="sm"
          onClick={() => setView("compare")}
          className="rounded-full"
        >
          比較する
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => basket.clear()}
          className="rounded-full px-2"
          aria-label="すべて外す"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
