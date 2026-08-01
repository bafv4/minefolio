import { createTranslator } from "@/lib/messages";
import { useLoaderData, useSearchParams, useNavigation, Form, type LoaderFunctionArgs } from "react-router";
import { useState } from "react";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getOptionalSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users, guides } from "@/lib/schema";
import { and, eq, sql } from "drizzle-orm";
import { guideLikeCountSql, guideListOrderBy } from "@/lib/likes.server";
import { guidePageViewsSql, hasPageViewStats } from "@/lib/page-view-stats.server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { BookOpen, Search } from "lucide-react";
import { useT, useLocale } from "@/hooks/use-locale";
import { localeFromMatches, resolveLocale } from "@/lib/locale";
import { pickDisplayName } from "@/lib/slug";
import { GuidesContentTabs } from "@/components/content-tabs";
import { TabContentSkeleton } from "@/components/tab-content-skeleton";
import { useTabNavigation } from "@/hooks/use-tab-navigation";
import {
  ViewToggle,
  GuideCardGrid,
  GuideListView,
  type GuideItem,
  type GuideItemWithAuthorSlug,
} from "@/components/guide-list-views";
import {
  ContentSortSelect,
  parseContentSort,
  GUIDE_SORTS,
  type ContentSort,
} from "@/components/content-sort-select";

export const meta = ({
  loaderData,
  matches,
}: {
  loaderData: Awaited<ReturnType<typeof loader>> | undefined;
  matches: ReadonlyArray<{ id: string; data?: unknown }>;
}) => {
  const t = createTranslator(localeFromMatches(matches));
  const title = t("guides.title");
  const description = t("guides.pageDesc");
  const appUrl = loaderData?.appUrl || "https://minefolio.app";
  const ogImage = `${appUrl}/icon.png`;
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
};

export async function loader({ request }: LoaderFunctionArgs) {
  const env = getEnv();
  const db = createDb();
  const locale = resolveLocale(request);

  const auth = createAuth(db, env);
  const session = await getOptionalSession(request, auth);
  const viewer = session
    ? await db.query.users.findFirst({
        where: eq(users.discordId, session.user.id),
        columns: { id: true },
      })
    : null;

  const url = new URL(request.url);
  const tag = url.searchParams.get("tag") || "";
  const q = url.searchParams.get("q") || "";
  const sort: ContentSort = parseContentSort(url.searchParams.get("sort"), GUIDE_SORTS);

  const likeCount = guideLikeCountSql();
  // 並び順の定義（人気順=7日PVのフォールバック含む）は likes.server.ts に集約している
  const orderBy = guideListOrderBy(sort);

  const isPopular = sort === "popular";
  // 人気順のときだけ根拠数値（直近7日PV）を取る。他の並びでは表示しないので、
  // 相関サブクエリを走らせず定数に差し替える（select の形は変えず1本のクエリのまま）
  const pageViews7d = isPopular ? guidePageViewsSql() : sql<number>`0`;
  // 集計がまだ無いと人気順は「いいね数 → 更新日時」へ落ちるため、UI で注記を出す。
  // 人気順以外では注記しないので問い合わせない（true = 注記不要）
  const [hasPageViewData, allGuides] = await Promise.all([
    isPopular ? hasPageViewStats(db, "guide") : Promise.resolve(true),
    db
      .select({
        guide: {
          id: guides.id,
          slug: guides.slug,
          title: guides.title,
          summary: guides.summary,
          tags: guides.tags,
          coverImageUrl: guides.coverImageUrl,
          viewCount: guides.viewCount,
          updatedAt: guides.updatedAt,
        },
        likeCount,
        pageViews7d,
        authorId: guides.authorId,
        authorSlug: users.slug,
        authorDisplayName: users.displayName,
        authorDisplayNameAlphabet: users.displayNameAlphabet,
        authorMcid: users.mcid,
      })
      .from(guides)
      .innerJoin(users, eq(guides.authorId, users.id))
      // 非公開・限定公開の著者のガイドは公開一覧（discovery）に出さない（browse-query と挙動を揃える）
      .where(and(eq(guides.isPublished, true), eq(users.profileVisibility, "public")))
      .orderBy(...orderBy),
  ]);

  // Filter in memory for tag/search (simple approach)
  let filtered = allGuides;
  if (tag) {
    filtered = filtered.filter((g) => {
      const tags = JSON.parse(g.guide.tags) as string[];
      return tags.includes(tag);
    });
  }
  if (q) {
    const lower = q.toLowerCase();
    filtered = filtered.filter(
      (g) =>
        g.guide.title.toLowerCase().includes(lower) ||
        (g.guide.summary && g.guide.summary.toLowerCase().includes(lower))
    );
  }

  // Collect all tags for filter UI
  const tagCounts: Record<string, number> = {};
  allGuides.forEach((g) => {
    const tags = JSON.parse(g.guide.tags) as string[];
    tags.forEach((t) => {
      tagCounts[t] = (tagCounts[t] || 0) + 1;
    });
  });
  const allTags = Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([name]) => name);

  const appUrl = env.APP_URL || "https://minefolio.app";
  return {
    guides: filtered,
    allTags,
    tag,
    q,
    sort,
    hasPageViewData,
    viewerId: viewer?.id ?? null,
    appUrl,
  };
}

