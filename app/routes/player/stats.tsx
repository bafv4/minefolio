import { useLoaderData, Link } from "react-router";
import type { Route } from "./+types/stats";
import { createDb } from "@/lib/db";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { fetchAllExternalStats, type MCSRRankedMatch } from "@/lib/external-stats";
import { formatTime } from "@/lib/time-utils";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Trophy,
  ExternalLink,
  Swords,
  Timer,
  ArrowLeft,
  UserCircle,
} from "lucide-react";

export const meta: Route.MetaFunction = ({ params, data }) => {
  // dataがある場合はmcidを使用、なければslugを表示
  const displayName = data?.mcid || params.slug;
  return [
    { title: `${displayName}の活動・記録 - Minefolio` },
    { name: "description", content: `${displayName}の外部サービス統計情報` },
  ];
};

export async function loader({ params }: Route.LoaderArgs) {
  const { slug } = params;
  const db = createDb();

  // slugでプレイヤーを検索
  const player = await db.query.users.findFirst({
    where: eq(users.slug, slug),
    columns: {
      mcid: true,
      slug: true,
      displayName: true,
    },
  });

  if (!player) {
    throw new Response("プレイヤーが見つかりません", { status: 404 });
  }

  // 外部サービスから統計情報を取得（MCIDがある場合のみ）
  const externalStats = player.mcid
    ? await fetchAllExternalStats(player.mcid)
    : { paceman: null, ranked: null, speedruncom: null };

  return {
    mcid: player.mcid,
    slug: player.slug,
    displayName: player.displayName,
    externalStats,
  };
}

