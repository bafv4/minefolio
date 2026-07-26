// 動画照会ページ（/videos）と /api/videos で共用するフィードロジック
// youtube_video_cache（YouTube動画）と twitch_vod_cache（Twitch VOD）を
// 統一形式 FeedVideo にマージし、検索条件で絞り込む。
// /paces（paces-feed.server.ts）と同じ構成: 全体をメモリキャッシュ → JSフィルタ → ページング

import { eq, and, isNotNull, gte, desc, inArray, sql } from "drizzle-orm";
import { createDb } from "./db";
import { createAuth } from "./auth";
import { users, socialLinks, youtubeVideoCache, twitchVodCache } from "./schema";
import { getOptionalSession } from "./session";
import { excludeViewersCondition } from "./users-filter";
import { getCached, setCached } from "./cache";
import { parseDateParam } from "./paces-feed.server";
import { videoRetentionCutoff, type FeedVideo } from "./feed-video";

// フィード全体のメモリキャッシュTTL（無限スクロールのページ毎の全走査を避ける）
const VIDEOS_FEED_CACHE_TTL = 60 * 1000;

/** 公開プロフィール（viewer除外）のTwitchリンク一覧（identifier=login と紐付けユーザー情報） */
export async function getPublicTwitchLinks() {
  const db = createDb();
  return db
    .select({
      identifier: socialLinks.identifier,
      mcid: users.mcid,
      uuid: users.uuid,
      slug: users.slug,
      displayName: users.displayName,
      displayNameAlphabet: users.displayNameAlphabet,
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
}

// /videos の検索条件
export interface VideoSearchFilters {
  player?: string; // MCID・表示名・チャンネル名の部分一致（小文字）
  platform?: "youtube" | "twitch";
  from?: Date;
  to?: Date;
}

/**
 * URLクエリパラメータから /videos の検索条件を解析する（不正な値は無視。
 * 日付は paces-feed.server.ts と共有の parseDateParam＝JST解釈）
 */
export function parseVideoSearchParams(searchParams: URLSearchParams): VideoSearchFilters {
  const filters: VideoSearchFilters = {};

  const player = searchParams.get("q")?.trim().toLowerCase();
  if (player) filters.player = player;

  const platform = searchParams.get("platform");
  if (platform === "youtube" || platform === "twitch") {
    filters.platform = platform;
  }

  filters.from = parseDateParam(searchParams.get("from"), false);
  filters.to = parseDateParam(searchParams.get("to"), true);

  return filters;
}

type Db = ReturnType<typeof createDb>;
type Auth = ReturnType<typeof createAuth>;

/**
 * フィード全体（フィルタ未適用・保持期間内・新しい順）を構築してキャッシュする。
 * 可視性: 公開プロフィール（viewer除外）に紐付く動画・VODのみ
 * （/paces と同じディスカバリ一覧の「公開のみ」ルール）
 */
async function getVideoFeedBase(db: Db): Promise<FeedVideo[]> {
  const cacheKey = "videos:feed:all";
  const cached = await getCached<FeedVideo[]>(cacheKey);
  if (cached) return cached;

  const cutoff = videoRetentionCutoff();

  const [ytRows, vodRows, twitchLinks] = await Promise.all([
    db.query.youtubeVideoCache.findMany({
      where: and(
        eq(youtubeVideoCache.isAvailable, true),
        gte(youtubeVideoCache.publishedAt, cutoff),
      ),
      orderBy: [desc(youtubeVideoCache.publishedAt)],
    }),
    db.query.twitchVodCache.findMany({
      where: and(
        eq(twitchVodCache.isAvailable, true),
        gte(twitchVodCache.publishedAt, cutoff),
      ),
      orderBy: [desc(twitchVodCache.publishedAt)],
    }),
    getPublicTwitchLinks(),
  ]);

  // YouTube動画に実際に紐付いているMCIDのユーザーのみ取得（全公開ユーザーの走査を避ける）
  const ytMcids = [
    ...new Set(
      ytRows
        .map((v) => v.minefolioMcid?.toLowerCase())
        .filter((mcid): mcid is string => !!mcid)
    ),
  ];
  const ytUsers =
    ytMcids.length > 0
      ? await db.query.users.findMany({
          where: and(
            isNotNull(users.mcid),
            inArray(sql`lower(${users.mcid})`, ytMcids),
            eq(users.profileVisibility, "public"),
            excludeViewersCondition,
          ),
          columns: {
            mcid: true,
            uuid: true,
            slug: true,
            displayName: true,
            displayNameAlphabet: true,
            discordAvatar: true,
            customSkinUrl: true,
          },
        })
      : [];

  const ytUserMap = new Map(ytUsers.map((u) => [u.mcid!.toLowerCase(), u]));
  const twitchLinkMap = new Map(twitchLinks.map((l) => [l.identifier.toLowerCase(), l]));

  const ytItems: FeedVideo[] = [];
  for (const v of ytRows) {
    // 紐付けユーザーが非公開・viewer化・退会した動画は出さない（紐付けなしの旧データは残す）
    const user = v.minefolioMcid ? ytUserMap.get(v.minefolioMcid.toLowerCase()) : null;
    if (v.minefolioMcid && !user) continue;
    ytItems.push({
      platform: "youtube",
      videoId: v.videoId,
      title: v.title,
      thumbnailUrl: v.thumbnailUrl,
      channelTitle: v.channelTitle,
      publishedAt: v.publishedAt,
      minefolioMcid: v.minefolioMcid,
      uuid: user?.uuid ?? null,
      slug: user?.slug ?? null,
      displayName: user?.displayName ?? null,
      displayNameAlphabet: user?.displayNameAlphabet ?? null,
      discordAvatar: user?.discordAvatar ?? null,
      customSkinUrl: user?.customSkinUrl ?? null,
    });
  }

  const vodItems: FeedVideo[] = [];
  for (const v of vodRows) {
    const link = twitchLinkMap.get(v.userLogin);
    if (!link) continue; // リンク解除・非公開化したユーザーのVODは出さない
    vodItems.push({
      platform: "twitch",
      videoId: v.vodId,
      title: v.title,
      thumbnailUrl: v.thumbnailUrl,
      channelTitle: v.channelTitle,
      publishedAt: v.publishedAt,
      durationSeconds: v.durationSeconds,
      minefolioMcid: link.mcid,
      uuid: link.uuid,
      slug: link.slug,
      displayName: link.displayName,
      displayNameAlphabet: link.displayNameAlphabet,
      discordAvatar: link.discordAvatar,
      customSkinUrl: link.customSkinUrl,
    });
  }

  // 両リストとも publishedAt 降順で取得済みのため、全体ソートせず線形マージする
  const timeOf = (v: FeedVideo) => new Date(v.publishedAt).getTime();
  const items: FeedVideo[] = [];
  let yi = 0;
  let vi = 0;
  while (yi < ytItems.length || vi < vodItems.length) {
    const yt = ytItems[yi];
    const vod = vodItems[vi];
    if (!vod || (yt && timeOf(yt) >= timeOf(vod))) {
      items.push(yt);
      yi++;
    } else {
      items.push(vod);
      vi++;
    }
  }

  await setCached(cacheKey, items, VIDEOS_FEED_CACHE_TTL);
  return items;
}

/**
 * 表示対象の動画一覧（保持期間内、新しい順、フィルタ適用済み）を取得（セッション非依存）
 * 「自分の動画を隠す」設定はここでは適用せず、getViewerVideoPrefs の結果で
 * クライアント側フィルタする（/paces・ホームと同じ挙動）
 */
export async function getPublicVideoFeed(
  db: Db,
  filters: VideoSearchFilters = {},
): Promise<FeedVideo[]> {
  let items = await getVideoFeedBase(db);

  if (filters.platform) {
    items = items.filter((v) => v.platform === filters.platform);
  }
  if (filters.from) {
    const fromMs = filters.from.getTime();
    items = items.filter((v) => new Date(v.publishedAt).getTime() >= fromMs);
  }
  if (filters.to) {
    const toMs = filters.to.getTime();
    items = items.filter((v) => new Date(v.publishedAt).getTime() <= toMs);
  }
  if (filters.player) {
    const q = filters.player;
    items = items.filter((v) => {
      const mcid = v.minefolioMcid?.toLowerCase() ?? "";
      const displayName = v.displayName?.toLowerCase() ?? "";
      const channel = v.channelTitle?.toLowerCase() ?? "";
      const slug = v.slug?.toLowerCase() ?? "";
      return (
        mcid.includes(q) || displayName.includes(q) || channel.includes(q) || slug.includes(q)
      );
    });
  }

  return items;
}

/**
 * ログインユーザーの表示設定（自分の動画/VODを一覧に表示するか）を取得
 * 未ログイン・未登録は全表示扱い
 */
export async function getViewerVideoPrefs(
  db: Db,
  auth: Auth,
  request: Request,
): Promise<{ mcid: string | null; showYoutubeOnHome: boolean; showTwitchOnHome: boolean }> {
  const session = await getOptionalSession(request, auth);
  if (!session) return { mcid: null, showYoutubeOnHome: true, showTwitchOnHome: true };

  const me = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
    columns: { mcid: true, showYoutubeOnHome: true, showTwitchOnHome: true },
  });
  if (!me) return { mcid: null, showYoutubeOnHome: true, showTwitchOnHome: true };

  return {
    mcid: me.mcid,
    showYoutubeOnHome: me.showYoutubeOnHome ?? true,
    showTwitchOnHome: me.showTwitchOnHome ?? true,
  };
}
