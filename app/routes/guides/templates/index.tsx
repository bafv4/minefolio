import { createTranslator } from "@/lib/messages";
import { localeFromMatches } from "@/lib/locale";
import { useState, useEffect } from "react";
import { useLoaderData, Link, Form, useSearchParams, type LoaderFunctionArgs } from "react-router";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getOptionalSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users, searchCraftTemplates } from "@/lib/schema";
import { eq, and, asc, desc, sql } from "drizzle-orm";
import { templateLikeCountSql } from "@/lib/likes.server";
import { useT, useLocale } from "@/hooks/use-locale";
import {
  ContentSortSelect,
  parseContentSort,
  TEMPLATE_SORTS,
  type ContentSort,
} from "@/components/content-sort-select";
import { LikeButton } from "@/components/like-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
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

  const auth = createAuth(db, env);
  const session = await getOptionalSession(request, auth);
  const viewer = session
    ? await db.query.users.findFirst({
        where: eq(users.discordId, session.user.id),
        columns: { id: true },
      })
    : null;

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const lang = (url.searchParams.get("lang") ?? "").trim();
  // テンプレートは「おすすめ順」を持たない（未対応の値は既定順へ落ちる）
  const sort: ContentSort = parseContentSort(url.searchParams.get("sort"), TEMPLATE_SORTS);

  // 言語はSQLで絞り込む（完全一致）
  // 非公開・限定公開の著者のテンプレートは公開一覧（discovery）に出さない
  // （ガイド一覧 guides/index.tsx と同じルール）
  const conditions = [
    eq(searchCraftTemplates.isPublished, true),
    eq(users.profileVisibility, "public"),
  ];
  if (lang) {
    conditions.push(eq(searchCraftTemplates.gameLanguage, lang));
  }

  // craftCount / hasRemaps / likeCount はSQLで算出し、craftsData/remapsData 本体は転送・パースしない
  const likeCount = templateLikeCountSql();

  // 人気順は必ず SQL の ORDER BY で行う。limit(100) が先に効くため、メモリ上で並べ替えると
  // 「新しい100件を人気順に並べた」結果になり、古くて人気のテンプレートが永久に出てこない。
  // 同数（初日は全件0）で順序が不定にならないよう id まで含めて全順序にする。
  const orderBy =
    sort === "popular"
      ? [desc(likeCount), desc(searchCraftTemplates.createdAt), asc(searchCraftTemplates.id)]
      : [desc(searchCraftTemplates.createdAt), asc(searchCraftTemplates.id)];

  const rows = await db
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
      authorMcid: users.mcid,
    })
    .from(searchCraftTemplates)
    .innerJoin(users, eq(searchCraftTemplates.userId, users.id))
    .where(and(...conditions))
    .orderBy(...orderBy)
    .limit(100);

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
    authorName: row.authorDisplayName || row.authorMcid || row.authorSlug,
  }));

  // 名称の絞り込みはガイド一覧と同様にメモリ上で行う（部分一致・大文字小文字を無視）
  if (q) {
    const lower = q.toLowerCase();
    templates = templates.filter((template) =>
      template.title.toLowerCase().includes(lower),
    );
  }

  const appUrl = env.APP_URL || "https://minefolio.app";

  return { templates, q, lang, sort, isLoggedIn: !!viewer, appUrl };
}

