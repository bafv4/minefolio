import { createTranslator } from "@/lib/messages";
import { localeFromMatches, resolveLocale } from "@/lib/locale";
import { useLoaderData, Link, redirect } from "react-router";
import type { Route } from "./+types/stats";
import { createDb } from "@/lib/db";
import { getEnv } from "@/lib/env.server";
import { createAuth } from "@/lib/auth";
import { getOptionalSession } from "@/lib/session";
import { users } from "@/lib/schema";
import { sql } from "drizzle-orm";
import { fetchAllExternalStats } from "@/lib/external-stats";
import { getNetherEnterCount, getMainPaces, type GroupedPaceEntry } from "@/lib/paceman-cache";
import { getMinefolioEloRank } from "@/lib/rankings-query.server";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { MCSRRankedCard, PaceManStatsCard, SpeedrunComCard } from "@/components/player-stats-cards";
import { Trophy, ArrowLeft } from "lucide-react";
import { useT, useLocale } from "@/hooks/use-locale";
import { getLocalizedDisplayName } from "@/lib/slug";
import { resolvePlayerSlugFallback } from "@/lib/player-slug-fallback.server";

export const meta: Route.MetaFunction = ({ matches, params, loaderData }) => {
  const t = createTranslator(localeFromMatches(matches));
  const displayName = loaderData?.mcid || params.slug;
  const title = t("playerStats.metaTitle", { name: displayName });
  const description = t("playerStats.metaDescription", { name: displayName });
  const appUrl = loaderData?.appUrl || "https://minefolio.app";
  const ogImage = loaderData?.mcid
    ? `${appUrl}/og-image?mcid=${encodeURIComponent(loaderData.mcid)}`
    : `${appUrl}/og-image?slug=${encodeURIComponent(params.slug || "")}`;
  return [
    { title },
    { name: "description", content: description },
    { property: "og:type", content: "profile" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:image", content: ogImage },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: ogImage },
  ];
};

export async function loader({ params, request }: Route.LoaderArgs) {
  const t = createTranslator(resolveLocale(request));
  const env = getEnv();
  const appUrl = env.APP_URL || "https://minefolio.app";
  const { slug } = params;
  const db = createDb();
  const auth = createAuth(db, env);
  const session = await getOptionalSession(request, auth);
  const normalizedSlug = slug?.toLowerCase();

  // slugで走者を検索
  const player = await db.query.users.findFirst({
    where: normalizedSlug
      ? sql`lower(${users.slug}) = ${normalizedSlug}`
      : sql`0 = 1`,
    columns: {
      id: true,
      mcid: true,
      slug: true,
      displayName: true,
      displayNameAlphabet: true,
      profileVisibility: true,
      discordId: true,
      showRankedStats: true,
    },
  });

  if (!player) {
    if (slug) {
      const target = await resolvePlayerSlugFallback(db, slug);
      if (target) {
        throw redirect(`/player/${encodeURIComponent(target)}/stats${new URL(request.url).search}`);
      }
    }
    throw new Response(t("playerStats.notFound"), { status: 404 });
  }

  // プライベートプロフィールは本人以外に404を返す（profile.tsxと同じ扱い）
  if (
    player.profileVisibility === "private" &&
    session?.user?.id !== player.discordId
  ) {
    throw new Response(t("playerStats.notFound"), { status: 404 });
  }

  // 外部サービス・PaceManキャッシュから統計情報を並列取得（MCIDがある場合のみ。直列待ちを解消）。
  // Minefolio内順位（cron キャッシュ基準）は公開プロフィール かつ Ranked統計を
  // 非表示にしていない場合のみ取得する（profile.tsx と同じ判定）
  const [externalStats, netherEnterCount, recentPaces, minefolioEloRank] = await Promise.all([
    player.mcid
      ? fetchAllExternalStats(player.mcid)
      : Promise.resolve({ paceman: null, ranked: null, speedruncom: null }),
    player.mcid ? getNetherEnterCount(player.mcid) : Promise.resolve(0),
    player.mcid
      ? getMainPaces(player.mcid, 10)
      : Promise.resolve<GroupedPaceEntry[]>([]),
    player.profileVisibility === "public" && player.showRankedStats !== false
      ? getMinefolioEloRank(db, player.id)
      : Promise.resolve(null),
  ]);

  return {
    mcid: player.mcid,
    slug: player.slug,
    displayName: player.displayName,
    displayNameAlphabet: player.displayNameAlphabet,
    externalStats,
    netherEnterCount,
    recentPaces,
    minefolioEloRank,
    appUrl,
  };
}

export default function PlayerStatsPage() {
  const t = useT();
  const locale = useLocale();
  const { mcid, slug, displayName, displayNameAlphabet, externalStats, netherEnterCount, recentPaces, minefolioEloRank } = useLoaderData<typeof loader>();

  // 表示名の優先順位: （英語表示なら）アルファベット表記 > displayName > mcid > slug
  const playerDisplayName = getLocalizedDisplayName(
    { displayName, displayNameAlphabet, mcid, slug },
    locale,
  );

  const hasPacemanData = externalStats.paceman?.isRegistered || netherEnterCount > 0 || recentPaces.length > 0;
  const hasAnyData =
    externalStats.ranked?.isRegistered ||
    hasPacemanData ||
    (externalStats.speedruncom?.personalBests?.length ?? 0) > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild>
          <Link to={`/player/${slug}`}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t("playerStats.backToProfile")}
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold">{playerDisplayName}</h1>
          <p className="text-muted-foreground text-sm">{t("playerStats.heading")}</p>
        </div>
      </div>

      {!hasAnyData ? (
        <EmptyState
          icon={<Trophy className="h-12 w-12" />}
          title={t("playerStats.noStatsFound")}
          description={
            mcid
              ? t("playerStats.noExternalRegistration")
              : t("playerStats.noMcidConfigured")
          }
        />
      ) : (
        <>
          {/* MCSR Ranked Section */}
          {externalStats.ranked?.isRegistered && (
            <MCSRRankedCard ranked={externalStats.ranked} minefolioRank={minefolioEloRank} />
          )}

          {/* PaceMan Section */}
          {hasPacemanData && (
            <PaceManStatsCard
              netherEnterCount={netherEnterCount}
              mainPaces={recentPaces}
              openDetailsMcid={externalStats.paceman?.isRegistered ? mcid : null}
            />
          )}

          {/* Speedrun.com Section */}
          {externalStats.speedruncom &&
            !externalStats.speedruncom.error &&
            externalStats.speedruncom.personalBests.length > 0 && (
              <SpeedrunComCard speedruncom={externalStats.speedruncom} showUsername />
            )}
        </>
      )}
    </div>
  );
}
