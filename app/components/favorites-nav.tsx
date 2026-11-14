import { Link } from "react-router";
import { useT } from "@/hooks/use-locale";
import { cn } from "@/lib/utils";
import { Activity, Heart } from "lucide-react";

/**
 * /favorites（お気に入り走者）と /favorites/activity（動き）を行き来するルート間ナビ。
 * ページ内タブ（Tabs）ではなくリンクなので、現在ページは aria-current="page" で示す。
 */
export function FavoritesNav({ current }: { current: "favorites" | "activity" }) {
  const t = useT();
  const items = [
    { key: "favorites", to: "/favorites", label: t("favorites.navFavorites"), Icon: Heart },
    { key: "activity", to: "/favorites/activity", label: t("favorites.navActivity"), Icon: Activity },
  ] as const;
  return (
    <nav aria-label={t("favorites.navLabel")} className="flex flex-wrap gap-2">
      {items.map(({ key, to, label, Icon }) => {
        const active = key === current;
        return (
          <Link
            key={key}
            to={to}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9",
              active
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border/70 bg-background/75 text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
