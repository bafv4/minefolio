// Twitch API - 配信状態取得

import { getCached, setCached, getTwitchCacheKey, CacheTTL } from "./cache";

const TWITCH_API = "https://api.twitch.tv/helix";
const TWITCH_AUTH = "https://id.twitch.tv/oauth2/token";

export interface TwitchStream {
  id: string;
  user_id: string;
  user_login: string;
  user_name: string;
  game_id: string;
  game_name: string;
  type: "live" | "";
  title: string;
  viewer_count: number;
  started_at: string;
  language: string;
  thumbnail_url: string;
  tag_ids: string[];
  tags: string[];
  is_mature: boolean;
}

interface TwitchTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

/**
 * Client Credentials FlowでApp Access Tokenを取得
 */
export async function getTwitchAppToken(
  clientId: string,
  clientSecret: string
): Promise<string | null> {
  // キャッシュチェック
  const cacheKey = getTwitchCacheKey(["app_token"]);
  const cached = await getCached<string>(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const res = await fetch(
      `${TWITCH_AUTH}?client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`,
      { method: "POST", signal: AbortSignal.timeout(10000) }
    );

    if (!res.ok) {
      console.error("Twitch auth failed:", res.status);
      return null;
    }

    const data = (await res.json()) as TwitchTokenResponse;

    // キャッシュに保存（15分）
    await setCached(cacheKey, data.access_token, CacheTTL.MEDIUM);

    return data.access_token;
  } catch (error) {
    console.error("Twitch auth error:", error);
    return null;
  }
}

/**
 * 指定したユーザーの配信中ストリームを取得
 * @param clientId Twitch Client ID
 * @param accessToken App Access Token
 * @param userLogins Twitchユーザー名の配列（最大100件）
 */
export async function getLiveStreams(
  clientId: string,
  accessToken: string,
  userLogins: string[]
): Promise<TwitchStream[]> {
  if (userLogins.length === 0) return [];

  // キャッシュチェック
  const cacheKey = getTwitchCacheKey(userLogins);
  const cached = await getCached<TwitchStream[]>(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    // Twitch APIは最大100件のuser_loginをサポート
    const batches: string[][] = [];
    for (let i = 0; i < userLogins.length; i += 100) {
      batches.push(userLogins.slice(i, i + 100));
    }

    const allStreams: TwitchStream[] = [];

    for (const batch of batches) {
      const params = batch.map((u) => `user_login=${encodeURIComponent(u)}`).join("&");
      const res = await fetch(`${TWITCH_API}/streams?${params}`, {
        headers: {
          "Client-ID": clientId,
          Authorization: `Bearer ${accessToken}`,
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        console.error("Twitch streams API failed:", res.status);
        continue;
      }

      const data = (await res.json()) as { data: TwitchStream[] };
      if (data.data) {
        allStreams.push(...data.data);
      }
    }

    // ライブ中のストリームのみ返す
    const liveStreams = allStreams.filter((s) => s.type === "live");

    // キャッシュに保存（15分）
    await setCached(cacheKey, liveStreams, CacheTTL.MEDIUM);

    return liveStreams;
  } catch (error) {
    console.error("Twitch streams error:", error);
    return [];
  }
}

export interface TwitchChannelStats {
  /** フォロワー数（取得失敗時は null） */
  followerCount: number | null;
  /** 配信中かどうか */
  isLive: boolean;
  /** 前回配信の日時（ISO 8601）。配信中なら開始日時、VODが無い場合は null */
  lastStreamAt: string | null;
}

/**
 * チャンネルの統計情報（フォロワー数・前回配信日時・配信中フラグ）を取得
 * @param clientId Twitch Client ID
 * @param accessToken App Access Token
 * @param login Twitchユーザー名（login名）
 */
export async function getChannelStats(
  clientId: string,
  accessToken: string,
  login: string
): Promise<TwitchChannelStats | null> {
  const headers = {
    "Client-ID": clientId,
    Authorization: `Bearer ${accessToken}`,
  };

  try {
    // login → broadcaster id
    const userRes = await fetch(
      `${TWITCH_API}/users?login=${encodeURIComponent(login)}`,
      { headers, signal: AbortSignal.timeout(10000) }
    );
    if (!userRes.ok) {
      console.error("Twitch users API failed:", userRes.status);
      return null;
    }
    const userData = (await userRes.json()) as { data?: Array<{ id: string }> };
    const broadcasterId = userData.data?.[0]?.id;
    if (!broadcasterId) return null;

    // フォロワー数と配信状態を並列取得
    // （/channels/followers の total は App Access Token でも返る。data はスコープが必要だが未使用）
    const [followersRes, streamsRes] = await Promise.all([
      fetch(
        `${TWITCH_API}/channels/followers?broadcaster_id=${broadcasterId}&first=1`,
        { headers, signal: AbortSignal.timeout(10000) }
      ),
      fetch(
        `${TWITCH_API}/streams?user_id=${broadcasterId}&first=1`,
        { headers, signal: AbortSignal.timeout(10000) }
      ),
    ]);

    let followerCount: number | null = null;
    if (followersRes.ok) {
      const followersData = (await followersRes.json()) as { total?: number };
      followerCount = typeof followersData.total === "number" ? followersData.total : null;
    }

    let isLive = false;
    let lastStreamAt: string | null = null;
    if (streamsRes.ok) {
      const streamsData = (await streamsRes.json()) as {
        data?: Array<{ type: string; started_at: string }>;
      };
      const stream = streamsData.data?.[0];
      if (stream?.type === "live") {
        isLive = true;
        lastStreamAt = stream.started_at;
      }
    }

    // 配信中でなければ最新の配信アーカイブから前回配信日時を取得
    if (!isLive) {
      const videosRes = await fetch(
        `${TWITCH_API}/videos?user_id=${broadcasterId}&type=archive&first=1`,
        { headers, signal: AbortSignal.timeout(10000) }
      );
      if (videosRes.ok) {
        const videosData = (await videosRes.json()) as {
          data?: Array<{ created_at: string }>;
        };
        lastStreamAt = videosData.data?.[0]?.created_at ?? null;
      }
    }

    return { followerCount, isLive, lastStreamAt };
  } catch (error) {
    console.error("Twitch channel stats error:", error);
    return null;
  }
}

/**
 * サムネイルURLを適切なサイズに変換
 */
export function getThumbnailUrl(
  templateUrl: string,
  width: number,
  height: number
): string {
  return templateUrl
    .replace("{width}", String(width))
    .replace("{height}", String(height));
}