export default function PlayerStatsPage() {
  const { mcid, slug, displayName, externalStats } = useLoaderData<typeof loader>();

  // 表示名の優先順位: displayName > mcid > slug
  const playerDisplayName = displayName || mcid || slug;

  const hasAnyData =
    externalStats.ranked?.isRegistered ||
    externalStats.paceman?.isRegistered ||
    (externalStats.speedruncom?.personalBests?.length ?? 0) > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" asChild>
            <Link to={`/player/${slug}`}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              プロフィール
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{playerDisplayName}</h1>
            <p className="text-muted-foreground text-sm">活動・記録</p>
          </div>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link to={`/player/${slug}`}>
            <UserCircle className="h-4 w-4 mr-2" />
            プロフィールを見る
          </Link>
        </Button>
      </div>

      {!hasAnyData ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <p className="text-lg font-medium">統計データが見つかりません</p>
            <p className="text-sm mt-2">
              {mcid
                ? "このMCIDは外部サービス（MCSR Ranked, PaceMan, Speedrun.com）に登録されていないようです。"
                : "MCIDが設定されていないため、外部サービスとの連携ができません。プロフィール編集からMCIDを設定してください。"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* MCSR Ranked Section */}
          {externalStats.ranked?.isRegistered && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Swords className="h-5 w-5" />
                  MCSR Ranked
                </CardTitle>
                <CardDescription>Ranked対戦の統計情報</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {externalStats.ranked.user?.eloRate && (
                    <div className="text-center p-3 bg-secondary/50 rounded-lg">
                      <p className="text-2xl font-bold">
                        {externalStats.ranked.user.eloRate}
                      </p>
                      <p className="text-xs text-muted-foreground">Elo レート</p>
                    </div>
                  )}
                  {externalStats.ranked.user?.eloRank && (
                    <div className="text-center p-3 bg-secondary/50 rounded-lg">
                      <p className="text-2xl font-bold">
                        #{externalStats.ranked.user.eloRank}
                      </p>
                      <p className="text-xs text-muted-foreground">ランキング</p>
                    </div>
                  )}
                  {externalStats.ranked.seasonData && (
                    <div className="text-center p-3 bg-secondary/50 rounded-lg">
                      <p className="text-2xl font-bold">
                        {externalStats.ranked.seasonData.records.win}W -{" "}
                        {externalStats.ranked.seasonData.records.lose}L
                      </p>
                      <p className="text-xs text-muted-foreground">
                        今シーズン戦績
                      </p>
                    </div>
                  )}
                </div>

                {/* PB表示（全期間 / 今シーズン） */}
                {externalStats.ranked.seasonData &&
                (typeof externalStats.ranked.seasonData.bestTimeAllTime ===
                  "number" ||
                  typeof externalStats.ranked.seasonData.bestTime ===
                    "number") ? (
                  <div className="grid grid-cols-2 gap-4">
                    {typeof externalStats.ranked.seasonData.bestTimeAllTime ===
                      "number" && (
                      <div className="p-3 bg-secondary/30 rounded-lg">
                        <p className="text-xs text-muted-foreground mb-1">
                          全期間 PB
                        </p>
                        <p className="text-xl font-mono font-bold">
                          {formatTime(
                            externalStats.ranked.seasonData.bestTimeAllTime
                          )}
                        </p>
                      </div>
                    )}
                    {typeof externalStats.ranked.seasonData.bestTime ===
                      "number" && (
                      <div className="p-3 bg-secondary/30 rounded-lg">
                        <p className="text-xs text-muted-foreground mb-1">
                          今シーズン PB
                        </p>
                        <p className="text-xl font-mono font-bold">
                          {formatTime(externalStats.ranked.seasonData.bestTime)}
                        </p>
                      </div>
                    )}
                  </div>
                ) : null}

                {/* Eloレートグラフ */}
                {externalStats.ranked.recentMatches.length > 1 && (
                  <EloRateGraph matches={externalStats.ranked.recentMatches} />
                )}

                {/* 最近のマッチ */}
                {externalStats.ranked.recentMatches.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-muted-foreground">
                      最近のマッチ
                    </h4>
                    <div className="space-y-1">
                      {externalStats.ranked.recentMatches
                        .slice(0, 5)
                        .map((match) => (
                          <div
                            key={match.id}
                            className={cn(
                              "flex items-center justify-between p-2 rounded text-sm",
                              match.result === "win" && "bg-green-500/10",
                              match.result === "lose" && "bg-red-500/10",
                              match.result === "draw" && "bg-yellow-500/10"
                            )}
                          >
                            <div className="flex items-center gap-2">
                              <Badge
                                variant={
                                  match.result === "win"
                                    ? "default"
                                    : match.result === "lose"
                                      ? "destructive"
                                      : "secondary"
                                }
                                className="w-12 justify-center"
                              >
                                {match.result === "win"
                                  ? "WIN"
                                  : match.result === "lose"
                                    ? "LOSE"
                                    : "DRAW"}
                              </Badge>
                              <span>vs {match.opponentNickname}</span>
                            </div>
                            <div className="flex items-center gap-3">
                              {match.time && (
                                <span className="font-mono text-muted-foreground">
                                  {formatTime(match.time)}
                                </span>
                              )}
                              <span
                                className={cn(
                                  "font-medium",
                                  match.eloChange > 0 && "text-green-500",
                                  match.eloChange < 0 && "text-red-500"
                                )}
                              >
                                {match.eloChange > 0 ? "+" : ""}
                                {match.eloChange}
                              </span>
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* PaceMan Section - リンクのみ */}
          {externalStats.paceman?.isRegistered && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Timer className="h-5 w-5" />
                  PaceMan Stats
                </CardTitle>
                <CardDescription>ペース統計・リセット情報</CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild variant="outline" className="w-full">
                  <a
                    href={`https://paceman.gg/stats/player/${encodeURIComponent(mcid!)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="mr-2 h-4 w-4" />
                    PaceMan Statsで詳細を見る
                  </a>
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Speedrun.com Section */}
          {externalStats.speedruncom &&
            !externalStats.speedruncom.error &&
            externalStats.speedruncom.personalBests.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Trophy className="h-5 w-5" />
                    Speedrun.com
                  </CardTitle>
                  <CardDescription>
                    公式記録（Minecraft関連）
                    {externalStats.speedruncom.user && (
                      <span className="ml-2">
                        - {externalStats.speedruncom.user.names.international}
                      </span>
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {externalStats.speedruncom.personalBests
                      .slice(0, 6)
                      .map((pb) => (
                        <div
                          key={pb.run.id}
                          className="p-3 bg-secondary/50 rounded-lg space-y-1"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-sm truncate">
                              {pb.category?.data?.name ?? "Unknown"}
                            </span>
                            <Badge variant="outline" className="shrink-0">
                              #{pb.place}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground truncate">
                            {pb.game?.data?.names?.international ??
                              "Unknown Game"}
                          </p>
                          {(pb.platformName || pb.versionName) && (
                            <p className="text-xs text-muted-foreground">
                              {[pb.platformName, pb.versionName]
                                .filter(Boolean)
                                .join(" / ")}
                            </p>
                          )}
                          <p className="text-xl font-mono font-bold">
                            {formatTime(pb.run.times.primary_t * 1000)}
                          </p>
                          {pb.run.weblink && (
                            <a
                              href={pb.run.weblink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-primary hover:underline flex items-center gap-1"
                            >
                              <ExternalLink className="h-3 w-3" />
                              記録を見る
                            </a>
                          )}
                        </div>
                      ))}
                  </div>
                </CardContent>
              </Card>
            )}
        </>
      )}
    </div>
  );
}

// Eloレートグラフコンポーネント
function EloRateGraph({ matches }: { matches: MCSRRankedMatch[] }) {
  // Eloレートが0のマッチを除外してから古い順に並べ替え（グラフ表示用）
  const validMatches = matches.filter((m) => m.eloAfter > 0);
  const sortedMatches = [...validMatches].reverse();

  if (sortedMatches.length < 2) return null;

  // Eloレートの配列を作成
  const eloHistory = sortedMatches.map((m) => m.eloAfter);
  const minElo = Math.min(...eloHistory);
  const maxElo = Math.max(...eloHistory);
  const range = maxElo - minElo || 100; // 変動がない場合のデフォルト

  // グラフのサイズ
  const width = 300;
  const height = 80;
  const padding = { top: 10, bottom: 20, left: 0, right: 0 };
  const graphWidth = width - padding.left - padding.right;
  const graphHeight = height - padding.top - padding.bottom;

  // ポイントの計算
  const points = eloHistory.map((elo, i) => {
    const x = padding.left + (i / (eloHistory.length - 1)) * graphWidth;
    const y =
      padding.top + graphHeight - ((elo - minElo) / range) * graphHeight;
    return { x, y, elo };
  });

  // SVGパスの作成
  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
    .join(" ");

  // グラデーション用のエリアパス
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${height - padding.bottom} L ${padding.left} ${height - padding.bottom} Z`;

  // 最初と最後のEloの変化
  const eloChange = eloHistory[eloHistory.length - 1] - eloHistory[0];
  const isPositive = eloChange >= 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-muted-foreground">
          Eloレート推移（直近{sortedMatches.length}試合）
        </h4>
        <span
          className={cn(
            "text-sm font-medium",
            isPositive ? "text-green-500" : "text-red-500"
          )}
        >
          {isPositive ? "+" : ""}
          {eloChange}
        </span>
      </div>
      <div className="bg-secondary/30 rounded-lg p-3">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto"
          style={{ maxHeight: "100px" }}
        >
          {/* グラデーションの定義 */}
          <defs>
            <linearGradient
              id="eloGradientStats"
              x1="0%"
              y1="0%"
              x2="0%"
              y2="100%"
            >
              <stop
                offset="0%"
                stopColor={isPositive ? "#22c55e" : "#ef4444"}
                stopOpacity="0.3"
              />
              <stop
                offset="100%"
                stopColor={isPositive ? "#22c55e" : "#ef4444"}
                stopOpacity="0.05"
              />
            </linearGradient>
          </defs>

          {/* エリア塗りつぶし */}
          <path d={areaPath} fill="url(#eloGradientStats)" />

          {/* ライン */}
          <path
            d={linePath}
            fill="none"
            stroke={isPositive ? "#22c55e" : "#ef4444"}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* ポイント（最初と最後のみ） */}
          <circle
            cx={points[0].x}
            cy={points[0].y}
            r="3"
            fill={isPositive ? "#22c55e" : "#ef4444"}
          />
          <circle
            cx={points[points.length - 1].x}
            cy={points[points.length - 1].y}
            r="4"
            fill={isPositive ? "#22c55e" : "#ef4444"}
          />

          {/* 最小・最大ラベル */}
          <text
            x={padding.left}
            y={height - 4}
            fontSize="10"
            fill="currentColor"
            className="text-muted-foreground"
          >
            {eloHistory[0]}
          </text>
          <text
            x={width - padding.right}
            y={height - 4}
            fontSize="10"
            fill="currentColor"
            className="text-muted-foreground"
            textAnchor="end"
          >
            {eloHistory[eloHistory.length - 1]}
          </text>
        </svg>
      </div>
    </div>
  );
}
