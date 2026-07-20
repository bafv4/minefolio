import { Link } from "react-router";
import { cn } from "@/lib/utils";
import { BookOpen, LayoutTemplate, type LucideIcon } from "lucide-react";
import { t } from "@/lib/messages";

export type ContentTab = {
  key: string;
  to: string;
  label: string;
  icon: LucideIcon;
};

/** ページ間を行き来するタブ型ナビゲーション（フォルダタブ調） */
export function ContentTabs({ tabs, active }: { tabs: ContentTab[]; active: string }) {
  return (
    <nav className="flex w-full items-end gap-1 border-b border-border">
      {tabs.map(({ key, to, label, icon: Icon }) => (
        <Link
          key={key}
          to={to}
          aria-current={active === key ? "page" : undefined}
          className={cn(
            "relative -mb-px inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-t-lg border border-transparent px-3.5 text-sm font-medium transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
            "before:pointer-events-none before:absolute before:inset-x-2 before:top-0 before:h-0.5 before:rounded-full",
            active === key
              ? "border-border border-b-transparent bg-background text-foreground before:bg-brand"
              : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
          )}
        >
          <Icon className="h-4 w-4 shrink-0" />
          {label}
        </Link>
      ))}
    </nav>
  );
}

/** 自分の公開コンテンツ（ガイド / サーチクラフトテンプレート）管理ページ間のタブ */
export function MyContentTabs({ active }: { active: "guides" | "templates" }) {
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
