// Twitch配信アーカイブ（VOD）キャッシュ管理（cron 書き込み経路）
// youtube-cache.ts と同様に Cron（/api/cron/twitch-update）で定期的に蓄積・検証される。
// 読み出し（ユーザー紐付け・可視性ゲート）は videos-feed.server.ts の getPublicVideoFeed に集約

import { eq, and, lt, gte, asc, inArray, sql } from "drizzle-orm";
import { createDb } from "./db";
import { twitchVodCache } from "./schema";
import { createId } from "@paralleldrive/cuid2";
import { getTwitchAppToken, getRecentVods, getVodsByIds, type TwitchVod } from "./twitch";
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
 * 取得済みの VOD マップ（login→公開VOD配列。取得成功チャンネルのみキーを持つ）を DB に反映する。
 * vodId は UNIQUE のため1回のバッチupsertで書き込む（タイトル・サムネイル（処理中→生成済み）・
 * 配信時間（進行中→確定）が変わり得るため、既存行も excluded 値で更新する）。
 *
 * 取得に成功したチャンネル（0件の応答も含む＝ vods にキーがある）については、キャッシュにあるが
 * 今回の取得結果に含まれない行（Twitch側で削除 or 非公開化）を差分削除する。判定不能なチャンネル
 * （vods にキーが無い = login解決不可・API呼び出し失敗）と、ページング安全上限で打ち切られた
 * チャンネル（incompleteLogins。保持期間内に未取得のVODが残りうる）では削除しない（フェイルオープン）。
 * 削除対象は保持期間（videoRetentionCutoff）内の行に限定し、期限切れ行の削除は cleanupOldVods に任せる。
 *
 * fetchAndCacheNewVods（全チャンネル一括）と targeted-refresh.server.ts の
 * refreshTwitchVodsForLogin（1チャンネル即時）の両方から使う共通部品
 */
export async function applyFetchedVods(
  vods: Map<string, TwitchVod[]>,
  incompleteLogins: ReadonlySet<string> = new Set()
): Promise<{ added: number; updated: number; deleted: number }> {
  const db = createDb();
  const allVods = [...vods.values()].flat();

  let added = 0;
  let updated = 0;
  if (allVods.length > 0) {
    // added / updated の集計用に既存IDを1クエリで取得
    const existingRows = await db.query.twitchVodCache.findMany({
      where: inArray(twitchVodCache.vodId, allVods.map((v) => v.id)),
      columns: { vodId: true },
    });
    const existingIds = new Set(existingRows.map((r) => r.vodId));

    const now = new Date();
    // SQLiteのbind変数上限（チャンネル数×最大500件で数千行になりうる）を避けるため500行ずつ書き込む
    for (let i = 0; i < allVods.length; i += 500) {
      await db
        .insert(twitchVodCache)
        .values(
          allVods.slice(i, i + 500).map((v) => ({
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
    }

    added = allVods.length - existingIds.size;
    updated = existingIds.size;
  }

  // 差分削除: 取得に成功し、かつ全件取得しきれたチャンネルについてのみ、
  // キャッシュにあるが今回の結果に含まれない行を削除する
  let deleted = 0;
  const successfulLogins = [...vods.keys()].filter((login) => !incompleteLogins.has(login));
  if (successfulLogins.length > 0) {
    const currentVodIds = new Set(allVods.map((v) => v.id));
    const cachedRows = await db.query.twitchVodCache.findMany({
      where: and(
        inArray(twitchVodCache.userLogin, successfulLogins),
        gte(twitchVodCache.publishedAt, videoRetentionCutoff())
      ),
      columns: { id: true, vodId: true },
    });
    const staleIds = cachedRows.filter((r) => !currentVodIds.has(r.vodId)).map((r) => r.id);
    if (staleIds.length > 0) {
      await db.delete(twitchVodCache).where(inArray(twitchVodCache.id, staleIds));
      deleted = staleIds.length;
    }
  }

  return { added, updated, deleted };
}

/**
 * 登録ユーザーの最新VODをAPIから取得してキャッシュに保存（Cron: update）
 */
export async function fetchAndCacheNewVods(
  clientId: string,
  clientSecret: string
): Promise<{ added: number; updated: number; channels: number; deleted: number }> {
  // リンク一覧とトークン取得は独立なので並列化（トークンはメモリキャッシュ済みのことが多い）
  const [links, token] = await Promise.all([
    getPublicTwitchLinks(),
    getTwitchAppToken(clientId, clientSecret),
  ]);
  if (links.length === 0) return { added: 0, updated: 0, channels: 0, deleted: 0 };
  if (!token) return { added: 0, updated: 0, channels: links.length, deleted: 0 };

  const { vods, incompleteLogins } = await getRecentVods(
    clientId,
    token,
    links.map((l) => l.identifier)
  );

  const result = await applyFetchedVods(vods, incompleteLogins);
  return { ...result, channels: links.length };
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
