import { useLoaderData, Link } from "react-router";
import { useState, useEffect } from "react";
import type { Route } from "./+types/home";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getOptionalSession } from "@/lib/session";
import { users } from "@/lib/schema";
import { eq, desc } from "drizzle-orm";
import { PaceCard } from "@/components/pace-card";
import { StreamCard } from "@/components/stream-card";
import { VideoCard } from "@/components/video-card";
import { PlayerCard } from "@/components/player-card";
import { RecentPaceCard } from "@/components/recent-pace-card";
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
} from "lucide-react";
import type { PaceManLiveRun, PaceManRecentRun } from "@/lib/paceman";
import type { TwitchStream } from "@/lib/twitch";
import type { YouTubeVideo } from "@/lib/youtube";

export const meta: Route.MetaFunction = () => {
  return [
    { title: "Minefolio - Minecraft Speedrunner Portfolio" },
    {
      name: "description",
      content:
        "Minecraftスピードランナーを見つけて、キー配置や自己ベストなどを確認しましょう。",
    },
  ];
};

export async function loader({ context, request }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const db = createDb(env.DB);
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

  // 登録ユーザーのMCIDとUUIDを取得
  const allUserMcids = await db.query.users.findMany({
    columns: { mcid: true, uuid: true },
  });
  const registeredMcids = allUserMcids.map((u) => u.mcid.toLowerCase());
  const mcidToUuid = Object.fromEntries(
    allUserMcids.map((u) => [u.mcid.toLowerCase(), u.uuid])
  );

  // 最近更新されたプロフィール（公開設定のみ、最新4件）- DBのみなので即時取得
  const recentlyUpdatedUsers = await db.query.users.findMany({
    where: eq(users.profileVisibility, "public"),
    columns: {
      mcid: true,
      uuid: true,
      displayName: true,
      location: true,
      updatedAt: true,
      shortBio: true,
    },
    orderBy: [desc(users.updatedAt)],
    limit: 4,
  });

  return {
    isRegistered,
    registeredMcids,
    mcidToUuid,
    recentlyUpdatedUsers,
  };
}

// APIレスポンスの型定義
interface LiveRunsResponse {
  liveRuns: PaceManLiveRun[];
  mcidToUuid: Record<string, string>;
}

interface TwitchStreamsResponse {
  liveStreams: { stream: TwitchStream; mcid: string }[];
}

interface YouTubeVideosResponse {
  recentVideos: YouTubeVideo[];
}

interface RecentPacesResponse {
  recentPaces: PaceManRecentRun[];
  mcidToUuid: Record<string, string>;
}

// セクション全体のローディングスケルトン
function SectionSkeleton({ columns = 4 }: { columns?: number }) {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <Skeleton className="h-5 w-5 rounded" />
        <Skeleton className="h-6 w-32" />
      </div>
      <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-${columns} gap-4`}>
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-lg" />
        ))}
      </div>
    </section>
  );
}

export default function HomePage() {
  const { isRegistered, registeredMcids, mcidToUuid, recentlyUpdatedUsers } =
    useLoaderData<typeof loader>();

  const registeredMcidSet = new Set(registeredMcids);

  // 遅延読み込み用の状態
  const [liveRuns, setLiveRuns] = useState<PaceManLiveRun[]>([]);
  const [liveStreams, setLiveStreams] = useState<{ stream: TwitchStream; mcid: string }[]>([]);
  const [recentVideos, setRecentVideos] = useState<YouTubeVideo[]>([]);
  const [recentPaces, setRecentPaces] = useState<PaceManRecentRun[]>([]);
  const [pacesMcidToUuid, setPacesMcidToUuid] = useState<Record<string, string>>({});

  // ローディング状態
  const [loadingLiveRuns, setLoadingLiveRuns] = useState(true);
  const [loadingStreams, setLoadingStreams] = useState(true);
  const [loadingVideos, setLoadingVideos] = useState(true);
  const [loadingPaces, setLoadingPaces] = useState(true);

  // 遅延読み込み
  useEffect(() => {
    // ライブペース取得
    fetch("/api/home-feed?type=live-runs")
      .then((res) => res.json() as Promise<LiveRunsResponse>)
      .then((data) => {
        setLiveRuns(data.liveRuns || []);
        if (data.mcidToUuid) {
          setPacesMcidToUuid((prev) => ({ ...prev, ...data.mcidToUuid }));
        }
      })
      .catch(console.error)
      .finally(() => setLoadingLiveRuns(false));

    // Twitch配信取得
    fetch("/api/home-feed?type=twitch-streams")
      .then((res) => res.json() as Promise<TwitchStreamsResponse>)
      .then((data) => setLiveStreams(data.liveStreams || []))
      .catch(console.error)
      .finally(() => setLoadingStreams(false));

    // YouTube動画取得
    fetch("/api/home-feed?type=youtube-videos")
      .then((res) => res.json() as Promise<YouTubeVideosResponse>)
      .then((data) => setRecentVideos(data.recentVideos || []))
      .catch(console.error)
      .finally(() => setLoadingVideos(false));

    // 最近のペース取得
    fetch("/api/home-feed?type=recent-paces")
      .then((res) => res.json() as Promise<RecentPacesResponse>)
      .then((data) => {
        setRecentPaces(data.recentPaces || []);
        if (data.mcidToUuid) {
          setPacesMcidToUuid((prev) => ({ ...prev, ...data.mcidToUuid }));
        }
      })
      .catch(console.error)
      .finally(() => setLoadingPaces(false));
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
              <PlayerCard key={user.mcid} player={user} />
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <UserCheck className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>登録ユーザーはまだいません</p>
          </div>
        )}
      </section>

      {/* Twitch 配信中 */}
      {loadingStreams ? (
        <SectionSkeleton columns={3} />
      ) : liveStreams.length > 0 ? (
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Radio className="h-5 w-5 text-red-500" />
            <h2 className="text-xl font-bold">配信中</h2>
            <span className="text-muted-foreground">({liveStreams.length})</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {liveStreams.map(({ stream, mcid }) => (
              <StreamCard key={stream.id} stream={stream} mcid={mcid} />
            ))}
          </div>
        </section>
      ) : null}

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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {liveRuns.map((run) => (
              <PaceCard
                key={run.worldId}
                run={run}
                isRegistered={registeredMcidSet.has(run.nickname.toLowerCase())}
              />
            ))}
          </div>
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
            <span className="text-muted-foreground">({recentPaces.length})</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {recentPaces.map((run) => (
              <RecentPaceCard
                key={`${run.id}-${run.time}`}
                run={run}
                isRegistered={registeredMcidSet.has(run.nickname.toLowerCase())}
                uuid={mergedMcidToUuid[run.nickname.toLowerCase()]}
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
              <VideoCard key={video.id.videoId} video={video} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
