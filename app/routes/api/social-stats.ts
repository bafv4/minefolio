// ソーシャルリンク統計API（プロフィールページ用・遅延読み込み）
// YouTube の登録者数/最新動画日時と Twitch のフォロワー数/前回配信日時を返す。
// APIキーはサーバー専用のため、クライアントからは slug 経由でこのエンドポイントを叩く
// （任意 identifier を受け取るオープンプロキシにしない。統計はDBに保存済みのリンクに限る）。

import type { LoaderFunctionArgs } from "react-router";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getOptionalSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users, socialLinks } from "@/lib/schema";
import { asc, sql } from "drizzle-orm";
import { getChannelStats as getYouTubeChannelStats, type YouTubeChannelStats } from "@/lib/youtube";
import { getTwitchAppToken, getChannelStats as getTwitchChannelStats, type TwitchChannelStats } from "@/lib/twitch";
import { getDbCached, setDbCached } from "@/lib/cache";

// DBキャッシュTTL: 登録者数は変動が緩やかなため長め、Twitchは配信中フラグの鮮度を優先して短め
const YOUTUBE_TTL = 6 * 60 * 60 * 1000; // 6時間
const YOUTUBE_ERROR_TTL = 15 * 60 * 1000; // 15分（取得失敗時。クォータ浪費を防ぎつつ復旧を待つ）
const TWITCH_TTL = 5 * 60 * 1000; // 5分

// CDNキャッシュ（秒）: Twitchの配信中フラグの鮮度に合わせる
const CDN_MAX_AGE = 300;
const CDN_SWR = 3600;

export interface SocialStatsResponse {
  youtube: YouTubeChannelStats | null;
  twitch: TwitchChannelStats | null;
}

async function fetchYouTubeStats(
  apiKey: string | undefined,
  userId: string,
  identifier: string
): Promise<YouTubeChannelStats | null> {
  if (!apiKey) return null;

  const cacheKey = `social-stats:youtube:${userId}`;
  const cached = await getDbCached<YouTubeChannelStats | null>(cacheKey);
  if (cached !== null) return cached;

  const stats = await getYouTubeChannelStats(apiKey, identifier);
  // 失敗（null）は短TTLでネガティブキャッシュし、連続アクセスでのクォータ浪費を防ぐ
  await setDbCached(cacheKey, "social_stats", stats, stats ? YOUTUBE_TTL : YOUTUBE_ERROR_TTL);
  return stats;
}

async function fetchTwitchStats(
  clientId: string | undefined,
  clientSecret: string | undefined,
  userId: string,
  identifier: string
): Promise<TwitchChannelStats | null> {
  if (!clientId || !clientSecret) return null;

  const cacheKey = `social-stats:twitch:${userId}`;
  const cached = await getDbCached<TwitchChannelStats | null>(cacheKey);
  if (cached !== null) return cached;

  const token = await getTwitchAppToken(clientId, clientSecret);
  const stats = token
    ? await getTwitchChannelStats(clientId, token, identifier)
    : null;
  await setDbCached(cacheKey, "social_stats", stats, TWITCH_TTL);
  return stats;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const env = getEnv();
  const db = createDb();

  const url = new URL(request.url);
  const slug = url.searchParams.get("slug");
  if (!slug) {
    return Response.json({ error: "slug is required" }, { status: 400 });
  }

  const normalizedSlug = slug.toLowerCase();
  const player = await db.query.users.findFirst({
    where: sql`lower(${users.slug}) = ${normalizedSlug}`,
    columns: {
      id: true,
      discordId: true,
      profileVisibility: true,
    },
    with: {
      socialLinks: {
        orderBy: [asc(socialLinks.displayOrder)],
        columns: { platform: true, identifier: true },
      },
    },
  });

  if (!player) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // 可視性ゲート: 非公開プロフィールは本人のみ（プロフィールページ本体と同じ判定）。
  // 本人向けレスポンスはCDNに乗せない
  let isPrivateOwnerView = false;
  if (player.profileVisibility === "private") {
    const auth = createAuth(db, env);
    const session = await getOptionalSession(request, auth);
    if (session?.user?.id !== player.discordId) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    isPrivateOwnerView = true;
  }

  const youtubeLink = player.socialLinks.find((l) => l.platform === "youtube");
  const twitchLink = player.socialLinks.find((l) => l.platform === "twitch");

  const [youtube, twitch] = await Promise.all([
    youtubeLink
      ? fetchYouTubeStats(env.YOUTUBE_API_KEY, player.id, youtubeLink.identifier)
      : Promise.resolve(null),
    twitchLink
      ? fetchTwitchStats(env.TWITCH_CLIENT_ID, env.TWITCH_CLIENT_SECRET, player.id, twitchLink.identifier)
      : Promise.resolve(null),
  ]);

  const body: SocialStatsResponse = { youtube, twitch };
  return Response.json(body, {
    headers: {
      "Cache-Control": isPrivateOwnerView
        ? "private, no-store"
        : `public, s-maxage=${CDN_MAX_AGE}, stale-while-revalidate=${CDN_SWR}`,
    },
  });
}
