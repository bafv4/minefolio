import { Link, useLocation } from "react-router";
import { Table2, LayoutGrid, BarChart3 } from "lucide-react";
import { createSerializer } from "nuqs";
import { cn } from "@/lib/utils";
import { keybindingsParsers } from "@/lib/keybindings-search-params";
import { useKeybindingsFilters } from "@/hooks/use-keybindings-filters";

type Item = {
  path: string;
  label: string;
  icon: typeof Table2;
  /** フィルタ等の検索パラメータを引き継ぐか（表・ビジュアルのみ） */
  keepSearch: boolean;
};

const ITEMS: Item[] = [
  { path: "/keybindings", label: "表", icon: Table2, keepSearch: true },
  { path: "/keybindings/visual", label: "ビジュアル", icon: LayoutGrid, keepSearch: true },
  { path: "/keybindings/stats", label: "統計", icon: BarChart3, keepSearch: false },
];

// nuqs のパラメータ → クエリ文字列。nuqs の shallow 更新は React Router の
// location に反映されないため、useLocation().search ではなく現在のパラメータから再構築する。
const serialize = createSerializer(keybindingsParsers);

export function ViewSwitcher() {
  const location = useLocation();
  const { params } = useKeybindingsFilters();
  const search = serialize(params);

  return (
    <div
      role="tablist"
      aria-label="ビュー切替"
      className="inline-flex items-end gap-1 border-b border-border"
    >
      {ITEMS.map((item) => {
        const isActive = location.pathname === item.path;
        const Icon = item.icon;
        // 表・ビジュアル間はフィルタ（users/数値/tab）を維持する
        const to = item.keepSearch
          ? { pathname: item.path, search }
          : item.path;
        return (
          <Link
            key={item.path}
            to={to}
            role="tab"
            aria-selected={isActive}
            className={cn(
              "relative -mb-px inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-t-lg border border-transparent px-3 text-sm font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
              "before:pointer-events-none before:absolute before:inset-x-2 before:top-0 before:h-0.5 before:rounded-full",
              isActive
                ? "border-border border-b-transparent bg-background text-foreground before:bg-brand"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4" aria-hidden />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </div>
  );
}
