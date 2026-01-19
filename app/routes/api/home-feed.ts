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
import { getCached, setCached, CacheTTL } from "@/lib/cache";

export async function loader({ context, request }: Route.LoaderArgs) {
  const env = context.env ?? getEnv();
  const db = createDb();

  const url = new URL(request.url);
  const feedType = url.searchParams.get("type");

  // お気に入りを取得
  const cookieHeader = request.headers.get("Cookie");
  const favoriteMcids = getFavoritesFromCookie(cookieHeader);
  const favoritesSet = new Set(favoriteMcids.map(m => m.toLowerCase()));

  // 登録ユーザーのMCID、UUID、表示名を取得
  const allUserMcids = await db.query.users.findMany({
    columns: { mcid: true, uuid: true, displayName: true },
  });
  const registeredMcidSet = new Set(allUserMcids.map((u) => u.mcid.toLowerCase()));
  const mcidToUuid = Object.fromEntries(
    allUserMcids.map((u) => [u.mcid.toLowerCase(), u.uuid])
  );
  const mcidToDisplayName = Object.fromEntries(
    allUserMcids.map((u) => [u.mcid.toLowerCase(), u.displayName || u.mcid])
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
      // キャッシュをチェック（お気に入りを含むキャッシュキー）
      const liveRunsCacheKey = `home-feed:live-runs:${favoriteMcids.sort().join(",")}`;
      const cachedLiveRuns = await getCached<{ liveRuns: any[]; mcidToUuid: any }>(liveRunsCacheKey);
      if (cachedLiveRuns) {
        return Response.json(cachedLiveRuns);
      }

      const liveRuns = await fetchLiveRuns();
      const filteredLiveRuns = liveRuns
        .filter((run) => registeredMcidSet.has(run.nickname.toLowerCase()));
      const sortedLiveRuns = sortByFavorite(filteredLiveRuns).slice(0, 20);
      const result = {
        liveRuns: sortedLiveRuns,
        mcidToUuid,
      };

      // キャッシュに保存（15秒 - ライブデータは頻繁に変わる）
      await setCached(liveRunsCacheKey, result, 15 * 1000);

      return Response.json(result);
    }

    case "recent-paces": {
      // キャッシュをチェック（お気に入りを含むキャッシュキー）
      const pacesCacheKey = `home-feed:paces:${favoriteMcids.sort().join(",")}`;
      const cachedPacesData = await getCached<{ recentPaces: any[]; mcidToUuid: any; mcidToDisplayName: any }>(pacesCacheKey);
      if (cachedPacesData) {
        return Response.json(cachedPacesData);
      }

      const recentPaces = await fetchRecentRunsForUsers(
        Array.from(registeredMcidSet),
        168, // 1週間
        5,
        20
      );
      const sortedPaces = sortByFavorite(recentPaces);
      const result = {
        recentPaces: sortedPaces,
        mcidToUuid,
        mcidToDisplayName,
      };

      // キャッシュに保存（5分 - ペースデータは比較的頻繁に更新される）
      await setCached(pacesCacheKey, result, CacheTTL.SHORT * 5);

      return Response.json(result);
    }

    case "twitch-streams": {
      const clientId = env.TWITCH_CLIENT_ID;
      const clientSecret = env.TWITCH_CLIENT_SECRET;

      if (!clientId || !clientSecret) {
        return Response.json({ liveStreams: [] });
      }

      // キャッシュをチェック（お気に入りを含むキャッシュキー）
      const twitchCacheKey = `home-feed:twitch:${favoriteMcids.sort().join(",")}`;
      const cachedTwitchData = await getCached<{ liveStreams: any[] }>(twitchCacheKey);
      if (cachedTwitchData) {
        return Response.json(cachedTwitchData);
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
      const result = { liveStreams: sortedStreams };

      // キャッシュに保存（1分 - ライブストリームは頻繁に変わる）
      await setCached(twitchCacheKey, result, CacheTTL.SHORT);

      return Response.json(result);
    }

    case "youtube-videos": {
      const apiKey = env.YOUTUBE_API_KEY;

      if (!apiKey) {
        return Response.json({ recentVideos: [] });
      }

      // キャッシュをチェック（お気に入りを含むキャッシュキー）
      const youtubeCacheKey = `home-feed:youtube:${favoriteMcids.sort().join(",")}`;
      const cachedYoutubeData = await getCached<{ recentVideos: any[] }>(youtubeCacheKey);
      if (cachedYoutubeData) {
        return Response.json(cachedYoutubeData);
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
      const result = { recentVideos: sortedVideos };

      // キャッシュに保存（30分 - YouTube APIのレート制限対策）
      await setCached(youtubeCacheKey, result, CacheTTL.MEDIUM * 2);

      return Response.json(result);
    }

    default:
      return Response.json({ error: "Invalid feed type" }, { status: 400 });
  }
}
