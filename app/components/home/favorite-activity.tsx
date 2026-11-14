import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ProfileFeedCard, type ProfileFeedCardPlayer } from "@/components/profile-feed-card";
import { EmptyState } from "@/components/empty-state";
import { FavoriteActivityRow, ACTIVITY_TIMELINE_CLASS } from "@/components/favorite-activity-row";
import { HomeSection } from "@/components/home/home-section";
import { useFavoriteActivity } from "@/hooks/use-favorite-activity";
import { useT } from "@/hooks/use-locale";
import { AlertCircle, Heart, RefreshCw } from "lucide-react";

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
  const { state, shouldFetch: shouldShow, retry } = useFavoriteActivity({ isRegistered });

  if (!shouldShow) return null;

  return (
    <HomeSection id="home-favorites" icon={<Heart className="h-5 w-5 text-favorite" />} title={t("home.favTitle")} viewAllTo="/favorites/activity">
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
            onClick={retry}
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
        <ol className={ACTIVITY_TIMELINE_CLASS}>
          {state.data.items.map((item, i) => (
            <li key={`${item.kind}-${item.slug}-${item.at}-${i}`}>
              <FavoriteActivityRow item={item} />
            </li>
          ))}
        </ol>
      )}
    </HomeSection>
  );
}
