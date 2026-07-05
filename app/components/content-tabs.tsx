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

/** ページ間を行き来するタブ型ナビゲーション（セグメント切替調） */
export function ContentTabs({ tabs, active }: { tabs: ContentTab[]; active: string }) {
  return (
    <div className="flex rounded-lg border bg-card p-0.5 gap-0.5 w-fit">
      {tabs.map(({ key, to, label, icon: Icon }) => (
        <Link
          key={key}
          to={to}
          aria-current={active === key ? "page" : undefined}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            active === key
              ? "bg-secondary text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="h-4 w-4 shrink-0" />
          {label}
        </Link>
      ))}
    </div>
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
