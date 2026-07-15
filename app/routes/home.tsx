import { useLoaderData, Link, useNavigate } from "react-router";
import { useEffect, useReducer, memo, useMemo } from "react";
import type { Route } from "./+types/home";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getOptionalSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users, guides } from "@/lib/schema";
import { excludeViewersCondition } from "@/lib/users-filter";
import { eq, desc, and, gte, sql } from "drizzle-orm";
import { type CachedPace } from "@/components/recent-pace-card";
import type { CachedYouTubeVideo } from "@/lib/youtube-cache";
import { ProfileFeedCard } from "@/components/profile-feed-card";
import { Button } from "@/components/ui/button";
import { GuideCardGrid, type GuideItem } from "@/components/guide-list-views";
import { Skeleton } from "@/components/ui/skeleton";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import { PaceFeedCard } from "@/components/pace-feed-card";
import { formatDistanceToNow } from "date-fns";
import { ja } from "date-fns/locale";
import { t } from "@/lib/messages";
import {
  ArrowRight,
  Play,
  Compass,
  UserCheck,
  History,
  Sparkles,
  Users,
  Activity,
  Youtube,
  BookOpen,
  Shuffle,
} from "lucide-react";

export const meta: Route.MetaFunction = ({ loaderData }) => {
  const appUrl = loaderData?.appUrl || "https://minefolio.app";
  const title = t("home.title");
  const description = t("home.heroDescription");
  const ogImageUrl = `${appUrl}/og-image?type=home`;

  return [
    { title },
    { name: "description", content: description },

    // Open Graph
    { property: "og:type", content: "website" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:image", content: ogImageUrl },
    { property: "og:image:type", content: "image/png" },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { property: "og:url", content: appUrl },

    // Twitter Card
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: ogImageUrl },
  ];
};

export async function loader({ request }: Route.LoaderArgs) {
  const env = getEnv();
  const db = createDb();
  const auth = createAuth(db, env);

  // セッションをチェックしてユーザーが登録済みか確認
  const session = await getOptionalSession(request, auth);
  let isRegistered = false;
  let currentUser: { mcid: string | null; showPacemanOnHome: boolean; showYoutubeOnHome: boolean } | null = null;
  if (session) {
    const existingUser = await db.query.users.findFirst({
      where: eq(users.discordId, session.user.id),
      columns: {
        id: true,
        mcid: true,
        showPacemanOnHome: true,
        showYoutubeOnHome: true,
      },
    });
    if (existingUser) {
      isRegistered = true;
      currentUser = {
        mcid: existingUser.mcid,
        showPacemanOnHome: existingUser.showPacemanOnHome ?? true,
        showYoutubeOnHome: existingUser.showYoutubeOnHome ?? true,
      };
    }
  }

  // 登録ユーザーのMCIDとUUIDを取得（MCIDがあるユーザーのみ - PaceMan連携用）
  const allUserMcids = await db.query.users.findMany({
    columns: { mcid: true, uuid: true, customSkinUrl: true },
  });
  const mcidToUuid = Object.fromEntries(
    allUserMcids
      .filter((u) => u.mcid !== null)
      .map((u) => [u.mcid!.toLowerCase(), u.uuid])
  );
  const mcidToSkinUrl = Object.fromEntries(
    allUserMcids
      .filter((u) => u.mcid !== null && u.customSkinUrl !== null)
      .map((u) => [u.mcid!.toLowerCase(), u.customSkinUrl!])
  );

  // 最近更新されたプロフィール（公開設定のみ、視聴者ロール除外、最新4件）
  const recentlyUpdatedUsers = await db.query.users.findMany({
    where: and(
      eq(users.profileVisibility, "public"),
      excludeViewersCondition,
    ),
    columns: {
      mcid: true,
      uuid: true,
      slug: true,
      displayName: true,
      pronouns: true,
      role: true,
      mainEdition: true,
      mainPlatform: true,
      inputMethodBadge: true,
      updatedAt: true,
      shortBio: true,
      customSkinUrl: true,
    },
    orderBy: [desc(users.updatedAt)],
    limit: 4,
  });

  // 最近更新されたガイド（公開済み、最新4件）
  const recentGuides = await db
    .select({
      id: guides.id,
      slug: guides.slug,
      title: guides.title,
      summary: guides.summary,
      tags: guides.tags,
      coverImageUrl: guides.coverImageUrl,
      viewCount: guides.viewCount,
      updatedAt: guides.updatedAt,
      authorSlug: users.slug,
      authorDisplayName: users.displayName,
      authorMcid: users.mcid,
    })
    .from(guides)
    .innerJoin(users, eq(guides.authorId, users.id))
    .where(eq(guides.isPublished, true))
    .orderBy(desc(guides.updatedAt))
    .limit(4);

  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  const totalPublicProfilesResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(users)
    .where(and(eq(users.profileVisibility, "public"), excludeViewersCondition));
  const totalPublicProfiles = totalPublicProfilesResult[0]?.count ?? 0;

  const activePublicProfilesResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(users)
    .where(
      and(
        eq(users.profileVisibility, "public"),
        gte(users.updatedAt, oneWeekAgo),
        excludeViewersCondition,
      )
    );
  const activePublicProfiles = activePublicProfilesResult[0]?.count ?? 0;

  return {
    appUrl: env.APP_URL || "https://minefolio.app",
    isRegistered,
    currentUser,
    mcidToUuid,
    mcidToSkinUrl,
    recentlyUpdatedUsers,
    recentGuides,
    totalPublicProfiles,
    activePublicProfiles,
  };
}

