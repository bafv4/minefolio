// YouTube動画キャッシュ管理
// 2時間毎に新しい動画を確認し、半日に1回存在確認を行う

import { eq, desc, and, lt, ne } from "drizzle-orm";
import { createDb } from "./db";
import { youtubeVideoCache, youtubeLiveCache, users, socialLinks } from "./schema";
import { createId } from "@paralleldrive/cuid2";
import type { YouTubeVideo, YouTubeSearchResult } from "./youtube";

const YOUTUBE_API = "https://www.googleapis.com/youtube/v3";

// キャッシュ管理設定
const CACHE_CONFIG = {
  // 新しい動画の確認間隔（2時間）
  NEW_VIDEO_CHECK_INTERVAL: 2 * 60 * 60 * 1000,
  // 存在確認の間隔（12時間）
  VERIFICATION_INTERVAL: 12 * 60 * 60 * 1000,
  // 表示する動画の最大期間（72時間）
  MAX_AGE_HOURS: 72,
  // 取得する最大件数
  MAX_VIDEOS: 10,
};

export interface CachedYouTubeVideo {
  videoId: string;
  channelId: string;
  minefolioMcid: string | null;
  title: string;
  description: string | null;
  thumbnailUrl: string | null;
  channelTitle: string | null;
  publishedAt: Date;
  isAvailable: boolean;
}

/**
 * キャッシュから最新動画を取得
 * キャッシュが存在しない場合や更新が必要な場合はnullを返す
 */
export async function getCachedVideos(): Promise<CachedYouTubeVideo[] | null> {
  try {
    const db = createDb();
    const cutoffTime = new Date(Date.now() - CACHE_CONFIG.MAX_AGE_HOURS * 60 * 60 * 1000);

    const videos = await db.query.youtubeVideoCache.findMany({
      where: and(
        eq(youtubeVideoCache.isAvailable, true),
        // 72時間以内の動画のみ
      ),
      orderBy: [desc(youtubeVideoCache.publishedAt)],
      limit: CACHE_CONFIG.MAX_VIDEOS,
    });

    // 72時間以内の動画のみフィルタリング
    const recentVideos = videos.filter(v => v.publishedAt >= cutoffTime);

    if (recentVideos.length === 0) {
      return null;
    }

    return recentVideos.map(v => ({
      videoId: v.videoId,
      channelId: v.channelId,
      minefolioMcid: v.minefolioMcid,
      title: v.title,
      description: v.description,
      thumbnailUrl: v.thumbnailUrl,
      channelTitle: v.channelTitle,
      publishedAt: v.publishedAt,
      isAvailable: v.isAvailable,
    }));
  } catch (error) {
    console.error("Failed to get cached videos:", error);
    return null;
  }
}

/**
 * キャッシュされた動画をYouTubeVideo形式に変換
 */
export function convertToYouTubeVideoFormat(cached: CachedYouTubeVideo[]): YouTubeVideo[] {
  return cached.map(v => ({
    kind: "youtube#searchResult",
    etag: "",
    id: {
      kind: "youtube#video",
      videoId: v.videoId,
    },
    snippet: {
      publishedAt: v.publishedAt.toISOString(),
      channelId: v.channelId,
      title: v.title,
      description: v.description || "",
      thumbnails: {
        default: { url: v.thumbnailUrl || "", width: 120, height: 90 },
        medium: { url: v.thumbnailUrl?.replace("default", "mqdefault") || "", width: 320, height: 180 },
        high: { url: v.thumbnailUrl?.replace("default", "hqdefault") || "", width: 480, height: 360 },
      },
      channelTitle: v.channelTitle || "",
      liveBroadcastContent: "none",
    },
    minefolioMcid: v.minefolioMcid || undefined,
  }));
}

/**
 * 新しい動画をAPIから取得してキャッシュに保存
 */
export async function fetchAndCacheNewVideos(
  apiKey: string,
  channels: Array<{ channelId: string; mcid: string }>
): Promise<{ added: number; updated: number }> {
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

  return { added, updated };
}

/**
 * 動画の存在確認を行い、削除/非公開の動画をマーク
 */
