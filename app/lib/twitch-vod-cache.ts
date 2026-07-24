// Twitch配信アーカイブ（VOD）キャッシュ管理
// youtube-cache.ts と同様に Cron（/api/cron/twitch-update）で定期的に蓄積・検証される。
// ユーザーとの紐付けは userLogin（小文字）を social_links.identifier と読み時に突合する

import { eq, desc, and, lt, gte, inArray } from "drizzle-orm";
import { createDb } from "./db";
import { twitchVodCache } from "./schema";
import { createId } from "@paralleldrive/cuid2";
import { getTwitchAppToken, getRecentVods, getVodsByIds } from "./twitch";
import { VIDEO_FEED_RETENTION_DAYS, getPublicTwitchLinks } from "./videos-feed.server";
import type { FeedVideo } from "@/components/feed-video-card";

// キャッシュ管理設定（youtube-cache.ts の CACHE_CONFIG に相当）
const VOD_CACHE_CONFIG = {
  // 存在確認の間隔（12時間）。Twitch VODは配信者設定により14〜60日で自動削除されるため定期検証する
  VERIFICATION_INTERVAL: 12 * 60 * 60 * 1000,
  // 1回の検証で確認する最大件数
  VERIFICATION_BATCH: 100,
  // ホームフィード用の最大取得件数
  MAX_VODS: 10,
};

type TwitchLinkUser = Awaited<ReturnType<typeof getPublicTwitchLinks>>[number];

/** login（小文字）→ 紐付けユーザーのマップを構築 */
function buildLinkMap(links: TwitchLinkUser[]): Map<string, TwitchLinkUser> {
  return new Map(links.map((l) => [l.identifier.toLowerCase(), l]));
}

/** キャッシュ行 + リンクユーザー → FeedVideo 形式へ変換 */
function toFeedVideo(
  row: typeof twitchVodCache.$inferSelect,
  link: TwitchLinkUser
): FeedVideo {
  return {
    platform: "twitch",
    videoId: row.vodId,
    title: row.title,
    thumbnailUrl: row.thumbnailUrl,
    channelTitle: row.channelTitle,
    publishedAt: row.publishedAt,
    durationSeconds: row.durationSeconds,
    minefolioMcid: link.mcid,
    uuid: link.uuid,
    slug: link.slug,
    displayName: link.displayName,
    discordAvatar: link.discordAvatar,
    customSkinUrl: link.customSkinUrl,
  };
}

/**
 * キャッシュから最新VODを取得（ユーザー情報付き）。
 * 公開プロフィールのTwitchリンクに紐付くVODのみ返す（リンク解除・非公開化で自然に消える）
 */
export async function getCachedVods(limit: number = VOD_CACHE_CONFIG.MAX_VODS): Promise<FeedVideo[]> {
  try {
    const db = createDb();
    const cutoff = new Date(Date.now() - VIDEO_FEED_RETENTION_DAYS * 24 * 60 * 60 * 1000);

    const [rows, links] = await Promise.all([
      db.query.twitchVodCache.findMany({
        where: and(
          eq(twitchVodCache.isAvailable, true),
          gte(twitchVodCache.publishedAt, cutoff),
        ),
        orderBy: [desc(twitchVodCache.publishedAt)],
        // 可視性フィルタで間引かれる分を見込んで多めに取得
        limit: limit * 3,
      }),
      getPublicTwitchLinks(),
    ]);

    const linkMap = buildLinkMap(links);
    const result: FeedVideo[] = [];
    for (const row of rows) {
      const link = linkMap.get(row.userLogin);
      if (!link) continue; // リンク解除・非公開・viewer化したユーザーのVODは出さない
      result.push(toFeedVideo(row, link));
      if (result.length >= limit) break;
    }
    return result;
  } catch (error) {
    console.error("Failed to get cached VODs:", error);
    return [];
  }
}

/**
 * 登録ユーザーの最新VODをAPIから取得してキャッシュに保存（Cron: update）
 */
