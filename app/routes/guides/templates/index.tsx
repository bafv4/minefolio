import { createTranslator } from "@/lib/messages";
import { localeFromMatches, resolveLocale } from "@/lib/locale";
import { pickDisplayName } from "@/lib/slug";
import { useState, useEffect } from "react";
import { useLoaderData, Link, Form, useSearchParams, useNavigation, type LoaderFunctionArgs } from "react-router";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getOptionalSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users, searchCraftTemplates } from "@/lib/schema";
import { eq, and, asc, desc, sql, isNotNull } from "drizzle-orm";
import { templateLikeCountSql } from "@/lib/likes.server";
import { useT, useLocale } from "@/hooks/use-locale";
import {
  ContentSortSelect,
  parseContentSort,
  TEMPLATE_SORTS,
  type ContentSort,
} from "@/components/content-sort-select";
import { LikeButton } from "@/components/like-button";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Combobox } from "@/components/ui/combobox";
import { EmptyState } from "@/components/empty-state";
import { LayoutTemplate, Search, Keyboard, Download, FlaskConical, Languages } from "lucide-react";
import { GuidesContentTabs } from "@/components/content-tabs";
import { TabContentSkeleton } from "@/components/tab-content-skeleton";
import { useTabNavigation } from "@/hooks/use-tab-navigation";
import { getGameLanguageName, gameLanguageOptions } from "@/lib/game-languages";
import { formatDistanceToNow } from "date-fns";
import { dateFnsLocale } from "@/lib/date-locale";

