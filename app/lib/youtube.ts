// YouTube Data API v3 - 最新動画取得

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

export interface YouTubeChannelStats {
  /** 登録者数（非公開設定のチャンネルは null） */
  subscriberCount: number | null;
  /** 最新動画（配信アーカイブ含む）の投稿日時（ISO 8601）。動画が無い場合は null */
  latestVideoAt: string | null;
}

/**
 * チャンネルの統計情報（登録者数・最新動画日時）を取得
 * クォータ: channels 1 unit + playlistItems 1 unit
 * @param apiKey YouTube API Key
 * @param identifier チャンネルID（UC...）またはハンドル
 */
export async function getChannelStats(
  apiKey: string,
  identifier: string
): Promise<YouTubeChannelStats | null> {
  try {
    const channelId = await resolveChannelId(apiKey, identifier);
    if (!channelId) return null;

    const params = new URLSearchParams({
      key: apiKey,
      id: channelId,
      part: "statistics,contentDetails",
    });
    const res = await fetch(`${YOUTUBE_API}/channels?${params}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      console.error("YouTube channels API failed:", res.status);
      return null;
    }

    const data = (await res.json()) as {
      items?: Array<{
        statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean };
        contentDetails?: { relatedPlaylists?: { uploads?: string } };
      }>;
    };
    const channel = data.items?.[0];
    if (!channel) return null;

    const subscriberCount =
      channel.statistics && !channel.statistics.hiddenSubscriberCount
        ? Number(channel.statistics.subscriberCount ?? NaN)
        : NaN;

    // 最新動画の投稿日時: uploads プレイリストの先頭1件（配信アーカイブも含まれる）
    let latestVideoAt: string | null = null;
    const uploadsPlaylistId = channel.contentDetails?.relatedPlaylists?.uploads;
    if (uploadsPlaylistId) {
      const plParams = new URLSearchParams({
        key: apiKey,
        playlistId: uploadsPlaylistId,
        part: "snippet",
        maxResults: "1",
      });
      const plRes = await fetch(`${YOUTUBE_API}/playlistItems?${plParams}`, {
        signal: AbortSignal.timeout(10000),
      });
      if (plRes.ok) {
        const plData = (await plRes.json()) as {
          items?: Array<{ snippet?: { publishedAt?: string } }>;
        };
        latestVideoAt = plData.items?.[0]?.snippet?.publishedAt ?? null;
      }
    }

    return {
      subscriberCount: Number.isFinite(subscriberCount) ? subscriberCount : null,
      latestVideoAt,
    };
  } catch (error) {
    console.error("YouTube channel stats error:", error);
    return null;
  }
}
