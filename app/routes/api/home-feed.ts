// ホームフィード用API（遅延読み込み対応）
// 最適化: キャッシュキーをユーザー間で共有、CDNキャッシュヘッダー追加

import type { Route } from "./+types/home-feed";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getOptionalSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users, socialLinks } from "@/lib/schema";
import { eq, and, isNotNull } from "drizzle-orm";
import { fetchLiveRuns } from "@/lib/paceman";
import { getPaceFeedEntries, getRunTimeline, type PaceTimelineEntry } from "@/lib/paceman-cache";
import { getTwitchAppToken, getLiveStreams } from "@/lib/twitch";
import { getFavoritesFromDb } from "@/lib/favorites";
import { excludeViewersCondition } from "@/lib/users-filter";
import { getCached, setCached } from "@/lib/cache";
import { getCachedVideos } from "@/lib/youtube-cache";

// キャッシュTTL設定（ミリ秒）
const CACHE_TTL = {
  LIVE_RUNS: 30 * 1000, // 30秒（PaceMan API への負荷を軽減）
  TWITCH: 60 * 1000, // 1分
  PACES: 5 * 60 * 1000, // 5分
  USER_DATA: 60 * 1000, // 1分（ユーザーデータ）
  TWITCH_LINKS: 5 * 60 * 1000, // 5分（Twitchリンク一覧）
};

