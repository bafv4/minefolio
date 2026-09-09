// 1ユーザー/1チャンネル単位の即時リフレッシュ（cron を待たない反映）。
// プロフィール編集の action（SNSリンクの追加/削除・MCID変更）から、
// レスポンスを返した後にバックグラウンドで呼ばれることを想定している。
//
// すべての関数は内部でエラーを握って console.error に残すだけで、呼び出し側の action を
// 絶対にブロック・失敗させない（throw しない）。cron 側の一括更新ロジック（twitch-vod-cache.ts /
// youtube-cache.ts / rankings-update.server.ts）をそのまま1件スコープで再利用する薄いラッパー

import { waitUntil } from "@vercel/functions";
import { eq, sql } from "drizzle-orm";
import { getEnv } from "./env.server";
import { createDb } from "./db";
import { users, speedrunCategories, youtubeVideoCache, twitchVodCache } from "./schema";
import { getTwitchAppToken, getRecentVods } from "./twitch";
import { applyFetchedVods } from "./twitch-vod-cache";
import { resolveChannelId } from "./youtube";
import { fetchChannelUploadsForCache, upsertVideoCache } from "./youtube-cache";
import { updateUserRankings, cleanupDuplicateVerifiedRankings } from "./rankings-update.server";

/**
 * レスポンスを返した後にバックグラウンドで実行するタスクを登録する。
 * Vercel 上では @vercel/functions の waitUntil でリクエストのライフタイムを延長する。
 * それ以外（ローカル開発等）では waitUntil が no-op になるだけで、task 自体は既に実行が
 * 開始された Promise なので、そのままバックグラウンドで完了まで実行される（fire-and-forget）。
 */
export function runAfterResponse(task: Promise<unknown>): void {
  const safeTask = task.catch((error) => {
    console.error("[targeted-refresh] background task failed:", error);
  });
  try {
    waitUntil(safeTask);
  } catch (error) {
    console.error("[targeted-refresh] waitUntil call failed:", error);
  }
}

/**
 * 指定Twitchチャンネルの最新VODを即時に全件取得し、cronと同じ差分削除ロジック
 * （twitch-vod-cache.ts の applyFetchedVods）で反映する。TWITCH認証情報未設定なら何もしない
 */
export async function refreshTwitchVodsForLogin(login: string): Promise<void> {
  try {
    const env = getEnv();
    const clientId = env.TWITCH_CLIENT_ID;
    const clientSecret = env.TWITCH_CLIENT_SECRET;
    if (!clientId || !clientSecret) return;

    const token = await getTwitchAppToken(clientId, clientSecret);
    if (!token) return;

    const { vods, incompleteLogins } = await getRecentVods(clientId, token, [login]);
    await applyFetchedVods(vods, incompleteLogins);
  } catch (error) {
    console.error(`[targeted-refresh] Failed to refresh Twitch VODs for ${login}:`, error);
  }
}

/**
 * リンク解除時に、そのTwitchチャンネルのVODキャッシュ行を削除する
 */
export async function deleteTwitchVodsForLogin(login: string): Promise<void> {
  try {
    const db = createDb();
    await db
      .delete(twitchVodCache)
      .where(sql`lower(${twitchVodCache.userLogin}) = ${login.toLowerCase()}`);
  } catch (error) {
    console.error(`[targeted-refresh] Failed to delete Twitch VODs for ${login}:`, error);
  }
}

/**
 * 指定YouTubeチャンネルの最新動画を即時に取得し、キャッシュへ反映する。
 * YOUTUBE_API_KEY未設定なら何もしない
 */
export async function refreshYoutubeForChannel(identifier: string, mcid: string): Promise<void> {
  try {
    const env = getEnv();
    if (!env.YOUTUBE_API_KEY) return;

    const pending = await fetchChannelUploadsForCache(env.YOUTUBE_API_KEY, identifier, mcid, 10);
    await upsertVideoCache(pending);
  } catch (error) {
    console.error(`[targeted-refresh] Failed to refresh YouTube videos for ${identifier}:`, error);
  }
}

/**
 * リンク解除時に、そのYouTubeチャンネル（ハンドル/UC-ID両対応）の動画キャッシュ行を削除する。
 * 識別子を解決できなければ何もしない
 */
export async function deleteYoutubeVideosForChannelIdentifier(identifier: string): Promise<void> {
  try {
    const env = getEnv();
    const apiKey = env.YOUTUBE_API_KEY;
    const isChannelIdFormat = identifier.startsWith("UC") && identifier.length === 24;
    const channelId = isChannelIdFormat
      ? identifier
      : apiKey
        ? await resolveChannelId(apiKey, identifier)
        : null;
    if (!channelId) return;

    const db = createDb();
    await db.delete(youtubeVideoCache).where(eq(youtubeVideoCache.channelId, channelId));
  } catch (error) {
    console.error(`[targeted-refresh] Failed to delete YouTube videos for ${identifier}:`, error);
  }
}

/**
 * MCID変更時に、youtube_video_cache.minefolio_mcid の紐付けを新MCIDへ追従させる
 * （大文字小文字を区別しない一致で更新。旧MCIDのまま残ると一覧から消えてしまうため）
 */
export async function updateYoutubeCacheMcid(oldMcid: string, newMcid: string): Promise<void> {
  try {
    const db = createDb();
    await db
      .update(youtubeVideoCache)
      .set({ minefolioMcid: newMcid, updatedAt: new Date() })
      .where(sql`lower(${youtubeVideoCache.minefolioMcid}) = ${oldMcid.toLowerCase()}`);
  } catch (error) {
    console.error(
      `[targeted-refresh] Failed to update YouTube cache MCID from ${oldMcid} to ${newMcid}:`,
      error
    );
  }
}

/**
 * 指定ユーザーのSpeedrun.com/MCSR Rankedランキング行を即時更新する
 * （api/cron/update-rankings.ts の全ユーザー走査ループと同じ rankings-update.server.ts を1ユーザー分だけ呼ぶ）
 */
export async function refreshSrcRankingsForUser(userId: string): Promise<void> {
  try {
    const db = createDb();
    const [categories, user] = await Promise.all([
      db.query.speedrunCategories.findMany({ where: eq(speedrunCategories.isActive, true) }),
      db.query.users.findFirst({
        where: eq(users.id, userId),
        columns: { id: true, mcid: true, uuid: true, speedruncomId: true, speedruncomUsername: true },
      }),
    ]);
    if (!user) return;

    await updateUserRankings(db, categories, user);
    await cleanupDuplicateVerifiedRankings(db, userId);
  } catch (error) {
    console.error(`[targeted-refresh] Failed to refresh SRC rankings for user ${userId}:`, error);
  }
}
