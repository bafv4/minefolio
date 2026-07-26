import { Link } from "react-router";
import { cn } from "@/lib/utils";
import { useTabScrollbar } from "@/hooks/use-tab-scrollbar";
import { useTabNavigation } from "@/hooks/use-tab-navigation";
import { BookOpen, LayoutTemplate, type LucideIcon } from "lucide-react";
import { useT } from "@/hooks/use-locale";

export type ContentTab = {
  key: string;
  to: string;
  label: string;
  icon: LucideIcon;
};

/**
 * ページ間を行き来するタブ型ナビゲーション（フォルダタブ調）。
 * 外側 nav の border-b が全幅ベースライン、内側スクローラーを -mb-px で 1px 重ね、
 * アクティブタブの bg がベースラインを覆ってページ面に開く（ui/tabs.tsx と同じ機構）。
 * タブは横スクロール可能（狭い画面でも見切れない）。
 */
export function ContentTabs({ tabs, active }: { tabs: ContentTab[]; active: string }) {
  const { scrollerRef, scrollbar, isScrollable } = useTabScrollbar();
  // タブ切替中は遷移先を先行してアクティブ表示する（コンテンツ側はスケルトン表示）
  const { targetPathname } = useTabNavigation();
  const activeKey =
    (targetPathname && tabs.find((tab) => tab.to === targetPathname)?.key) || active;
  return (
    <nav className="flex w-full items-end border-b border-border">
      {/* relative ラッパ: カスタムスクロールバーの位置基準。-mb-px でベースラインに 1px 重ねる */}
      <div className="relative -mb-px min-w-0 flex-1">
      <div
        ref={scrollerRef}
        className={cn(
          "flex items-end gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          // スクロールが必要なときだけ、上側にスクロールバーの余白を確保
          isScrollable && "pt-2.5",
        )}
      >
        {tabs.map(({ key, to, label, icon: Icon }) => (
          <Link
            key={key}
            to={to}
            aria-current={activeKey === key ? "page" : undefined}
            className={cn(
              "relative inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-t-lg border border-border px-3.5 text-sm font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
              "before:pointer-events-none before:absolute before:inset-x-2 before:top-0 before:h-0.5 before:rounded-full",
              activeKey === key
                ? "border-b-transparent bg-background text-foreground before:bg-brand"
                : "bg-muted/50 text-muted-foreground hover:bg-muted/80 hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </Link>
        ))}
      </div>
      {scrollbar}
      </div>
    </nav>
  );
}

/** 自分の公開コンテンツ（ガイド / サーチクラフトテンプレート）管理ページ間のタブ */
export function MyContentTabs({ active }: { active: "guides" | "templates" }) {
  const t = useT();
  return (
    <ContentTabs
      active={active}
      tabs={[
        { key: "guides", to: "/my-guides", label: t("meGuides.tabGuides"), icon: BookOpen },
        { key: "templates", to: "/my-guides/templates", label: t("meGuides.tabTemplates"), icon: LayoutTemplate },
      ]}
    />
  );
}

/** 公開ガイド一覧 / 公開テンプレート一覧間のタブ */
export function GuidesContentTabs({ active }: { active: "guides" | "templates" }) {
  const t = useT();
  return (
    <ContentTabs
      active={active}
      tabs={[
        { key: "guides", to: "/guides", label: t("guides.tabGuides"), icon: BookOpen },
        { key: "templates", to: "/guides/templates", label: t("guides.tabTemplates"), icon: LayoutTemplate },
      ]}
    />
  );
}