export default function GuidesIndexPage() {
  const t = useT();
  const locale = useLocale();
  const {
    guides: allGuides,
    allTags,
    tag,
    q,
    sort,
    hasPageViewData,
    viewerId,
  } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const isNavigating = navigation.state === "loading";
  const { isTabSwitching } = useTabNavigation();
  const [viewMode, setViewMode] = useState<"card" | "list">("card");

  // Transform loader data to GuideItem[]
  // isPinned はプロフィールのガイドタブでのみ考慮する仕様のため、グローバル一覧では意図的に落とす
  // （selectで必要カラムのみ取得しているため isPinned はそもそも含まれない）
  // 型注釈にする（as キャストだと likeCount 等の取得漏れを型検査が見逃す）
  const guideItems: GuideItemWithAuthorSlug[] = allGuides.map(
    ({ guide, likeCount, pageViews7d, authorId, authorSlug, authorDisplayName, authorDisplayNameAlphabet, authorMcid }) => ({
      ...guide,
      likeCount: Number(likeCount),
      // 直近7日PVは人気順のときだけ集計している（それ以外は常に0が入るので出さない）
      pageViews7d: sort === "popular" ? Number(pageViews7d) : undefined,
      isOwn: !!viewerId && authorId === viewerId,
      authorName:
        pickDisplayName(
          { displayName: authorDisplayName, displayNameAlphabet: authorDisplayNameAlphabet },
          locale,
        ) || authorMcid || authorSlug,
      _authorSlug: authorSlug,
    }),
  );

  const linkFn = (guide: GuideItem) => {
    const item = guide as GuideItemWithAuthorSlug;
    return `/guides/${item._authorSlug}/${guide.slug}`;
  };

  const handleSortChange = (value: ContentSort) => {
    setSearchParams(
      (prev) => {
        // 既定値のときはパラメータを消してURLを綺麗に保つ
        if (value === "new") prev.delete("sort");
        else prev.set("sort", value);
        return prev;
      },
      { preventScrollReset: true },
    );
  };

  return (
    <div className="space-y-6">
      <GuidesContentTabs active="guides" />

      {/* タブ切替中はタイトル含むコンテンツ全体をスケルトンに（タイトルはタブ内側にあるため、
          先行切替済みのタブと旧ページのタイトルが食い違って見えないようにする） */}
      {isTabSwitching ? (
        <TabContentSkeleton variant="cards" />
      ) : (
      <>
      {/* タイトル・説明はタブの内側（コンテンツ側）に置く */}
      <div>
        <h1 className="text-2xl font-bold">{t("guides.pageTitle")}</h1>
      </div>

      {/* Search + tag filter + toggle */}
      <div className="flex flex-col gap-3">
        {/* 狭い画面では縦積みにする（1行のままだと検索入力が潰れる。テンプレート一覧と同じ構成） */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <Form method="get" className="flex flex-col sm:flex-row gap-2 flex-1">
            {tag && <input type="hidden" name="tag" value={tag} />}
            {/* GETフォームはクエリを総入れ替えするので、並び順を hidden で持ち越す（tag と同じ理由） */}
            {sort !== "new" && <input type="hidden" name="sort" value={sort} />}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                name="q"
                placeholder={t("guides.searchPlaceholder")}
                defaultValue={q}
                className="pl-10"
              />
            </div>
            <Button type="submit">
              <Search className="mr-2 h-4 w-4" />
              {t("common.search")}
            </Button>
          </Form>
          <div className="flex items-center justify-end gap-2">
            <ContentSortSelect
              value={sort}
              onChange={handleSortChange}
              options={GUIDE_SORTS}
              newestLabel={t("contentSort.recentlyUpdated")}
              // 同じ「人気順」でも一覧ごとに基準が違うため、説明は呼び出し側で用意する
              descriptions={{
                likes: t("contentSort.likesDesc"),
                views: t("contentSort.viewsDesc"),
                popular: t("contentSort.popularDesc"),
              }}
            />
            <ViewToggle viewMode={viewMode} onChange={setViewMode} />
          </div>
        </div>
        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <Badge
              variant={!tag ? "default" : "outline"}
              className="cursor-pointer"
              onClick={() =>
                setSearchParams((prev) => {
                  prev.delete("tag");
                  return prev;
                })
              }
            >
              {t("guides.tagAll")}
            </Badge>
            {allTags.map((t) => (
              <Badge
                key={t}
                variant={tag === t ? "default" : "outline"}
                className="cursor-pointer"
                onClick={() =>
                  setSearchParams((prev) => {
                    prev.set("tag", t);
                    return prev;
                  })
                }
              >
                {t}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* ページビュー集計がまだ無い間は人気順が「いいね数 → 更新日時」へ落ちるので、
          並びが期待と違って見える理由を一覧の直上に出す */}
      {sort === "popular" && !hasPageViewData && (
        <p className="text-sm text-muted-foreground">{t("guides.popularPending")}</p>
      )}

      {isNavigating ? (
        viewMode === "card" ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="border border-border/70 rounded-xl overflow-hidden">
                <Skeleton className="h-36 w-full" />
                <div className="p-4 space-y-2">
                  <Skeleton className="h-5 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-1">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 py-3 px-1">
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-32" />
                </div>
              </div>
            ))}
          </div>
        )
      ) : guideItems.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <BookOpen className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p>{t("guides.noGuides")}</p>
        </div>
      ) : viewMode === "card" ? (
        <GuideCardGrid guides={guideItems} linkFn={linkFn} />
      ) : (
        <GuideListView guides={guideItems} linkFn={linkFn} />
      )}
      </>
      )}
    </div>
  );
}
