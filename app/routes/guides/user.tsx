import { createTranslator } from "@/lib/messages";
import { localeFromMatches, resolveLocale } from "@/lib/locale";
import { getGuideTranslations } from "@/lib/content-translation.server";
import { applyGuideTranslation } from "@/lib/guide-translation-list";
import { useT, useLocale } from "@/hooks/use-locale";
import { getLocalizedDisplayName } from "@/lib/slug";
import {
  useLoaderData,
  Link,
  useNavigation,
  redirect,
  type LoaderFunctionArgs,
} from "react-router";
import { useState } from "react";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getOptionalSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users, guides, searchCraftTemplates } from "@/lib/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { resolvePlayerSlugFallback } from "@/lib/player-slug-fallback.server";
import { guideLikeCountSql } from "@/lib/likes.server";
import { Button } from "@/components/ui/button";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import { EmptyState } from "@/components/empty-state";
import { GuideRouteNotFound } from "@/components/guide-route-not-found";
import { SectionHeaderLink } from "@/components/page-section";
import { BookOpen, ArrowLeft, LayoutTemplate } from "lucide-react";
import { ViewToggle } from "@/components/view-toggle";
import { GuideListSkeleton, type GuideItem } from "@/components/guide-list-views";
import { GuidePagedList } from "@/components/guide-paged-list";

