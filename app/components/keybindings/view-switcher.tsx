import { Table2, LayoutGrid, BarChart3, GitCompareArrows } from "lucide-react";
import { cn } from "@/lib/utils";
import { useKeybindingsFilters } from "@/hooks/use-keybindings-filters";
import type { View } from "@/lib/keybindings-search-params";

type Item = {
  value: View;
  label: string;
  icon: typeof Table2;
  badgeCount?: number;
  disabled?: boolean;
};

export function ViewSwitcher({
  compareCount = 0,
  hideGrid = true,
}: {
  /** 比較バスケットに入っている件数 */
  compareCount?: number;
  /** Grid ビューを非表示にするか（Phase 4 まで未実装のため既定で隠す） */
  hideGrid?: boolean;
}) {
  const { params, setView } = useKeybindingsFilters();

  const items: Item[] = [
    { value: "table", label: "表", icon: Table2 },
    { value: "grid", label: "カード", icon: LayoutGrid, disabled: hideGrid },
    { value: "stats", label: "統計", icon: BarChart3 },
    {
      value: "compare",
      label: "比較",
      icon: GitCompareArrows,
      badgeCount: compareCount,
    },
  ];

  return (
    <div
      role="tablist"
      aria-label="ビュー切替"
      className="inline-flex items-center rounded-lg border bg-card p-1 gap-0.5"
    >
      {items
        .filter((item) => !item.disabled)
        .map((item) => {
          const isActive = params.view === item.value;
          const Icon = item.icon;
          return (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setView(item.value)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isActive
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/50",
              )}
            >
              <Icon className="h-4 w-4" aria-hidden />
              <span>{item.label}</span>
              {item.badgeCount != null && item.badgeCount > 0 && (
                <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-semibold text-brand-foreground">
                  {item.badgeCount}
                </span>
              )}
            </button>
          );
        })}
    </div>
  );
}