export async function verifyVideosExistence(apiKey: string): Promise<{ verified: number; removed: number }> {
  const db = createDb();
  const verificationCutoff = new Date(Date.now() - CACHE_CONFIG.VERIFICATION_INTERVAL);

  // 最後の確認から12時間以上経過した動画を取得
  const videosToVerify = await db.query.youtubeVideoCache.findMany({
    where: and(
      eq(youtubeVideoCache.isAvailable, true),
      lt(youtubeVideoCache.lastVerifiedAt, verificationCutoff)
    ),
    limit: 50, // APIクォータ節約のため一度に50件まで
  });

  if (videosToVerify.length === 0) {
    return { verified: 0, removed: 0 };
  }

  const videoIds = videosToVerify.map(v => v.videoId);
  let verified = 0;
  let removed = 0;

  try {
    // バッチでビデオの存在確認（最大50件）
    const existingIds = await checkVideosExist(apiKey, videoIds);
    const existingSet = new Set(existingIds);

    for (const video of videosToVerify) {
      if (existingSet.has(video.videoId)) {
        // 存在する場合は確認日時を更新
        await db
          .update(youtubeVideoCache)
          .set({
            lastVerifiedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(youtubeVideoCache.videoId, video.videoId));
        verified++;
      } else {
        // 存在しない場合は非公開としてマーク
        await db
          .update(youtubeVideoCache)
          .set({
            isAvailable: false,
            lastVerifiedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(youtubeVideoCache.videoId, video.videoId));
        removed++;
      }
    }
  } catch (error) {
    console.error("Failed to verify videos:", error);
  }

  return { verified, removed };
}

/**
 * 最終更新時刻を取得
 */
export async function getLastUpdateTime(): Promise<Date | null> {
  try {
    const db = createDb();
    const latest = await db.query.youtubeVideoCache.findFirst({
      orderBy: [desc(youtubeVideoCache.updatedAt)],
      columns: { updatedAt: true },
    });
    return latest?.updatedAt || null;
  } catch {
    return null;
  }
}

/**
 * 更新が必要かどうかを確認
 */
export async function needsUpdate(): Promise<boolean> {
  const lastUpdate = await getLastUpdateTime();
  if (!lastUpdate) return true;

  const elapsed = Date.now() - lastUpdate.getTime();
  return elapsed > CACHE_CONFIG.NEW_VIDEO_CHECK_INTERVAL;
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

    const res = await fetch(`${YOUTUBE_API}/search?${params}`);
    if (!res.ok) return [];

    const data = await res.json();
    return data.items || [];
  } catch {
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

    const res = await fetch(`${YOUTUBE_API}/channels?${params}`);
    if (!res.ok) return null;

    const data = await res.json();
    return data.items?.[0]?.id || null;
  } catch {
    return null;
  }
}

async function checkVideosExist(
  apiKey: string,
  videoIds: string[]
): Promise<string[]> {
  try {
    const params = new URLSearchParams({
      key: apiKey,
      id: videoIds.join(","),
      part: "id,status",
    });

    const res = await fetch(`${YOUTUBE_API}/videos?${params}`);
    if (!res.ok) return [];

    const data = await res.json();
    // 公開されている動画のIDのみ返す
    return (data.items || [])
      .filter((item: any) => item.status?.privacyStatus === "public")
      .map((item: any) => item.id);
  } catch {
    return [];
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
        eq(socialLinks.platform, "youtube")
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
// ========================================

// ライブ配信キャッシュ設定
const LIVE_CACHE_CONFIG = {
  // ライブ配信確認間隔（30分）- クォータ効率重視
  LIVE_CHECK_INTERVAL: 30 * 60 * 1000,
  // 終了した配信のクリーンアップ間隔（1時間）
  CLEANUP_INTERVAL: 60 * 60 * 1000,
};

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
}

/**
 * キャッシュからライブ配信を取得
 */
export async function getCachedLiveStreams(): Promise<CachedYouTubeLive[]> {
  try {
    const db = createDb();

    // ライブ中または配信予定の動画を取得
    const streams = await db.query.youtubeLiveCache.findMany({
      where: ne(youtubeLiveCache.liveBroadcastContent, "none"),
      orderBy: [desc(youtubeLiveCache.concurrentViewers)],
    });

    return streams.map(s => ({
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
    }));
  } catch (error) {
    console.error("Failed to get cached live streams:", error);
    return [];
  }
}

/**
 * ライブ配信の最終確認時刻を取得
 */
export async function getLiveLastCheckTime(): Promise<Date | null> {
  try {
    const db = createDb();
    const latest = await db.query.youtubeLiveCache.findFirst({
      orderBy: [desc(youtubeLiveCache.lastCheckedAt)],
      columns: { lastCheckedAt: true },
    });
    return latest?.lastCheckedAt || null;
  } catch {
    return null;
  }
}

/**
 * ライブ配信の更新が必要かどうか確認
 */
export async function needsLiveUpdate(): Promise<boolean> {
  const lastCheck = await getLiveLastCheckTime();
  if (!lastCheck) return true;

  const elapsed = Date.now() - lastCheck.getTime();
  return elapsed > LIVE_CACHE_CONFIG.LIVE_CHECK_INTERVAL;
}

/**
 * YouTubeライブ配信をAPIから取得してキャッシュに保存
 * クォータ効率重視: Videos APIを使用（1クォータ/リクエスト）
 */
export async function fetchAndCacheLiveStreams(
  apiKey: string,
  channels: Array<{ channelId: string; mcid: string }>
): Promise<{ live: number; upcoming: number; ended: number }> {
  const db = createDb();
  let live = 0;
  let upcoming = 0;
  let ended = 0;

  // まず、各チャンネルのライブ配信をSearch APIで検索
  // クォータ節約のため、チャンネル数を制限（最大10チャンネル）
  const channelsToCheck = channels.slice(0, 10);
  const liveVideoIds: Array<{ videoId: string; channelId: string; mcid: string }> = [];

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

      const searchRes = await fetch(`${YOUTUBE_API}/search?${searchParams}`);
      if (searchRes.ok) {
        const searchData = await searchRes.json();
        for (const item of searchData.items || []) {
          if (item.id?.videoId) {
            liveVideoIds.push({ videoId: item.id.videoId, channelId, mcid });
          }
        }
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

      const upcomingRes = await fetch(`${YOUTUBE_API}/search?${upcomingParams}`);
      if (upcomingRes.ok) {
        const upcomingData = await upcomingRes.json();
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

  // 動画IDがない場合は終了
  if (liveVideoIds.length === 0) {
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

    return { live, upcoming, ended };
  }

  // Videos APIで詳細情報を取得（1クォータ/リクエスト、最大50件）
  const videoIds = [...new Set(liveVideoIds.map(v => v.videoId))];
  const videoIdToInfo = new Map(liveVideoIds.map(v => [v.videoId, v]));

  try {
    const videosParams = new URLSearchParams({
      key: apiKey,
      id: videoIds.join(","),
      part: "snippet,liveStreamingDetails",
    });

    const videosRes = await fetch(`${YOUTUBE_API}/videos?${videosParams}`);
    if (!videosRes.ok) {
      console.error("Failed to fetch video details:", await videosRes.text());
      return { live, upcoming, ended };
    }

    const videosData = await videosRes.json();
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
