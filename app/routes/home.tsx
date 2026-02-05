import { useLoaderData, Link } from "react-router";
import { useEffect, useReducer, memo } from "react";
import type { Route } from "./+types/home";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getOptionalSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users } from "@/lib/schema";
import { eq, desc } from "drizzle-orm";
import { VideoCard } from "@/components/video-card";
import { PlayerCard } from "@/components/player-card";
import { RecentPaceCard } from "@/components/recent-pace-card";
import type { CachedYouTubeVideo } from "@/lib/youtube-cache";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowRight,
  Play,
  Compass,
  UserCheck,
  History,
} from "lucide-react";
import type { PaceManRecentRun } from "@/lib/paceman";

export const meta: Route.MetaFunction = ({ data }) => {
  const appUrl = data?.appUrl || "https://minefolio.pages.dev";
  const title = "Minefolio - Minecraft Speedrunner Portfolio";
  const ogImageUrl = `${appUrl}/icon.png`;

  return [
    { title },

    // Open Graph
    { property: "og:type", content: "website" },
    { property: "og:title", content: title },
    { property: "og:image", content: ogImageUrl },
    { property: "og:image:type", content: "image/png" },
    { property: "og:url", content: appUrl },

    // Twitter Card
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: title },
    { name: "twitter:image", content: ogImageUrl },
  ];
};

export async function loader({ context, request }: Route.LoaderArgs) {
  const env = context.env ?? getEnv();
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
    columns: { mcid: true, uuid: true, slug: true },
  });
  const registeredMcids = allUserMcids
    .filter((u) => u.mcid !== null)
    .map((u) => u.mcid!.toLowerCase());
  const mcidToUuid = Object.fromEntries(
    allUserMcids
      .filter((u) => u.mcid !== null)
      .map((u) => [u.mcid!.toLowerCase(), u.uuid])
  );

  // 最近更新されたプロフィール（公開設定のみ、最新4件）- DBのみなので即時取得
  const recentlyUpdatedUsers = await db.query.users.findMany({
    where: eq(users.profileVisibility, "public"),
    columns: {
      mcid: true,
      uuid: true,
      slug: true,
      displayName: true,
      location: true,
      updatedAt: true,
      shortBio: true,
    },
    orderBy: [desc(users.updatedAt)],
    limit: 4,
  });

  return {
    appUrl: env.APP_URL || "https://minefolio.pages.dev",
    isRegistered,
    currentUser,
    registeredMcids,
    mcidToUuid,
    recentlyUpdatedUsers,
  };
}

// APIレスポンスの型定義
interface YouTubeVideosResponse {
  recentVideos: CachedYouTubeVideo[];
}

interface RecentPacesResponse {
  recentPaces: PaceManRecentRun[];
  mcidToUuid: Record<string, string>;
  mcidToDisplayName: Record<string, string>;
}

// Feed状態管理用のReducer
interface FeedState {
  recentVideos: CachedYouTubeVideo[];
  recentPaces: PaceManRecentRun[];
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
  | { type: "SET_PACES"; payload: { recentPaces: PaceManRecentRun[]; mcidToUuid?: Record<string, string>; mcidToDisplayName?: Record<string, string> } }
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

// セクション全体のローディングスケルトン（memo化）
const SectionSkeleton = memo(function SectionSkeleton({ columns = 4 }: { columns?: number }) {
  const gridColsClass =
    columns === 3 ? "lg:grid-cols-3" :
    columns === 4 ? "lg:grid-cols-4" :
    "lg:grid-cols-4";

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <Skeleton className="h-5 w-5 rounded" />
        <Skeleton className="h-6 w-32" />
      </div>
      <div className={`grid grid-cols-1 md:grid-cols-2 ${gridColsClass} gap-4`}>
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-lg" />
        ))}
      </div>
    </section>
  );
});

export default function HomePage() {
  const { isRegistered, currentUser, registeredMcids, mcidToUuid, recentlyUpdatedUsers } =
    useLoaderData<typeof loader>();

  const registeredMcidSet = new Set(registeredMcids);

  const [feed, dispatch] = useReducer(feedReducer, initialFeedState);

  // フィルタリング
  const filteredRecentPaces = currentUser?.showPacemanOnHome === false && currentUser?.mcid
    ? feed.recentPaces.filter(run => run.nickname.toLowerCase() !== currentUser.mcid!.toLowerCase())
    : feed.recentPaces;

  const filteredRecentVideos = currentUser?.showYoutubeOnHome === false && currentUser?.mcid
    ? feed.recentVideos.filter(video =>
        !video.minefolioMcid || video.minefolioMcid.toLowerCase() !== currentUser.mcid!.toLowerCase()
      )
    : feed.recentVideos;

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
    <div className="flex-1 flex flex-col space-y-8">
      {/* Hero Section */}
      <section className="text-center py-12 space-y-4">
        <h1 className="text-4xl font-bold tracking-tight">Minefolio</h1>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
          Minecraft Speedrunning + Portfolio
        </p>
        <div className="flex flex-col sm:flex-row justify-center gap-4 pt-4 px-4 sm:px-0">
          {!isRegistered && (
            <Button asChild size="lg" className="w-full sm:w-auto">
              <Link to="/login">
                プロフィールを作る
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          )}
          <Button asChild size="lg" variant="outline" className="w-full sm:w-auto">
            <Link to="/browse">
              <Compass className="mr-2 h-4 w-4" />
              ランナーを探す
            </Link>
          </Button>
        </div>
      </section>

      {/* 最近更新されたプロフィール（即時表示） */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <UserCheck className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-bold">最近更新されたプロフィール</h2>
        </div>
        {recentlyUpdatedUsers.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {recentlyUpdatedUsers.map((user) => (
              <PlayerCard key={user.slug} player={user} />
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <UserCheck className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>登録ユーザーはまだいません</p>
          </div>
        )}
      </section>

      {/* PaceMan Stats 最近のペース */}
      {feed.loading.paces ? (
        <SectionSkeleton columns={4} />
      ) : filteredRecentPaces.length > 0 ? (
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <History className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-bold">最近のペース</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {filteredRecentPaces.map((run) => (
              <RecentPaceCard
                key={`${run.id}-${run.time}`}
                run={run}
                isRegistered={registeredMcidSet.has(run.nickname.toLowerCase())}
                uuid={mergedMcidToUuid[run.nickname.toLowerCase()] ?? undefined}
                displayName={pacesMcidToDisplayName[run.nickname.toLowerCase()]}
              />
            ))}
          </div>
        </section>
      ) : null}

      {/* YouTube 最新動画 */}
      {feed.loading.videos ? (
        <SectionSkeleton columns={3} />
      ) : filteredRecentVideos.length > 0 ? (
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Play className="h-5 w-5 text-red-600" />
            <h2 className="text-xl font-bold">最新動画</h2>
            <span className="text-muted-foreground">({filteredRecentVideos.length})</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredRecentVideos.map((video) => (
              <VideoCard key={video.videoId} video={video} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
