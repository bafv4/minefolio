// YouTube動画キャッシュ管理
// Cronで定期的に更新される

import { eq, desc, asc, and, lt, ne, inArray } from "drizzle-orm";
import { createDb } from "./db";
import { youtubeVideoCache, youtubeLiveCache, users, socialLinks } from "./schema";
import { excludeViewersCondition } from "./users-filter";
import { createId } from "@paralleldrive/cuid2";
import { videoRetentionCutoff } from "./feed-video";
import type { YouTubeSearchResult } from "./youtube";

const YOUTUBE_API = "https://www.googleapis.com/youtube/v3";

// キャッシュ管理設定
// 表示・保持する動画の最大期間は feed-video.ts の VIDEO_FEED_RETENTION_DAYS（90日）を共用
const CACHE_CONFIG = {
  // 存在確認の間隔（12時間）
  VERIFICATION_INTERVAL: 12 * 60 * 60 * 1000,
};

// 読み出し（ユーザー紐付け・可視性ゲート・FeedVideo変換）は videos-feed.server.ts の
// getPublicVideoFeed に集約されている。このモジュールは cron の書き込み経路のみを担う

/**
 * 新しい動画をAPIから取得してキャッシュに保存
 */
export async function fetchAndCacheNewVideos(
  apiKey: string,
  channels: Array<{ channelId: string; mcid: string }>
): Promise<{ added: number; updated: number }> {
  console.log(`[YouTube API] Starting fetchAndCacheNewVideos for ${channels.length} channels`);
  const db = createDb();
  let added = 0;
  let updated = 0;

  for (const { channelId: identifier, mcid } of channels.slice(0, 10)) {
    try {
      // チャンネルIDを解決
      const channelId = await resolveChannelIdInternal(apiKey, identifier);
      if (!channelId) continue;

      // 最新動画を取得
      const videos = await fetchChannelVideos(apiKey, channelId, 3);

      for (const video of videos) {
        const videoId = video.id.videoId;
        if (!videoId) continue;

        // 既存のキャッシュを確認
        const existing = await db.query.youtubeVideoCache.findFirst({
          where: eq(youtubeVideoCache.videoId, videoId),
        });

        if (existing) {
          // 既存の場合は更新（タイトルなどが変わっている可能性）
          await db
            .update(youtubeVideoCache)
            .set({
              title: video.snippet.title,
              description: video.snippet.description,
              thumbnailUrl: video.snippet.thumbnails.medium?.url || video.snippet.thumbnails.default?.url,
              channelTitle: video.snippet.channelTitle,
              isAvailable: true,
              lastVerifiedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(youtubeVideoCache.videoId, videoId));
          updated++;
        } else {
          // 新規追加
          await db.insert(youtubeVideoCache).values({
            id: createId(),
            videoId,
            channelId,
            minefolioMcid: mcid,
            title: video.snippet.title,
            description: video.snippet.description,
            thumbnailUrl: video.snippet.thumbnails.medium?.url || video.snippet.thumbnails.default?.url,
            channelTitle: video.snippet.channelTitle,
            publishedAt: new Date(video.snippet.publishedAt),
            lastVerifiedAt: new Date(),
            isAvailable: true,
          });
          added++;
        }
      }
    } catch (error) {
      console.error(`Failed to fetch videos for channel ${identifier}:`, error);
    }
  }

  console.log(`[YouTube API] fetchAndCacheNewVideos completed: added=${added}, updated=${updated}`);
  return { added, updated };
}

/**
 * 動画の存在確認を行い、削除/非公開の動画をマーク
 */
export async function verifyVideosExistence(apiKey: string): Promise<{ verified: number; removed: number }> {
  const db = createDb();
  const verificationCutoff = new Date(Date.now() - CACHE_CONFIG.VERIFICATION_INTERVAL);

  // 最後の確認から12時間以上経過した動画を、古い順に取得
  // （90日保持で対象が積み上がるため、最も stale な行から消化する）
  const videosToVerify = await db.query.youtubeVideoCache.findMany({
    where: and(
      eq(youtubeVideoCache.isAvailable, true),
      lt(youtubeVideoCache.lastVerifiedAt, verificationCutoff)
    ),
    orderBy: [asc(youtubeVideoCache.lastVerifiedAt)],
    limit: 50, // APIクォータ節約のため一度に50件まで
  });

  if (videosToVerify.length === 0) {
    return { verified: 0, removed: 0 };
  }

  const videoIds = videosToVerify.map(v => v.videoId);
  let verified = 0;
  let removed = 0;

  try {
    // バッチでビデオの存在確認（最大50件）。
    // API障害時（null）は判定不能のため何もマークしない（フェイルオープン。
    // 誤って isAvailable=false にすると以後の検証対象から外れ、恒久的に非表示になるため）
    const existingIds = await checkVideosExist(apiKey, videoIds);
    if (existingIds === null) {
      return { verified: 0, removed: 0 };
    }
    const existingSet = new Set(existingIds);

    const verifiedIds = videoIds.filter((id) => existingSet.has(id));
    const removedIds = videoIds.filter((id) => !existingSet.has(id));

    if (verifiedIds.length > 0) {
      // 存在する場合は確認日時を更新
      await db
        .update(youtubeVideoCache)
        .set({ lastVerifiedAt: new Date(), updatedAt: new Date() })
        .where(inArray(youtubeVideoCache.videoId, verifiedIds));
      verified = verifiedIds.length;
    }
    if (removedIds.length > 0) {
      // 存在しない場合は非公開としてマーク
      await db
        .update(youtubeVideoCache)
        .set({ isAvailable: false, lastVerifiedAt: new Date(), updatedAt: new Date() })
        .where(inArray(youtubeVideoCache.videoId, removedIds));
      removed = removedIds.length;
    }
  } catch (error) {
    console.error("Failed to verify videos:", error);
  }

  return { verified, removed };
}

/**
 * 保持期間（90日）を超えた動画キャッシュ行を削除（Cron: update 内で実行）
 */
export async function cleanupOldVideos(): Promise<number> {
  try {
    const db = createDb();
    const result = await db
      .delete(youtubeVideoCache)
      .where(lt(youtubeVideoCache.publishedAt, videoRetentionCutoff()));
    return result.rowsAffected;
  } catch (error) {
    console.error("Failed to cleanup old videos:", error);
    return 0;
  }
}

// ========================================
// 内部ヘルパー関数
// ========================================

async function fetchChannelVideos(
  apiKey: string,
  channelId: string,
  maxResults: number
): Promise<YouTubeSearchResult[]> {
  try {
    const params = new URLSearchParams({
      key: apiKey,
      channelId,
      part: "snippet",
      type: "video",
      order: "date",
      maxResults: String(maxResults),
    });

    console.log(`[YouTube API] Fetching videos for channel: ${channelId}`);
    const res = await fetch(`${YOUTUBE_API}/search?${params}`, { signal: AbortSignal.timeout(10000) });

    if (!res.ok) {
      const errorText = await res.text();
      console.error(`[YouTube API] Search failed (${res.status}): ${errorText}`);
      return [];
    }

    const data = await res.json();
    console.log(`[YouTube API] Search response for ${channelId}:`, JSON.stringify({
      totalResults: data.pageInfo?.totalResults,
      resultsPerPage: data.pageInfo?.resultsPerPage,
      itemCount: data.items?.length || 0,
      items: data.items?.map((item: any) => ({
        videoId: item.id?.videoId,
        title: item.snippet?.title,
        publishedAt: item.snippet?.publishedAt,
      })),
    }));
    return data.items || [];
  } catch (error) {
    console.error(`[YouTube API] Search error for channel ${channelId}:`, error);
    return [];
  }
}

async function resolveChannelIdInternal(
  apiKey: string,
  identifier: string
): Promise<string | null> {
  // UCで始まる場合はチャンネルID
  if (identifier.startsWith("UC") && identifier.length === 24) {
    return identifier;
  }

  // ハンドルからチャンネルIDを解決
  try {
    const username = identifier.startsWith("@") ? identifier.slice(1) : identifier;
    const params = new URLSearchParams({
      key: apiKey,
      forHandle: username,
      part: "id",
    });

    console.log(`[YouTube API] Resolving handle: @${username}`);
    const res = await fetch(`${YOUTUBE_API}/channels?${params}`, { signal: AbortSignal.timeout(10000) });

    if (!res.ok) {
      const errorText = await res.text();
      console.error(`[YouTube API] Channel resolution failed (${res.status}): ${errorText}`);
      return null;
    }

    const data = await res.json();
    const channelId = data.items?.[0]?.id || null;
    console.log(`[YouTube API] Resolved @${username} -> ${channelId}`);
    return channelId;
  } catch (error) {
    console.error(`[YouTube API] Channel resolution error for ${identifier}:`, error);
    return null;
  }
}

// 存在する（公開中の）動画IDを返す。API障害時は null（「全件削除された」と区別するため）
async function checkVideosExist(
  apiKey: string,
  videoIds: string[]
): Promise<string[] | null> {
  try {
    const params = new URLSearchParams({
      key: apiKey,
      id: videoIds.join(","),
      part: "id,status",
    });

    const res = await fetch(`${YOUTUBE_API}/videos?${params}`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) {
      console.error("YouTube videos verification API failed:", res.status);
      return null;
    }

    const data = await res.json();
    // 公開されている動画のIDのみ返す
    return (data.items || [])
      .filter((item: any) => item.status?.privacyStatus === "public")
      .map((item: any) => item.id);
  } catch (error) {
    console.error("YouTube videos verification error:", error);
    return null;
  }
}

/**
 * 登録ユーザーのYouTubeチャンネル情報を取得
 */
export async function getRegisteredYouTubeChannels(): Promise<Array<{ channelId: string; mcid: string }>> {
  const db = createDb();

  const youtubeLinks = await db
    .select({
      identifier: socialLinks.identifier,
      mcid: users.mcid,
    })
    .from(socialLinks)
    .innerJoin(users, eq(socialLinks.userId, users.id))
    .where(
      and(
        eq(users.profileVisibility, "public"),
        eq(socialLinks.platform, "youtube"),
        excludeViewersCondition,
      )
    );

  return youtubeLinks
    .filter((l) => l.mcid !== null)
    .map((l) => ({
      channelId: l.identifier,
      mcid: l.mcid!,
    }));
}

// ========================================
// YouTubeライブ配信キャッシュ機能
// ※ 利用停止中: Search APIのクォータコスト（1リクエスト100ユニット）が高く、
//   日次クォータ（10,000ユニット）をすぐに消費してしまうため。
//   将来的にRSS/Atomフィードや別の方法で再実装を検討。
// ========================================


export interface CachedYouTubeLive {
  videoId: string;
  channelId: string;
  minefolioMcid: string | null;
  title: string;
  description: string | null;
  thumbnailUrl: string | null;
  channelTitle: string | null;
  liveBroadcastContent: "live" | "upcoming" | "none";
  scheduledStartTime: Date | null;
  actualStartTime: Date | null;
  concurrentViewers: number | null;
  // ユーザー情報
  uuid: string | null;
  slug: string | null;
  displayName: string | null;
  displayNameAlphabet: string | null;
  discordAvatar: string | null;
  customSkinUrl: string | null;
}

/**
 * キャッシュからライブ配信を取得（ユーザー情報付き）
 */
export async function getCachedLiveStreams(): Promise<CachedYouTubeLive[]> {
  try {
    const db = createDb();

    // ライブ中または配信予定の動画を取得（ユーザー情報をJOIN）
    const streams = await db.query.youtubeLiveCache.findMany({
      where: ne(youtubeLiveCache.liveBroadcastContent, "none"),
      orderBy: [desc(youtubeLiveCache.concurrentViewers)],
    });

    // MCIDからユーザー情報を取得（視聴者ロールは除外）
    const mcids = streams
      .map(s => s.minefolioMcid)
      .filter((mcid): mcid is string => mcid !== null);

    const usersData = mcids.length > 0
      ? await db.query.users.findMany({
          where: excludeViewersCondition,
          columns: { mcid: true, uuid: true, slug: true, displayName: true, displayNameAlphabet: true, discordAvatar: true, customSkinUrl: true },
        })
      : [];

    const userMap = new Map(
      usersData
        .filter(u => u.mcid !== null)
        .map(u => [u.mcid!.toLowerCase(), u])
    );

    // 視聴者ロールに紐づく配信（minefolioMcid あり かつ userMap に無し）を除外
    const filteredStreams = streams.filter(s => {
      if (!s.minefolioMcid) return true;
      return userMap.has(s.minefolioMcid.toLowerCase());
    });

    return filteredStreams.map(s => {
      const user = s.minefolioMcid ? userMap.get(s.minefolioMcid.toLowerCase()) : null;
      return {
        videoId: s.videoId,
        channelId: s.channelId,
        minefolioMcid: s.minefolioMcid,
        title: s.title,
        description: s.description,
        thumbnailUrl: s.thumbnailUrl,
        channelTitle: s.channelTitle,
        liveBroadcastContent: s.liveBroadcastContent as "live" | "upcoming" | "none",
        scheduledStartTime: s.scheduledStartTime,
        actualStartTime: s.actualStartTime,
        concurrentViewers: s.concurrentViewers,
        uuid: user?.uuid ?? null,
        slug: user?.slug ?? null,
        displayName: user?.displayName ?? null,
        displayNameAlphabet: user?.displayNameAlphabet ?? null,
        discordAvatar: user?.discordAvatar ?? null,
        customSkinUrl: user?.customSkinUrl ?? null,
      };
    });
  } catch (error) {
    console.error("Failed to get cached live streams:", error);
    return [];
  }
}

/**
 * YouTubeライブ配信をAPIから取得してキャッシュに保存
 * クォータ効率重視: Videos APIを使用（1クォータ/リクエスト）
 */
export async function fetchAndCacheLiveStreams(
  apiKey: string,
  channels: Array<{ channelId: string; mcid: string }>
): Promise<{ live: number; upcoming: number; ended: number }> {
  console.log(`[YouTube API] Starting fetchAndCacheLiveStreams for ${channels.length} channels`);
  const db = createDb();
  let live = 0;
  let upcoming = 0;
  let ended = 0;

  // まず、各チャンネルのライブ配信をSearch APIで検索
  // クォータ節約のため、チャンネル数を制限（最大10チャンネル）
  const channelsToCheck = channels.slice(0, 10);
  const liveVideoIds: Array<{ videoId: string; channelId: string; mcid: string }> = [];
  let successfulApiCalls = 0; // 成功したAPIコールをカウント

  for (const { channelId: identifier, mcid } of channelsToCheck) {
    try {
      // チャンネルIDを解決
      const channelId = await resolveChannelIdInternal(apiKey, identifier);
      if (!channelId) continue;

      // ライブ配信中または配信予定を検索（Search API: 100クォータ）
      const searchParams = new URLSearchParams({
        key: apiKey,
        channelId,
        part: "id",
        type: "video",
        eventType: "live", // ライブ中のみ
        maxResults: "5",
      });

      console.log(`[YouTube API] Searching live streams for channel: ${channelId}`);
      const searchRes = await fetch(`${YOUTUBE_API}/search?${searchParams}`, { signal: AbortSignal.timeout(10000) });
      if (searchRes.ok) {
        successfulApiCalls++;
        const searchData = await searchRes.json();
        console.log(`[YouTube API] Live search response for ${channelId}:`, JSON.stringify({
          totalResults: searchData.pageInfo?.totalResults,
          itemCount: searchData.items?.length || 0,
          videoIds: searchData.items?.map((item: any) => item.id?.videoId),
        }));
        for (const item of searchData.items || []) {
          if (item.id?.videoId) {
            liveVideoIds.push({ videoId: item.id.videoId, channelId, mcid });
          }
        }
      } else {
        const errorText = await searchRes.text();
        console.error(`[YouTube API] Live search failed (${searchRes.status}): ${errorText}`);
      }

      // 配信予定も検索
      const upcomingParams = new URLSearchParams({
        key: apiKey,
        channelId,
        part: "id",
        type: "video",
        eventType: "upcoming",
        maxResults: "3",
      });

      console.log(`[YouTube API] Searching upcoming streams for channel: ${channelId}`);
      const upcomingRes = await fetch(`${YOUTUBE_API}/search?${upcomingParams}`, { signal: AbortSignal.timeout(10000) });
      if (upcomingRes.ok) {
        successfulApiCalls++;
        const upcomingData = await upcomingRes.json();
        console.log(`[YouTube API] Upcoming search response for ${channelId}:`, JSON.stringify({
          totalResults: upcomingData.pageInfo?.totalResults,
          itemCount: upcomingData.items?.length || 0,
          videoIds: upcomingData.items?.map((item: any) => item.id?.videoId),
        }));
        for (const item of upcomingData.items || []) {
          if (item.id?.videoId) {
            liveVideoIds.push({ videoId: item.id.videoId, channelId, mcid });
          }
        }
      }
    } catch (error) {
      console.error(`Failed to search live for channel ${identifier}:`, error);
    }
  }

  // 動画IDがない場合
  if (liveVideoIds.length === 0) {
    // APIが少なくとも1回成功した場合のみキャッシュをクリア
    // 全てのAPIコールが失敗した場合はクォータ切れ等の可能性があるため、既存キャッシュを維持
    if (successfulApiCalls > 0) {
      // 既存のキャッシュをクリア（配信終了）
      const existingStreams = await db.query.youtubeLiveCache.findMany({
        where: ne(youtubeLiveCache.liveBroadcastContent, "none"),
      });

      for (const stream of existingStreams) {
        await db
          .update(youtubeLiveCache)
          .set({
            liveBroadcastContent: "none",
            lastCheckedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(youtubeLiveCache.videoId, stream.videoId));
        ended++;
      }
    } else if (channelsToCheck.length > 0) {
      console.warn("All YouTube API calls failed, keeping existing cache");
    }

    return { live, upcoming, ended };
  }

  // Videos APIで詳細情報を取得（1クォータ/リクエスト、最大50件）
  const videoIds = [...new Set(liveVideoIds.map(v => v.videoId))];
  const videoIdToInfo = new Map(liveVideoIds.map(v => [v.videoId, v]));

  console.log(`[YouTube API] Fetching video details for ${videoIds.length} videos: ${videoIds.join(", ")}`);

  try {
    const videosParams = new URLSearchParams({
      key: apiKey,
      id: videoIds.join(","),
      part: "snippet,liveStreamingDetails",
    });

    const videosRes = await fetch(`${YOUTUBE_API}/videos?${videosParams}`, { signal: AbortSignal.timeout(10000) });
    if (!videosRes.ok) {
      const errorText = await videosRes.text();
      console.error(`[YouTube API] Videos API failed (${videosRes.status}): ${errorText}`);
      return { live, upcoming, ended };
    }

    const videosData = await videosRes.json();
    console.log(`[YouTube API] Videos API response:`, JSON.stringify({
      itemCount: videosData.items?.length || 0,
      items: videosData.items?.map((item: any) => ({
        videoId: item.id,
        title: item.snippet?.title,
        liveBroadcastContent: item.snippet?.liveBroadcastContent,
        concurrentViewers: item.liveStreamingDetails?.concurrentViewers,
      })),
    }));
    const currentLiveIds = new Set<string>();

    for (const video of videosData.items || []) {
      const videoId = video.id;
      const info = videoIdToInfo.get(videoId);
      if (!info) continue;

      const snippet = video.snippet;
      const liveDetails = video.liveStreamingDetails;
      const broadcastContent = snippet.liveBroadcastContent as "live" | "upcoming" | "none";

      if (broadcastContent === "none") continue;

      currentLiveIds.add(videoId);

      // 既存のキャッシュを確認
      const existing = await db.query.youtubeLiveCache.findFirst({
        where: eq(youtubeLiveCache.videoId, videoId),
      });

      const cacheData = {
        title: snippet.title,
        description: snippet.description,
        thumbnailUrl: snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url,
        channelTitle: snippet.channelTitle,
        liveBroadcastContent: broadcastContent,
        scheduledStartTime: liveDetails?.scheduledStartTime ? new Date(liveDetails.scheduledStartTime) : null,
        actualStartTime: liveDetails?.actualStartTime ? new Date(liveDetails.actualStartTime) : null,
        concurrentViewers: liveDetails?.concurrentViewers ? parseInt(liveDetails.concurrentViewers, 10) : null,
        lastCheckedAt: new Date(),
        updatedAt: new Date(),
      };

      if (existing) {
        await db
          .update(youtubeLiveCache)
          .set(cacheData)
          .where(eq(youtubeLiveCache.videoId, videoId));
      } else {
        await db.insert(youtubeLiveCache).values({
          id: createId(),
          videoId,
          channelId: info.channelId,
          minefolioMcid: info.mcid,
          ...cacheData,
        });
      }

      if (broadcastContent === "live") {
        live++;
      } else if (broadcastContent === "upcoming") {
        upcoming++;
      }
    }

    // 配信終了したものをマーク
    const existingStreams = await db.query.youtubeLiveCache.findMany({
      where: ne(youtubeLiveCache.liveBroadcastContent, "none"),
    });

    for (const stream of existingStreams) {
      if (!currentLiveIds.has(stream.videoId)) {
        await db
          .update(youtubeLiveCache)
          .set({
            liveBroadcastContent: "none",
            lastCheckedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(youtubeLiveCache.videoId, stream.videoId));
        ended++;
      }
    }
  } catch (error) {
    console.error("Failed to fetch live stream details:", error);
  }

  console.log(`[YouTube API] fetchAndCacheLiveStreams completed: live=${live}, upcoming=${upcoming}, ended=${ended}`);
  return { live, upcoming, ended };
}

/**
 * 古いライブキャッシュをクリーンアップ
 */
export async function cleanupOldLiveCache(): Promise<number> {
  try {
    const db = createDb();
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24時間前

    // 24時間以上前に終了した配信を削除
    const oldStreams = await db.query.youtubeLiveCache.findMany({
      where: and(
        eq(youtubeLiveCache.liveBroadcastContent, "none"),
        lt(youtubeLiveCache.updatedAt, cutoff)
      ),
    });

    for (const stream of oldStreams) {
      await db.delete(youtubeLiveCache).where(eq(youtubeLiveCache.id, stream.id));
    }

    return oldStreams.length;
  } catch (error) {
    console.error("Failed to cleanup old live cache:", error);
    return 0;
  }
}
