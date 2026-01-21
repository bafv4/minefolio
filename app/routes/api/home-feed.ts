// ホームフィード用API（遅延読み込み対応）
// 最適化: キャッシュキーをユーザー間で共有、CDNキャッシュヘッダー追加

import type { Route } from "./+types/home-feed";
import { createDb } from "@/lib/db";
import { getEnv } from "@/lib/env.server";
import { users, socialLinks } from "@/lib/schema";
import { eq, and, isNotNull } from "drizzle-orm";
import { fetchLiveRuns, fetchRecentRunsForUsers } from "@/lib/paceman";
import { getTwitchAppToken, getLiveStreams } from "@/lib/twitch";
import { getFavoritesFromCookie } from "@/lib/favorites";
import {
  getCached,
  setCached,
  getDbCached,
  setDbCached,
} from "@/lib/cache";
import {
  getCachedVideos,
  fetchAndCacheNewVideos,
  needsUpdate,
  getRegisteredYouTubeChannels,
  // YouTubeライブ配信API関連は利用停止中
  // getCachedLiveStreams,
  // needsLiveUpdate,
  // fetchAndCacheLiveStreams,
} from "@/lib/youtube-cache";

// キャッシュTTL設定（ミリ秒）
const CACHE_TTL = {
  LIVE_RUNS: 10 * 1000, // 10秒（リアルタイム性重視）
  TWITCH: 60 * 1000, // 1分
  PACES: 5 * 60 * 1000, // 5分
  USER_DATA: 60 * 1000, // 1分（ユーザーデータ）
  TWITCH_LINKS: 5 * 60 * 1000, // 5分（Twitchリンク一覧）
};

// CDNキャッシュヘッダー（秒）
const CDN_CACHE = {
  LIVE_RUNS: 10, // 10秒（リアルタイム性重視）
  TWITCH: 30, // 30秒
  PACES: 60, // 1分
  YOUTUBE: 300, // 5分
  YOUTUBE_LIVE: 60, // 1分（ライブ配信）
};

// ユーザーデータのキャッシュ（DBクエリ削減）
interface UserDataCache {
  registeredMcids: string[];
  mcidToUuid: Record<string, string>;
  mcidToDisplayName: Record<string, string>;
}

async function getCachedUserData(): Promise<UserDataCache | null> {
  return getCached<UserDataCache>("home-feed:user-data");
}

async function fetchAndCacheUserData(): Promise<UserDataCache> {
  const db = createDb();
  // DBクエリ段階でMCIDとUUIDがあるユーザーのみフィルタリング（最適化）
  const usersWithMcid = await db
    .select({
      mcid: users.mcid,
      uuid: users.uuid,
      displayName: users.displayName,
    })
    .from(users)
    .where(and(isNotNull(users.mcid), isNotNull(users.uuid)));

  const data: UserDataCache = {
    registeredMcids: usersWithMcid.map((u) => u.mcid!.toLowerCase()),
    mcidToUuid: Object.fromEntries(
      usersWithMcid.map((u) => [u.mcid!.toLowerCase(), u.uuid!])
    ),
    mcidToDisplayName: Object.fromEntries(
      usersWithMcid.map((u) => [u.mcid!.toLowerCase(), u.displayName || u.mcid!])
    ),
  };

  await setCached("home-feed:user-data", data, CACHE_TTL.USER_DATA);
  return data;
}

async function getUserData(): Promise<UserDataCache> {
  const cached = await getCachedUserData();
  if (cached) return cached;
  return fetchAndCacheUserData();
}

// Twitchリンク一覧のキャッシュ
interface TwitchLinkData {
  identifier: string;
  mcid: string | null;
  uuid: string | null;
  slug: string;
  displayName: string | null;
  discordAvatar: string | null;
}
interface TwitchLinkCache {
  links: TwitchLinkData[];
}

async function getCachedTwitchLinks(): Promise<TwitchLinkCache | null> {
  return getCached<TwitchLinkCache>("home-feed:twitch-links");
}

async function fetchAndCacheTwitchLinks(): Promise<TwitchLinkCache> {
  const db = createDb();
  const twitchLinks = await db
    .select({
      identifier: socialLinks.identifier,
      mcid: users.mcid,
      uuid: users.uuid,
      slug: users.slug,
      displayName: users.displayName,
      discordAvatar: users.discordAvatar,
    })
    .from(socialLinks)
    .innerJoin(users, eq(socialLinks.userId, users.id))
    .where(
      and(
        eq(users.profileVisibility, "public"),
        eq(socialLinks.platform, "twitch")
      )
    );

  const data: TwitchLinkCache = { links: twitchLinks };
  await setCached("home-feed:twitch-links", data, CACHE_TTL.TWITCH_LINKS);
  return data;
}