// APIレスポンスの型定義
interface YouTubeVideosResponse {
  recentVideos: CachedYouTubeVideo[];
}

interface RecentPacesResponse {
  recentPaces: CachedPace[];
  mcidToUuid: Record<string, string>;
  mcidToDisplayName: Record<string, string>;
}

// Feed状態管理用のReducer
interface FeedState {
  recentVideos: CachedYouTubeVideo[];
  recentPaces: CachedPace[];
  mcidToUuid: Record<string, string>;
  mcidToDisplayName: Record<string, string>;
  loading: {
    videos: boolean;
    paces: boolean;
  };
  errors: {
    videos: boolean;
    paces: boolean;
  };
}

type FeedAction =
  | { type: "SET_VIDEOS"; payload: CachedYouTubeVideo[] }
  | { type: "SET_PACES"; payload: { recentPaces: CachedPace[]; mcidToUuid?: Record<string, string>; mcidToDisplayName?: Record<string, string> } }
  | { type: "SET_ERROR"; payload: keyof FeedState["errors"] };

const initialFeedState: FeedState = {
  recentVideos: [],
  recentPaces: [],
  mcidToUuid: {},
  mcidToDisplayName: {},
  loading: {
    videos: true,
    paces: true,
  },
  errors: {
    videos: false,
    paces: false,
  },
};

function feedReducer(state: FeedState, action: FeedAction): FeedState {
  switch (action.type) {
    case "SET_VIDEOS":
      return {
        ...state,
        recentVideos: action.payload,
        loading: { ...state.loading, videos: false },
      };
    case "SET_PACES":
      return {
        ...state,
        recentPaces: action.payload.recentPaces,
        mcidToUuid: action.payload.mcidToUuid
          ? { ...state.mcidToUuid, ...action.payload.mcidToUuid }
          : state.mcidToUuid,
        mcidToDisplayName: action.payload.mcidToDisplayName
          ? { ...state.mcidToDisplayName, ...action.payload.mcidToDisplayName }
          : state.mcidToDisplayName,
        loading: { ...state.loading, paces: false },
      };
    case "SET_ERROR":
      return {
        ...state,
        errors: { ...state.errors, [action.payload]: true },
        loading: { ...state.loading, [action.payload]: false },
      };
    default:
      return state;
  }
}

function formatVideoTime(date: Date): string {
  const now = Date.now();
  const hoursAgo = Math.floor((now - new Date(date).getTime()) / (1000 * 60 * 60));

  if (hoursAgo < 1) return t("home.justWithinHour");
  if (hoursAgo < 24) return t("playerStats.hoursAgo", { count: hoursAgo });
  return t("playerStats.daysAgo", { count: Math.floor(hoursAgo / 24) });
}

