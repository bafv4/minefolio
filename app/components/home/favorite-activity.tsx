import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import { ProfileFeedCard, type ProfileFeedCardPlayer } from "@/components/profile-feed-card";
import { EmptyState } from "@/components/empty-state";
import { HomeSection } from "@/components/home/home-section";
import { useFavorites } from "@/hooks/use-favorites";
import { useT, useLocale } from "@/hooks/use-locale";
import { pickDisplayName } from "@/lib/slug";
import { formatClock } from "@/lib/home-format";
import { formatRelativeTimeInMinutes } from "@/lib/relative-time";
import type { FavoriteActivityItem, FavoriteActivityResult } from "@/lib/home-favorite-activity.server";
import { AlertCircle, BookOpen, Heart, History, Play, RefreshCw, UserRound } from "lucide-react";

const KIND_ICON = {
  pace: History,
  video: Play,
  guide: BookOpen,
  profile: UserRound,
} as const;

/**
 * 「お気に入りの動き」欄（縦タイムライン・新しい順 10 件）。
 * ログイン済み: サーバーのお気に入りを使う（本文なしで POST）。未ログイン: ブラウザのお気に入りを POST の本文で送る
 * （URL に載せない）。未ログインでお気に入りが無い（または Cookie 未同意で空の）ときは欄ごと出さない。
 */
export function FavoriteActivity({
  isRegistered,
  recommended,
}: {
  isRegistered: boolean;
  /** お気に入り 0 人のときに勧める、よく見られている走者（最大3人） */
  recommended: ProfileFeedCardPlayer[];
}) {
  const t = useT();
  const locale = useLocale();
  const { favorites } = useFavorites();
  const favoritesKey = favorites.join(",");
  const [state, setState] = useState<
    { status: "loading" } | { status: "error" } | { status: "done"; data: FavoriteActivityResult }
  >({ status: "loading" });
  const [retryNonce, setRetryNonce] = useState(0);

  const shouldShow = isRegistered || favorites.length > 0;

  useEffect(() => {
    if (!shouldShow) return;
    let cancelled = false;
    setState((s) => (s.status === "done" ? s : { status: "loading" }));
    fetch("/api/home-favorite-activity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // ログイン済みはサーバー側のお気に入りが使われる（本文は無視される）
      body: JSON.stringify({ slugs: isRegistered ? [] : favorites }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<FavoriteActivityResult>;
      })
      .then((data) => {
        if (!cancelled) setState({ status: "done", data });
      })
      .catch((err) => {
        console.error("Failed to fetch favorite activity:", err);
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
    // favorites は配列の同一性ではなく内容（favoritesKey）で再取得する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldShow, isRegistered, favoritesKey, retryNonce]);

  const sentence = useCallback(
    (item: FavoriteActivityItem): string => {
      const name = pickDisplayName(item, locale) || item.mcid || item.slug;
      switch (item.kind) {
        case "pace":
          // 区間名（英語の PaceMan 語彙）を日本語の文に埋め込むと不自然なので、ラベル: 値 の形にする。完走だけは文で言う
          return item.label === "Finish"
            ? t("home.favPaceFinish", { name, time: formatClock(item.timeMs ?? 0) })
            : t("home.favPace", { name, split: item.label ?? "", time: formatClock(item.timeMs ?? 0) });
        case "video":
          return t("home.favVideo", { name, title: item.label ?? "" });
        case "guide":
          return t("home.favGuide", { name, title: item.label ?? "" });
        case "profile":
          return t("home.favProfile", { name });
      }
    },
    [t, locale],
  );

  if (!shouldShow) return null;

  return (
    <HomeSection id="home-favorites" icon={<Heart className="h-5 w-5 text-favorite" />} title={t("home.favTitle")} viewAllTo="/favorites">
      {state.status === "loading" ? (
        <div className="space-y-2" aria-hidden="true">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-11 rounded-lg" />
          ))}
        </div>
      ) : state.status === "error" ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm text-destructive"
        >
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0">{t("home.favFetchFailed")}</span>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto min-h-11 shrink-0 sm:min-h-8"
            onClick={() => setRetryNonce((n) => n + 1)}
          >
            <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            {t("home.feedRetry")}
          </Button>
        </div>
      ) : state.data.favoritesCount === 0 ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("home.favEmpty")}</p>
          {recommended.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {recommended.map((p) => (
                <ProfileFeedCard key={p.slug} player={p} />
              ))}
            </div>
          ) : (
            <EmptyState icon={<Heart className="h-12 w-12" />} title={t("home.favEmpty")} description="" />
          )}
        </div>
      ) : state.data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("home.favNoActivity")}</p>
      ) : (
        <ol className="relative space-y-1 before:absolute before:bottom-4 before:left-[17px] before:top-4 before:w-px before:bg-border/60">
          {state.data.items.map((item, i) => {
            const Icon = KIND_ICON[item.kind];
            return (
              <li key={`${item.kind}-${item.slug}-${item.at}-${i}`}>
                <Link
                  to={item.href}
                  prefetch="intent"
                  className="relative flex min-h-11 items-center gap-3 rounded-lg px-0 py-1.5 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="relative z-10 shrink-0 rounded-lg bg-card">
                    <MinecraftAvatar uuid={item.uuid} skinUrl={item.customSkinUrl} mcid={item.mcid} size={36} className="rounded-lg" />
                  </span>
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-sm">{sentence(item)}</span>
                  <span className="ml-auto shrink-0 pr-1 text-xs text-muted-foreground" suppressHydrationWarning>
                    {formatRelativeTimeInMinutes(t, new Date(item.at))}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </HomeSection>
  );
}
