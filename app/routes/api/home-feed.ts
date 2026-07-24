// ホームフィード用API（遅延読み込み対応）
// レスポンスはユーザー非依存（お気に入りの並べ替えはクライアント側で適用）。
// CDNキャッシュ（s-maxage + stale-while-revalidate）でエッジ配信し、オリジン到達を最小化する。

import type { Route } from "./+types/home-feed";
import { createDb } from "@/lib/db";
import { getEnv } from "@/lib/env.server";
import { users, socialLinks } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { fetchLiveRuns } from "@/lib/paceman";
import { getPaceFeedEntries, getRunTimeline, type PaceTimelineEntry } from "@/lib/paceman-cache";
import { getTwitchAppToken, getLiveStreams } from "@/lib/twitch";
import { excludeViewersCondition } from "@/lib/users-filter";
import { getCached, setCached } from "@/lib/cache";
import { getCachedVideos } from "@/lib/youtube-cache";
import { getCachedVods } from "@/lib/twitch-vod-cache";
import { getUserData } from "@/lib/home-user-data.server";

// キャッシュTTL設定（ミリ秒）
const CACHE_TTL = {
  LIVE_RUNS: 30 * 1000, // 30秒（PaceMan API への負荷を軽減）
  TWITCH: 60 * 1000, // 1分
  PACES: 5 * 60 * 1000, // 5分
  USER_DATA: 60 * 1000, // 1分（ユーザーデータ）
  TWITCH_LINKS: 5 * 60 * 1000, // 5分（Twitchリンク一覧）
};

// CDNキャッシュヘッダー（秒）
// DBキャッシュ系（paces/youtube）はデータ鮮度がcron更新間隔（30分/2時間）で決まるため、
// s-maxage を長めに取っても実質的な鮮度は変わらない
const CDN_CACHE = {
  LIVE_RUNS: 30, // 30秒（CACHE_TTL.LIVE_RUNS と整合）
  TWITCH: 30, // 30秒
  PACES: 300, // 5分（DBはcronが30分毎に更新）
  YOUTUBE: 1800, // 30分（DBはcronが2時間毎に更新）
  YOUTUBE_LIVE: 60, // 1分（ライブ配信）
  TWITCH_VODS: 900, // 15分（DBはcronが30分毎に更新）
};

// TTL切れ後もエッジからstale配信しつつバックグラウンドで再検証する猶予（1日）。
// 低トラフィック時でもオリジン（コールドスタート・DBアクセス）の遅延をユーザーに見せないためのもの
const CDN_SWR_LONG = 24 * 60 * 60;

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

// JSONレスポンスとCDNキャッシュヘッダーを生成
function jsonResponse(data: unknown, cdnMaxAge: number, staleWhileRevalidate = cdnMaxAge * 2): Response {
  return Response.json(data, {
    headers: {
      "Cache-Control": `public, s-maxage=${cdnMaxAge}, stale-while-revalidate=${staleWhileRevalidate}`,
    },
  });
}

export async function loader({ request }: Route.LoaderArgs) {
  const env = getEnv();

  const url = new URL(request.url);
  const feedType = url.searchParams.get("type");

  switch (feedType) {
    case "live-runs": {
      // 共通キャッシュキー（ユーザーに依存しない）
      const cacheKey = "home-feed:live-runs:all";
      type LiveRunsCache = { liveRuns: any[]; mcidToUuid: Record<string, string>; mcidToSkinUrl: Record<string, string> };

      const cached = await getCached<LiveRunsCache>(cacheKey);
      if (cached) {
        return jsonResponse({ liveRuns: cached.liveRuns, mcidToUuid: cached.mcidToUuid, mcidToSkinUrl: cached.mcidToSkinUrl }, CDN_CACHE.LIVE_RUNS);
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
      };

      // キャッシュに保存
      await setCached(cacheKey, result, CACHE_TTL.LIVE_RUNS);

      return jsonResponse({ liveRuns: result.liveRuns, mcidToUuid: result.mcidToUuid, mcidToSkinUrl: result.mcidToSkinUrl }, CDN_CACHE.LIVE_RUNS);
    }

    case "recent-paces": {
      const userData = await getUserData();

      // DBキャッシュからペースを取得（新しい順、フィードは最新12件まで）
      // Enter Nether以外の全Split（Bastion, Fortress, First Portal, 2nd Structure以降）を含む
      // 視聴者ロールのペースは除外（userData.registeredMcidsはviewer除外済み）
      const registeredMcidSet = new Set(userData.registeredMcids);
      const uniquePaces = await getPaceFeedEntries(registeredMcidSet, { limit: 12 });

      // クライアント表示用に nickname / time（Unix秒）を付与（新しい順のまま返す）
      const recentPaces = uniquePaces.map((p) => ({
        ...p,
        nickname: p.mcid,
        time: Math.floor(p.date.getTime() / 1000),
      }));

      return jsonResponse(
        {
          recentPaces,
          mcidToUuid: userData.mcidToUuid,
          mcidToDisplayName: userData.mcidToDisplayName,
          mcidToSkinUrl: userData.mcidToSkinUrl,
        },
        CDN_CACHE.PACES,
        CDN_SWR_LONG
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
        return jsonResponse({ timeline: cached }, CDN_CACHE.PACES, CDN_SWR_LONG);
      }

      const timeline = await getRunTimeline(mcid, runId);
      await setCached(cacheKey, timeline, CACHE_TTL.PACES);
      return jsonResponse({ timeline }, CDN_CACHE.PACES, CDN_SWR_LONG);
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
        return jsonResponse({ liveStreams: cached.liveStreams }, CDN_CACHE.TWITCH);
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

      return jsonResponse({ liveStreams }, CDN_CACHE.TWITCH);
    }

    case "youtube-videos": {
      // キャッシュから動画を取得（Cronで更新、新しい順）
      const cachedVideos = await getCachedVideos();

      // null（DBエラー or 72時間以内の動画なし）や0件は、動画公開・障害復旧で即変わり得るため
      // 短TTLで返す（長TTL+SWRだと空状態がエッジに最大1日残ってしまう）
      if (!cachedVideos || cachedVideos.length === 0) {
        return jsonResponse({ recentVideos: [] }, 60);
      }

      return jsonResponse({ recentVideos: cachedVideos }, CDN_CACHE.YOUTUBE, CDN_SWR_LONG);
    }

    case "twitch-vods": {
      // キャッシュテーブル（twitch_vod_cache。Cronが30分毎に更新）から取得
      const recentVods = await getCachedVods();

      // 空状態はVOD公開・障害復旧で即変わり得るため短TTL（youtube-videos と同じ方針）
      if (recentVods.length === 0) {
        return jsonResponse({ recentVods: [] }, 60);
      }

      return jsonResponse({ recentVods }, CDN_CACHE.TWITCH_VODS, CDN_SWR_LONG);
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
