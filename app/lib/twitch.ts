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

export interface TwitchVod {
  /** VOD ID（数値文字列。視聴URLは https://www.twitch.tv/videos/{id}） */
  id: string;
  /** 配信者の login 名（小文字） */
  userLogin: string;
  /** 配信者の表示名 */
  userName: string;
  title: string;
  url: string;
  /** サムネイルURL（サイズ解決済み）。処理中のVOD等で未生成なら null */
  thumbnailUrl: string | null;
  /** 公開日時（ISO 8601） */
  publishedAt: string;
  /** 配信時間（秒）。パース不能なら null */
  durationSeconds: number | null;
}

/**
 * Twitch の duration 文字列（例: "3h12m5s" / "45m" / "58s"）を秒に変換。
 * 不正な形式は null を返す
 */
export function parseTwitchDuration(duration: string): number | null {
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(duration);
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  const hours = Number(m[1] ?? 0);
  const minutes = Number(m[2] ?? 0);
  const seconds = Number(m[3] ?? 0);
  return hours * 3600 + minutes * 60 + seconds;
}

/** VODサムネイルのテンプレートURL（%{width}x%{height}）を実サイズに解決。未生成なら null */
function resolveVodThumbnail(templateUrl: string): string | null {
  if (!templateUrl) return null;
  return templateUrl.replace("%{width}", "640").replace("%{height}", "360");
}

interface TwitchVideoResponse {
  data?: Array<{
    id: string;
    user_login: string;
    user_name: string;
    title: string;
    url: string;
    thumbnail_url: string;
    published_at: string;
    created_at: string;
    duration: string;
    type: string;
  }>;
}

/**
 * 指定した配信者たちの最近の配信アーカイブ（VOD）を取得
 * /users は最大100件バッチ、/videos は配信者ごとに1リクエスト
 * @param clientId Twitch Client ID
 * @param accessToken App Access Token
 * @param userLogins Twitchユーザー名の配列
 * @param vodsPerChannel 配信者ごとの最大取得件数
 * @param maxChannels 取得対象の最大配信者数（リクエスト数の上限）
 */
export async function getRecentVods(
  clientId: string,
  accessToken: string,
  userLogins: string[],
  vodsPerChannel: number = 3,
  maxChannels: number = 10
): Promise<TwitchVod[]> {
  if (userLogins.length === 0) return [];

  const headers = {
    "Client-ID": clientId,
    Authorization: `Bearer ${accessToken}`,
  };

  try {
    // login → broadcaster id をバッチ解決（最大100件/リクエスト）
    const limitedLogins = userLogins.slice(0, maxChannels);
    const params = limitedLogins
      .map((u) => `login=${encodeURIComponent(u)}`)
      .join("&");
    const usersRes = await fetch(`${TWITCH_API}/users?${params}`, {
      headers,
      signal: AbortSignal.timeout(10000),
    });
    if (!usersRes.ok) {
      console.error("Twitch users API failed:", usersRes.status);
      return [];
    }
    const usersData = (await usersRes.json()) as {
      data?: Array<{ id: string; login: string }>;
    };
    const broadcasters = usersData.data ?? [];
    if (broadcasters.length === 0) return [];

    // 配信者ごとに最新アーカイブを取得（/videos は user_id 単位のため並列化）
    const results = await Promise.all(
      broadcasters.map(async ({ id }) => {
        try {
          const res = await fetch(
            `${TWITCH_API}/videos?user_id=${id}&type=archive&first=${vodsPerChannel}`,
            { headers, signal: AbortSignal.timeout(10000) }
          );
          if (!res.ok) {
            console.error("Twitch videos API failed:", res.status);
            return [];
          }
          const data = (await res.json()) as TwitchVideoResponse;
          return data.data ?? [];
        } catch (error) {
          console.error("Twitch videos error:", error);
          return [];
        }
      })
    );

    return results.flat().map((v) => ({
      id: v.id,
      userLogin: v.user_login.toLowerCase(),
      userName: v.user_name,
      title: v.title,
      url: v.url,
      thumbnailUrl: resolveVodThumbnail(v.thumbnail_url),
      publishedAt: v.published_at || v.created_at,
      durationSeconds: parseTwitchDuration(v.duration),
    }));
  } catch (error) {
    console.error("Twitch VODs error:", error);
    return [];
  }
}

/**
 * VOD IDの配列から現存するVODのIDを返す（存在確認用）
 * /videos は id パラメータを最大100件までバッチ指定できるが、削除済みIDが混ざると
 * バッチ全体が 404 になることがあるため、404 時は二分割で再試行して切り分ける
 */
export async function getVodsByIds(
  clientId: string,
  accessToken: string,
  vodIds: string[]
): Promise<Set<string>> {
  const existing = new Set<string>();
  if (vodIds.length === 0) return existing;

  const headers = {
    "Client-ID": clientId,
    Authorization: `Bearer ${accessToken}`,
  };

  async function checkBatch(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    try {
      const params = ids.map((id) => `id=${encodeURIComponent(id)}`).join("&");
      const res = await fetch(`${TWITCH_API}/videos?${params}`, {
        headers,
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const data = (await res.json()) as { data?: Array<{ id: string }> };
        for (const v of data.data ?? []) {
          existing.add(v.id);
        }
        return;
      }
      if (res.status === 404) {
        // 1件なら「存在しない」が確定。複数件は削除済みIDの混入でバッチごと404に
        // なっている可能性があるため、二分割して切り分ける
        if (ids.length === 1) return;
        const mid = Math.ceil(ids.length / 2);
        await checkBatch(ids.slice(0, mid));
        await checkBatch(ids.slice(mid));
        return;
      }
      console.error("Twitch videos batch API failed:", res.status);
      // 判定不能のため、誤削除を避けて「存在する」扱いにする
      for (const id of ids) existing.add(id);
    } catch (error) {
      console.error("Twitch videos batch error:", error);
      for (const id of ids) existing.add(id);
    }
  }

  for (let i = 0; i < vodIds.length; i += 100) {
    await checkBatch(vodIds.slice(i, i + 100));
  }

  return existing;
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
