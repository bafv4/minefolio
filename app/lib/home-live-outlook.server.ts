// ホームの読み込み中の骨組みの「見込み」。SSR の時点で、ライブ欄・動画欄の骨組みを「0件の形」にするか「カードの形」にするかを選ぶための情報
// （読み込み後に高さが大きく変わって下の欄が飛ぶのを避ける。ui.md 8章）。
// 上流（PaceMan・Ranked・Twitch）は呼ばず、サーバーのキャッシュに残っている値と DB の1行確認だけで決める。
// 見込みが外れたとき（人・動画が居た）は、クライアントが本物に合わせて伸ばすだけで、表示の正しさには影響しない。
import { createDb } from "./db";
import { getCached } from "./cache";
import { pacemanPaces, youtubeVideoCache, twitchVodCache } from "./schema";
import { and, eq, gte } from "drizzle-orm";
import { getPaceRetentionStart } from "./paceman-cache";
import { videoRetentionCutoff } from "./feed-video";

/** /api/home-feed の Ranked ライブ・Twitch 配信のキャッシュキー（api/home-feed.ts と共有） */
export const RANKED_LIVE_CACHE_KEY = "home-feed:ranked-live:v3";
export const TWITCH_STREAMS_CACHE_KEY = "home-feed:twitch:all:v2";
/** ホームが実際に出した PaceMan ライブの件数（登録走者で絞った後）。api/home-feed の live-runs が残す（見込みの判定用） */
export const HOME_LIVE_COUNT_CACHE_KEY = "home-feed:live-count:v1";
export const HOME_LIVE_COUNT_TTL_MS = 5 * 60 * 1000;

/** empty: 0件の見込み／unknown: 分からない（既定。カードの形の骨組みを出す） */
export type HomeOutlook = "empty" | "unknown";

export interface HomeOutlooks {
  /** ライブ0人かつ最近のペース0件の見込み */
  live: HomeOutlook;
  /** 動画（YouTube・Twitch VOD）0件の見込み */
  videos: HomeOutlook;
}

/**
 * ライブ欄: 「0人・最近のペース0件」と言い切れるときだけ "empty"。
 * - ホームが実際に出したライブの件数（/api/home-feed の live-runs が登録走者で絞った後の件数を5分残す）が0であること
 *   （居れば unknown）。PaceMan の生のライブ一覧は Minefolio 未登録の走者を含み、ホームでは0人でも居ることになるため使わない。
 *   残りが無いときは判断材料にしない（キャッシュはインメモリで、ローカル開発・サーバーレスのコールド起動では常に空。ここで unknown にすると、
 *   0人の環境でも毎回カード3枚ぶんの骨組みが 1 行に縮んで下の欄が飛ぶ）。DB の蓄積ペースが0件であることで補う
 * - Ranked 対戦・Twitch 配信のキャッシュが、あれば空であること（無ければ判断材料にしない）
 * - 保持期間内の蓄積ペース（ネザー入場以外）が DB に1行も無いこと
 */
async function liveOutlook(db: ReturnType<typeof createDb>): Promise<HomeOutlook> {
  const [liveCount, ranked, twitch] = await Promise.all([
    getCached<number>(HOME_LIVE_COUNT_CACHE_KEY),
    getCached<{ matches: unknown[] }>(RANKED_LIVE_CACHE_KEY),
    getCached<{ liveStreams: unknown[] }>(TWITCH_STREAMS_CACHE_KEY),
  ]);
  if (liveCount !== null && liveCount > 0) return "unknown";
  if (ranked && ranked.matches.length > 0) return "unknown";
  if (twitch && twitch.liveStreams.length > 0) return "unknown";

  const anyPace = await db
    .select({ id: pacemanPaces.pacemanRunId })
    .from(pacemanPaces)
    .where(and(eq(pacemanPaces.isNetherEnter, false), gte(pacemanPaces.date, getPaceRetentionStart())))
    .limit(1);
  return anyPace.length === 0 ? "empty" : "unknown";
}

/**
 * 動画欄: 保持期間内の YouTube 動画・Twitch VOD のキャッシュ行が1行も無いときだけ "empty"。
 * ホームは配信中だけでも Twitch の段を出すので、Twitch 配信のキャッシュが空でなければ unknown
 * （キャッシュが無いときは判断材料にしない）
 */
async function videosOutlook(db: ReturnType<typeof createDb>): Promise<HomeOutlook> {
  const twitch = await getCached<{ liveStreams: unknown[] }>(TWITCH_STREAMS_CACHE_KEY);
  if (twitch && twitch.liveStreams.length > 0) return "unknown";
  const cutoff = videoRetentionCutoff();
  const [yt, vod] = await Promise.all([
    db
      .select({ id: youtubeVideoCache.videoId })
      .from(youtubeVideoCache)
      .where(and(eq(youtubeVideoCache.isAvailable, true), gte(youtubeVideoCache.publishedAt, cutoff)))
      .limit(1),
    db
      .select({ id: twitchVodCache.vodId })
      .from(twitchVodCache)
      .where(and(eq(twitchVodCache.isAvailable, true), gte(twitchVodCache.publishedAt, cutoff)))
      .limit(1),
  ]);
  return yt.length === 0 && vod.length === 0 ? "empty" : "unknown";
}

export async function getHomeOutlooks(): Promise<HomeOutlooks> {
  const db = createDb();
  const [live, videos] = await Promise.all([
    liveOutlook(db).catch((): HomeOutlook => "unknown"),
    videosOutlook(db).catch((): HomeOutlook => "unknown"),
  ]);
  return { live, videos };
}
