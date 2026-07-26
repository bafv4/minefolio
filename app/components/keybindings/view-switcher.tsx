import type { ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { Table2, LayoutGrid, BarChart3 } from "lucide-react";
import { createSerializer } from "nuqs";
import { cn } from "@/lib/utils";
import { keybindingsParsers } from "@/lib/keybindings-search-params";
import { useKeybindingsFilters } from "@/hooks/use-keybindings-filters";
import { useTabScrollbar } from "@/hooks/use-tab-scrollbar";
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
 * ビュー切替タブ（表 / ビジュアル / 統計）。
 * 全幅のベースライン行として描画され、`actions` に渡した要素（件数表示・
 * フィルターボタン等）は同じ行の右端・ベースラインの上に並ぶ。
 * タブ部分は横スクロール可能（狭い画面でも見切れない）。
 * 仕組みは ui/tabs.tsx と同じ: 行の border-b がベースライン、スクローラーを
 * -mb-px で 1px 重ね、アクティブタブの bg がベースラインを覆ってページ面に開く。
 */
export function ViewSwitcher({ actions }: { actions?: ReactNode }) {
  const t = useT();
  const location = useLocation();
  const { params } = useKeybindingsFilters();
  const search = serialize(params);
  const { scrollerRef, scrollbar, isScrollable } = useTabScrollbar();
  // タブ切替中は遷移先を先行してアクティブ表示する（コンテンツ側はスケルトン表示）
  const { targetPathname } = useTabNavigation();
  const activePath = ITEMS.some((i) => i.path === targetPathname)
    ? targetPathname
    : location.pathname;

  return (
    <div className="flex w-full items-end gap-3 border-b border-border">
      {/* relative ラッパ: カスタムスクロールバーの位置基準。-mb-px で行の
          ベースラインに 1px 重ね、アクティブタブの bg が線を覆う */}
      <div className="relative -mb-px min-w-0 flex-1">
      <div
        ref={scrollerRef}
        role="tablist"
        aria-label={t("keybindings.viewSwitcher")}
        className={cn(
          "flex items-end gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          // スクロールが必要なときだけ、上側にスクロールバーの余白を確保
          isScrollable && "pt-2.5",
        )}
      >
        {ITEMS.map((item) => {
          const isActive = activePath === item.path;
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
                "relative inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-t-lg border border-border px-3 text-sm font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                "before:pointer-events-none before:absolute before:inset-x-2 before:top-0 before:h-0.5 before:rounded-full",
                isActive
                  ? "border-b-transparent bg-background text-foreground before:bg-brand"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted/80 hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" aria-hidden />
              <span>{t(item.labelKey)}</span>
            </Link>
          );
        })}
      </div>
      {scrollbar}
      </div>
      {actions && (
        // タブ列ラッパと同じ h-9 + -mb-px に固定 — actions の有無で行の高さ（＝タブの位置）が変わらないようにする
        <div className="-mb-px flex h-9 shrink-0 items-center gap-3">{actions}</div>
      )}
    </div>
  );
}
