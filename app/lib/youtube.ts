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

// ============================================
// アップロード再生リスト方式（Search API の代替。クォータ節約用）
// Search API（channelId + type=video）は1リクエスト100ユニットで日次クォータ（10,000ユニット）を
// すぐに消費してしまうため、動画一覧の取得は channels.list（1ユニット）で
// uploads プレイリストIDを取得し、playlistItems.list（1ユニット）でその中身を読む方式に切り替える
// ============================================

export interface YouTubeUploadsPlaylistInfo {
  channelId: string;
  uploadsPlaylistId: string;
}

function isChannelIdFormat(identifier: string): boolean {
  return identifier.startsWith("UC") && identifier.length === 24;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * 複数チャンネル識別子（UCチャンネルID or @ハンドル）からアップロード再生リストIDを一括解決する。
 * UC形式は channels.list の id= で最大50件バッチ（1ユニット/リクエスト）、
 * ハンドルは forHandle で1件ずつ（1ユニット/リクエスト。forHandle はバッチ指定不可のため）。
 * 戻り値は呼び出し側が渡した識別子そのものをキーにする（UC形式はそのまま、ハンドルは元の文字列）
 */
export async function resolveUploadsPlaylists(
  apiKey: string,
  identifiers: string[]
): Promise<Map<string, YouTubeUploadsPlaylistInfo>> {
  const result = new Map<string, YouTubeUploadsPlaylistInfo>();
  const uniqueIdentifiers = [...new Set(identifiers)];
  const channelIdEntries = uniqueIdentifiers.filter(isChannelIdFormat);
  const handleEntries = uniqueIdentifiers.filter((id) => !isChannelIdFormat(id));

  type ChannelsListItem = {
    id: string;
    contentDetails?: { relatedPlaylists?: { uploads?: string } };
  };

  for (const batch of chunk(channelIdEntries, 50)) {
    try {
      const params = new URLSearchParams({
        key: apiKey,
        id: batch.join(","),
        part: "id,contentDetails",
      });
      const res = await fetch(`${YOUTUBE_API}/channels?${params}`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        console.error(`[YouTube API] channels.list (batch) failed: ${res.status}`);
        continue;
      }
      const data = (await res.json()) as { items?: ChannelsListItem[] };
      for (const item of data.items ?? []) {
        const uploads = item.contentDetails?.relatedPlaylists?.uploads;
        if (item.id && uploads) {
          result.set(item.id, { channelId: item.id, uploadsPlaylistId: uploads });
        }
      }
    } catch (error) {
      console.error("[YouTube API] channels.list (batch) error:", error);
    }
  }

  for (const handle of handleEntries) {
    try {
      const username = handle.startsWith("@") ? handle.slice(1) : handle;
      const params = new URLSearchParams({
        key: apiKey,
        forHandle: username,
        part: "id,contentDetails",
      });
      const res = await fetch(`${YOUTUBE_API}/channels?${params}`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        console.error(`[YouTube API] channels.list (forHandle) failed: ${res.status}`);
        continue;
      }
      const data = (await res.json()) as { items?: ChannelsListItem[] };
      const item = data.items?.[0];
      const uploads = item?.contentDetails?.relatedPlaylists?.uploads;
      if (item?.id && uploads) {
        result.set(handle, { channelId: item.id, uploadsPlaylistId: uploads });
      }
    } catch (error) {
      console.error(`[YouTube API] channels.list (forHandle) error for ${handle}:`, error);
    }
  }

  return result;
}

export interface YouTubePlaylistItem {
  snippet: {
    title: string;
    description: string;
    channelTitle: string;
    publishedAt: string;
    thumbnails?: {
      default?: { url: string };
      medium?: { url: string };
    };
    resourceId?: { videoId?: string };
  };
  status?: { privacyStatus?: string };
}

/**
 * アップロード再生リストから最新動画を取得する（1ユニット/リクエスト）。
 * part=snippet,status。unlisted/private の除外（privacyStatus !== "public"）は呼び出し側で行う
 */
export async function fetchUploadsPlaylistItems(
  apiKey: string,
  playlistId: string,
  maxResults: number
): Promise<YouTubePlaylistItem[]> {
  try {
    const params = new URLSearchParams({
      key: apiKey,
      playlistId,
      part: "snippet,status",
      maxResults: String(maxResults),
    });
    const res = await fetch(`${YOUTUBE_API}/playlistItems?${params}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      console.error(`[YouTube API] playlistItems.list failed (${res.status}) for playlist ${playlistId}`);
      return [];
    }
    const data = (await res.json()) as { items?: YouTubePlaylistItem[] };
    return data.items ?? [];
  } catch (error) {
    console.error(`[YouTube API] playlistItems.list error for playlist ${playlistId}:`, error);
    return [];
  }
}
