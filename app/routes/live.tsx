import { useLoaderData } from "react-router";
import { useState, useEffect, useReducer, useCallback, memo, useMemo } from "react";
import type { Route } from "./+types/live";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getOptionalSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { LivePaceList } from "@/components/live-pace-list";
import { StreamCard } from "@/components/stream-card";
import { YouTubeLiveCard } from "@/components/youtube-live-card";
import type { CachedYouTubeLive } from "@/lib/youtube-cache";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Radio,
  Timer,
  AlertCircle,
} from "lucide-react";
import type { PaceManLiveRun } from "@/lib/paceman";
import type { TwitchStream } from "@/lib/twitch";
import { t } from "@/lib/messages";

export const meta: Route.MetaFunction = () => {
  return [{ title: t("live.metaTitle") }];
};

export async function loader({ context, request }: Route.LoaderArgs) {
  const env = context.env ?? getEnv();
  const db = createDb();
  const auth = createAuth(db, env);

  const session = await getOptionalSession(request, auth);
  let currentUser: { mcid: string | null; showPacemanOnHome: boolean; showTwitchOnHome: boolean; showYoutubeOnHome: boolean } | null = null;
  if (session) {
    const existingUser = await db.query.users.findFirst({
      where: eq(users.discordId, session.user.id),
      columns: {
        id: true,
        mcid: true,
        showPacemanOnHome: true,
        showTwitchOnHome: true,
        showYoutubeOnHome: true,
      },
    });
    if (existingUser) {
      currentUser = {
        mcid: existingUser.mcid,
        showPacemanOnHome: existingUser.showPacemanOnHome ?? true,
        showTwitchOnHome: existingUser.showTwitchOnHome ?? true,
        showYoutubeOnHome: existingUser.showYoutubeOnHome ?? true,
      };
    }
  }

  const allUserMcids = await db.query.users.findMany({
    columns: { mcid: true, uuid: true, slug: true, displayName: true, customSkinUrl: true },
  });
  const registeredMcids = allUserMcids
    .filter((u) => u.mcid !== null)
    .map((u) => u.mcid!.toLowerCase());
  const mcidToUuid = Object.fromEntries(
    allUserMcids
      .filter((u) => u.mcid !== null)
      .map((u) => [u.mcid!.toLowerCase(), u.uuid])
  );
  const mcidToSlug = Object.fromEntries(
    allUserMcids
      .filter((u) => u.mcid !== null)
      .map((u) => [u.mcid!.toLowerCase(), u.slug])
  );
  const mcidToDisplayName = Object.fromEntries(
    allUserMcids
      .filter((u) => u.mcid !== null)
      .map((u) => [u.mcid!.toLowerCase(), u.displayName || u.mcid!])
  );
  const mcidToSkinUrl = Object.fromEntries(
    allUserMcids
      .filter((u) => u.mcid !== null && u.customSkinUrl !== null)
      .map((u) => [u.mcid!.toLowerCase(), u.customSkinUrl!])
  );

  return {
    currentUser,
    registeredMcids,
    mcidToUuid,
    mcidToSlug,
    mcidToDisplayName,
    mcidToSkinUrl,
  };
}

// APIレスポンスの型定義
interface LiveRunsResponse {
  liveRuns: PaceManLiveRun[];
  mcidToUuid: Record<string, string>;
  mcidToSkinUrl: Record<string, string>;
}

interface TwitchStreamWithUser {
  stream: TwitchStream;
  mcid: string | null;
  uuid: string | null;
  slug: string;
  displayName: string | null;
  discordAvatar: string | null;
  customSkinUrl: string | null;
}

interface TwitchStreamsResponse {
  liveStreams: TwitchStreamWithUser[];
}

interface YouTubeLiveResponse {
  liveStreams: CachedYouTubeLive[];
}