export const meta = ({
  matches,
  loaderData,
}: {
  matches: ReadonlyArray<{ id: string; loaderData?: unknown }>;
  loaderData: Awaited<ReturnType<typeof loader>> | undefined;
}) => {
  const t = createTranslator(localeFromMatches(matches));
  const title = t("templates.title");
  const description = t("templates.pageDesc");
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
  // viewer（session → users）と一覧の取得は互いに独立なので並行する（rows は下で起動）
  const viewerPromise = getOptionalSession(request, auth).then((session) =>
    session
      ? db.query.users.findFirst({
          where: eq(users.discordId, session.user.id),
          columns: { id: true },
        })
      : null
  );

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const lang = (url.searchParams.get("lang") ?? "").trim();
  // 作成者（走者の slug）での絞り込み。著者別のガイド一覧（/guides/:author）からの導線で使う
  const authorSlug = (url.searchParams.get("author") ?? "").trim();
  // テンプレートは新着順・いいね数順のみ（未対応の値は既定順へ落ちる）
  const sort: ContentSort = parseContentSort(url.searchParams.get("sort"), TEMPLATE_SORTS);

  // 言語はSQLで絞り込む（完全一致）
  // 非公開・限定公開の著者のテンプレートは公開一覧（discovery）に出さない
  // （ガイド一覧 guides/index.tsx と同じルール）
  const publicConditions = [
    eq(searchCraftTemplates.isPublished, true),
    eq(users.profileVisibility, "public"),
  ];
  const conditions = [...publicConditions];
  if (lang) {
    conditions.push(eq(searchCraftTemplates.gameLanguage, lang));
  }
  if (authorSlug) {
    // slug の大文字小文字を区別せず一致させる（/guides/:author と同じポリシー）
    conditions.push(sql`lower(${users.slug}) = ${authorSlug.toLowerCase()}`);
  }

  // 言語の絞り込みの選択肢は、公開一覧に出るテンプレートがある言語だけ（件数つき）。
  // 数える範囲は一覧と同じ条件（公開・公開プロフィールの著者）で、いまの絞り込み（言語・検索語・作成者）には依らない
  const languageCountsPromise = db
    .select({
      gameLanguage: searchCraftTemplates.gameLanguage,
      count: sql<number>`count(*)`,
    })
    .from(searchCraftTemplates)
    .innerJoin(users, eq(searchCraftTemplates.userId, users.id))
    .where(and(...publicConditions, isNotNull(searchCraftTemplates.gameLanguage)))
    .groupBy(searchCraftTemplates.gameLanguage);

  // 作成者で絞り込んでいるときは、件数の文言に出す名前を引く（0件でも名前を出せるよう一覧とは別に引く）。
  // 公開一覧と同じく、公開プロフィールの走者だけ
  const filterAuthorPromise = authorSlug
    ? db.query.users.findFirst({
        where: and(
          sql`lower(${users.slug}) = ${authorSlug.toLowerCase()}`,
          eq(users.profileVisibility, "public"),
        ),
        columns: { slug: true, displayName: true, displayNameAlphabet: true, mcid: true },
      })
    : Promise.resolve(undefined);

  // craftCount / hasRemaps / likeCount はSQLで算出し、craftsData/remapsData 本体は転送・パースしない
  const likeCount = templateLikeCountSql();

  // いいね数順は必ず SQL の ORDER BY で行う。limit(100) が先に効くため、メモリ上で並べ替えると
  // 「新しい100件をいいね数順に並べた」結果になり、古くて人気のテンプレートが永久に出てこない。
  // 同数（初日は全件0）で順序が不定にならないよう id まで含めて全順序にする。
  const orderBy =
    sort === "likes"
      ? [desc(likeCount), desc(searchCraftTemplates.createdAt), asc(searchCraftTemplates.id)]
      : [desc(searchCraftTemplates.createdAt), asc(searchCraftTemplates.id)];

  const rowsPromise = db
    .select({
      id: searchCraftTemplates.id,
      title: searchCraftTemplates.title,
      description: searchCraftTemplates.description,
      craftCount: sql<number>`json_array_length(${searchCraftTemplates.craftsData})`,
      hasRemaps: sql<boolean>`${searchCraftTemplates.remapsData} is not null`,
      gameLanguage: searchCraftTemplates.gameLanguage,
      applyCount: searchCraftTemplates.applyCount,
      likeCount,
      ownerId: searchCraftTemplates.userId,
      createdAt: searchCraftTemplates.createdAt,
      authorSlug: users.slug,
      authorDisplayName: users.displayName,
      authorDisplayNameAlphabet: users.displayNameAlphabet,
      authorMcid: users.mcid,
      // 著者の顔（行の著者名の左）。同じ JOIN で取れるので追加クエリは無い
      authorUuid: users.uuid,
      authorCustomSkinUrl: users.customSkinUrl,
    })
    .from(searchCraftTemplates)
    .innerJoin(users, eq(searchCraftTemplates.userId, users.id))
    .where(and(...conditions))
    .orderBy(...orderBy)
    .limit(100);

  const [viewer, rows, languageCountRows, filterAuthor] = await Promise.all([
    viewerPromise,
    rowsPromise,
    languageCountsPromise,
    filterAuthorPromise,
  ]);
  const languageCounts: Record<string, number> = {};
  for (const row of languageCountRows) {
    if (row.gameLanguage) languageCounts[row.gameLanguage] = Number(row.count);
  }

  let templates = rows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    craftCount: Number(row.craftCount),
    hasRemaps: !!row.hasRemaps,
    gameLanguage: row.gameLanguage,
    applyCount: row.applyCount,
    likeCount: Number(row.likeCount),
    isOwn: !!viewer && row.ownerId === viewer.id,
    createdAt: row.createdAt.toISOString(),
    authorSlug: row.authorSlug,
    authorUuid: row.authorUuid,
    authorSkinUrl: row.authorCustomSkinUrl,
    authorName:
      pickDisplayName(
        { displayName: row.authorDisplayName, displayNameAlphabet: row.authorDisplayNameAlphabet },
        locale,
      ) || row.authorMcid || row.authorSlug,
  }));

  // 名称の絞り込みはガイド一覧と同様にメモリ上で行う（部分一致・大文字小文字を無視）
  if (q) {
    const lower = q.toLowerCase();
    templates = templates.filter((template) =>
      template.title.toLowerCase().includes(lower),
    );
  }

  const appUrl = env.APP_URL || "https://minefolio.app";

  const authorFilterName = authorSlug
    ? filterAuthor
      ? pickDisplayName(
          { displayName: filterAuthor.displayName, displayNameAlphabet: filterAuthor.displayNameAlphabet },
          locale,
        ) || filterAuthor.mcid || filterAuthor.slug
      : authorSlug
    : "";

  return {
    templates,
    q,
    lang,
    author: authorSlug,
    authorFilterName,
    languageCounts,
    sort,
    isLoggedIn: !!viewer,
    appUrl,
  };
}

