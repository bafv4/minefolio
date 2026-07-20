import { useLoaderData, useSearchParams, useNavigation, Form, type LoaderFunctionArgs } from "react-router";
import { useState } from "react";
import { createDb } from "@/lib/db";
import { getEnv } from "@/lib/env.server";
import { users, guides } from "@/lib/schema";
import { eq, desc } from "drizzle-orm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { BookOpen, Search } from "lucide-react";
import { t } from "@/lib/messages";
import { GuidesContentTabs } from "@/components/content-tabs";
import { TabContentSkeleton } from "@/components/tab-content-skeleton";
import { useTabNavigation } from "@/hooks/use-tab-navigation";
import {
  ViewToggle,
  GuideCardGrid,
  GuideListView,
  type GuideItem,
} from "@/components/guide-list-views";

export const meta = ({ loaderData }: { loaderData: Awaited<ReturnType<typeof loader>> | undefined }) => {
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

  const url = new URL(request.url);
  const tag = url.searchParams.get("tag") || "";
  const q = url.searchParams.get("q") || "";

  const allGuides = await db
    .select({
      guide: guides,
      authorSlug: users.slug,
      authorDisplayName: users.displayName,
      authorMcid: users.mcid,
    })
    .from(guides)
    .innerJoin(users, eq(guides.authorId, users.id))
    .where(eq(guides.isPublished, true))
    .orderBy(desc(guides.updatedAt));

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
  return { guides: filtered, allTags, tag, q, appUrl };
}

export default function GuidesIndexPage() {
  const { guides: allGuides, allTags, tag, q } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const isNavigating = navigation.state === "loading";
  const { isTabSwitching } = useTabNavigation();
  const [viewMode, setViewMode] = useState<"card" | "list">("card");

  // Transform loader data to GuideItem[]
  // isPinned はプロフィールのガイドタブでのみ考慮する仕様のため、グローバル一覧では意図的に落とす
  // （guide: guides で全カラムを取得しているため、GuideItem に残すとカード拡大表示が漏れてしまう）
  const guideItems: GuideItem[] = allGuides.map(({ guide, authorSlug, authorDisplayName, authorMcid }) => {
    const { isPinned: _isPinned, ...guideWithoutPin } = guide;
    return {
      ...guideWithoutPin,
      authorName: authorDisplayName || authorMcid || authorSlug,
      _authorSlug: authorSlug,
    };
  }) as (GuideItem & { _authorSlug: string })[];

  const linkFn = (guide: GuideItem) => {
    const item = guide as GuideItem & { _authorSlug: string };
    return `/guides/${item._authorSlug}/${guide.slug}`;
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
        <div className="flex items-center gap-2">
          <Form method="get" className="flex gap-2 flex-1">
            {tag && <input type="hidden" name="tag" value={tag} />}
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
              検索
            </Button>
          </Form>
          <ViewToggle viewMode={viewMode} onChange={setViewMode} />
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
              すべて
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
