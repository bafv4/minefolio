import { Link } from "react-router";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import { Badge } from "@/components/ui/badge";
import { useT, useLocale } from "@/hooks/use-locale";
import { getLocalizedDisplayName } from "@/lib/slug";
import { categoryLabel, isCategoryKey } from "@/lib/playstyle";
import { formatRelativeDate } from "@/lib/relative-time";
import type { ProfileFeedCardPlayer } from "@/components/profile-feed-card";
import { Clock3, TrendingUp } from "lucide-react";

/** 「最近の更新」「よく見られている」用のコンパクト行（アバター・名前・メインカテゴリ・右端に時刻/閲覧数） */
export function CompactProfileList({
  title,
  players,
  mode,
}: {
  title: string;
  players: ProfileFeedCardPlayer[];
  mode: "recent" | "popular";
}) {
  const t = useT();
  const locale = useLocale();
  return (
    <div className="min-w-0 space-y-2">
      <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
      <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70 bg-card">
        {players.map((p) => (
          <li key={p.slug}>
            <Link
              to={`/player/${p.slug}`}
              prefetch="intent"
              // 行の高さはカテゴリ（2行目）の有無によらず 2行分（h-14 = 56px）で揃え、1行だけの行は上下中央に置く
              className="flex h-14 items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <MinecraftAvatar uuid={p.uuid} skinUrl={p.customSkinUrl} mcid={p.mcid} size={32} className="shrink-0 rounded-lg" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{getLocalizedDisplayName(p, locale)}</span>
                {isCategoryKey(p.mainCategory) && (
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Badge variant="secondary" className="rounded-full px-1.5 py-0 text-[11px]">
                      {categoryLabel(t, p.mainCategory)}
                    </Badge>
                  </span>
                )}
              </span>
              <span className="ml-auto flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                {mode === "popular" ? (
                  <>
                    <TrendingUp className="h-3 w-3" aria-hidden="true" />
                    {t("home.views7d", { count: p.pageViews7d ?? 0 })}
                  </>
                ) : (
                  <>
                    <Clock3 className="h-3 w-3" aria-hidden="true" />
                    <span suppressHydrationWarning>{formatRelativeDate(t, p.updatedAt)}</span>
                  </>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
