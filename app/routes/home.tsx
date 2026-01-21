import { useLoaderData, Link } from "react-router";
import { useState, useEffect, useReducer, useCallback, memo } from "react";
import type { Route } from "./+types/home";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getOptionalSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users } from "@/lib/schema";
import { eq, desc } from "drizzle-orm";
import { LivePaceList } from "@/components/live-pace-list";
import { StreamCard } from "@/components/stream-card";
import { VideoCard } from "@/components/video-card";
import { PlayerCard } from "@/components/player-card";
import { RecentPaceCard } from "@/components/recent-pace-card";
import { YouTubeLiveCard } from "@/components/youtube-live-card";
import type { CachedYouTubeLive, CachedYouTubeVideo } from "@/lib/youtube-cache";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowRight,
  Radio,
  Timer,
  Play,
  Compass,
  UserCheck,
  History,
  AlertCircle,
} from "lucide-react";
import type { PaceManLiveRun, PaceManRecentRun } from "@/lib/paceman";
import type { TwitchStream } from "@/lib/twitch";

export const meta: Route.MetaFunction = ({ data }) => {
  const appUrl = data?.appUrl || "https://minefolio.pages.dev";
  const title = "Minefolio - Minecraft Speedrunner Portfolio";
  const ogImageUrl = `${appUrl}/og-image`;

  return [
    { title },

    // Open Graph
    { property: "og:type", content: "website" },
    { property: "og:title", content: title },
    { property: "og:image", content: ogImageUrl },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { property: "og:url", content: appUrl },

    // Twitter Card
    { name: "twitter:card", content: "summary_large_image" },
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
  if (session) {
    const existingUser = await db.query.users.findFirst({
      where: eq(users.discordId, session.user.id),
      columns: { id: true },
    });
    isRegistered = !!existingUser;
  }

  // 登録ユーザーのMCIDとUUIDを取得（MCIDがあるユーザーのみ - PaceMan連携用）
  const allUserMcids = await db.query.users.findMany({
    columns: { mcid: true, uuid: true, slug: true },
  });
  // MCIDがあるユーザーのみ（PaceMan連携対象）
  const registeredMcids = allUserMcids
    .filter((u) => u.mcid !== null)
    .map((u) => u.mcid!.toLowerCase());
  const mcidToUuid = Object.fromEntries(
    allUserMcids
      .filter((u) => u.mcid !== null)
      .map((u) => [u.mcid!.toLowerCase(), u.uuid])
  );
  // MCIDからslugへのマッピング（PaceMan連携のリンク生成用）
  const mcidToSlug = Object.fromEntries(
    allUserMcids
      .filter((u) => u.mcid !== null)
      .map((u) => [u.mcid!.toLowerCase(), u.slug])
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
    registeredMcids,
    mcidToUuid,
    mcidToSlug,
    recentlyUpdatedUsers,
  };
}

// APIレスポンスの型定義
interface LiveRunsResponse {
  liveRuns: PaceManLiveRun[];
  mcidToUuid: Record<string, string>;
}

interface TwitchStreamWithUser {
  stream: TwitchStream;
  mcid: string | null;
  uuid: string | null;
  slug: string;
  displayName: string | null;
  discordAvatar: string | null;
}

interface TwitchStreamsResponse {
  liveStreams: TwitchStreamWithUser[];
}

interface YouTubeVideosResponse {
  recentVideos: CachedYouTubeVideo[];
}

interface RecentPacesResponse {
  recentPaces: PaceManRecentRun[];
  mcidToUuid: Record<string, string>;
  mcidToDisplayName: Record<string, string>;
}

interface YouTubeLiveResponse {
  liveStreams: CachedYouTubeLive[];
}

// Feed状態管理用のReducer
interface FeedState {
  liveRuns: PaceManLiveRun[];
  liveStreams: TwitchStreamWithUser[];
  youtubeLiveStreams: CachedYouTubeLive[];
  recentVideos: CachedYouTubeVideo[];
  recentPaces: PaceManRecentRun[];
  mcidToUuid: Record<string, string>;
  mcidToDisplayName: Record<string, string>;
  loading: {
    liveRuns: boolean;
    streams: boolean;
    youtubeLive: boolean;
    videos: boolean;
    paces: boolean;
  };
  errors: {
    liveRuns: boolean;
    streams: boolean;
    youtubeLive: boolean;
    videos: boolean;
    paces: boolean;
  };
}

type FeedAction =
  | { type: "SET_LIVE_RUNS"; payload: { liveRuns: PaceManLiveRun[]; mcidToUuid?: Record<string, string> } }
  | { type: "SET_STREAMS"; payload: TwitchStreamWithUser[] }
  | { type: "SET_YOUTUBE_LIVE"; payload: CachedYouTubeLive[] }
  | { type: "SET_VIDEOS"; payload: CachedYouTubeVideo[] }
  | { type: "SET_PACES"; payload: { recentPaces: PaceManRecentRun[]; mcidToUuid?: Record<string, string>; mcidToDisplayName?: Record<string, string> } }
  | { type: "SET_ERROR"; payload: keyof FeedState["errors"] }
  | { type: "SET_LOADING"; payload: { key: keyof FeedState["loading"]; value: boolean } };

const initialFeedState: FeedState = {
  liveRuns: [],
  liveStreams: [],
  youtubeLiveStreams: [],
  recentVideos: [],
  recentPaces: [],
  mcidToUuid: {},
  mcidToDisplayName: {},
  loading: {
    liveRuns: true,
    streams: true,
    youtubeLive: true,
    videos: true,
    paces: true,
  },
  errors: {
    liveRuns: false,
    streams: false,
    youtubeLive: false,
    videos: false,
    paces: false,
  },
};

function feedReducer(state: FeedState, action: FeedAction): FeedState {
  switch (action.type) {
    case "SET_LIVE_RUNS":
      return {
        ...state,
        liveRuns: action.payload.liveRuns,
        mcidToUuid: action.payload.mcidToUuid
          ? { ...state.mcidToUuid, ...action.payload.mcidToUuid }
          : state.mcidToUuid,
        loading: { ...state.loading, liveRuns: false },
      };
    case "SET_STREAMS":
      return {
        ...state,
        liveStreams: action.payload,
        loading: { ...state.loading, streams: false },
      };
    case "SET_YOUTUBE_LIVE":
      return {
        ...state,
        youtubeLiveStreams: action.payload,
        loading: { ...state.loading, youtubeLive: false },
      };
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
    case "SET_LOADING":
      return {
        ...state,
        loading: { ...state.loading, [action.payload.key]: action.payload.value },
      };
    default:
      return state;
  }
}

// セクション全体のローディングスケルトン（memo化）
const SectionSkeleton = memo(function SectionSkeleton({ columns = 4 }: { columns?: number }) {
  // Tailwindのgrid-colsクラスをcolumns値に応じて動的に選択
  const gridColsClass =
    columns === 3 ? "lg:grid-cols-3" :
    columns === 4 ? "lg:grid-cols-4" :
    "lg:grid-cols-4"; // デフォルト

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
  const { isRegistered, registeredMcids, mcidToUuid, mcidToSlug, recentlyUpdatedUsers } =
    useLoaderData<typeof loader>();

  const registeredMcidSet = new Set(registeredMcids);

  // Feed状態管理（useReducerで統合）
  const [feed, dispatch] = useReducer(feedReducer, initialFeedState);

  // 後方互換性のためのエイリアス
  const { liveRuns, liveStreams, youtubeLiveStreams, recentVideos, recentPaces } = feed;
  const pacesMcidToUuid = feed.mcidToUuid;
  const pacesMcidToDisplayName = feed.mcidToDisplayName;
  const loadingLiveRuns = feed.loading.liveRuns;
  const loadingStreams = feed.loading.streams;
  const loadingYoutubeLive = feed.loading.youtubeLive;
  const loadingVideos = feed.loading.videos;
  const loadingPaces = feed.loading.paces;

  // エラー状態（reducerから取得）
  const errorLiveRuns = feed.errors.liveRuns;
  const errorStreams = feed.errors.streams;
  const errorYoutubeLive = feed.errors.youtubeLive;
  const errorVideos = feed.errors.videos;
  const errorPaces = feed.errors.paces;

  // ライブペースを取得する関数（useCallbackでメモ化）
  const fetchLiveRuns = useCallback(() => {
    fetch("/api/home-feed?type=live-runs")
      .then((res) => res.json() as Promise<LiveRunsResponse>)
      .then((data) => {
        dispatch({
          type: "SET_LIVE_RUNS",
          payload: { liveRuns: data.liveRuns || [], mcidToUuid: data.mcidToUuid },
        });
      })
      .catch((err) => {
        console.error("Failed to fetch live runs:", err);
        dispatch({ type: "SET_ERROR", payload: "liveRuns" });
      });
  }, []);

  // 遅延読み込み（Promise.allで並列化）
  useEffect(() => {
    // 全てのAPIを並列で取得
    Promise.all([
      // ライブペース
      fetch("/api/home-feed?type=live-runs")
        .then((res) => res.json() as Promise<LiveRunsResponse>)
        .then((data) => {
          dispatch({
            type: "SET_LIVE_RUNS",
            payload: { liveRuns: data.liveRuns || [], mcidToUuid: data.mcidToUuid },
          });
        })
        .catch((err) => {
          console.error("Failed to fetch live runs:", err);
          dispatch({ type: "SET_ERROR", payload: "liveRuns" });
        }),

      // Twitch配信
      fetch("/api/home-feed?type=twitch-streams")
        .then((res) => res.json() as Promise<TwitchStreamsResponse>)
        .then((data) => {
          dispatch({ type: "SET_STREAMS", payload: data.liveStreams || [] });
        })
        .catch((err) => {
          console.error("Failed to fetch Twitch streams:", err);
          dispatch({ type: "SET_ERROR", payload: "streams" });
        }),

      // YouTubeライブ配信
      fetch("/api/home-feed?type=youtube-live")
        .then((res) => res.json() as Promise<YouTubeLiveResponse>)
        .then((data) => {
          dispatch({ type: "SET_YOUTUBE_LIVE", payload: data.liveStreams || [] });
        })
        .catch((err) => {
          console.error("Failed to fetch YouTube live streams:", err);
          dispatch({ type: "SET_ERROR", payload: "youtubeLive" });
        }),

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

  // ライブペースの自動更新（15秒間隔）
  useEffect(() => {
    const interval = setInterval(fetchLiveRuns, 15000);
    return () => clearInterval(interval);
  }, [fetchLiveRuns]);

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
        <div className="flex justify-center gap-4 pt-4">
          {!isRegistered && (
            <Button asChild size="lg">
              <Link to="/login">
                プロフィールを作る
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          )}
          <Button asChild size="lg" variant="outline">
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

      {/* 配信中（Twitch + YouTube Live） */}
      {(() => {
        // 全体のローディング状態（両方ロード完了するまで待つ）
        const isLoading = loadingStreams || loadingYoutubeLive;
        // エラー状態（両方がエラーの場合のみエラー表示）
        const hasError = errorStreams && errorYoutubeLive;
        // 配信数
        const totalStreams = liveStreams.length + youtubeLiveStreams.length;

        if (isLoading) {
          return <SectionSkeleton columns={3} />;
        }

        if (hasError) {
          return (
            <section className="space-y-4">
              <div className="flex items-center gap-2">
                <Radio className="h-5 w-5 text-red-500" />
                <h2 className="text-xl font-bold">配信中</h2>
              </div>
              <div className="text-center py-8 text-muted-foreground">
                <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>配信情報の取得に失敗しました</p>
              </div>
            </section>
          );
        }

        if (totalStreams === 0) {
          return null;
        }

        return (
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <Radio className="h-5 w-5 text-red-500" />
              <h2 className="text-xl font-bold">配信中（Twitch）</h2>
              <span className="text-muted-foreground">({totalStreams})</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {liveStreams.map((data) => (
                <StreamCard key={`twitch-${data.stream.id}`} {...data} />
              ))}
              {youtubeLiveStreams.map((stream) => (
                <YouTubeLiveCard key={`youtube-${stream.videoId}`} stream={stream} />
              ))}
            </div>
          </section>
        );
      })()}

      {/* PaceMan ライブペース */}
      {loadingLiveRuns ? (
        <SectionSkeleton columns={2} />
      ) : liveRuns.length > 0 ? (
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Timer className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-bold">ライブペース</h2>
            <span className="text-muted-foreground">({liveRuns.length})</span>
          </div>
          <LivePaceList
            runs={liveRuns}
            registeredMcidSet={registeredMcidSet}
            mcidToSlug={mcidToSlug}
            mcidToUuid={mergedMcidToUuid}
            mcidToDisplayName={pacesMcidToDisplayName}
          />
        </section>
      ) : null}

      {/* PaceMan Stats 最近のペース */}
      {loadingPaces ? (
        <SectionSkeleton columns={4} />
      ) : recentPaces.length > 0 ? (
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <History className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-bold">最近のペース</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {recentPaces.map((run) => (
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
      {loadingVideos ? (
        <SectionSkeleton columns={3} />
      ) : recentVideos.length > 0 ? (
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Play className="h-5 w-5 text-red-600" />
            <h2 className="text-xl font-bold">最新動画</h2>
            <span className="text-muted-foreground">({recentVideos.length})</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {recentVideos.map((video) => (
              <VideoCard key={video.videoId} video={video} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
