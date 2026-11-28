import { createTranslator } from "@/lib/messages";
import { useLoaderData, Link } from "react-router";
import type { Route } from "./+types/favorites";
import { useEffect, useRef, useState } from "react";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getOptionalSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users, favorites } from "@/lib/schema";
import { asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { getLocalFavorites } from "@/lib/favorites-client";
import { ProfileFeedCard, ProfileFeedCardSkeleton, type ProfileFeedCardPlayer } from "@/components/profile-feed-card";
import { FavoritesNav } from "@/components/favorites-nav";
import { FavoritesCookieAlert, FavoritesEmptyState } from "@/components/favorites-shared";
import { FeedErrorNotice } from "@/components/home/feed-error-notice";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Heart, ArrowLeft } from "lucide-react";
import { useCookieConsent } from "@/components/cookie-consent";
import { useT } from "@/hooks/use-locale";
import { useFavorites } from "@/hooks/use-favorites";
import { localeFromMatches } from "@/lib/locale";

type FavoritePlayer = ProfileFeedCardPlayer;

// 一覧取得で必要な列（ProfileFeedCard の描画に必要な最小限。browse-query.server.ts の
// BROWSE_LIST_COLUMNS と揃える）
const favoritePlayer = alias(users, "favorite_player");
const FAVORITE_PLAYER_SELECT = {
  mcid: favoritePlayer.mcid,
  uuid: favoritePlayer.uuid,
  slug: favoritePlayer.slug,
  displayName: favoritePlayer.displayName,
  displayNameAlphabet: favoritePlayer.displayNameAlphabet,
  pronouns: favoritePlayer.pronouns,
  role: favoritePlayer.role,
  mainEdition: favoritePlayer.mainEdition,
  mainPlatform: favoritePlayer.mainPlatform,
  customSkinUrl: favoritePlayer.customSkinUrl,
  updatedAt: favoritePlayer.updatedAt,
  shortBio: favoritePlayer.shortBio,
};

export const meta: Route.MetaFunction = ({ loaderData, matches }) => {
  const t = createTranslator(localeFromMatches(matches));
  const title = t("favorites.metaTitle");
  const description = t("favorites.description");
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
  const appUrl = env.APP_URL || "https://minefolio.app";
  const db = createDb();
  const auth = createAuth(db, env);

  const session = await getOptionalSession(request, auth);
  if (!session) {
    // 未ログイン: クライアント側で localStorage → /api/users/by-slugs を呼ぶ
    return { players: [] as FavoritePlayer[], isLoggedIn: false, appUrl };
  }

  // 本人の行 → favorites → お気に入り先の users を1回の JOIN で引く（slug 一覧 → users IN の2往復を1往復に）。
  // 本人の行が無い（users 未登録）ときは0行 = 未ログイン扱い。お気に入りが無いときは favorite_player が全て null の1行。
  // 並びは favoriteSlug の辞書順。実在しない slug（孤児行）は favorite_player が null になるので落とす
  const rows = await db
    .select(FAVORITE_PLAYER_SELECT)
    .from(users)
    .leftJoin(favorites, eq(favorites.userId, users.id))
    .leftJoin(favoritePlayer, eq(favoritePlayer.slug, favorites.favoriteSlug))
    .where(eq(users.discordId, session.user.id))
    .orderBy(asc(favorites.favoriteSlug));
  if (rows.length === 0) {
    return { players: [] as FavoritePlayer[], isLoggedIn: false, appUrl };
  }
  const players = rows.filter((p): p is typeof p & FavoritePlayer => p.slug !== null);

  return { players, isLoggedIn: true, appUrl };
}

