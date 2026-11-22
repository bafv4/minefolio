import { useT } from "@/hooks/use-locale";
import { ContentTabs } from "@/components/content-tabs";
import { Activity, Heart } from "lucide-react";

/**
 * /favorites（お気に入り走者）と /favorites/activity（動き）を行き来するルート間ナビ。
 * ページ内タブ（Tabs）ではなくリンクなので、ページ間のタブ（ContentTabs。現在ページは aria-current="page"）で示す。
 */
export function FavoritesNav({ current }: { current: "favorites" | "activity" }) {
  const t = useT();
  return (
    <ContentTabs
      active={current}
      label={t("favorites.navLabel")}
      tabs={[
        { key: "favorites", to: "/favorites", label: t("favorites.navFavorites"), icon: Heart },
        { key: "activity", to: "/favorites/activity", label: t("favorites.navActivity"), icon: Activity },
      ]}
    />
  );
}