export async function fetchAndCacheNewVods(
  clientId: string,
  clientSecret: string
): Promise<{ added: number; updated: number; channels: number }> {
  const db = createDb();
  const links = await getPublicTwitchLinks();
  if (links.length === 0) return { added: 0, updated: 0, channels: 0 };

  const token = await getTwitchAppToken(clientId, clientSecret);
  if (!token) return { added: 0, updated: 0, channels: links.length };

  const vods = await getRecentVods(
    clientId,
    token,
    links.map((l) => l.identifier)
  );

  let added = 0;
  let updated = 0;

  for (const vod of vods) {
    const existing = await db.query.twitchVodCache.findFirst({
      where: eq(twitchVodCache.vodId, vod.id),
    });

    if (existing) {
      // タイトル・サムネイル（処理中→生成済み）・配信時間（進行中→確定）が変わり得るため更新
      await db
        .update(twitchVodCache)
        .set({
          title: vod.title,
          thumbnailUrl: vod.thumbnailUrl,
          channelTitle: vod.userName,
          durationSeconds: vod.durationSeconds,
          isAvailable: true,
          lastVerifiedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(twitchVodCache.vodId, vod.id));
      updated++;
    } else {
      await db.insert(twitchVodCache).values({
        id: createId(),
        vodId: vod.id,
        userLogin: vod.userLogin,
        title: vod.title,
        thumbnailUrl: vod.thumbnailUrl,
        channelTitle: vod.userName,
        durationSeconds: vod.durationSeconds,
        publishedAt: new Date(vod.publishedAt),
        lastVerifiedAt: new Date(),
        isAvailable: true,
      });
      added++;
    }
  }

  return { added, updated, channels: links.length };
}

/**
 * VODの存在確認を行い、削除済みのVODをマーク（Cron: verify）
 * Twitch VODは配信者設定により14〜60日で自動削除されるため、youtube-cache と同様に定期検証する
 */
export async function verifyVodsExistence(
  clientId: string,
  clientSecret: string
): Promise<{ verified: number; removed: number }> {
  const db = createDb();
  const verificationCutoff = new Date(Date.now() - VOD_CACHE_CONFIG.VERIFICATION_INTERVAL);

  const vodsToVerify = await db.query.twitchVodCache.findMany({
    where: and(
      eq(twitchVodCache.isAvailable, true),
      lt(twitchVodCache.lastVerifiedAt, verificationCutoff)
    ),
    limit: VOD_CACHE_CONFIG.VERIFICATION_BATCH,
  });

  if (vodsToVerify.length === 0) {
    return { verified: 0, removed: 0 };
  }

  const token = await getTwitchAppToken(clientId, clientSecret);
  if (!token) return { verified: 0, removed: 0 };

  const vodIds = vodsToVerify.map((v) => v.vodId);
  const existingIds = await getVodsByIds(clientId, token, vodIds);

  const verifiedIds = vodIds.filter((id) => existingIds.has(id));
  const removedIds = vodIds.filter((id) => !existingIds.has(id));

  if (verifiedIds.length > 0) {
    await db
      .update(twitchVodCache)
      .set({ lastVerifiedAt: new Date(), updatedAt: new Date() })
      .where(inArray(twitchVodCache.vodId, verifiedIds));
  }
  if (removedIds.length > 0) {
    await db
      .update(twitchVodCache)
      .set({ isAvailable: false, lastVerifiedAt: new Date(), updatedAt: new Date() })
      .where(inArray(twitchVodCache.vodId, removedIds));
  }

  return { verified: verifiedIds.length, removed: removedIds.length };
}

/**
 * 保持期間（90日）を超えたVOD行を削除（Cron: update 内で実行）
 */
export async function cleanupOldVods(): Promise<number> {
  try {
    const db = createDb();
    const cutoff = new Date(Date.now() - VIDEO_FEED_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const result = await db
      .delete(twitchVodCache)
      .where(lt(twitchVodCache.publishedAt, cutoff));
    return result.rowsAffected;
  } catch (error) {
    console.error("Failed to cleanup old VODs:", error);
    return 0;
  }
}
