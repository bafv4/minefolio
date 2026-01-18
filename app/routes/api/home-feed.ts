// ホームフィード用API（遅延読み込み対応）

import type { Route } from "./+types/home-feed";
import { createDb } from "@/lib/db";
import { users, socialLinks } from "@/lib/schema";
import { eq, and, inArray } from "drizzle-orm";
import { fetchLiveRuns, fetchRecentRunsForUsers } from "@/lib/paceman";
import { getTwitchAppToken, getLiveStreams } from "@/lib/twitch";
import { getRecentVideos } from "@/lib/youtube";

export async function loader({ context, request }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const db = createDb(env.DB);

  const url = new URL(request.url);
  const feedType = url.searchParams.get("type");

  // 登録ユーザーのMCIDとUUIDを取得
  const allUserMcids = await db.query.users.findMany({
    columns: { mcid: true, uuid: true },
  });
  const registeredMcidSet = new Set(allUserMcids.map((u) => u.mcid.toLowerCase()));
  const mcidToUuid = Object.fromEntries(
    allUserMcids.map((u) => [u.mcid.toLowerCase(), u.uuid])
  );

  // フィードタイプに応じてデータを取得
  switch (feedType) {
    case "live-runs": {
      const liveRuns = await fetchLiveRuns();
      const filteredLiveRuns = liveRuns
        .filter((run) => registeredMcidSet.has(run.nickname.toLowerCase()))
        .slice(0, 20);
      return Response.json({
        liveRuns: filteredLiveRuns,
        mcidToUuid,
      });
    }

    case "recent-paces": {
      const recentPaces = await fetchRecentRunsForUsers(
        Array.from(registeredMcidSet),
        168, // 1週間
        5,
        20
      );
      return Response.json({
        recentPaces,
        mcidToUuid,
      });
    }

    case "twitch-streams": {
      const clientId = env.TWITCH_CLIENT_ID;
      const clientSecret = env.TWITCH_CLIENT_SECRET;

      if (!clientId || !clientSecret) {
        return Response.json({ liveStreams: [] });
      }

      // 公開プロフィールのTwitchリンクを取得
      const twitchLinks = await db
        .select({
          identifier: socialLinks.identifier,
          mcid: users.mcid,
        })
        .from(socialLinks)
        .innerJoin(users, eq(socialLinks.userId, users.id))
        .where(
          and(
            eq(users.profileVisibility, "public"),
            eq(socialLinks.platform, "twitch")
          )
        );

      if (twitchLinks.length === 0) {
        return Response.json({ liveStreams: [] });
      }

      const token = await getTwitchAppToken(clientId, clientSecret);
      if (!token) {
        return Response.json({ liveStreams: [] });
      }

      const userLogins = twitchLinks.map((l) => l.identifier);
      const streams = await getLiveStreams(clientId, token, userLogins);

      const liveStreams = streams.map((stream) => {
        const link = twitchLinks.find(
          (l) => l.identifier.toLowerCase() === stream.user_login.toLowerCase()
        );
        return { stream, mcid: link?.mcid ?? "" };
      });

      return Response.json({ liveStreams });
    }

    case "youtube-videos": {
      const apiKey = env.YOUTUBE_API_KEY;

      if (!apiKey) {
        return Response.json({ recentVideos: [] });
      }

      // 公開プロフィールのYouTubeリンクを取得
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

      if (youtubeLinks.length === 0) {
        return Response.json({ recentVideos: [] });
      }

      const channels = youtubeLinks.map((l) => ({
        channelId: l.identifier,
        mcid: l.mcid,
      }));

      const recentVideos = await getRecentVideos(apiKey, channels, 3, 72);
      return Response.json({ recentVideos });
    }

    default:
      return Response.json({ error: "Invalid feed type" }, { status: 400 });
  }
}
