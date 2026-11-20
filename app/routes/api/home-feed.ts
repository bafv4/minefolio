// ホームフィード用API（遅延読み込み対応）
// レスポンスはユーザー非依存（お気に入りの並べ替えはクライアント側で適用）。
// CDNキャッシュ（s-maxage + stale-while-revalidate）でエッジ配信し、オリジン到達を最小化する。

import type { Route } from "./+types/home-feed";
import { createDb, type Database } from "@/lib/db";
import { getEnv } from "@/lib/env.server";
import { fetchLiveRuns, type PaceManLiveRun } from "@/lib/paceman";
import { getPaceFeedEntries, getRunTimeline, type PaceTimelineEntry } from "@/lib/paceman-cache";
import { getTwitchAppToken, getLiveStreams } from "@/lib/twitch";
import { getCached, setCached } from "@/lib/cache";
import { getPublicTwitchLinks, getPublicVideoFeed } from "@/lib/videos-feed.server";
import { getHomeHiddenUsers } from "@/lib/home-visibility.server";
import { getUserData, pickUserDataForMcids, type McidUserMaps } from "@/lib/home-user-data.server";
import { fetchRankedLiveMatches, fetchRankedResult } from "@/lib/ranked-live.server";
import { SECOND_STRUCTURE_BEST_KEY, type HomeTwitchStream, type RankedLiveMatch } from "@/lib/home-live";
import { pacemanPaces } from "@/lib/schema";
import { and, inArray, lt, sql } from "drizzle-orm";
import { feedVideoKey, type FeedVideo } from "@/lib/feed-video";

// キャッシュTTL設定（ミリ秒）
const CACHE_TTL = {
  LIVE_RUNS: 30 * 1000, // 30秒（PaceMan API への負荷を軽減）
  TWITCH: 60 * 1000, // 1分
  PACES: 5 * 60 * 1000, // 5分
  USER_DATA: 60 * 1000, // 1分（ユーザーデータ）
  TWITCH_LINKS: 5 * 60 * 1000, // 5分（Twitchリンク一覧）
};

// 上流（PaceMan / MCSR Ranked）の失敗を覚えておく時間。障害中は、ホームを開いている全タブの15秒ごとの
// ポーリングがそのまま上流へ届き、上流が応答しないとタイムアウト（10秒 / 8秒）まで関数が待ち続けるため、
// この間は上流を呼ばずに即 502 を返す。復旧の反映は最大でこの時間だけ遅れる（インスタンス単位のメモリ。CDN には載せない）
const UPSTREAM_FAILURE_TTL = 10 * 1000;

// 動画フィード（youtube-videos / twitch-vods）でホームに返す最大件数
const HOME_FEED_VIDEO_LIMIT = 10;

// ライブ走者の「同区間ベスト」に使う蓄積ペースの除外幅（進行中のラン自身を比較対象にしない）
const SPLIT_BEST_EXCLUDE_MS = 3 * 60 * 60 * 1000;

