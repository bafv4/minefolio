// 1ユーザー/1チャンネル単位の即時リフレッシュ（cron を待たない反映）。
// プロフィール編集の action（SNSリンクの追加/削除・MCID変更）から、
// レスポンスを返した後にバックグラウンドで呼ばれることを想定している。
//
// すべての関数は内部でエラーを握って console.error に残すだけで、呼び出し側の action を
// 絶対にブロック・失敗させない（throw しない）。cron 側の一括更新ロジック（twitch-vod-cache.ts /
// youtube-cache.ts / rankings-update.server.ts）をそのまま1件スコープで再利用する薄いラッパー

import { errorSummary } from "@/lib/error-summary";
import { waitUntil } from "@vercel/functions";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { getEnv } from "./env.server";
import { createDb } from "./db";
import { users, speedrunCategories, youtubeVideoCache, twitchVodCache, socialLinks } from "./schema";
import { getTwitchAppToken, getRecentVods } from "./twitch";
import { applyFetchedVods, findKnownVodIds } from "./twitch-vod-cache";
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
    console.error("[targeted-refresh] background task failed:", errorSummary(error));
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

    const { vods, incompleteLogins } = await getRecentVods(clientId, token, [login], {
      getKnownVodIds: findKnownVodIds,
    });
    await applyFetchedVods(vods, incompleteLogins);
  } catch (error) {
    console.error(`[targeted-refresh] Failed to refresh Twitch VODs for ${login}:`, errorSummary(error));
  }
}

/** リンクを外した（変えた）本人。共有キャッシュのうち、他の走者の登録分を消さないための判定に使う */
export type LinkOwner = {
  userId: string;
  /** 本人の MCID（変更・削除を含む保存では旧・新の両方。`youtube_video_cache.minefolio_mcid` との一致に使う） */
  mcids: readonly (string | null | undefined)[];
};

/**
 * リンク解除時に、そのTwitchチャンネルのVODキャッシュ行を削除する。
 * `twitch_vod_cache` はチャンネル単位の共有キャッシュで誰の登録かの列を持たないため、
 * 自分以外の走者が同じ login（大文字小文字を無視）の twitch リンクを持っているときは消さない
 * （自己申告のリンクを作って外すだけで、他人の VOD をキャッシュから消せてしまうのを防ぐ）。
 * 判定に失敗したときも消さない側に倒す
 */
export async function deleteTwitchVodsForLogin(login: string, owner: LinkOwner): Promise<void> {
  try {
    const db = createDb();
    const lowered = login.toLowerCase();
    const otherOwner = await db
      .select({ id: socialLinks.id })
      .from(socialLinks)
      .where(
        and(
          eq(socialLinks.platform, "twitch"),
          sql`lower(${socialLinks.identifier}) = ${lowered}`,
          ne(socialLinks.userId, owner.userId),
        ),
      )
      .limit(1);
    if (otherOwner.length > 0) return;

    await db.delete(twitchVodCache).where(sql`lower(${twitchVodCache.userLogin}) = ${lowered}`);
  } catch (error) {
    console.error(`[targeted-refresh] Failed to delete Twitch VODs for ${login}:`, errorSummary(error));
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
    console.error(`[targeted-refresh] Failed to refresh YouTube videos for ${identifier}:`, errorSummary(error));
  }
}

/**
 * リンク解除時に、そのYouTubeチャンネル（ハンドル/UC-ID両対応）の動画キャッシュ行のうち、
 * 本人の MCID に帰属した行だけを削除する。識別子を解決できなければ何もしない。
 * `youtube_video_cache` はチャンネル単位の共有キャッシュで、行は最初に取得した走者の MCID に帰属する
 * （再取得で上書きされない）。他の走者の MCID に帰属した行は、同じチャンネルでも消さない。
 * 本人の MCID が無ければ（取得がスキップされるため帰属行も無い）何も消さない
 */
export async function deleteYoutubeVideosForChannelIdentifier(identifier: string, owner: LinkOwner): Promise<void> {
  try {
    const mcids = [...new Set(owner.mcids.filter((m): m is string => Boolean(m)).map((m) => m.toLowerCase()))];
    if (mcids.length === 0) return;

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
    await db
      .delete(youtubeVideoCache)
      .where(
        and(
          eq(youtubeVideoCache.channelId, channelId),
          inArray(sql`lower(${youtubeVideoCache.minefolioMcid})`, mcids),
        ),
      );
  } catch (error) {
    console.error(`[targeted-refresh] Failed to delete YouTube videos for ${identifier}:`, errorSummary(error));
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
      errorSummary(error)
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
    console.error(`[targeted-refresh] Failed to refresh SRC rankings for user ${userId}:`, errorSummary(error));
  }
}
