import { createTranslator } from "@/lib/messages";
import { useLoaderData } from "react-router";
import type { Route } from "./+types/favorites-activity";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getOptionalSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { localeFromMatches } from "@/lib/locale";
import { FAVORITE_ACTIVITY_PAGE_LIMIT, FAVORITE_ACTIVITY_PAGE_WINDOW_DAYS } from "@/lib/home-favorite-activity-shared";
import type { FavoriteActivityItem } from "@/lib/home-favorite-activity.server";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { FavoritesNav } from "@/components/favorites-nav";
import { FavoritesCookieAlert, FavoritesEmptyState } from "@/components/favorites-shared";
import { FeedErrorNotice } from "@/components/home/feed-error-notice";
import { FavoriteActivityRow, ACTIVITY_TIMELINE_CLASS } from "@/components/favorite-activity-row";
import { StatusPill } from "@/components/status-pill";
import { useCookieConsent } from "@/components/cookie-consent";
import { useFavoriteActivity } from "@/hooks/use-favorite-activity";
import { useT, useLocale } from "@/hooks/use-locale";
import { Activity } from "lucide-react";

export const meta: Route.MetaFunction = ({ loaderData, matches }) => {
  const t = createTranslator(localeFromMatches(matches));
  const title = t("favorites.activityMetaTitle");
  const description = t("favorites.activityDescription", { days: FAVORITE_ACTIVITY_PAGE_WINDOW_DAYS });
  const appUrl = loaderData?.appUrl || "https://minefolio.app";
  const ogImage = `${appUrl}/icon.png`;
  return [
    { title },
    { name: "description", content: description },
    { property: "og:type", content: "website" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:image", content: ogImage },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: ogImage },
  ];
};

export async function loader({ request }: Route.LoaderArgs) {
  const env = getEnv();
  const db = createDb();
  const auth = createAuth(db, env);
  const session = await getOptionalSession(request, auth);
  return { isLoggedIn: !!session, appUrl: env.APP_URL || "https://minefolio.app" };
}

/** ローカル日付（端末のタイムゾーン）ごとにまとめる。items は新しい順 */
function groupByDay(items: FavoriteActivityItem[]) {
  const groups: { key: string; at: number; items: FavoriteActivityItem[] }[] = [];
  for (const item of items) {
    const d = new Date(item.at);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(item);
    else groups.push({ key, at: item.at, items: [item] });
  }
  return groups;
}

export default function FavoritesActivityPage() {
  const t = useT();
  const locale = useLocale();
  const { isLoggedIn } = useLoaderData<typeof loader>();
  const { hasConsent, acceptCookies } = useCookieConsent();
  const { state, shouldFetch, favoritesLoading, retry } = useFavoriteActivity({
    isRegistered: isLoggedIn,
    windowDays: FAVORITE_ACTIVITY_PAGE_WINDOW_DAYS,
    limit: FAVORITE_ACTIVITY_PAGE_LIMIT,
  });

  const dayLabel = (at: number) => {
    const d = new Date(at);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
    const date = d.toLocaleDateString(locale, { month: "long", day: "numeric", weekday: "short" });
    if (same(d, today)) return `${t("relativeDate.today")} (${date})`;
    if (same(d, yesterday)) return `${t("relativeDate.yesterday")} (${date})`;
    return date;
  };

  const showCookieAlert = !isLoggedIn && hasConsent === false;
  const loading = shouldFetch ? state.status === "loading" : favoritesLoading;
  const count = state.status === "done" ? state.data.items.length : null;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-3">
          {/* /favorites と同じ形（素のアイコン＋h1）。丸背景のアイコンチップは公開一覧ページのヘッダだけ（ui.md 13章） */}
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="h-6 w-6" aria-hidden="true" />
            {t("favorites.activityTitle")}
          </h1>
          {count != null && count > 0 && (
            <StatusPill>{t("favorites.activityCount", { count })}</StatusPill>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {t("favorites.activityDescription", { days: FAVORITE_ACTIVITY_PAGE_WINDOW_DAYS })}
        </p>
      </div>

      <FavoritesNav current="activity" />

      {showCookieAlert && <FavoritesCookieAlert onAccept={acceptCookies} />}

      {loading ? (
        <ActivitySkeleton />
      ) : !shouldFetch || (state.status === "done" && state.data.favoritesCount === 0) ? (
        <FavoritesEmptyState cookieBlocked={showCookieAlert} />
      ) : state.status === "error" ? (
        <FeedErrorNotice message={t("home.favFetchFailed")} onRetry={retry} />
      ) : state.status === "done" && state.data.items.length === 0 ? (
        <EmptyState
          icon={<Activity className="h-12 w-12" />}
          title={t("favorites.activityNone", { days: FAVORITE_ACTIVITY_PAGE_WINDOW_DAYS })}
          description={t("favorites.activityNoneHelp")}
        />
      ) : state.status === "done" ? (
        <div className="space-y-6">
          {groupByDay(state.data.items).map((group) => (
            <section key={group.key} aria-labelledby={`fav-activity-${group.key}`} className="space-y-2">
              <h2 id={`fav-activity-${group.key}`} className="text-sm font-semibold text-muted-foreground">
                {dayLabel(group.at)}
              </h2>
              <ol className={ACTIVITY_TIMELINE_CLASS}>
                {group.items.map((item, i) => (
                  <li key={`${item.kind}-${item.slug}-${item.at}-${i}`}>
                    <FavoriteActivityRow item={item} time="clock" />
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ActivitySkeleton() {
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={i} className="h-11 rounded-lg" />
      ))}
    </div>
  );
}

export function HydrateFallback() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-10 w-72" />
      <Skeleton className="h-11 w-64 rounded-b-none sm:h-9" />
      <ActivitySkeleton />
    </div>
  );
}