export default function FavoritesPage() {
  const t = useT();
  const { players: ssrPlayers, isLoggedIn } = useLoaderData<typeof loader>();
  const { hasConsent, acceptCookies } = useCookieConsent();
  const { isFavorite } = useFavorites();

  // 未ログイン時はクライアント側で localStorage → /api/users/by-slugs を呼んで詳細取得
  const [guestPlayers, setGuestPlayers] = useState<FavoritePlayer[]>([]);
  const [guestLoading, setGuestLoading] = useState(false);
  // 取得に失敗したとき（空の一覧と区別して、再試行を出す）。retryNonce は再試行で effect を取り直すための値
  const [guestFailed, setGuestFailed] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // 再試行が成功したら見出しへフォーカスを戻す（押した再試行ボタンが消えるため）
  const focusHeadingAfterLoad = useRef(false);

  useEffect(() => {
    if (isLoggedIn) return;
    if (hasConsent !== true) {
      setGuestPlayers([]);
      setGuestFailed(false);
      return;
    }
    const slugs = getLocalFavorites();
    if (slugs.length === 0) {
      setGuestPlayers([]);
      setGuestFailed(false);
      return;
    }
    setGuestLoading(true);
    setGuestFailed(false);
    fetch("/api/users/by-slugs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slugs }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && Array.isArray(data.users)) {
          // 入力順を維持
          const bySlug = new Map<string, FavoritePlayer>(
            (data.users as FavoritePlayer[]).map((u) => [u.slug, u]),
          );
          setGuestPlayers(slugs.map((s) => bySlug.get(s)).filter((u): u is FavoritePlayer => u != null));
          if (focusHeadingAfterLoad.current) {
            focusHeadingAfterLoad.current = false;
            // 描画（一覧への切り替え）の後にフォーカスする
            requestAnimationFrame(() => headingRef.current?.focus());
          }
        } else {
          setGuestFailed(true);
        }
      })
      .catch(() => setGuestFailed(true))
      .finally(() => setGuestLoading(false));
  }, [isLoggedIn, hasConsent, retryNonce]);

  const players = isLoggedIn ? ssrPlayers : guestPlayers;
  const showCookieAlert = !isLoggedIn && hasConsent === false;
  const isLoadingList = !isLoggedIn && guestLoading;
  const showFailure = !isLoggedIn && guestFailed && !guestLoading;
  // 見出しの件数は実際にお気に入りの数（外した後は減る。カードは再読み込みまで残す）。ゲストの読み込み中・失敗中は出さない
  const favoriteCount = players.filter((p) => isFavorite(p.slug)).length;
  const showCount = !isLoadingList && !showFailure;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-bold flex items-center gap-2 outline-none">
            <Heart className="h-6 w-6 text-favorite fill-current" aria-hidden />
            {t("favorites.title")}
          </h1>
          <p className="min-h-5 text-sm text-muted-foreground">
            {showCount ? t("favorites.totalCountWithNumber", { count: favoriteCount }) : null}
          </p>
        </div>
        {/* 副次の導線なので目立たせない（全幅の主ボタン級にしない） */}
        <Button asChild variant="ghost" size="sm" className="self-start min-h-11 text-muted-foreground sm:self-auto sm:min-h-8">
          <Link to="/">
            <ArrowLeft className="h-4 w-4 mr-2" aria-hidden />
            {t("common.backToHome")}
          </Link>
        </Button>
      </div>

      <FavoritesNav current="favorites" />

      {/* Cookie未承諾の警告（未ログインのみ） */}
      {showCookieAlert && <FavoritesCookieAlert onAccept={acceptCookies} />}

      {isLoadingList ? (
        <FavoriteCardSkeletonGrid />
      ) : showFailure ? (
        <FeedErrorNotice
          message={t("home.favFetchFailed")}
          onRetry={() => {
            focusHeadingAfterLoad.current = true;
            setRetryNonce((n) => n + 1);
          }}
        />
      ) : players.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {players.map((player) => (
            // 外してもカードはその場に残る（ハートが空になるだけ。もう一度押せば戻せる＝取り消し）。
            // 一覧は再読み込みまで変えない（並びの slug 順を保ち、押した直後にカードが消えて位置がずれるのを避ける）
            <ProfileFeedCard key={player.slug} player={player} showFavoriteButton surface="card" />
          ))}
        </div>
      ) : (
        <FavoritesEmptyState cookieBlocked={showCookieAlert} />
      )}

      {!isLoggedIn && (
        <p className="text-xs text-muted-foreground text-center">
          {t("favorites.cookieNotice")}
        </p>
      )}
    </div>
  );
}

// HydrateFallback とゲスト読み込み中（clientの by-slugs フェッチ）の両方で共有する。
function FavoriteCardSkeletonGrid() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <ProfileFeedCardSkeleton key={i} surface="card" />
      ))}
    </div>
  );
}

export function HydrateFallback() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          {/* 見出し h1（32px）+ 件数の行 min-h-5（20px）。mb は付けない（実物は行間なし） */}
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-5 w-64" />
        </div>
        <Skeleton className="h-11 w-28 self-start sm:h-8 sm:self-auto" />
      </div>
      {/* FavoritesNav（ContentTabs）の帯の高さ */}
      <Skeleton className="h-11 w-full max-w-xs sm:h-9" />
      <FavoriteCardSkeletonGrid />
    </div>
  );
}
