import { createTranslator } from "@/lib/messages";
import { localeFromMatches, resolveLocale } from "@/lib/locale";
import { useLoaderData, Link, redirect } from "react-router";
import type { Route } from "./+types/stats";
import { createDb } from "@/lib/db";
import { getEnv } from "@/lib/env.server";
import { createAuth } from "@/lib/auth";
import { getOptionalSession } from "@/lib/session";
import { users, categoryRecords } from "@/lib/schema";
import { asc, desc, eq, sql } from "drizzle-orm";
import { fetchAllExternalStats, fetchSpeedrunComStats, type ExternalStatsData } from "@/lib/external-stats";
import { getNetherEnterCount, getMainPaces, type GroupedPaceEntry } from "@/lib/paceman-cache";
import { getMinefolioEloRank } from "@/lib/rankings-query.server";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { PageSection } from "@/components/page-section";
import { OwnerEditAction } from "@/components/player-profile-bits";
import { RecordCard } from "@/components/record-card";
import { MCSRRankedCard, PaceManStatsCard, SpeedrunComCard } from "@/components/player-stats-cards";
import { Trophy, ArrowLeft } from "lucide-react";
import { useT, useLocale } from "@/hooks/use-locale";
import { getLocalizedDisplayName } from "@/lib/slug";
import { resolvePlayerSlugFallback } from "@/lib/player-slug-fallback.server";

export const meta: Route.MetaFunction = ({ matches, params, loaderData }) => {
  const t = createTranslator(localeFromMatches(matches));
  // 名前は h1 と同じ（getLocalizedDisplayName。走者画面の <title> と同じ選び方）
  const displayName = loaderData
    ? getLocalizedDisplayName(loaderData, localeFromMatches(matches))
    : params.slug;
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
  const normalizedSlug = slug?.toLowerCase();

  // session の取得と slug での走者検索は独立しているため並列に実行する（profile.tsx と同じ）
  const [session, player] = await Promise.all([
    getOptionalSession(request, auth),
    db.query.users.findFirst({
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
        speedruncomUsername: true,
      },
      // 手入力のカスタム記録（走者画面の記録タブと同じ条件・並び。ピン留めを先頭に）
      with: {
        categoryRecords: {
          where: eq(categoryRecords.isVisible, true),
          orderBy: [desc(categoryRecords.isPinned), asc(categoryRecords.displayOrder)],
          columns: {
            id: true,
            category: true,
            categoryDisplayName: true,
            subcategory: true,
            personalBest: true,
            targetTime: true,
            achieved: true,
            pbVideoUrl: true,
            pbNotes: true,
            isPinned: true,
          },
        },
      },
    }),
  ]);

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
  const [externalStatsRaw, netherEnterCount, recentPaces, minefolioEloRank] = await Promise.all([
    // 記録タブと同じ条件: MCID があれば3サービス、MCID が無くても speedrun.com ユーザー名があればそれだけ取る
    player.mcid
      ? fetchAllExternalStats(player.mcid, player.speedruncomUsername)
      : player.speedruncomUsername
        ? fetchSpeedrunComStats(player.speedruncomUsername).then((speedruncom) => ({ speedruncom }) as ExternalStatsData)
        : Promise.resolve({} as ExternalStatsData),
    player.mcid ? getNetherEnterCount(player.mcid) : Promise.resolve(0),
    player.mcid
      ? getMainPaces(player.mcid, 10)
      : Promise.resolve<GroupedPaceEntry[]>([]),
    player.profileVisibility === "public" && player.showRankedStats !== false
      ? getMinefolioEloRank(db, player.id)
      : Promise.resolve(null),
  ]);

  // Ranked統計を非表示設定にしているユーザーは、profile.tsx の活動・記録タブと同様に
  // MCSR Ranked カードを表示しない。非表示の統計データを loader ペイロードで配らないよう
  // ここで ranked を落とす（コンポーネント側のカード表示条件・hasAnyData 判定はそのまま連動する）
  const externalStats =
    player.showRankedStats === false ? { ...externalStatsRaw, ranked: null } : externalStatsRaw;

  return {
    mcid: player.mcid,
    slug: player.slug,
    displayName: player.displayName,
    displayNameAlphabet: player.displayNameAlphabet,
    externalStats,
    netherEnterCount,
    recentPaces,
    minefolioEloRank,
    categoryRecords: player.categoryRecords,
    isOwner: !!session?.user?.id && session.user.id === player.discordId,
    appUrl,
  };
}