export function meta({
  loaderData,
  matches,
}: {
  loaderData: Awaited<ReturnType<typeof loader>> | undefined;
  matches: Parameters<typeof localeFromMatches>[0];
}) {
  const t = createTranslator(localeFromMatches(matches));
  if (!loaderData?.author) {
    return [{ title: `${t("guides.userNotFound")} - Minefolio` }];
  }
  const name = getLocalizedDisplayName(loaderData.author, localeFromMatches(matches));
  const title = `${t("guides.userGuidesTitle", { name })} - Minefolio`;
  const description = t("guides.userGuidesDescription", { name });
  const ogImage = `${loaderData.appUrl}/icon.png`;
  return [
    { title },
    { name: "description", content: description },
    { property: "og:type", content: "website" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:image", content: ogImage },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: ogImage },
  ];
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const env = getEnv();
  const db = createDb();
  const auth = createAuth(db, env);

  const { authorSlug } = params as { authorSlug: string };
  const url = new URL(request.url);

  // セッション解決（→ isOwner 判定用の currentUser 取得へ連鎖）と著者取得は互いに独立なので並行する
  const [currentUser, author] = await Promise.all([
    getOptionalSession(request, auth).then((session) =>
      session?.user?.id
        ? db.query.users.findFirst({
            where: eq(users.discordId, session.user.id),
            columns: { id: true },
          })
        : null
    ),
    db.query.users.findFirst({
      // slug の大文字小文字を区別せず一致させる（/player/:slug と同じポリシー）
      where: sql`lower(${users.slug}) = ${authorSlug.toLowerCase()}`,
      columns: {
        id: true,
        slug: true,
        mcid: true,
        uuid: true,
        displayName: true,
        displayNameAlphabet: true,
        discordAvatar: true,
        customSkinUrl: true,
        profileVisibility: true,
      },
    }),
  ]);

  if (!author) {
    // MCID変更等でslugが変わった旧URLを、slug_history → Mojang API の順で救済する
    // （publicly referencable なユーザーのみ。private は漏らさない）
    const target = await resolvePlayerSlugFallback(db, authorSlug);
    if (target) {
      throw redirect(`/guides/${encodeURIComponent(target)}${url.search}`);
    }
    throw new Response("Not Found", { status: 404 });
  }

  // プライベートプロフィールの著者のガイド一覧は本人以外に404を返す（プロフィール本体と挙動を揃える）
  const isOwner = currentUser?.id === author.id;
  if (author.profileVisibility === "private" && !isOwner) {
    throw new Response("Not Found", { status: 404 });
  }

  // テンプレートへの導線は、公開一覧（/guides/templates?author=）に出るテンプレートの件数で出し分ける。
  // 公開一覧は公開プロフィールの走者のテンプレートだけを出すので、それ以外の走者は数えない（0件＝導線なし）
  const [authorGuides, templateCountRows] = await Promise.all([
    db.query.guides.findMany({
      where: and(eq(guides.authorId, author.id), eq(guides.isPublished, true)),
      orderBy: [desc(guides.updatedAt)],
      columns: {
        id: true,
        slug: true,
        title: true,
        summary: true,
        tags: true,
        coverImageUrl: true,
        viewCount: true,
        updatedAt: true,
      },
      extras: { likeCount: guideLikeCountSql().as("like_count") },
    }),
    author.profileVisibility === "public"
      ? db
          .select({ count: sql<number>`count(*)` })
          .from(searchCraftTemplates)
          .where(
            and(
              eq(searchCraftTemplates.userId, author.id),
              eq(searchCraftTemplates.isPublished, true),
            ),
          )
      : Promise.resolve([{ count: 0 }]),
  ]);
  const templateCount = Number(templateCountRows[0]?.count ?? 0);

  // 自動翻訳（docs/translation.md）。title / summary を訳文へ差し替える（使えない行は原文のまま）
  const translations = await getGuideTranslations(
    db,
    authorGuides.map((g) => g.id),
    resolveLocale(request),
  );
  const translatedGuides = authorGuides.map((g) => applyGuideTranslation(g, translations));

  const appUrl = env.APP_URL || "https://minefolio.app";
  return { author, guides: translatedGuides, templateCount, appUrl };
}


export default function UserGuidesPage() {
  const t = useT();
  const locale = useLocale();
  const { author, guides: authorGuides, templateCount } = useLoaderData<typeof loader>();
  const authorName = getLocalizedDisplayName(author, locale);
  const [viewMode, setViewMode] = useState<"card" | "list">("card");
  const navigation = useNavigation();
  const isNavigating = navigation.state === "loading";

  const linkFn = (guide: GuideItem) => `/guides/${author.slug}/${guide.slug}`;

  return (
    <div className="space-y-6">
      {/* Back */}
      <Button variant="ghost" size="sm" asChild className="-ml-2 h-11 sm:h-8">
        <Link to="/guides">
          <ArrowLeft className="h-4 w-4 mr-1" />
          {t("guides.guideList")}
        </Link>
      </Button>

      {/* Author header */}
      {/* 名前が長く右の操作と並ばない幅では、操作を次の行の右端へ回す（名前を細い列で折り返させない） */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        {/* 走者画面への導線は右の「プロフィールを見る」1つにする（名前・顔もリンクにすると、同じ行き先で
            Tab の停止点が2つになる） */}
        <div className="flex min-w-0 items-center gap-4">
          <MinecraftAvatar
            uuid={author.uuid ?? undefined}
            skinUrl={author.customSkinUrl}
            size={44}
            alt=""
            className="shrink-0 rounded-xl"
          />
          <div className="min-w-0">
            <h1 className="text-2xl font-bold break-words">{authorName}</h1>
            {author.mcid && (
              <p className="text-sm text-muted-foreground">@{author.mcid}</p>
            )}
            <p className="text-sm text-muted-foreground mt-0.5">
              {t("guides.guidesCount", { count: authorGuides.length })}
            </p>
            {/* この走者のサーチクラフトテンプレート（公開一覧の作成者の絞り込み）。公開一覧に出るものがあるときだけ。
                押せる高さは負のマージン＋同じ量の padding で広げる（モバイル 44px、sm 以上 28px。行の高さは変えない） */}
            {templateCount > 0 && (
              <Link
                to={`/guides/templates?author=${encodeURIComponent(author.slug)}`}
                className="-my-3 inline-flex items-center gap-1.5 py-3 text-sm text-primary hover:underline sm:-my-1 sm:py-1"
              >
                <LayoutTemplate className="h-3.5 w-3.5" aria-hidden />
                {t("guides.authorTemplatesLink", { count: templateCount })}
              </Link>
            )}
          </div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <SectionHeaderLink to={`/player/${author.slug}`} label={t("guides.viewProfile")} />
          <ViewToggle viewMode={viewMode} onChange={setViewMode} />
        </div>
      </div>

      {/* Guide list */}
      {isNavigating ? (
        <GuideListSkeleton viewMode={viewMode} />
      ) : authorGuides.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="h-12 w-12" />}
          title={t("guides.noPublishedGuidesTitle")}
          description={t("guides.noPublishedGuides")}
        />
      ) : (
        <GuidePagedList
          key={author.slug}
          guides={authorGuides}
          linkFn={linkFn}
          viewMode={viewMode}
          titleLevel="h2"
        />
      )}
    </div>
  );
}

export function ErrorBoundary() {
  const t = useT();
  return (
    <GuideRouteNotFound
      title={t("guides.userNotFound")}
      description={t("guides.notFoundHint")}
      backTo="/guides"
      backLabel={t("guides.guideList")}
      showFindRunner
    />
  );
}