function HomeVideoFeedCard({ video }: { video: CachedYouTubeVideo }) {
  const thumbnailUrl = video.thumbnailUrl || `https://i.ytimg.com/vi/${video.videoId}/mqdefault.jpg`;
  const videoUrl = `https://www.youtube.com/watch?v=${video.videoId}`;
  const showName = video.displayName || video.channelTitle || "Unknown";

  return (
    <div
      className="group relative overflow-hidden rounded-2xl border border-border/70 bg-background/80 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-sm"
    >
      <a
        href={videoUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="absolute inset-0 z-0 rounded-2xl"
        aria-label={video.title}
      />
      <div className="relative aspect-video overflow-hidden bg-muted">
        <img src={thumbnailUrl} alt={video.title} className="h-full w-full object-cover" loading="lazy" />
        <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/65 px-2 py-0.5 text-[11px] font-medium text-white">
          <Youtube className="h-3 w-3" />
          YouTube
        </span>
      </div>

      <div className="space-y-3 p-4">
        <h3 className="line-clamp-2 text-sm font-semibold leading-snug transition-colors group-hover:text-primary">
          {video.title}
        </h3>
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          {video.slug ? (
            <Link to={`/player/${video.slug}`} prefetch="intent" className="relative z-10 inline-flex min-w-0 items-center gap-2 hover:text-primary transition-colors">
              {video.uuid ? (
                <MinecraftAvatar uuid={video.uuid} skinUrl={video.customSkinUrl} size={20} className="rounded-md" />
              ) : video.discordAvatar ? (
                <img src={video.discordAvatar} alt={showName} className="h-5 w-5 rounded-md" />
              ) : (
                <div className="h-5 w-5 rounded-md bg-muted" />
              )}
              <span className="truncate">{showName}</span>
            </Link>
          ) : (
            <span className="truncate">{showName}</span>
          )}
          <span className="shrink-0">{formatVideoTime(video.publishedAt)}</span>
        </div>
      </div>
    </div>
  );
}

// セクション全体のローディングスケルトン（memo化）
const SectionSkeleton = memo(function SectionSkeleton({ columns = 4 }: { columns?: number }) {
  const gridColsClass =
    columns === 3 ? "lg:grid-cols-3" :
      columns === 4 ? "lg:grid-cols-4" :
        "lg:grid-cols-4";

  return (
    <section className="space-y-5 rounded-3xl border border-border/70 bg-card/70 p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <Skeleton className="h-9 w-9 rounded-xl" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-24 rounded" />
          <Skeleton className="h-6 w-40 rounded" />
        </div>
      </div>
      <div className={`grid grid-cols-1 md:grid-cols-2 ${gridColsClass} gap-4`}>
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
    </section>
  );
});

export default function HomePage() {
  const {
    isRegistered,
    currentUser,
    mcidToUuid,
    mcidToSkinUrl,
    recentlyUpdatedUsers,
    recentGuides,
    totalPublicProfiles,
    activePublicProfiles,
  } =
    useLoaderData<typeof loader>();

  const [feed, dispatch] = useReducer(feedReducer, initialFeedState);
  const navigate = useNavigate();

  // 「ランダムで見る」をAlt(Option)キー押下中にクリックすると隠しページへ。
  // Shift(新規ウィンドウ)/Ctrl・Cmd(新規タブ)やテキスト選択と競合しないAltを使用。
  const handleRandomClick = (e: React.MouseEvent) => {
    if (e.altKey) {
      e.preventDefault();
      navigate("/secret-grid");
    }
  };

  // フィルタリング
  const filteredRecentPaces = useMemo(() =>
    currentUser?.showPacemanOnHome === false && currentUser?.mcid
      ? feed.recentPaces.filter(run => run.mcid.toLowerCase() !== currentUser.mcid!.toLowerCase())
      : feed.recentPaces,
    [feed.recentPaces, currentUser?.showPacemanOnHome, currentUser?.mcid]
  );

  const filteredRecentVideos = useMemo(() =>
    currentUser?.showYoutubeOnHome === false && currentUser?.mcid
      ? feed.recentVideos.filter(video =>
        !video.minefolioMcid || video.minefolioMcid.toLowerCase() !== currentUser.mcid!.toLowerCase()
      )
      : feed.recentVideos,
    [feed.recentVideos, currentUser?.showYoutubeOnHome, currentUser?.mcid]
  );

  const pacesMcidToUuid = feed.mcidToUuid;
  const pacesMcidToDisplayName = feed.mcidToDisplayName;

  // 遅延読み込み（Promise.allで並列化）
  useEffect(() => {
    Promise.all([
      // YouTube動画
      fetch("/api/home-feed?type=youtube-videos")
        .then((res) => res.json() as Promise<YouTubeVideosResponse>)
        .then((data) => {
          dispatch({ type: "SET_VIDEOS", payload: data.recentVideos || [] });
        })
        .catch((err) => {
          console.error("Failed to fetch YouTube videos:", err);
          dispatch({ type: "SET_ERROR", payload: "videos" });
        }),

      // 最近のペース
      fetch("/api/home-feed?type=recent-paces")
        .then((res) => res.json() as Promise<RecentPacesResponse>)
        .then((data) => {
          dispatch({
            type: "SET_PACES",
            payload: {
              recentPaces: data.recentPaces || [],
              mcidToUuid: data.mcidToUuid,
              mcidToDisplayName: data.mcidToDisplayName,
            },
          });
        })
        .catch((err) => {
          console.error("Failed to fetch recent paces:", err);
          dispatch({ type: "SET_ERROR", payload: "paces" });
        }),
    ]);
  }, []);

  // mcidToUuidをマージ
  const mergedMcidToUuid = { ...mcidToUuid, ...pacesMcidToUuid };

  return (
    <div className="relative flex-1 space-y-7 sm:space-y-8">
      <div
        className="pointer-events-none absolute inset-x-0 -top-12 -z-10 h-80 rounded-[2.5rem] opacity-70 blur-2xl"
        style={{
          background:
            "radial-gradient(60% 60% at 20% 20%, color-mix(in oklch, var(--info) 28%, transparent), transparent), radial-gradient(50% 50% at 80% 30%, color-mix(in oklch, var(--success) 30%, transparent), transparent)",
        }}
      />

      <section className="relative overflow-hidden rounded-3xl border border-border/70 bg-card/80 p-6 shadow-sm sm:p-8">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,color-mix(in_oklch,var(--border)_40%,transparent)_1px,transparent_1px),linear-gradient(to_bottom,color-mix(in_oklch,var(--border)_35%,transparent)_1px,transparent_1px)] bg-[size:26px_26px] opacity-25" />
        <div className="relative grid gap-7 lg:grid-cols-[1.3fr_1fr] lg:items-end">
          <div className="space-y-5">
            <span className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/75 px-3 py-1 text-xs font-medium text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              {t("home.heroBadge")}
            </span>
            <div className="space-y-3">
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl lg:text-4xl">
                {t("home.heroTitle")}
              </h1>
              <p className="max-w-xl text-base text-muted-foreground sm:text-lg">
                {t("home.heroDescription")}
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              {!isRegistered && (
                <Button asChild size="lg" className="w-full sm:w-auto">
                  <Link to="/login">
                    {t("home.ctaStart")}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              )}
              <Button asChild size="lg" variant="outline" className="w-full sm:w-auto">
                <Link to="/browse">
                  <Compass className="mr-2 h-4 w-4" />
                  {t("home.ctaBrowse")}
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="w-full sm:w-auto">
                <Link to="/random-player" onClick={handleRandomClick}>
                  <Shuffle className="mr-2 h-4 w-4" />
                  {t("home.ctaRandom")}
                </Link>
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
              <p className="text-xs text-muted-foreground">{t("home.profileTotal")}</p>
              <p className="mt-2 text-2xl font-bold">{totalPublicProfiles}</p>
            </div>
            <div className="rounded-2xl border border-border/70 bg-background/80 p-4">
              <p className="text-xs text-muted-foreground">{t("home.profileActive")}</p>
              <p className="mt-2 text-2xl font-bold">{activePublicProfiles}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-5 rounded-3xl border border-border/70 bg-card/70 p-5 sm:p-6">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-primary/10 p-2">
            <UserCheck className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{t("home.profilesLabel")}</p>
            <h2 className="text-xl font-bold">{t("home.sectionProfiles")}</h2>
          </div>
        </div>
        {recentlyUpdatedUsers.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
              {recentlyUpdatedUsers.map((user) => (
                <ProfileFeedCard key={user.slug} player={user} />
              ))}
            </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-border/70 bg-background/60 py-16 text-center text-muted-foreground">
            <Users className="mx-auto mb-2 h-12 w-12 opacity-30" />
            <p>{t("home.noProfiles")}</p>
          </div>
        )}
      </section>

      {recentGuides.length > 0 && (
        <section className="space-y-5 rounded-3xl border border-border/70 bg-card/70 p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-primary/10 p-2">
              <BookOpen className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{t("home.guideFeedLabel")}</p>
              <h2 className="text-xl font-bold">{t("home.sectionGuides")}</h2>
            </div>
            <Button variant="ghost" size="sm" asChild className="ml-auto">
              <Link to="/guides">
                {t("home.viewAll")}
                <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
          <GuideCardGrid
            guides={recentGuides.map((g) => ({
              ...g,
              authorName: g.authorDisplayName || g.authorMcid || g.authorSlug,
              _authorSlug: g.authorSlug,
            })) as (GuideItem & { _authorSlug: string })[]}
            linkFn={(guide) => {
              const item = guide as GuideItem & { _authorSlug: string };
              return `/guides/${item._authorSlug}/${guide.slug}`;
            }}
            gridCols="md:grid-cols-2 lg:grid-cols-4"
          />
        </section>
      )}

      {feed.loading.paces ? (
        <SectionSkeleton columns={4} />
      ) : filteredRecentPaces.length > 0 ? (
        <section className="space-y-5 rounded-3xl border border-border/70 bg-card/70 p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-primary/10 p-2">
              <History className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{t("home.paceFeedLabel")}</p>
              <h2 className="text-xl font-bold">{t("home.sectionPaces")}</h2>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <span className="hidden items-center gap-1 rounded-full border border-border/70 bg-background/70 px-2.5 py-1 text-xs text-muted-foreground sm:inline-flex">
                <Activity className="h-3.5 w-3.5" />
                {filteredRecentPaces.length}
              </span>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/paces">
                  {t("home.viewAll")}
                  <ArrowRight className="ml-1 h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            {filteredRecentPaces.map((run) => (
              <PaceFeedCard
                key={`${run.mcid}-${run.time}-${run.timeline}`}
                run={run}
                uuid={mergedMcidToUuid[run.mcid.toLowerCase()] ?? undefined}
                displayName={pacesMcidToDisplayName[run.mcid.toLowerCase()]}
                skinUrl={mcidToSkinUrl[run.mcid.toLowerCase()]}
              />
            ))}
          </div>
        </section>
      ) : null}

      {feed.loading.videos ? (
        <SectionSkeleton columns={3} />
      ) : filteredRecentVideos.length > 0 ? (
        <section className="space-y-5 rounded-3xl border border-border/70 bg-card/70 p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-red-500/10 p-2">
              <Play className="h-5 w-5 text-red-600" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{t("home.videoFeedLabel")}</p>
              <h2 className="text-xl font-bold">{t("home.sectionVideos")}</h2>
            </div>
            <span className="ml-auto rounded-full border border-border/70 bg-background/70 px-2.5 py-1 text-xs text-muted-foreground">
              {t("home.videosCount", { count: filteredRecentVideos.length })}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredRecentVideos.map((video) => (
              <HomeVideoFeedCard key={video.videoId} video={video} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
