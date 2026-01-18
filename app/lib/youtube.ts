// YouTube Data API v3 - 最新動画取得

import { getCached, setCached, getYouTubeCacheKey, CacheTTL } from "./cache";

const YOUTUBE_API = "https://www.googleapis.com/youtube/v3";

export interface YouTubeVideoSnippet {
  publishedAt: string;
  channelId: string;
  title: string;
  description: string;
  thumbnails: {
    default: { url: string; width: number; height: number };
    medium: { url: string; width: number; height: number };
    high: { url: string; width: number; height: number };
  };
  channelTitle: string;
  liveBroadcastContent: "none" | "live" | "upcoming";
}

export interface YouTubeSearchResult {
  kind: string;
  etag: string;
  id: {
    kind: string;
    videoId?: string;
    channelId?: string;
    playlistId?: string;
  };
  snippet: YouTubeVideoSnippet;
}

export interface YouTubeVideo extends YouTubeSearchResult {
  // 追加のメタデータ
  minefolioMcid?: string; // Minefolioユーザーとの紐付け用
}

interface YouTubeSearchResponse {
  kind: string;
  etag: string;
  nextPageToken?: string;
  prevPageToken?: string;
  pageInfo: {
    totalResults: number;
    resultsPerPage: number;
  };
  items: YouTubeSearchResult[];
  error?: {
    code: number;
    message: string;
    errors: Array<{ message: string; domain: string; reason: string }>;
  };
}

/**
 * 指定したチャンネルの最新動画を取得
 * @param apiKey YouTube API Key
 * @param channelId YouTubeチャンネルID
 * @param maxResults 取得する最大件数（デフォルト: 3）
 */
export async function getChannelVideos(
  apiKey: string,
  channelId: string,
  maxResults: number = 3
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

    if (!res.ok) {
      console.error("YouTube API failed:", res.status);
      return [];
    }

    const data = (await res.json()) as YouTubeSearchResponse;

    if (data.error) {
      console.error("YouTube API error:", data.error.message);
      return [];
    }

    return data.items || [];
  } catch (error) {
    console.error("YouTube API error:", error);
    return [];
  }
}

/**
 * 複数チャンネルの最新動画を取得
 * @param apiKey YouTube API Key
 * @param channels チャンネル情報の配列 { channelId, mcid } （channelIdはハンドルも可）
 * @param maxVideosPerChannel チャンネルごとの最大取得件数
 * @param maxAgeHours 取得する動画の最大経過時間（時間）
 */
export async function getRecentVideos(
  apiKey: string,
  channels: Array<{ channelId: string; mcid: string }>,
  maxVideosPerChannel: number = 3,
  maxAgeHours: number = 72
): Promise<YouTubeVideo[]> {
  if (channels.length === 0) return [];

  // キャッシュチェック
  const channelIds = channels.map((c) => c.channelId);
  const cacheKey = getYouTubeCacheKey(channelIds);
  const cached = await getCached<YouTubeVideo[]>(cacheKey);
  if (cached) {
    return cached;
  }

  const allVideos: YouTubeVideo[] = [];
  const cutoffTime = Date.now() - maxAgeHours * 60 * 60 * 1000;

  // 並列で取得（クォータ節約のため最大10チャンネル）
  const limitedChannels = channels.slice(0, 10);
  const results = await Promise.all(
    limitedChannels.map(async ({ channelId: identifier, mcid }) => {
      // ハンドルの場合はチャンネルIDに変換
      const channelId = await resolveChannelId(apiKey, identifier);
      if (!channelId) {
        console.warn(`Failed to resolve channel ID for: ${identifier}`);
        return [];
      }

      const videos = await getChannelVideos(apiKey, channelId, maxVideosPerChannel);
      return videos.map((v) => ({
        ...v,
        minefolioMcid: mcid,
      }));
    })
  );

  for (const videos of results) {
    allVideos.push(...videos);
  }

  // 指定時間以内の動画のみ、最新順でソート
  const recentVideos = allVideos
    .filter((v) => new Date(v.snippet.publishedAt).getTime() > cutoffTime)
    .sort(
      (a, b) =>
        new Date(b.snippet.publishedAt).getTime() -
        new Date(a.snippet.publishedAt).getTime()
    )
    .slice(0, 10);

  // キャッシュに保存（15分）
  await setCached(cacheKey, recentVideos, CacheTTL.MEDIUM);

  return recentVideos;
}

/**
 * YouTubeチャンネルハンドル（@username）からチャンネルIDを取得
 * forHandle APIを使用（クォータコスト: 1ユニット）
 */
export async function resolveChannelHandle(
  apiKey: string,
  handle: string
): Promise<string | null> {
  try {
    // @を除去
    const username = handle.startsWith("@") ? handle.slice(1) : handle;

    const params = new URLSearchParams({
      key: apiKey,
      forHandle: username,
      part: "id",
    });

    const res = await fetch(`${YOUTUBE_API}/channels?${params}`);

    if (!res.ok) return null;

    const data = (await res.json()) as { items?: Array<{ id: string }> };
    return data.items?.[0]?.id || null;
  } catch {
    return null;
  }
}

/**
 * 識別子がチャンネルIDかハンドルかを判定し、必要に応じて変換
 */
export async function resolveChannelId(
  apiKey: string,
  identifier: string
): Promise<string | null> {
  // UCで始まる場合はチャンネルID
  if (identifier.startsWith("UC") && identifier.length === 24) {
    return identifier;
  }
  // それ以外はハンドルとして変換を試みる
  return resolveChannelHandle(apiKey, identifier);
}

/**
 * 動画URLを生成
 */
export function getVideoUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/**
 * チャンネルURLを生成
 */
export function getChannelUrl(channelId: string): string {
  return `https://www.youtube.com/channel/${channelId}`;
}