// CDNキャッシュヘッダー（秒）
const CDN_CACHE = {
  LIVE_RUNS: 30, // 30秒（CACHE_TTL.LIVE_RUNS と整合）
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
  mcidToSkinUrl: Record<string, string>;
  mcidToSlug: Record<string, string>;
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
      slug: users.slug,
      displayName: users.displayName,
      customSkinUrl: users.customSkinUrl,
    })
    .from(users)
    .where(and(isNotNull(users.mcid), isNotNull(users.uuid), excludeViewersCondition));

  const data: UserDataCache = {
    registeredMcids: usersWithMcid.map((u) => u.mcid!.toLowerCase()),
    mcidToUuid: Object.fromEntries(
      usersWithMcid.map((u) => [u.mcid!.toLowerCase(), u.uuid!])
    ),
    mcidToDisplayName: Object.fromEntries(
      usersWithMcid.map((u) => [u.mcid!.toLowerCase(), u.displayName || u.mcid!])
    ),
    mcidToSkinUrl: Object.fromEntries(
      usersWithMcid
        .filter((u) => u.customSkinUrl !== null)
        .map((u) => [u.mcid!.toLowerCase(), u.customSkinUrl!])
    ),
    mcidToSlug: Object.fromEntries(
      usersWithMcid.map((u) => [u.mcid!.toLowerCase(), u.slug])
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
  customSkinUrl: string | null;
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
      customSkinUrl: users.customSkinUrl,
    })
    .from(socialLinks)
    .innerJoin(users, eq(socialLinks.userId, users.id))
    .where(
      and(
        eq(users.profileVisibility, "public"),
        eq(socialLinks.platform, "twitch"),
        excludeViewersCondition,
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

// お気に入りソート関数（時間順を維持）
// favoriteSlugsSet: ログイン中ユーザーのお気に入りslug集合
// mcidToSlug: アイテムのmcidからslugへのマッピング（item.slugが既にある場合は不要）
function sortByFavorite<T extends { mcid?: string | null; nickname?: string | null; minefolioMcid?: string | null; slug?: string | null; time?: number }>(
  items: T[],
  favoriteSlugsSet: Set<string>,
  mcidToSlug: Record<string, string> = {},
): T[] {
  return [...items].sort((a, b) => {
    const aSlug = a.slug || mcidToSlug[(a.mcid || a.nickname || a.minefolioMcid || "").toLowerCase()];
    const bSlug = b.slug || mcidToSlug[(b.mcid || b.nickname || b.minefolioMcid || "").toLowerCase()];
    const aIsFavorite = aSlug ? favoriteSlugsSet.has(aSlug) : false;
    const bIsFavorite = bSlug ? favoriteSlugsSet.has(bSlug) : false;
    // お気に入りを先頭に
    if (aIsFavorite && !bIsFavorite) return -1;
    if (!aIsFavorite && bIsFavorite) return 1;
    // 同じお気に入り状態の場合は時間順（新しい順）
    if (a.time !== undefined && b.time !== undefined) {
      return b.time - a.time;
    }
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

export async function loader({ request }: Route.LoaderArgs) {
  const env = getEnv();

  const url = new URL(request.url);
  const feedType = url.searchParams.get("type");

  // ログイン中ユーザーのお気に入り（slug）を取得（ソートのみに使用、キャッシュキーには含めない）
  let favoriteSlugsSet = new Set<string>();
  try {
    const db = createDb();
    const auth = createAuth(db, env);
    const session = await getOptionalSession(request, auth);
    if (session) {
      const me = await db.query.users.findFirst({
        where: eq(users.discordId, session.user.id),
        columns: { id: true },
      });
      if (me) {
        const slugs = await getFavoritesFromDb(db, me.id);
        favoriteSlugsSet = new Set(slugs);
      }
    }
  } catch {
    // セッション取得失敗時はお気に入り無しで続行
  }

  switch (feedType) {
    case "live-runs": {
      // 共通キャッシュキー（お気に入りに依存しない）
      const cacheKey = "home-feed:live-runs:all";
      type LiveRunsCache = { liveRuns: any[]; mcidToUuid: Record<string, string>; mcidToSkinUrl: Record<string, string>; mcidToSlug: Record<string, string> };

      const cached = await getCached<LiveRunsCache>(cacheKey);
      if (cached) {
        // お気に入りでソートして返す
        const sortedRuns = sortByFavorite(cached.liveRuns, favoriteSlugsSet, cached.mcidToSlug);
        return jsonResponse({ liveRuns: sortedRuns, mcidToUuid: cached.mcidToUuid, mcidToSkinUrl: cached.mcidToSkinUrl }, CDN_CACHE.LIVE_RUNS);
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
        mcidToSkinUrl: userData.mcidToSkinUrl,
        mcidToSlug: userData.mcidToSlug,
      };

      // キャッシュに保存
      await setCached(cacheKey, result, CACHE_TTL.LIVE_RUNS);

      // お気に入りでソートして返す
      const sortedRuns = sortByFavorite(result.liveRuns, favoriteSlugsSet, result.mcidToSlug);
      return jsonResponse({ liveRuns: sortedRuns, mcidToUuid: result.mcidToUuid, mcidToSkinUrl: result.mcidToSkinUrl }, CDN_CACHE.LIVE_RUNS);
    }

    case "recent-paces": {
      const userData = await getUserData();

      // DBキャッシュからペースを取得（新しい順、フィードは最新12件まで）
      // Enter Nether以外の全Split（Bastion, Fortress, First Portal, 2nd Structure以降）を含む
      // 視聴者ロールのペースは除外（userData.registeredMcidsはviewer除外済み）
      const registeredMcidSet = new Set(userData.registeredMcids);
      const uniquePaces = await getPaceFeedEntries(registeredMcidSet, { limit: 12 });

      // お気に入りソート用にtime（Unix秒）を追加
      const pacesWithTime = uniquePaces.map((p) => ({
        ...p,
        nickname: p.mcid,
        time: Math.floor(p.date.getTime() / 1000),
      }));

      const sortedPaces = sortByFavorite(pacesWithTime, favoriteSlugsSet, userData.mcidToSlug);
      return jsonResponse(
        {
          recentPaces: sortedPaces,
          mcidToUuid: userData.mcidToUuid,
          mcidToDisplayName: userData.mcidToDisplayName,
          mcidToSkinUrl: userData.mcidToSkinUrl,
        },
        CDN_CACHE.PACES
      );
    }

    case "pace-timeline": {
      // 過去のペースカードのタイムラインモーダル用: 特定ラン（mcid + pacemanRunId）の全スプリットを返す
      const mcid = url.searchParams.get("mcid");
      const runIdParam = url.searchParams.get("runId");
      const runId = runIdParam ? Number.parseInt(runIdParam, 10) : NaN;
      if (!mcid || !Number.isFinite(runId)) {
        return Response.json({ error: "mcid and runId are required" }, { status: 400 });
      }

      const cacheKey = `home-feed:pace-timeline:${mcid.toLowerCase()}:${runId}`;
      const cached = await getCached<PaceTimelineEntry[]>(cacheKey);
      if (cached) {
        return jsonResponse({ timeline: cached }, CDN_CACHE.PACES);
      }

      const timeline = await getRunTimeline(mcid, runId);
      await setCached(cacheKey, timeline, CACHE_TTL.PACES);
      return jsonResponse({ timeline }, CDN_CACHE.PACES);
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
        const sortedStreams = sortByFavorite(cached.liveStreams, favoriteSlugsSet);
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

      // O(n²) を避けるため identifier（小文字）→ TwitchLinkData の Map を構築
      const twitchLinkByIdentifier = new Map<string, TwitchLinkData>(
        twitchLinks.map((l) => [l.identifier.toLowerCase(), l])
      );

      const liveStreams = streams.map((stream) => {
        const link = twitchLinkByIdentifier.get(stream.user_login.toLowerCase());
        return {
          stream,
          mcid: link?.mcid ?? null,
          uuid: link?.uuid ?? null,
          slug: link?.slug ?? "",
          displayName: link?.displayName ?? null,
          discordAvatar: link?.discordAvatar ?? null,
          customSkinUrl: link?.customSkinUrl ?? null,
        };
      });

      const result: TwitchCache = { liveStreams };
      await setCached(cacheKey, result, CACHE_TTL.TWITCH);

      const sortedStreams = sortByFavorite(liveStreams, favoriteSlugsSet);
      return jsonResponse({ liveStreams: sortedStreams }, CDN_CACHE.TWITCH);
    }

    case "youtube-videos": {
      // キャッシュから動画を取得（Cronで更新）
      const cachedVideos = await getCachedVideos();

      if (cachedVideos && cachedVideos.length > 0) {
        const sortedVideos = sortByFavorite(cachedVideos, favoriteSlugsSet);
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
