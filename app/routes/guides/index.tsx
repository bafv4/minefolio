import { createTranslator } from "@/lib/messages";
import {
  useLoaderData,
  useSearchParams,
  useNavigation,
  useLocation,
  Form,
  Link,
  type LoaderFunctionArgs,
  type ShouldRevalidateFunctionArgs,
} from "react-router";
import { useEffect, useRef } from "react";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getOptionalSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users, guides } from "@/lib/schema";
import { and, eq, sql } from "drizzle-orm";
import { guideLikeCountSql, guideListOrderBy } from "@/lib/likes.server";
import { parseGuideTags, rankGuideTags } from "@/lib/guide-tags";
import { guidePageViewsSql, hasPageViewStats } from "@/lib/page-view-stats.server";
import { PAGE_VIEW_WINDOW_DAYS } from "@/lib/page-view-paths";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/empty-state";
import { BookOpen, Search } from "lucide-react";
import { useT, useLocale } from "@/hooks/use-locale";
import { localeFromMatches, resolveLocale } from "@/lib/locale";
import { getGuideTranslations } from "@/lib/content-translation.server";
import { applyGuideTranslation } from "@/lib/guide-translation-list";
import { pickDisplayName } from "@/lib/slug";
import { GuidesContentTabs } from "@/components/content-tabs";
import { TabContentSkeleton } from "@/components/tab-content-skeleton";
import { useTabNavigation } from "@/hooks/use-tab-navigation";
import { ViewToggle } from "@/components/view-toggle";
import {
  GUIDE_TAG_HIT_AREA,
  GuideListSkeleton,
  type GuideItem,
  type GuideItemWithAuthorSlug,
} from "@/components/guide-list-views";
import { GuidePagedList } from "@/components/guide-paged-list";
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
  // 人気順以外では注記しないので問い合わせない（true = 注記不要）。
  // 閲覧者の解決（session → users 行）は本体クエリと独立なので同じ Promise.all で並行する
  const [viewer, hasPageViewData, allGuides] = await Promise.all([
    (async () => {
      const session = await getOptionalSession(request, auth);
      return session
        ? ((await db.query.users.findFirst({
            where: eq(users.discordId, session.user.id),
            columns: { id: true },
          })) ?? null)
        : null;
    })(),
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
        // 著者の顔（カード・リストの著者名の左）。同じ JOIN で取れるので追加クエリは無い
        authorUuid: users.uuid,
        authorCustomSkinUrl: users.customSkinUrl,
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
      const tags = parseGuideTags(g.guide.tags);
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
    const tags = parseGuideTags(g.guide.tags);
    tags.forEach((t) => {
      tagCounts[t] = (tagCounts[t] || 0) + 1;
    });
  });
  // 並び替え（新着・人気）に依存しない順（件数 → 名前）
  const allTags = rankGuideTags(tagCounts, locale);

  // 自動翻訳（docs/translation.md）。表示対象の訳文をまとめて 1 回で引き、title / summary を差し替える。
  // 検索・タグ絞り込みは原文で行う。機能無効・opt-out・失効・原文と同じロケールでは空の Map（原文のまま）
  const translations = await getGuideTranslations(
    db,
    filtered.map((g) => g.guide.id),
    locale,
  );
  const translatedGuides = filtered.map((row) => ({
    ...row,
    guide: applyGuideTranslation(row.guide, translations),
  }));

  const appUrl = env.APP_URL || "https://minefolio.app";
  return {
    guides: translatedGuides,
    allTags,
    tag,
    q,
    sort,
    hasPageViewData,
    viewerId: viewer?.id ?? null,
    appUrl,
  };
}

/** 表示形式（?view=list）を除いたクエリ。表示形式だけが変わったかの判定に使う */
function searchWithoutView(search: string): string {
  const params = new URLSearchParams(search);
  params.delete("view");
  return params.toString();
}

/**
 * 表示形式（view）の値だけが変わり、ほかは同じ遷移か。同じ URL への再検証（いいねの fetcher の後・同じ検索の
 * 再送信など）は当てはまらない（view が変わっていない）ので、従来どおり再検証される
 */
function isViewToggle(
  current: { pathname: string; search: string },
  next: { pathname: string; search: string },
): boolean {
  return (
    current.pathname === next.pathname &&
    new URLSearchParams(current.search).get("view") !== new URLSearchParams(next.search).get("view") &&
    searchWithoutView(current.search) === searchWithoutView(next.search)
  );
}

