import { Link, useLocation } from "react-router";
import { Table2, LayoutGrid, BarChart3 } from "lucide-react";
import { createSerializer } from "nuqs";
import { cn } from "@/lib/utils";
import { keybindingsParsers } from "@/lib/keybindings-search-params";
import { useKeybindingsFilters } from "@/hooks/use-keybindings-filters";
import { useTabNavigation } from "@/hooks/use-tab-navigation";
import { useT } from "@/hooks/use-locale";
import type { MessageKey } from "@/lib/messages";

type Item = {
  path: string;
  /** ラベルは描画時に t() で解決する（モジュール評価時はロケールが未確定） */
  labelKey: MessageKey;
  icon: typeof Table2;
  /** フィルタ等の検索パラメータを引き継ぐか（表・ビジュアルのみ） */
  keepSearch: boolean;
};

const ITEMS: Item[] = [
  { path: "/keybindings", labelKey: "keybindings.viewTable", icon: Table2, keepSearch: true },
  { path: "/keybindings/visual", labelKey: "keybindings.viewVisual", icon: LayoutGrid, keepSearch: true },
  { path: "/keybindings/stats", labelKey: "keybindings.viewStats", icon: BarChart3, keepSearch: false },
];

// nuqs のパラメータ → クエリ文字列。nuqs の shallow 更新は React Router の
// location に反映されないため、useLocation().search ではなく現在のパラメータから再構築する。
const serialize = createSerializer(keybindingsParsers);

/**
 * ビュー切替（表 / ビジュアル / 統計）。別ページへのリンク列（nav ＋ aria-current）。
 * タブではなくセグメント（`rounded-lg bg-secondary/50 p-0.5`、選択中だけ `bg-background` ＋ shadow）。
 * brand の上端線は下段のフォルダ型タブ（表の中身の切替）だけが持つので、ここでは使わない。
 * ページタイトル行の右に置く（`KeybindingsPageTitle` の `trailing`）。
 */
export function ViewSwitcher() {
  const t = useT();
  const location = useLocation();
  const { params } = useKeybindingsFilters();
  const search = serialize(params);
  // タブ切替中は遷移先を先行してアクティブ表示する（コンテンツ側はスケルトン表示）
  const { targetPathname } = useTabNavigation();
  const activePath = ITEMS.some((i) => i.path === targetPathname)
    ? targetPathname
    : location.pathname;

  return (
    // 表・ビジュアル・統計は別ページへのリンクなので、tablist ではなく nav ＋ aria-current
    <nav
      data-slot="view-switcher"
      aria-label={t("keybindings.viewSwitcher")}
      className="flex w-full gap-0.5 rounded-lg bg-secondary/50 p-0.5 sm:w-auto"
    >
      {ITEMS.map((item) => {
        const isActive = activePath === item.path;
        const Icon = item.icon;
        // 表・ビジュアル間はフィルタ（users/数値/tab）を維持する
        const to = item.keepSearch ? { pathname: item.path, search } : item.path;
        return (
          <Link
            key={item.path}
            to={to}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 text-sm font-medium transition-colors sm:min-h-8 sm:flex-none",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
              isActive
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4" aria-hidden />
            <span>{t(item.labelKey)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
