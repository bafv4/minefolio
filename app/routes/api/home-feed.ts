// ホームフィード用API（遅延読み込み対応）

import type { Route } from "./+types/home-feed";
import { createDb } from "@/lib/db";
import { getEnv } from "@/lib/env.server";
import { users, socialLinks } from "@/lib/schema";
import { eq, and, inArray } from "drizzle-orm";
import { fetchLiveRuns, fetchRecentRunsForUsers } from "@/lib/paceman";
import { getTwitchAppToken, getLiveStreams } from "@/lib/twitch";
import { getRecentVideos } from "@/lib/youtube";
import { getFavoritesFromCookie } from "@/lib/favorites";

export async function loader({ context, request }: Route.LoaderArgs) {
  const env = context.env ?? getEnv();
  const db = createDb();

  const url = new URL(request.url);
  const feedType = url.searchParams.get("type");

  // お気に入りを取得
  const cookieHeader = request.headers.get("Cookie");
  const favoriteMcids = getFavoritesFromCookie(cookieHeader);
  const favoritesSet = new Set(favoriteMcids.map(m => m.toLowerCase()));

  // 登録ユーザーのMCIDとUUIDを取得
  const allUserMcids = await db.query.users.findMany({
    columns: { mcid: true, uuid: true },
  });
  const registeredMcidSet = new Set(allUserMcids.map((u) => u.mcid.toLowerCase()));
  const mcidToUuid = Object.fromEntries(
    allUserMcids.map((u) => [u.mcid.toLowerCase(), u.uuid])
  );

  // お気に入りを優先してソートする関数
  const sortByFavorite = <T extends { mcid?: string; nickname?: string }>(items: T[]): T[] => {
    return items.sort((a, b) => {
      const aMcid = (a.mcid || a.nickname || '').toLowerCase();
      const bMcid = (b.mcid || b.nickname || '').toLowerCase();
      const aIsFavorite = favoritesSet.has(aMcid);
      const bIsFavorite = favoritesSet.has(bMcid);
      if (aIsFavorite && !bIsFavorite) return -1;
      if (!aIsFavorite && bIsFavorite) return 1;
      return 0;
    });
  };

  // フィードタイプに応じてデータを取得
  switch (feedType) {
    case "live-runs": {
      const liveRuns = await fetchLiveRuns();
      const filteredLiveRuns = liveRuns
        .filter((run) => registeredMcidSet.has(run.nickname.toLowerCase()));
      const sortedLiveRuns = sortByFavorite(filteredLiveRuns).slice(0, 20);
      return Response.json({
        liveRuns: sortedLiveRuns,
        mcidToUuid,
      });
    }

    case "recent-paces": {
      const recentPaces = await fetchRecentRunsForUsers(
        Array.from(registeredMcidSet),
        168, // 1週間
        5,
        20
      );
      const sortedPaces = sortByFavorite(recentPaces);
      return Response.json({
        recentPaces: sortedPaces,
        mcidToUuid,
      });
    }

    case "twitch-streams": {
      const clientId = env.TWITCH_CLIENT_ID;
      const clientSecret = env.TWITCH_CLIENT_SECRET;

      if (!clientId || !clientSecret) {
        return Response.json({ liveStreams: [] });
      }

      // 公開プロフィールのTwitchリンクを取得
      const twitchLinks = await db
        .select({
          identifier: socialLinks.identifier,
          mcid: users.mcid,
        })
        .from(socialLinks)
        .innerJoin(users, eq(socialLinks.userId, users.id))
        .where(
          and(
            eq(users.profileVisibility, "public"),
            eq(socialLinks.platform, "twitch")
          )
        );

      if (twitchLinks.length === 0) {
        return Response.json({ liveStreams: [] });
      }

      const token = await getTwitchAppToken(clientId, clientSecret);
      if (!token) {
        return Response.json({ liveStreams: [] });
      }

      const userLogins = twitchLinks.map((l) => l.identifier);
      const streams = await getLiveStreams(clientId, token, userLogins);

      const liveStreams = streams.map((stream) => {
        const link = twitchLinks.find(
          (l) => l.identifier.toLowerCase() === stream.user_login.toLowerCase()
        );
        return { stream, mcid: link?.mcid ?? "" };
      });

      const sortedStreams = sortByFavorite(liveStreams);
      return Response.json({ liveStreams: sortedStreams });
    }

    case "youtube-videos": {
      const apiKey = env.YOUTUBE_API_KEY;

      if (!apiKey) {
        return Response.json({ recentVideos: [] });
      }

      // 公開プロフィールのYouTubeリンクを取得
      const youtubeLinks = await db
        .select({
          identifier: socialLinks.identifier,
          mcid: users.mcid,
        })
        .from(socialLinks)
        .innerJoin(users, eq(socialLinks.userId, users.id))
        .where(
          and(
            eq(users.profileVisibility, "public"),
            eq(socialLinks.platform, "youtube")
          )
        );

      if (youtubeLinks.length === 0) {
        return Response.json({ recentVideos: [] });
      }

      const channels = youtubeLinks.map((l) => ({
        channelId: l.identifier,
        mcid: l.mcid,
      }));

      const recentVideos = await getRecentVideos(apiKey, channels, 3, 72);
      const sortedVideos = sortByFavorite(recentVideos);
      return Response.json({ recentVideos: sortedVideos });
    }

    default:
      return Response.json({ error: "Invalid feed type" }, { status: 400 });
  }
}