// 表示形式（view）だけを切り替えたときはサーバーデータが同一なので再取得しない（/browse と同じ考え方）
export function shouldRevalidate({ currentUrl, nextUrl, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) {
  if (isViewToggle(currentUrl, nextUrl)) return false;
  return defaultShouldRevalidate;
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
  const location = useLocation();
  // 表示形式の切替だけのナビゲーション（このルートの loader は再実行しない。親のレイアウトは再検証される）では
  // 一覧をスケルトンに差し替えない
  const isViewOnlyNavigation = !!navigation.location && isViewToggle(location, navigation.location);
  const isNavigating = navigation.state === "loading" && !isViewOnlyNavigation;
  const { isTabSwitching } = useTabNavigation();
  // 表示形式は URL の ?view=list に保持する（既定のカードはパラメータなし。/browse と同じ形）。
  // 戻る・再読み込みでも保たれる。切替は履歴を積まない replace で行う
  const viewMode: "card" | "list" = searchParams.get("view") === "list" ? "list" : "card";
  const setViewMode = (mode: "card" | "list") => {
    setSearchParams(
      (prev) => {
        if (mode === "list") prev.set("view", "list");
        else prev.delete("view");
        return prev;
      },
      { replace: true, preventScrollReset: true },
    );
  };
  const tagNavRef = useRef<HTMLElement | null>(null);

  // 選択中のタグが横スクロールのレールの外にあるときだけ、初回に見える位置へ寄せる
  // （ページ本体はスクロールさせない。nav の scrollLeft だけ動かす）
  useEffect(() => {
    const nav = tagNavRef.current;
    const el = nav?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!nav || !el) return;
    const n = nav.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (r.left >= n.left && r.right <= n.right) return;
    nav.scrollLeft += r.left - n.left - (n.width - r.width) / 2;
  }, []);

  // Transform loader data to GuideItem[]
  // isPinned はプロフィールのガイドタブでのみ考慮する仕様のため、グローバル一覧では意図的に落とす
  // （selectで必要カラムのみ取得しているため isPinned はそもそも含まれない）
  // 型注釈にする（as キャストだと likeCount 等の取得漏れを型検査が見逃す）
  const guideItems: GuideItemWithAuthorSlug[] = allGuides.map(
    ({ guide, likeCount, pageViews7d, authorId, authorSlug, authorDisplayName, authorDisplayNameAlphabet, authorMcid, authorUuid, authorCustomSkinUrl }) => ({
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
      authorAvatar: { uuid: authorUuid, skinUrl: authorCustomSkinUrl },
      _authorSlug: authorSlug,
    }),
  );

  const linkFn = (guide: GuideItem) => {
    const item = guide as GuideItemWithAuthorSlug;
    return `/guides/${item._authorSlug}/${guide.slug}`;
  };

  // タグの絞り込みリンク。ほかのクエリ（検索語・並び順）は保ち、tag だけ入れ替える／外す
  const tagHref = (value: string | null) => {
    const params = new URLSearchParams(searchParams);
    if (value) params.set("tag", value);
    else params.delete("tag");
    const qs = params.toString();
    return qs ? `?${qs}` : "?";
  };

  // 件数の文言。絞り込み中は「n 件（検索: …、タグ: …）」のように何で絞っているかを添える
  const activeFilters = [
    q ? t("guides.resultFilterQuery", { q }) : "",
    tag ? t("guides.resultFilterTag", { tag }) : "",
  ].filter(Boolean);
  const resultCountText =
    activeFilters.length > 0
      ? t("guides.resultCountFiltered", {
          count: guideItems.length,
          filters: activeFilters.join(t("guides.resultFilterSeparator")),
        })
      : t("guides.resultCount", { count: guideItems.length });

  // 絞り込み（検索語・タグ）だけを外す。並び順は保つ
  const clearFiltersHref = (() => {
    const params = new URLSearchParams(searchParams);
    params.delete("tag");
    params.delete("q");
    const qs = params.toString();
    return qs ? `?${qs}` : "?";
  })();

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
        <p className="text-sm text-muted-foreground">{t("guides.pageDesc")}</p>
      </div>

      {/* 検索 → 絞り込み（タグ）→ 並び替え → 表示 の順。テンプレート一覧と同じ組み方 */}
      <div className="flex flex-col gap-3">
        {/* 狭い画面では縦積みにする（1行のままだと検索入力が潰れる） */}
        <Form method="get" role="search" className="flex flex-col sm:flex-row gap-2">
          {tag && <input type="hidden" name="tag" value={tag} />}
          {/* GETフォームはクエリを総入れ替えするので、並び順を hidden で持ち越す（tag と同じ理由） */}
          {sort !== "new" && <input type="hidden" name="sort" value={sort} />}
          {viewMode === "list" && <input type="hidden" name="view" value="list" />}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden />
            <Input
              name="q"
              aria-label={t("guides.searchLabel")}
              placeholder={t("guides.searchPlaceholder")}
              defaultValue={q}
              className="h-11 pl-10 pr-12 sm:h-9 sm:pr-3"
            />
            {/* モバイルは検索ボタンを入力欄の右端に収めて縦を節約する（Enter でも送れる） */}
            <Button
              type="submit"
              variant="ghost"
              size="icon"
              className="absolute right-0 top-0 size-11 sm:hidden"
            >
              <Search className="h-4 w-4" aria-hidden />
              <span className="sr-only">{t("common.search")}</span>
            </Button>
          </div>
          <Button type="submit" className="hidden sm:inline-flex">
            <Search className="mr-2 h-4 w-4" />
            {t("common.search")}
          </Button>
        </Form>
        {allTags.length > 0 && (
          // md 未満は 1 行の横スクロールのレール（縦を取らない）。各タグは高さ 44px の枠に入れ、
          // ::after で広げた押せる範囲（見た目は 22px のピルのまま。GUIDE_TAG_HIT_AREA）が枠の中に収まるようにする。
          // md 以上は折り返し表示で、押せる範囲は 24px 以上（隣と重ならない大きさ）
          <nav
            ref={tagNavRef}
            aria-label={t("guides.tagFilterLabel")}
            className="flex gap-x-2 overflow-x-auto [scrollbar-width:none] md:flex-wrap md:gap-y-2 md:overflow-visible [&::-webkit-scrollbar]:hidden"
          >
            {[null, ...allTags].map((name) => {
              const selected = name === null ? !tag : tag === name;
              return (
                <div key={name ?? "__all"} className="flex min-h-11 shrink-0 items-center md:min-h-0">
                  <Badge
                    asChild
                    variant="outline"
                    className={cn(
                      GUIDE_TAG_HIT_AREA.md,
                      // 選択中は brand（ui.md 1 章。primary は dark でほぼ白になる）
                      selected &&
                        "border-transparent bg-brand text-brand-foreground [a&]:hover:bg-brand/90 [a&]:hover:text-brand-foreground",
                    )}
                  >
                    <Link
                      to={tagHref(name)}
                      preventScrollReset
                      aria-current={selected ? "true" : undefined}
                    >
                      {name ?? t("guides.tagAll")}
                    </Link>
                  </Badge>
                </div>
              );
            })}
          </nav>
        )}
        {/* スキップリンク: 検索・タグ・並び替えを飛ばして一覧の先頭へ（フォーカス時だけ見える） */}
        <a
          href="#guide-results"
          className="sr-only rounded-md border bg-background px-3 py-2 text-sm font-medium text-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-20 focus:z-50"
        >
          {t("guides.skipToResults")}
        </a>
        {/* 件数（左）と、並び替え・表示（右）。aria-live は件数だけに付ける。
            件数は一覧の先頭の目印にもなる（スキップリンクの飛び先） */}
        {/* 件数が長い（絞り込みの内容つき）ときは、並び替え・表示を次の行へ回す（件数を細い列に押し込まない） */}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <p
            id="guide-results"
            tabIndex={-1}
            aria-live="polite"
            className="min-w-0 text-sm text-muted-foreground outline-none"
          >
            {resultCountText}
          </p>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <ContentSortSelect
              value={sort}
              onChange={handleSortChange}
              options={GUIDE_SORTS}
              // 既定順の語はテンプレート一覧と同じ「新着順」。ガイドは更新日時で並ぶので、説明でそれを示す
              newestLabel={t("contentSort.newest")}
              // 同じ「人気順」でも一覧ごとに基準が違うため、説明は呼び出し側で用意する
              descriptions={{
                new: t("contentSort.newestUpdatedDesc"),
                likes: t("contentSort.likesDesc"),
                views: t("contentSort.viewsDesc"),
                popular: t("contentSort.popularDesc", { days: PAGE_VIEW_WINDOW_DAYS }),
              }}
            />
            <ViewToggle viewMode={viewMode} onChange={setViewMode} />
          </div>
        </div>
      </div>

      {/* ページビュー集計がまだ無い間は人気順が「いいね数 → 更新日時」へ落ちるので、
          並びが期待と違って見える理由を一覧の直上に出す */}
      {sort === "popular" && !hasPageViewData && (
        <p className="text-sm text-muted-foreground">{t("guides.popularPending")}</p>
      )}

      {isNavigating ? (
        <GuideListSkeleton viewMode={viewMode} />
      ) : guideItems.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="h-12 w-12" />}
          title={q ? t("guides.noGuidesForQueryTitle", { q }) : t("guides.noGuidesTitle")}
          description={tag || q ? t("guides.noMatchDesc") : t("guides.noGuides")}
          action={
            tag || q ? (
              <Button asChild variant="outline" className="min-h-11 sm:min-h-9">
                <Link to={clearFiltersHref}>{t("guides.clearFilters")}</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        // 条件（検索語・タグ・並び順）が変わったら出す件数を戻す（表示形式の切替では戻さない）
        <GuidePagedList
          key={searchWithoutView(searchParams.toString())}
          guides={guideItems}
          linkFn={linkFn}
          viewMode={viewMode}
          titleLevel="h2"
        />
      )}
      </>
      )}
    </div>
  );
}