async function getTwitchLinks(): Promise<TwitchLinkCache> {
  const cached = await getCachedTwitchLinks();
  if (cached) return cached;
  return fetchAndCacheTwitchLinks();
}

// お気に入りソート関数
function sortByFavorite<T extends { mcid?: string | null; nickname?: string | null; minefolioMcid?: string | null }>(
  items: T[],
  favoritesSet: Set<string>
): T[] {
  return [...items].sort((a, b) => {
    const aMcid = (a.mcid || a.nickname || a.minefolioMcid || "").toLowerCase();
    const bMcid = (b.mcid || b.nickname || b.minefolioMcid || "").toLowerCase();
    const aIsFavorite = favoritesSet.has(aMcid);
    const bIsFavorite = favoritesSet.has(bMcid);
    if (aIsFavorite && !bIsFavorite) return -1;
    if (!aIsFavorite && bIsFavorite) return 1;
    return 0;
  });
}

// JSONレスポンスとCDNキャッシュヘッダーを生成
function jsonResponse(data: unknown, cdnMaxAge: number): Response {
  return Response.json(data, {
    headers: {
      "Cache-Control": `public, s-maxage=${cdnMaxAge}, stale-while-revalidate=${cdnMaxAge * 2}`,
    },
  });
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const env = context.env ?? getEnv();

  const url = new URL(request.url);
  const feedType = url.searchParams.get("type");

  // お気に入りを取得（ソートのみに使用、キャッシュキーには含めない）
  const cookieHeader = request.headers.get("Cookie");
  const favoriteMcids = getFavoritesFromCookie(cookieHeader);
  const favoritesSet = new Set(favoriteMcids.map((m) => m.toLowerCase()));

  switch (feedType) {
    case "live-runs": {
      // 共通キャッシュキー（お気に入りに依存しない）
      const cacheKey = "home-feed:live-runs:all";
      type LiveRunsCache = { liveRuns: any[]; mcidToUuid: Record<string, string> };

      const cached = await getCached<LiveRunsCache>(cacheKey);
      if (cached) {
        // お気に入りでソートして返す
        const sortedRuns = sortByFavorite(cached.liveRuns, favoritesSet);
        return jsonResponse({ liveRuns: sortedRuns, mcidToUuid: cached.mcidToUuid }, CDN_CACHE.LIVE_RUNS);
      }

      // ユーザーデータとライブランを並列取得
      const [userData, liveRuns] = await Promise.all([
        getUserData(),
        fetchLiveRuns(),
      ]);

      const registeredMcidSet = new Set(userData.registeredMcids);
      const filteredLiveRuns = liveRuns
        .filter((run) => registeredMcidSet.has(run.nickname.toLowerCase()))
        .slice(0, 20);

      const result: LiveRunsCache = {
        liveRuns: filteredLiveRuns,
        mcidToUuid: userData.mcidToUuid,
      };

      // キャッシュに保存
      await setCached(cacheKey, result, CACHE_TTL.LIVE_RUNS);

      // お気に入りでソートして返す
      const sortedRuns = sortByFavorite(result.liveRuns, favoritesSet);
      return jsonResponse({ liveRuns: sortedRuns, mcidToUuid: result.mcidToUuid }, CDN_CACHE.LIVE_RUNS);
    }

    case "recent-paces": {
      const dbCacheKey = "home-feed:paces:all";
      type PacesCache = { recentPaces: any[] };

      const cachedPacesData = await getDbCached<PacesCache>(dbCacheKey);
      const userData = await getUserData();

      let recentPaces: any[];
      if (cachedPacesData) {
        recentPaces = cachedPacesData.recentPaces;
      } else {
        recentPaces = await fetchRecentRunsForUsers(
          userData.registeredMcids,
          168, // 1週間
          5,
          20
        );

        await setDbCached(dbCacheKey, "recent_paces", { recentPaces }, CACHE_TTL.PACES);
      }

      const sortedPaces = sortByFavorite(recentPaces, favoritesSet);
      return jsonResponse(
        {
          recentPaces: sortedPaces,
          mcidToUuid: userData.mcidToUuid,
          mcidToDisplayName: userData.mcidToDisplayName,
        },
        CDN_CACHE.PACES
      );
    }

    case "twitch-streams": {
      const clientId = env.TWITCH_CLIENT_ID;
      const clientSecret = env.TWITCH_CLIENT_SECRET;

      if (!clientId || !clientSecret) {
        return jsonResponse({ liveStreams: [] }, CDN_CACHE.TWITCH);
      }

      // 共通キャッシュキー
      const cacheKey = "home-feed:twitch:all";
      type TwitchCache = { liveStreams: any[] };

      const cached = await getCached<TwitchCache>(cacheKey);
      if (cached) {
        const sortedStreams = sortByFavorite(cached.liveStreams, favoritesSet);
        return jsonResponse({ liveStreams: sortedStreams }, CDN_CACHE.TWITCH);
      }

      // Twitchリンク一覧を取得（キャッシュあり）
      const { links: twitchLinks } = await getTwitchLinks();

      if (twitchLinks.length === 0) {
        return jsonResponse({ liveStreams: [] }, CDN_CACHE.TWITCH);
      }

      const token = await getTwitchAppToken(clientId, clientSecret);
      if (!token) {
        return jsonResponse({ liveStreams: [] }, CDN_CACHE.TWITCH);
      }

      const userLogins = twitchLinks.map((l) => l.identifier);
      const streams = await getLiveStreams(clientId, token, userLogins);

      const liveStreams = streams.map((stream) => {
        const link = twitchLinks.find(
          (l) => l.identifier.toLowerCase() === stream.user_login.toLowerCase()
        );
        return {
          stream,
          mcid: link?.mcid ?? null,
          uuid: link?.uuid ?? null,
          slug: link?.slug ?? "",
          displayName: link?.displayName ?? null,
          discordAvatar: link?.discordAvatar ?? null,
        };
      });

      const result: TwitchCache = { liveStreams };
      await setCached(cacheKey, result, CACHE_TTL.TWITCH);

      const sortedStreams = sortByFavorite(liveStreams, favoritesSet);
      return jsonResponse({ liveStreams: sortedStreams }, CDN_CACHE.TWITCH);
    }

    case "youtube-videos": {
      const apiKey = env.YOUTUBE_API_KEY;

      // 永続キャッシュから動画を取得（ユーザー情報付き）
      const cachedVideos = await getCachedVideos();

      if (cachedVideos && cachedVideos.length > 0) {
        const sortedVideos = sortByFavorite(cachedVideos, favoritesSet);

        // バックグラウンドで更新が必要かチェック（APIキーがある場合のみ）
        if (apiKey && await needsUpdate()) {
          updateYouTubeCache(apiKey).catch(console.error);
        }

        return jsonResponse({ recentVideos: sortedVideos }, CDN_CACHE.YOUTUBE);
      }

      // キャッシュがない場合はAPIから取得して保存
      if (!apiKey) {
        return jsonResponse({ recentVideos: [] }, CDN_CACHE.YOUTUBE);
      }

      const channels = await getRegisteredYouTubeChannels();
      if (channels.length === 0) {
        return jsonResponse({ recentVideos: [] }, CDN_CACHE.YOUTUBE);
      }

      // 初回取得
      await fetchAndCacheNewVideos(apiKey, channels);

      const newCachedVideos = await getCachedVideos();
      if (newCachedVideos) {
        const sortedVideos = sortByFavorite(newCachedVideos, favoritesSet);
        return jsonResponse({ recentVideos: sortedVideos }, CDN_CACHE.YOUTUBE);
      }

      return jsonResponse({ recentVideos: [] }, CDN_CACHE.YOUTUBE);
    }

    case "youtube-live": {
      // YouTubeライブ配信APIは利用停止中（Search APIのクォータコストが高いため）
      // 将来的にRSS/Atomフィードや別の方法で再実装を検討
      return jsonResponse({ liveStreams: [] }, CDN_CACHE.YOUTUBE_LIVE);
    }

    default:
      return Response.json({ error: "Invalid feed type" }, { status: 400 });
  }
}

/**
 * YouTubeキャッシュをバックグラウンドで更新
 */
async function updateYouTubeCache(apiKey: string): Promise<void> {
  try {
    const channels = await getRegisteredYouTubeChannels();
    if (channels.length > 0) {
      await fetchAndCacheNewVideos(apiKey, channels);
    }
  } catch (error) {
    console.error("Background YouTube cache update failed:", error);
  }
}