export default function PlayerStatsPage() {
  const t = useT();
  const locale = useLocale();
  const { mcid, slug, displayName, displayNameAlphabet, externalStats, netherEnterCount, recentPaces, minefolioEloRank, categoryRecords, isOwner } = useLoaderData<typeof loader>();

  // 表示名の優先順位: （英語表示なら）アルファベット表記 > displayName > mcid > slug
  const playerDisplayName = getLocalizedDisplayName(
    { displayName, displayNameAlphabet, mcid, slug },
    locale,
  );

  const hasPacemanData = externalStats.paceman?.isRegistered || netherEnterCount > 0 || recentPaces.length > 0;
  // 手入力のカスタム記録も「データあり」に数える（走者画面の記録タブと同じ）
  const hasAnyData =
    externalStats.ranked?.isRegistered ||
    hasPacemanData ||
    (externalStats.speedruncom?.personalBests?.length ?? 0) > 0 ||
    categoryRecords.length > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" className="min-h-11 sm:min-h-8" asChild>
          {/* 戻り先は走者画面の記録タブ（このページと同じ中身のタブ） */}
          <Link to={`/player/${slug}?tab=stats`}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t("playerStats.backToProfile")}
          </Link>
        </Button>
        <h1 className="min-w-0 text-2xl font-bold break-words">{playerDisplayName}</h1>
      </div>

      {/* 走者画面の記録タブと同じ骨格（h2 ＞ 欄 h3 ＞ 小見出し h4。欄は箱なし）。見出し直後の欄の上罫線は外す */}
      <div className="space-y-7 sm:space-y-8 [&>[data-stats-title]+section]:border-t-0 [&>[data-stats-title]+section]:pt-0">
        <h2 data-stats-title className="text-xl font-bold md:text-2xl">{t("playerStats.heading")}</h2>

        {!hasAnyData ? (
          <EmptyState
            icon={<Trophy className="h-12 w-12" />}
            title={t("playerProfile.noStatsTitle")}
            description={t(isOwner ? "playerProfile.noStatsDescriptionOwner" : "playerProfile.noStatsDescription")}
            action={isOwner ? <OwnerEditAction to="/me/records" label={t("playerProfile.editLinkRecords")} /> : undefined}
          />
        ) : (
          <>
            {/* MCSR Ranked Section */}
            {externalStats.ranked?.isRegistered && (
              <MCSRRankedCard framed={false} ranked={externalStats.ranked} minefolioRank={minefolioEloRank} />
            )}

            {/* PaceMan Section */}
            {hasPacemanData && (
              <PaceManStatsCard
                framed={false}
                netherEnterCount={netherEnterCount}
                mainPaces={recentPaces}
                openDetailsMcid={externalStats.paceman?.isRegistered ? mcid : null}
              />
            )}

            {/* Speedrun.com Section */}
            {externalStats.speedruncom &&
              !externalStats.speedruncom.error &&
              externalStats.speedruncom.personalBests.length > 0 && (
                <SpeedrunComCard framed={false} speedruncom={externalStats.speedruncom} showUsername />
              )}

            {/* カスタム記録（RecordCard は1件ずつの箱のまま。記録タブと同じ） */}
            {categoryRecords.length > 0 && (
              <PageSection headingLevel="h3" id="stats-custom-records" title={t("playerProfile.customRecords")}>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {categoryRecords.map((record) => (
                    <RecordCard key={record.id} record={record} />
                  ))}
                </div>
              </PageSection>
            )}
          </>
        )}
      </div>
    </div>
  );
}