export default function TemplatesIndexPage() {
  const t = useT();
  const locale = useLocale();
  const { templates, q, lang, sort } = useLoaderData<typeof loader>();
  const [langValue, setLangValue] = useState(lang || "__all");
  const [, setSearchParams] = useSearchParams();
  const hasFilters = !!q || !!lang;
  // タブ切替（→ /guides）中は一覧をスケルトンに差し替える
  const { isTabSwitching } = useTabNavigation();

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

  // 戻る/進むナビゲーション時にローダーの値へ同期する
  useEffect(() => {
    setLangValue(lang || "__all");
  }, [lang]);

  const languageOptions = [
    { value: "__all", label: t("templates.allLanguages") },
    ...gameLanguageOptions(t, locale),
  ];

  return (
    <div className="space-y-6">
      <GuidesContentTabs active="templates" />

      {/* タブ切替中はタイトル含むコンテンツ全体をスケルトンに */}
      {isTabSwitching ? (
        <TabContentSkeleton variant="cards" />
      ) : (
      <>
      {/* タイトル・説明はタブの内側（コンテンツ側）に置く */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t("templates.pageTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("templates.pageDesc")}</p>
        </div>
        <Button asChild variant="outline" className="w-full sm:w-auto">
          <Link to="/playground">
            <FlaskConical className="mr-2 h-4 w-4" />
            {t("templates.openPlayground")}
          </Link>
        </Button>
      </div>

      {/* 検索バー（検索ボタン押下でGET送信 → 画面更新） */}
      <Form method="get" className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            name="q"
            placeholder={t("templates.searchPlaceholder")}
            defaultValue={q}
            className="pl-10"
          />
        </div>
        <div className="w-full sm:w-64">
          <Combobox
            options={languageOptions}
            value={langValue}
            onValueChange={setLangValue}
            placeholder={t("templates.allLanguages")}
            searchPlaceholder={t("meDevices.search")}
            emptyText={t("meDevices.notFound")}
          />
        </div>
        {langValue !== "__all" && <input type="hidden" name="lang" value={langValue} />}
        {/* GETフォームはクエリを総入れ替えするので、並び順を hidden で持ち越す（lang と同じ理由） */}
        {sort !== "new" && <input type="hidden" name="sort" value={sort} />}
        <Button type="submit">
          <Search className="mr-2 h-4 w-4" />
          {t("templates.searchButton")}
        </Button>
      </Form>

      <div className="flex items-center justify-end">
        <ContentSortSelect
          value={sort}
          onChange={handleSortChange}
          options={TEMPLATE_SORTS}
          newestLabel={t("contentSort.newest")}
        />
      </div>

      {templates.length > 0 ? (
        <div className="divide-y">
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
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-medium group-hover:text-primary transition-colors line-clamp-1">
                    {template.title}
                  </h3>
                  {/* ゲーム内言語（最重要メタ情報として目立たせる） */}
                  {template.gameLanguage && (
                    <span className="flex items-center gap-1.5 text-sm font-medium shrink-0">
                      <Languages className="h-4 w-4 text-primary" />
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
                  <span>{t("templates.byAuthor", { name: template.authorName })}</span>
                  <span className="flex items-center gap-0.5">
                    <Search className="h-3 w-3" />
                    {t("templates.craftCount", { count: template.craftCount })}
                  </span>
                  {template.hasRemaps && (
                    <span className="flex items-center gap-0.5">
                      <Keyboard className="h-3 w-3" />
                      {t("templates.includesRemaps")}
                    </span>
                  )}
                  <span className="flex items-center gap-0.5">
                    <Download className="h-3 w-3" />
                    {template.applyCount}
                  </span>
                  <LikeButton
                    variant="compact"
                    targetType="template"
                    targetId={template.id}
                    likeCount={template.likeCount}
                    isOwn={template.isOwn}
                  />
                  <span>
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
        <Card>
          <CardContent className="text-center py-16">
            <Search className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
            <p className="text-lg font-medium">{t("templates.noResultsTitle")}</p>
            <p className="text-sm text-muted-foreground">
              <Link to="/guides/templates" className="text-primary hover:underline">
                {t("templates.resetFilters")}
              </Link>
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="text-center py-16">
            <LayoutTemplate className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
            <p className="text-lg font-medium">{t("templates.emptyTitle")}</p>
            <p className="text-sm text-muted-foreground">
              <Link to="/my-guides/templates" className="text-primary hover:underline">
                {t("templates.emptyDescriptionLink")}
              </Link>{" "}
              {t("templates.emptyDescriptionSuffix")}
            </p>
          </CardContent>
        </Card>
      )}
      </>
      )}
    </div>
  );
}