/** 同じ走者（slug）の動画・VODを新しい順の先頭1件に絞る（slug の無い行は動画ごとに別扱い） */
function onePerRunner(videos: FeedVideo[]): FeedVideo[] {
  const seen = new Set<string>();
  return videos.filter((v) => {
    const key = v.slug ?? feedVideoKey(v);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * 動画フィード（youtube-videos / twitch-vods）の取得。perRunner=1（ホーム呼び出し）では
 * ホーム表示をオフにした人（forHome）を除き、同じ走者を新しい順の先頭1件に絞ってから切り出す
 */
async function getHomeFeedVideos(db: Database, url: URL, platform: "youtube" | "twitch"): Promise<FeedVideo[]> {
  const forHome = url.searchParams.get("perRunner") === "1";
  const feed = await getPublicVideoFeed(db, { platform }, { forHome });
  return (forHome ? onePerRunner(feed) : feed).slice(0, HOME_FEED_VIDEO_LIMIT);
}

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

// Twitchリンク一覧のキャッシュ（形状を変えたら版数を上げる）
const TWITCH_LINKS_CACHE_KEY = "home-feed:twitch-links:v2";
type TwitchLinkData = Awaited<ReturnType<typeof getPublicTwitchLinks>>[number];
interface TwitchLinkCache {
  links: TwitchLinkData[];
}

async function getCachedTwitchLinks(): Promise<TwitchLinkCache | null> {
  return getCached<TwitchLinkCache>(TWITCH_LINKS_CACHE_KEY);
}

async function fetchAndCacheTwitchLinks(): Promise<TwitchLinkCache> {
  // クエリ本体（可視性ルール含む）は videos-feed.server.ts と共有し、ここではキャッシュのみ担う
  const twitchLinks = await getPublicTwitchLinks();

  const data: TwitchLinkCache = { links: twitchLinks };
  await setCached(TWITCH_LINKS_CACHE_KEY, data, CACHE_TTL.TWITCH_LINKS);
  return data;
}

async function getTwitchLinks(): Promise<TwitchLinkCache> {
  const cached = await getCachedTwitchLinks();
  if (cached) return cached;
  return fetchAndCacheTwitchLinks();
}

// 上流 API の失敗応答。0 件の正常応答と区別するため 502 にし、どこにもキャッシュさせない
function upstreamFailure(): Response {
  return Response.json({ error: "Upstream unavailable" }, { status: 502, headers: { "Cache-Control": "no-store" } });
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
      const cacheKey = "home-feed:live-runs:v3";
      // マップは liveRuns に出てくる mcid の分だけ（全公開ユーザー分を15秒ポーリングで再送しない）。
      // splitBests: 走者ごとの「同区間のベスト IGT」（蓄積ペース〈直近2か月〉内の最小。区間名 → ミリ秒）。
      // paceman_paces は列名に反して rta 列に IGT が入っている（igt 列は常に null。paceman-cache.ts 参照）ので、
      // 下の集計の min(rta) / max(rta) は IGT どうしの比較になる。igt 列に置き換えると全区間が null になる
      type LiveRunsCache = {
        liveRuns: PaceManLiveRun[];
        splitBests: Record<string, Record<string, number>>;
      } & McidUserMaps;

      const cached = await getCached<LiveRunsCache>(cacheKey);
      if (cached) {
        return jsonResponse(cached, CDN_CACHE.LIVE_RUNS);
      }
      // 直前に上流（PaceMan）が失敗していたら、期限内は上流を呼ばずに失敗を返す
      const failKey = `${cacheKey}:fail`;
      if (await getCached<true>(failKey)) return upstreamFailure();

      // ユーザーデータとライブランを並列取得
      const [userData, liveRuns, hidden] = await Promise.all([
        getUserData(),
        fetchLiveRuns(),
        getHomeHiddenUsers(createDb()),
      ]);

      // 上流（PaceMan）の失敗は 0 件と区別してエラー応答にする（サーバー・CDN ともキャッシュしない）
      // 負キャッシュは上流（PaceMan）の失敗だけ。DB 側の一時エラーは例外として伝わり、覚えない
      if (liveRuns === null) {
        await setCached(failKey, true, UPSTREAM_FAILURE_TTL);
        return upstreamFailure();
      }

      // 「ホーム画面にPaceManのペースを表示」をオフにした人は全員のホームから除く（mcid は大文字小文字を無視）
      const registeredMcidSet = new Set(userData.registeredMcids);
      const filteredLiveRuns = liveRuns
        .filter((run) => {
          const mcid = run.nickname.toLowerCase();
          return registeredMcidSet.has(mcid) && !hidden.pacemanMcids.has(mcid);
        })
        .slice(0, 20)
        // 「ホーム画面にTwitch配信を表示」をオフにした人は「Twitch で見る」リンク・配信中の印の元（liveAccount）も消す
        // （閲覧者非依存のままサーバー側で除外。mcid → slug は公開ユーザーのマップで引く）
        .map((run) => {
          const slug = userData.mcidToSlug[run.nickname.toLowerCase()];
          return slug && hidden.twitchSlugs.has(slug) && run.user.liveAccount
            ? { ...run, user: { ...run.user, liveAccount: null } }
            : run;
        });

      // 同区間ベスト（ライブ走者の分だけ。失敗しても比較を出さないだけで一覧は返す）
      const splitBests: Record<string, Record<string, number>> = {};
      if (filteredLiveRuns.length > 0) {
        const db = createDb();
        const scope = and(
          inArray(
            sql`lower(${pacemanPaces.mcid})`,
            filteredLiveRuns.map((run) => run.nickname.toLowerCase()),
          ),
          lt(pacemanPaces.date, new Date(Date.now() - SPLIT_BEST_EXCLUDE_MS)),
        );
        // 2つ目の構造物: 蓄積ペースは構造物を種類でしか持たないので、同じランで Bastion・Fortress の両方に
        // 着いたものの遅い方を2つ目とし、その最小を取る（1つ目の速い記録と比べないため）
        const structureRuns = db
          .select({
            mcid: sql<string>`lower(${pacemanPaces.mcid})`.as("mcid"),
            secondAt: sql<number>`max(${pacemanPaces.rta})`.as("second_at"),
          })
          .from(pacemanPaces)
          .where(and(scope, inArray(pacemanPaces.timeline, ["Bastion", "Fortress"])))
          .groupBy(sql`lower(${pacemanPaces.mcid})`, pacemanPaces.pacemanRunId)
          .having(sql`count(distinct ${pacemanPaces.timeline}) = 2`)
          .as("structure_runs");
        const [rows, secondRows] = await Promise.all([
          db
            .select({
              mcid: sql<string>`lower(${pacemanPaces.mcid})`,
              timeline: pacemanPaces.timeline,
              best: sql<number>`min(${pacemanPaces.rta})`,
            })
            .from(pacemanPaces)
            .where(scope)
            .groupBy(sql`lower(${pacemanPaces.mcid})`, pacemanPaces.timeline)
            .catch(() => []),
          db
            .select({ mcid: structureRuns.mcid, best: sql<number>`min(${structureRuns.secondAt})` })
            .from(structureRuns)
            .groupBy(sql`${structureRuns.mcid}`)
            .catch(() => []),
        ]);
        for (const r of rows) {
          (splitBests[r.mcid] ??= {})[r.timeline] = Number(r.best);
        }
        for (const r of secondRows) {
          (splitBests[r.mcid] ??= {})[SECOND_STRUCTURE_BEST_KEY] = Number(r.best);
        }
      }

      const result: LiveRunsCache = {
        liveRuns: filteredLiveRuns,
        splitBests,
        ...pickUserDataForMcids(userData, filteredLiveRuns.map((run) => run.nickname)),
      };

      // キャッシュに保存
      await setCached(cacheKey, result, CACHE_TTL.LIVE_RUNS);

      return jsonResponse(result, CDN_CACHE.LIVE_RUNS);
    }

    case "recent-paces": {
      const [userData, hidden] = await Promise.all([getUserData(), getHomeHiddenUsers(createDb())]);

      // DBキャッシュからペースを取得（新しい順、フィードは最新12件まで）
      // Enter Nether以外の全Split（Bastion, Fortress, First Portal, 2nd Structure以降）を含む
      // 視聴者ロールのペースは除外（userData.registeredMcidsはviewer除外済み）
      // showPacemanOnHome=false の人は全員のホームから除く
      const registeredMcidSet = new Set(userData.registeredMcids.filter((mcid) => !hidden.pacemanMcids.has(mcid)));
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
          // 表示する12件に出てくる mcid の分だけ（クライアントのカード表示・お気に入り並べ替え用）
          ...pickUserDataForMcids(userData, recentPaces.map((p) => p.mcid)),
        },
        CDN_CACHE.PACES,
        CDN_SWR_LONG
      );
    }

    case "ranked-live": {
      // MCSR Ranked の公開ライブ試合のうち Minefolio 登録者が出ているもの。ユーザー非依存・30秒キャッシュ
      const cacheKey = "home-feed:ranked-live:v3";
      const cached = await getCached<{ matches: RankedLiveMatch[]; fetchedAt: number }>(cacheKey);
      if (cached) return jsonResponse(cached, CDN_CACHE.LIVE_RUNS);

      // 直前に上流（MCSR Ranked）が失敗していたら、期限内は上流を呼ばずに失敗を返す
      const failKey = `${cacheKey}:fail`;
      if (await getCached<true>(failKey)) return upstreamFailure();

      const matches = await fetchRankedLiveMatches(createDb());
      if (matches === null) {
        await setCached(failKey, true, UPSTREAM_FAILURE_TTL);
        return upstreamFailure();
      }
      // fetchedAt: 取得時刻（クライアントが試合開始時刻を推定する基準。配信遅延・端末時計のずれの影響を受けない）
      const result = { matches, fetchedAt: Date.now() };
      await setCached(cacheKey, result, CACHE_TTL.LIVE_RUNS);
      return jsonResponse(result, CDN_CACHE.LIVE_RUNS);
    }

    case "ranked-result": {
      // 終了した Ranked 試合の結果。登録者以外・未確定・上流失敗はどれも同じ pending（キャッシュしない）
      const result = await fetchRankedResult(createDb(), {
        uuid: url.searchParams.get("uuid") ?? "",
        opponent: url.searchParams.get("opponent") ?? "",
        sinceMs: Number(url.searchParams.get("since") ?? "NaN"),
      });
      return Response.json(result, { headers: { "Cache-Control": "no-store" } });
    }

    case "pace-timeline": {
      // 過去のペースカードのタイムラインモーダル用: 特定ラン（mcid + pacemanRunId）の全スプリットを返す
      const mcid = url.searchParams.get("mcid");
      const runIdParam = url.searchParams.get("runId");
      const runId = runIdParam ? Number.parseInt(runIdParam, 10) : NaN;
      if (!mcid || !Number.isFinite(runId)) {
        return Response.json({ error: "mcid and runId are required" }, { status: 400 });
      }

      // 公開プロフィール（視聴者除外）として登録されている mcid だけ。それ以外は「存在しない」場合と同じ空の応答にして、
      // 登録の有無（非公開・視聴者・未登録）を応答から判別できないようにする
      const mcidKey = mcid.toLowerCase();
      if (!(await getUserData()).registeredMcids.includes(mcidKey)) {
        return jsonResponse({ timeline: [] }, CDN_CACHE.PACES, CDN_SWR_LONG);
      }

      const cacheKey = `home-feed:pace-timeline:${mcidKey}:${runId}`;
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
      const cacheKey = "home-feed:twitch:all:v2";
      type TwitchCache = { liveStreams: HomeTwitchStream[] };

      const cached = await getCached<TwitchCache>(cacheKey);
      if (cached) {
        return jsonResponse({ liveStreams: cached.liveStreams }, CDN_CACHE.TWITCH);
      }

      // Twitchリンク一覧を取得（キャッシュあり）
      // 「ホーム画面にTwitch配信を表示」をオフにした人は問い合わせ前に除く（全員のホームから除外）
      const [{ links: allTwitchLinks }, hidden] = await Promise.all([getTwitchLinks(), getHomeHiddenUsers(createDb())]);
      const twitchLinks = allTwitchLinks.filter((l) => !hidden.twitchSlugs.has(l.slug));

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

      const liveStreams = streams.map((stream): HomeTwitchStream => {
        const link = twitchLinkByIdentifier.get(stream.user_login.toLowerCase());
        return {
          stream,
          mcid: link?.mcid ?? null,
          uuid: link?.uuid ?? null,
          slug: link?.slug ?? "",
          displayName: link?.displayName ?? null,
          displayNameAlphabet: link?.displayNameAlphabet ?? null,
          discordAvatar: link?.discordAvatar ?? null,
          customSkinUrl: link?.customSkinUrl ?? null,
        };
      });

      const result: TwitchCache = { liveStreams };
      await setCached(cacheKey, result, CACHE_TTL.TWITCH);

      return jsonResponse({ liveStreams }, CDN_CACHE.TWITCH);
    }

    case "youtube-videos": {
      // キャッシュテーブル（Cronが2時間毎に更新）から取得。可視性・ユーザー紐付けは
      // /videos と同一の getPublicVideoFeed に委譲し、twitch-vods と同じ FeedVideo 形式で返す
      // perRunner=1（ホーム）: 同じ走者の動画は新しい順の先頭1本に絞ってから切り出す
      // perRunner=1（ホーム呼び出し）では showYoutubeOnHome=false の人の動画を除く
      const recentVideos = await getHomeFeedVideos(createDb(), url, "youtube");

      // 0件は、動画公開・障害復旧で即変わり得るため短TTLで返す
      // （長TTL+SWRだと空状態がエッジに最大1日残ってしまう）
      if (recentVideos.length === 0) {
        return jsonResponse({ recentVideos: [] }, 60);
      }

      return jsonResponse({ recentVideos }, CDN_CACHE.YOUTUBE, CDN_SWR_LONG);
    }

    case "twitch-vods": {
      // キャッシュテーブル（twitch_vod_cache。Cronが30分毎に更新）から取得
      // perRunner=1（ホーム「最近配信した人」）: 1人1行にするため、人ごとの最新1件に絞ってから切り出す
      // perRunner=1（ホーム呼び出し）では showTwitchOnHome=false の人のVODを除く
      const recentVods = await getHomeFeedVideos(createDb(), url, "twitch");

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
