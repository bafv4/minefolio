import { Skeleton } from "@/components/ui/skeleton";
import { ProfileFeedCard, type ProfileFeedCardPlayer } from "@/components/profile-feed-card";
import { EmptyState } from "@/components/empty-state";
import { FavoriteActivityRow, ACTIVITY_TIMELINE_CLASS } from "@/components/favorite-activity-row";
import { PageSection } from "@/components/page-section";
import { FeedErrorNotice } from "@/components/home/feed-error-notice";
import { useFavoriteActivity } from "@/hooks/use-favorite-activity";
import { useT } from "@/hooks/use-locale";
import { cn } from "@/lib/utils";
import { Heart } from "lucide-react";

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

  // 取得が終わってお気に入りが0人のときだけ、動きの欄ではなく走者を勧める欄として見出しを切り替える
  const noFavorites = state.status !== "loading" && state.status !== "error" && state.data.favoritesCount === 0;

  return (
    <PageSection id="home-favorites" icon={<Heart className="h-5 w-5 text-favorite" />} title={t(noFavorites ? "home.favFindTitle" : "home.favTitle")} viewAllTo={noFavorites ? "/browse" : "/favorites/activity"}>
      {state.status === "loading" ? (
        <div className="space-y-2" aria-hidden="true">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-11 rounded-lg" />
          ))}
        </div>
      ) : state.status === "error" ? (
        <FeedErrorNotice message={t("home.favFetchFailed")} onRetry={retry} />
      ) : state.data.favoritesCount === 0 ? (
        // 勧める走者がいれば「お気に入りがいない」の文＋カード、いなければ空状態のみ（同じ文を2回出さない）
        recommended.length > 0 ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{t("home.favEmpty")}</p>
            {/* sm 未満: 横レール（ライブ欄と同じ作法。ホバーの浮きと影が切れないよう余白を取り負マージンで打ち消す。
                カード幅 83% で次のカードの端を覗かせる）。sm 以上: 3 列グリッド */}
            <ul
              className={cn(
                "-mx-2 -mt-2 flex snap-x snap-mandatory scroll-px-2 gap-4 overflow-x-auto px-2 pt-2 pb-3",
                "sm:mx-0 sm:mt-0 sm:grid sm:snap-none sm:grid-cols-3 sm:overflow-visible sm:p-0",
              )}
            >
              {recommended.map((p) => (
                <li key={p.slug} className="flex w-[83%] shrink-0 snap-start flex-col sm:w-auto">
                  <ProfileFeedCard player={p} showFavoriteButton className="flex-1" />
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <EmptyState icon={<Heart className="h-12 w-12" />} title={t("home.favEmpty")} description="" />
        )
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
    </PageSection>
  );
}
