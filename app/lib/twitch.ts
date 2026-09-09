// Twitch API - 配信状態取得

import { getCached, setCached, getTwitchCacheKey, CacheTTL } from "./cache";
import { videoRetentionCutoff } from "./feed-video";

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

interface TwitchVideoApiItem {
  id: string;
  user_login: string;
  user_name: string;
  title: string;
  thumbnail_url: string;
  published_at: string;
  created_at: string;
  duration: string;
  type: string;
  /** "public" | "private"（非公開VODの防御用フィルタに使用） */
  viewable: string;
}

interface TwitchVideosPageResponse {
  data?: TwitchVideoApiItem[];
  pagination?: { cursor?: string };
}

// VODページング設定
const VOD_PAGE_SIZE = 100; // /videos の1リクエストあたり最大件数
const VOD_MAX_PAGES_PER_CHANNEL = 5; // 安全上限（500件/チャンネル）
const VOD_FETCH_CONCURRENCY = 5; // Helixレート制限（800pt/分）への配慮

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * 1チャンネル分の archive VOD を保持期間（cutoff）に達するまでページングして取得。
 * API呼び出しが失敗した場合は null（判定不能）を返す。
 * `complete: false` は安全上限（VOD_MAX_PAGES_PER_CHANNEL）による打ち切りで、
 * 保持期間内に未取得のVODが残っている可能性を表す（差分削除の対象にしてはならない）
 */
async function fetchChannelVodsPaged(
  headers: Record<string, string>,
  broadcasterId: string,
  cutoff: Date
): Promise<{ items: TwitchVideoApiItem[]; complete: boolean } | null> {
  const items: TwitchVideoApiItem[] = [];
  let cursor: string | undefined;
  let complete = false;

  for (let page = 0; page < VOD_MAX_PAGES_PER_CHANNEL; page++) {
    const params = new URLSearchParams({
      user_id: broadcasterId,
      type: "archive",
      first: String(VOD_PAGE_SIZE),
      sort: "time",
    });
    if (cursor) params.set("after", cursor);

    try {
      const res = await fetch(`${TWITCH_API}/videos?${params}`, {
        headers,
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        console.error("Twitch videos API failed:", res.status);
        return null;
      }
      const data = (await res.json()) as TwitchVideosPageResponse;
      const pageItems = data.data ?? [];

      let reachedCutoff = false;
      for (const item of pageItems) {
        const publishedAt = new Date(item.published_at || item.created_at);
        if (publishedAt < cutoff) {
          reachedCutoff = true;
          break;
        }
        items.push(item);
      }
      if (reachedCutoff) {
        complete = true;
        break;
      }

      cursor = data.pagination?.cursor;
      if (!cursor || pageItems.length === 0) {
        complete = true;
        break;
      }
    } catch (error) {
      console.error("Twitch videos error:", error);
      return null;
    }
  }

  return { items, complete };
}

/** チャンネル単位でのVOD取得結果。判定不能（login解決不可・API失敗）と空配列を区別する */
export interface TwitchVodFetchResult {
  /** login（小文字）→ 取得成功した公開VOD一覧（0件でも「成功」を表す） */
  vods: Map<string, TwitchVod[]>;
  /** 判定不能な login（/users で解決できなかった、または /videos 呼び出しが失敗した） */
  failedLogins: Set<string>;
  /**
   * 取得は成功したが安全上限（5ページ=500件）で打ち切られ、保持期間内に未取得のVODが
   * 残っている可能性がある login。取得分の upsert は行うが、差分削除の対象にしてはならない
   */
  incompleteLogins: Set<string>;
}

/**
 * 指定した配信者たちの最近の配信アーカイブ（VOD、保持期間内・public のみ）を取得。
 * /users は最大100件ずつバッチ解決、/videos はチャンネルごとに保持期間に達するまでページングし、
 * 同時5チャンネル程度に制限して並列実行する（Helixレート制限800pt/分への配慮）。
 * @param clientId Twitch Client ID
 * @param accessToken App Access Token
 * @param userLogins Twitchユーザー名の配列（件数上限なし）
 */
export async function getRecentVods(
  clientId: string,
  accessToken: string,
  userLogins: string[]
): Promise<TwitchVodFetchResult> {
  const vods = new Map<string, TwitchVod[]>();
  const failedLogins = new Set<string>();
  const incompleteLogins = new Set<string>();
  if (userLogins.length === 0) return { vods, failedLogins, incompleteLogins };

  const headers = {
    "Client-ID": clientId,
    Authorization: `Bearer ${accessToken}`,
  };

  // login → broadcaster id をバッチ解決（最大100件/リクエスト）
  const requestedLogins = [...new Set(userLogins.map((l) => l.toLowerCase()))];
  const broadcasters: Array<{ id: string; login: string }> = [];

  for (const batch of chunk(requestedLogins, 100)) {
    try {
      const params = batch.map((u) => `login=${encodeURIComponent(u)}`).join("&");
      const usersRes = await fetch(`${TWITCH_API}/users?${params}`, {
        headers,
        signal: AbortSignal.timeout(10000),
      });
      if (!usersRes.ok) {
        console.error("Twitch users API failed:", usersRes.status);
        for (const login of batch) failedLogins.add(login);
        continue;
      }
      const usersData = (await usersRes.json()) as {
        data?: Array<{ id: string; login: string }>;
      };
      const resolved = usersData.data ?? [];
      const resolvedLogins = new Set(resolved.map((b) => b.login.toLowerCase()));
      broadcasters.push(...resolved);
      // /users解決で返ってこなかったlogin（改名・凍結等）は判定不能
      for (const login of batch) {
        if (!resolvedLogins.has(login)) failedLogins.add(login);
      }
    } catch (error) {
      console.error("Twitch users error:", error);
      for (const login of batch) failedLogins.add(login);
    }
  }

  if (broadcasters.length === 0) return { vods, failedLogins, incompleteLogins };

  // 配信者ごとに最新アーカイブをページング取得（同時 VOD_FETCH_CONCURRENCY 件に制限）
  const cutoff = videoRetentionCutoff();
  const queue = [...broadcasters];

  async function worker(): Promise<void> {
    for (;;) {
      const broadcaster = queue.shift();
      if (!broadcaster) return;
      const login = broadcaster.login.toLowerCase();
      const result = await fetchChannelVodsPaged(headers, broadcaster.id, cutoff);
      if (result === null) {
        failedLogins.add(login);
        continue;
      }
      if (!result.complete) incompleteLogins.add(login);
      // 非公開VODの防御フィルタ。Helixの viewable は現状常に "public" で、フィールド自体が
      // 応答から消えた場合に全件除外→差分削除で全消し、とならないよう欠落時は public 扱いにする
      const publicVods = result.items
        .filter((v) => v.viewable !== "private")
        .map((v) => ({
          id: v.id,
          userLogin: login,
          userName: v.user_name,
          title: v.title,
          thumbnailUrl: resolveVodThumbnail(v.thumbnail_url),
          publishedAt: v.published_at || v.created_at,
          durationSeconds: parseTwitchDuration(v.duration),
        }));
      vods.set(login, publicVods);
    }
  }

  const workerCount = Math.min(VOD_FETCH_CONCURRENCY, broadcasters.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return { vods, failedLogins, incompleteLogins };
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