export default function TemplatesIndexPage() {
  const t = useT();
  const locale = useLocale();
  const { templates, q, lang, author, authorFilterName, languageCounts, sort } =
    useLoaderData<typeof loader>();
  const [langValue, setLangValue] = useState(lang || "__all");
  const [searchParams, setSearchParams] = useSearchParams();
  const hasFilters = !!q || !!lang || !!author;
  // タブ切替（→ /guides）中は一覧をスケルトンに差し替える
  const { isTabSwitching } = useTabNavigation();
  // 検索・絞り込み・並び替え等でのナビゲーション中は一覧をスケルトンに差し替える（guides/index.tsx と同型）
  const navigation = useNavigation();
  const isNavigating = navigation.state === "loading";

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

  // 言語は選んだ時点で絞り込む（並び替えと同じ形。q と sort は保ち、「すべての言語」は lang を外す）
  const handleLangChange = (value: string) => {
    setLangValue(value);
    setSearchParams(
      (prev) => {
        if (!value || value === "__all") prev.delete("lang");
        else prev.set("lang", value);
        return prev;
      },
      { preventScrollReset: true },
    );
  };

  // 戻る/進むナビゲーション時にローダーの値へ同期する
  useEffect(() => {
    setLangValue(lang || "__all");
  }, [lang]);

  // 言語の選択肢は、公開一覧にテンプレートがある言語だけ（件数つき）。URL で選ばれている言語は
  // 0 件でも残す（選択中の値が選択肢に無いとコンボボックスが空表示になるため）
  const languageOptions = [
    { value: "__all", label: t("templates.allLanguages") },
    ...gameLanguageOptions(t, locale)
      .filter((option) => (languageCounts[option.value] ?? 0) > 0 || option.value === lang)
      .map((option) => ({
        value: option.value,
        label: t("templates.languageOptionWithCount", {
          language: option.label,
          count: languageCounts[option.value] ?? 0,
        }),
      })),
  ];

  // 件数の文言（ガイド一覧と同じ形）。絞り込み中は「n 件（検索: …、言語: …、作成者: …）」
  const activeFilters = [
    q ? t("templates.resultFilterQuery", { q }) : "",
    lang ? t("templates.resultFilterLanguage", { language: getGameLanguageName(t, locale, lang) }) : "",
    author ? t("templates.resultFilterAuthor", { name: authorFilterName }) : "",
  ].filter(Boolean);
  const resultCountText =
    activeFilters.length > 0
      ? t("templates.resultCountFiltered", {
          count: templates.length,
          filters: activeFilters.join(t("templates.resultFilterSeparator")),
        })
      : t("templates.resultCount", { count: templates.length });

  // 絞り込み（検索語・言語・作成者）だけを外す。並び順は保つ
  const clearFiltersHref = (() => {
    const params = new URLSearchParams(searchParams);
    params.delete("q");
    params.delete("lang");
    params.delete("author");
    const qs = params.toString();
    return qs ? `?${qs}` : "?";
  })();

  return (
    <div className="space-y-6">
      <GuidesContentTabs active="templates" />

      {/* タブ切替中はタイトル含むコンテンツ全体をスケルトンに */}
      {isTabSwitching ? (
        <TabContentSkeleton variant="cards" />
      ) : (
      <>
      {/* タイトル・説明はタブの内側（コンテンツ側）に置く */}
      {/* Playground は一覧の上の主ボタンにせず、見出しの行の右端に置く副次の操作（ghost）。
          モバイルはアイコンだけ（名前は sr-only で残す）にして、一覧の1件目を押し下げない */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">{t("templates.pageTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("templates.pageDesc")}</p>
        </div>
        <Button asChild variant="ghost" size="sm" className="-mr-2 size-11 shrink-0 sm:size-auto sm:min-h-8">
          <Link to="/playground">
            <FlaskConical className="h-4 w-4 sm:mr-1.5" aria-hidden />
            <span className="sr-only sm:not-sr-only">{t("templates.openPlayground")}</span>
          </Link>
        </Button>
      </div>

      {/* 検索 → 絞り込み（言語）→ 並び替え の順。ガイド一覧と同じ組み方（検索ボタンは入力欄の右端〔狭い画面〕／右隣〔sm 以上〕）。
          検索ボタン押下でGET送信 → 画面更新 */}
      <div className="flex flex-col gap-3">
        <Form method="get" role="search" className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden />
            <Input
              name="q"
              aria-label={t("templates.searchLabel")}
              placeholder={t("templates.searchPlaceholder")}
              defaultValue={q}
              className="h-11 pl-10 pr-12 sm:h-9 sm:pr-3"
            />
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
          <div className="w-full sm:w-64">
            <Combobox
              options={languageOptions}
              value={langValue}
              onValueChange={handleLangChange}
              placeholder={t("templates.allLanguages")}
              searchPlaceholder={t("meDevices.search")}
              emptyText={t("meDevices.notFound")}
              className="h-11 sm:h-9"
            />
          </div>
          {langValue !== "__all" && <input type="hidden" name="lang" value={langValue} />}
          {author && <input type="hidden" name="author" value={author} />}
          {/* GETフォームはクエリを総入れ替えするので、並び順を hidden で持ち越す（lang と同じ理由） */}
          {sort !== "new" && <input type="hidden" name="sort" value={sort} />}
          <Button type="submit" className="hidden sm:inline-flex">
            <Search className="mr-2 h-4 w-4" />
            {t("common.search")}
          </Button>
        </Form>

        {/* 件数（左）と並び替え（右）。aria-live は件数だけ。絞り込み中は解除の導線を件数の隣に出す */}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3">
            <p aria-live="polite" className="min-w-0 text-sm text-muted-foreground">
              {resultCountText}
            </p>
            {hasFilters && (
              <Button asChild variant="link" size="sm" className="h-11 px-0 sm:h-8">
                <Link to={clearFiltersHref} preventScrollReset>
                  {t("templates.resetFilters")}
                </Link>
              </Button>
            )}
          </div>
          {/* 件数の行が長くて折り返したときも、並び替えは右端に置く（ガイド一覧と同じ） */}
          <div className="ml-auto shrink-0">
            <ContentSortSelect
              value={sort}
              onChange={handleSortChange}
              options={TEMPLATE_SORTS}
              newestLabel={t("contentSort.newest")}
              descriptions={{ new: t("contentSort.newestCreatedDesc"), likes: t("contentSort.likesDesc") }}
            />
          </div>
        </div>
      </div>

      {isNavigating ? (
        // 本物の行（タイトル・説明・メタ行）と同じ配置。読み込みの前後で高さが変わらないようにする
        <div className="divide-y divide-border/60" aria-hidden>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="-mx-1 flex items-center gap-3 px-1 py-3">
              <div className="min-w-0 flex-1">
                <Skeleton className="h-5 w-48 max-w-full" />
                <Skeleton className="mt-1.5 h-4 w-2/3" />
                <div className="mt-1.5 flex items-center gap-3">
                  <Skeleton className="size-5 rounded-md" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-12" />
                  <Skeleton className="ml-auto h-4 w-16" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : templates.length > 0 ? (
        <div className="divide-y divide-border/60">
          {templates.map((template) => (
            // 行全体のクリックはオーバーレイのリンクが担う（いいねボタンを <a> の
            // 子孫に置くと不正なHTMLになるため。pace-feed-card と同じ構造）
            <div
              key={template.id}
              className="group relative flex items-center gap-3 py-3 px-1 hover:bg-muted/50 -mx-1 rounded transition-colors"
            >
              <Link
                to={`/guides/templates/${template.id}`}
                prefetch="intent"
                className="absolute inset-0 z-0 rounded"
                aria-label={template.title}
              />
              <div className="flex-1 min-w-0">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                  {/* ゲーム内言語（最重要メタ情報として目立たせる）。狭い画面はタイトルの前置きとして1行目に出し、
                      sm 以上は右端。両方を描いて CSS で出し分ける（非表示側は読み上げにも出ない） */}
                  {template.gameLanguage && (
                    <span className="mb-0.5 flex items-center gap-1.5 text-xs font-medium sm:hidden">
                      <Languages className="h-3 w-3 text-primary" aria-hidden />
                      {getGameLanguageName(t, locale, template.gameLanguage)}
                    </span>
                  )}
                  <h2 className="text-sm font-medium line-clamp-2 sm:line-clamp-1">
                    {template.title}
                  </h2>
                  {template.gameLanguage && (
                    <span className="hidden shrink-0 items-center gap-1.5 text-sm font-medium sm:flex">
                      <Languages className="h-4 w-4 text-primary" aria-hidden />
                      {getGameLanguageName(t, locale, template.gameLanguage)}
                    </span>
                  )}
                </div>
                {template.description && (
                  <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                    {template.description}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs text-muted-foreground">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <MinecraftAvatar
                      uuid={template.authorUuid}
                      skinUrl={template.authorSkinUrl}
                      size={20}
                      alt=""
                      className="shrink-0 rounded-md"
                    />
                    {/* 作成者はガイド一覧と同じ書き方（顔＋名前。「作成者:」の前置きは付けない） */}
                    <span className="truncate">{template.authorName}</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <Search className="h-3 w-3" aria-hidden />
                    {t("templates.craftCount", { count: template.craftCount })}
                  </span>
                  {template.hasRemaps && (
                    <span className="flex items-center gap-1">
                      <Keyboard className="h-3 w-3" aria-hidden />
                      {t("templates.includesRemaps")}
                    </span>
                  )}
                  {/* 適用数は数字だけにせず「適用 n回」と見える文で出す（アイコンと数字だけでは何の数か分からないため。
                      行はオーバーレイのリンクに覆われていて title のツールチップが出ないので、見える文にする） */}
                  <span className="flex items-center gap-1">
                    <Download className="h-3 w-3" aria-hidden />
                    {t("templates.applyCount", { count: template.applyCount })}
                  </span>
                  <LikeButton
                    variant="compact"
                    targetType="template"
                    targetId={template.id}
                    likeCount={template.likeCount}
                    isOwn={template.isOwn}
                  />
                  {/* 相対時刻はSSR時とhydration時で基準時刻がずれるため警告を抑制。ガイド系一覧と
                      同様に右端固定（ml-auto shrink-0）にする */}
                  <span className="ml-auto shrink-0" suppressHydrationWarning>
                    {formatDistanceToNow(new Date(template.createdAt), {
                      addSuffix: true,
                      locale: dateFnsLocale(locale),
                    })}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : hasFilters ? (
        <EmptyState
          icon={<Search className="h-12 w-12" />}
          title={q ? t("templates.noResultsForQueryTitle", { q }) : t("templates.noResultsTitle")}
          description={t("templates.noResultsDescription")}
          action={
            <Button asChild variant="outline" className="min-h-11 sm:min-h-9">
              <Link to={clearFiltersHref}>{t("templates.resetFilters")}</Link>
            </Button>
          }
        />
      ) : (
        <EmptyState
          icon={<LayoutTemplate className="h-12 w-12" />}
          title={t("templates.emptyTitle")}
          description={t("templates.emptyDescriptionSuffix")}
          action={
            <Button asChild variant="outline" size="sm" className="min-h-11 sm:min-h-9">
              <Link to="/my-guides/templates">{t("templates.emptyDescriptionLink")}</Link>
            </Button>
          }
        />
      )}
      </>
      )}
    </div>
  );
}