// Feed状態管理用のReducer
interface FeedState {
  liveRuns: PaceManLiveRun[];
  liveStreams: TwitchStreamWithUser[];
  youtubeLiveStreams: CachedYouTubeLive[];
  mcidToUuid: Record<string, string>;
  mcidToSkinUrl: Record<string, string>;
  loading: {
    liveRuns: boolean;
    streams: boolean;
    youtubeLive: boolean;
  };
  errors: {
    liveRuns: boolean;
    streams: boolean;
    youtubeLive: boolean;
  };
}

type FeedAction =
  | { type: "SET_LIVE_RUNS"; payload: { liveRuns: PaceManLiveRun[]; mcidToUuid?: Record<string, string>; mcidToSkinUrl?: Record<string, string> } }
  | { type: "SET_STREAMS"; payload: TwitchStreamWithUser[] }
  | { type: "SET_YOUTUBE_LIVE"; payload: CachedYouTubeLive[] }
  | { type: "SET_ERROR"; payload: keyof FeedState["errors"] };

const initialFeedState: FeedState = {
  liveRuns: [],
  liveStreams: [],
  youtubeLiveStreams: [],
  mcidToUuid: {},
  mcidToSkinUrl: {},
  loading: {
    liveRuns: true,
    streams: true,
    youtubeLive: true,
  },
  errors: {
    liveRuns: false,
    streams: false,
    youtubeLive: false,
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
        mcidToSkinUrl: action.payload.mcidToSkinUrl
          ? { ...state.mcidToSkinUrl, ...action.payload.mcidToSkinUrl }
          : state.mcidToSkinUrl,
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

const SectionSkeleton = memo(function SectionSkeleton({ columns = 3 }: { columns?: number }) {
  const gridColsClass =
    columns === 3 ? "lg:grid-cols-3" :
    columns === 2 ? "lg:grid-cols-2" :
    "lg:grid-cols-3";

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

export default function LivePage() {
  const { currentUser, registeredMcids, mcidToUuid, mcidToSlug, mcidToDisplayName, mcidToSkinUrl } =
    useLoaderData<typeof loader>();

  const registeredMcidSet = new Set(registeredMcids);

  const [feed, dispatch] = useReducer(feedReducer, initialFeedState);

  // フィルタリング
  const filteredLiveRuns = useMemo(() =>
    currentUser?.showPacemanOnHome === false && currentUser?.mcid
      ? feed.liveRuns.filter(run => run.nickname.toLowerCase() !== currentUser.mcid!.toLowerCase())
      : feed.liveRuns,
    [feed.liveRuns, currentUser?.showPacemanOnHome, currentUser?.mcid]
  );

  const filteredLiveStreams = useMemo(() =>
    currentUser?.showTwitchOnHome === false && currentUser?.mcid
      ? feed.liveStreams.filter(stream =>
          !stream.mcid || stream.mcid.toLowerCase() !== currentUser.mcid!.toLowerCase()
        )
      : feed.liveStreams,
    [feed.liveStreams, currentUser?.showTwitchOnHome, currentUser?.mcid]
  );

  const filteredYoutubeLiveStreams = useMemo(() =>
    currentUser?.showYoutubeOnHome === false && currentUser?.mcid
      ? feed.youtubeLiveStreams.filter(stream =>
          !stream.minefolioMcid || stream.minefolioMcid.toLowerCase() !== currentUser.mcid!.toLowerCase()
        )
      : feed.youtubeLiveStreams,
    [feed.youtubeLiveStreams, currentUser?.showYoutubeOnHome, currentUser?.mcid]
  );

  const mergedMcidToUuid = useMemo(() =>
    ({ ...mcidToUuid, ...feed.mcidToUuid }),
    [mcidToUuid, feed.mcidToUuid]
  );
  const mergedMcidToSkinUrl = useMemo(() =>
    ({ ...mcidToSkinUrl, ...feed.mcidToSkinUrl }),
    [mcidToSkinUrl, feed.mcidToSkinUrl]
  );

  // ライブペースを取得する関数
  const fetchLiveRuns = useCallback(() => {
    fetch("/api/home-feed?type=live-runs")
      .then((res) => res.json() as Promise<LiveRunsResponse>)
      .then((data) => {
        dispatch({
          type: "SET_LIVE_RUNS",
          payload: { liveRuns: data.liveRuns || [], mcidToUuid: data.mcidToUuid, mcidToSkinUrl: data.mcidToSkinUrl },
        });
      })
      .catch((err) => {
        console.error("Failed to fetch live runs:", err);
        dispatch({ type: "SET_ERROR", payload: "liveRuns" });
      });
  }, []);

  // 初回データ取得
  useEffect(() => {
    Promise.all([
      fetch("/api/home-feed?type=live-runs")
        .then((res) => res.json() as Promise<LiveRunsResponse>)
        .then((data) => {
          dispatch({
            type: "SET_LIVE_RUNS",
            payload: { liveRuns: data.liveRuns || [], mcidToUuid: data.mcidToUuid, mcidToSkinUrl: data.mcidToSkinUrl },
          });
        })
        .catch((err) => {
          console.error("Failed to fetch live runs:", err);
          dispatch({ type: "SET_ERROR", payload: "liveRuns" });
        }),

      fetch("/api/home-feed?type=twitch-streams")
        .then((res) => res.json() as Promise<TwitchStreamsResponse>)
        .then((data) => {
          dispatch({ type: "SET_STREAMS", payload: data.liveStreams || [] });
        })
        .catch((err) => {
          console.error("Failed to fetch Twitch streams:", err);
          dispatch({ type: "SET_ERROR", payload: "streams" });
        }),

      fetch("/api/home-feed?type=youtube-live")
        .then((res) => res.json() as Promise<YouTubeLiveResponse>)
        .then((data) => {
          dispatch({ type: "SET_YOUTUBE_LIVE", payload: data.liveStreams || [] });
        })
        .catch((err) => {
          console.error("Failed to fetch YouTube live streams:", err);
          dispatch({ type: "SET_ERROR", payload: "youtubeLive" });
        }),
    ]);
  }, []);

  // ライブペースの自動更新（15秒間隔）
  useEffect(() => {
    const interval = setInterval(fetchLiveRuns, 15000);
    return () => clearInterval(interval);
  }, [fetchLiveRuns]);

  return (
    <div className="flex-1 flex flex-col space-y-6">
      <section className="space-y-2">
        <h1 className="text-2xl font-bold">ライブ</h1>
        <p className="text-sm text-muted-foreground">
          現在進行中のペースとライブ配信
        </p>
      </section>

      {/* 配信中（Twitch + YouTube Live） */}
      {(() => {
        const isLoading = feed.loading.streams || feed.loading.youtubeLive;
        const hasError = feed.errors.streams && feed.errors.youtubeLive;
        const totalStreams = filteredLiveStreams.length + filteredYoutubeLiveStreams.length;

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

        return (
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <Radio className="h-5 w-5 text-red-500" />
              <h2 className="text-xl font-bold">配信中（Twitch）</h2>
              <span className="text-muted-foreground">({totalStreams})</span>
            </div>
            {totalStreams === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Radio className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>{t("live.noStreaming")}</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredLiveStreams.map((data) => (
                  <StreamCard key={`twitch-${data.stream.id}`} {...data} />
                ))}
                {filteredYoutubeLiveStreams.map((stream) => (
                  <YouTubeLiveCard key={`youtube-${stream.videoId}`} stream={stream} />
                ))}
              </div>
            )}
          </section>
        );
      })()}

      {/* PaceMan ライブペース */}
      {feed.loading.liveRuns ? (
        <SectionSkeleton columns={2} />
      ) : (
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Timer className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-bold">ライブペース</h2>
            <span className="text-muted-foreground">({filteredLiveRuns.length})</span>
          </div>
          {filteredLiveRuns.length > 0 ? (
            <LivePaceList
              runs={filteredLiveRuns}
              registeredMcidSet={registeredMcidSet}
              mcidToSlug={mcidToSlug}
              mcidToUuid={mergedMcidToUuid}
              mcidToDisplayName={mcidToDisplayName}
              mcidToSkinUrl={mergedMcidToSkinUrl}
            />
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Timer className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>{t("live.noPacing")}</p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
