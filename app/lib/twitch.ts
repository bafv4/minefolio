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
      { method: "POST" }
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
