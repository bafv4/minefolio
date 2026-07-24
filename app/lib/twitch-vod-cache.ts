// Twitch配信アーカイブ（VOD）キャッシュ管理（cron 書き込み経路）
// youtube-cache.ts と同様に Cron（/api/cron/twitch-update）で定期的に蓄積・検証される。
// 読み出し（ユーザー紐付け・可視性ゲート）は videos-feed.server.ts の getPublicVideoFeed に集約

import { eq, and, lt, asc, inArray, sql } from "drizzle-orm";
import { createDb } from "./db";
import { twitchVodCache } from "./schema";
import { createId } from "@paralleldrive/cuid2";
import { getTwitchAppToken, getRecentVods, getVodsByIds } from "./twitch";
import { getPublicTwitchLinks } from "./videos-feed.server";
import { videoRetentionCutoff } from "./feed-video";

// キャッシュ管理設定（youtube-cache.ts の CACHE_CONFIG に相当）
const VOD_CACHE_CONFIG = {
  // 再検証を許可する最短間隔。cron の verify スケジュール（8時間毎）より短くして、
  // 毎回の実行で必ず対象が出るようにする（Twitch VODは配信者設定により14〜60日で自動削除される）
  VERIFICATION_INTERVAL: 6 * 60 * 60 * 1000,
  // 1回の検証で確認する最大件数（lastVerifiedAt が古い順に処理）
  VERIFICATION_BATCH: 100,
};

/**
 * 登録ユーザーの最新VODをAPIから取得してキャッシュに保存（Cron: update）
 * vodId は UNIQUE のため1回のバッチupsertで書き込む（タイトル・サムネイル（処理中→生成済み）・
 * 配信時間（進行中→確定）が変わり得るため、既存行も excluded 値で更新する）
 */
export async function fetchAndCacheNewVods(
  clientId: string,
  clientSecret: string
): Promise<{ added: number; updated: number; channels: number }> {
  const db = createDb();
  // リンク一覧とトークン取得は独立なので並列化（トークンはメモリキャッシュ済みのことが多い）
  const [links, token] = await Promise.all([
    getPublicTwitchLinks(),
    getTwitchAppToken(clientId, clientSecret),
  ]);
  if (links.length === 0) return { added: 0, updated: 0, channels: 0 };
  if (!token) return { added: 0, updated: 0, channels: links.length };

  const vods = await getRecentVods(
    clientId,
    token,
    links.map((l) => l.identifier)
  );
  if (vods.length === 0) return { added: 0, updated: 0, channels: links.length };

  // added / updated の集計用に既存IDを1クエリで取得
  const existingRows = await db.query.twitchVodCache.findMany({
    where: inArray(twitchVodCache.vodId, vods.map((v) => v.id)),
    columns: { vodId: true },
  });
  const existingIds = new Set(existingRows.map((r) => r.vodId));

  const now = new Date();
  await db
    .insert(twitchVodCache)
    .values(
      vods.map((v) => ({
        id: createId(),
        vodId: v.id,
        userLogin: v.userLogin,
        title: v.title,
        thumbnailUrl: v.thumbnailUrl,
        channelTitle: v.userName,
        durationSeconds: v.durationSeconds,
        publishedAt: new Date(v.publishedAt),
        lastVerifiedAt: now,
      }))
    )
    .onConflictDoUpdate({
      target: twitchVodCache.vodId,
      set: {
        title: sql`excluded.title`,
        thumbnailUrl: sql`excluded.thumbnail_url`,
        channelTitle: sql`excluded.channel_title`,
        durationSeconds: sql`excluded.duration_seconds`,
        isAvailable: true,
        lastVerifiedAt: now,
        updatedAt: now,
      },
    });

  return {
    added: vods.length - existingIds.size,
    updated: existingIds.size,
    channels: links.length,
  };
}

/**
 * VODの存在確認を行い、削除済みのVODをマーク（Cron: verify）
 * lastVerifiedAt が古い順に最大100件ずつ処理する
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
    orderBy: [asc(twitchVodCache.lastVerifiedAt)],
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
    const result = await db
      .delete(twitchVodCache)
      .where(lt(twitchVodCache.publishedAt, videoRetentionCutoff()));
    return result.rowsAffected;
  } catch (error) {
    console.error("Failed to cleanup old VODs:", error);
    return 0;
  }
}
