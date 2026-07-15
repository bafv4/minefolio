import { useState, useEffect } from "react";
import { useLoaderData, Link, Form, type LoaderFunctionArgs } from "react-router";
import { createDb } from "@/lib/db";
import { getEnv } from "@/lib/env.server";
import { users, searchCraftTemplates } from "@/lib/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { t } from "@/lib/messages";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { LayoutTemplate, Search, Keyboard, Download, FlaskConical, Languages } from "lucide-react";
import { GuidesContentTabs } from "@/components/content-tabs";
import { getGameLanguageName, GAME_LANGUAGE_OPTIONS } from "@/lib/game-languages";
import { formatDistanceToNow } from "date-fns";
import { ja } from "date-fns/locale";

export const meta = ({ loaderData }: { loaderData: Awaited<ReturnType<typeof loader>> | undefined }) => {
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

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const lang = (url.searchParams.get("lang") ?? "").trim();

  // 言語はSQLで絞り込む（完全一致）
  const conditions = [eq(searchCraftTemplates.isPublished, true)];
  if (lang) {
    conditions.push(eq(searchCraftTemplates.gameLanguage, lang));
  }

  // craftCount / hasRemaps はSQLで算出し、craftsData/remapsData 本体は転送・パースしない
  const rows = await db
    .select({
      id: searchCraftTemplates.id,
      title: searchCraftTemplates.title,
      description: searchCraftTemplates.description,
      craftCount: sql<number>`json_array_length(${searchCraftTemplates.craftsData})`,
      hasRemaps: sql<boolean>`${searchCraftTemplates.remapsData} is not null`,
      gameLanguage: searchCraftTemplates.gameLanguage,
      applyCount: searchCraftTemplates.applyCount,
      createdAt: searchCraftTemplates.createdAt,
      authorSlug: users.slug,
      authorDisplayName: users.displayName,
      authorMcid: users.mcid,
    })
    .from(searchCraftTemplates)
    .innerJoin(users, eq(searchCraftTemplates.userId, users.id))
    .where(and(...conditions))
    .orderBy(desc(searchCraftTemplates.createdAt))
    .limit(100);

  let templates = rows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    craftCount: Number(row.craftCount),
    hasRemaps: !!row.hasRemaps,
    gameLanguage: row.gameLanguage,
    applyCount: row.applyCount,
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

  return { templates, q, lang, appUrl };
}

export default function TemplatesIndexPage() {
  const { templates, q, lang } = useLoaderData<typeof loader>();
  const [langValue, setLangValue] = useState(lang || "__all");
  const hasFilters = !!q || !!lang;

  // 戻る/進むナビゲーション時にローダーの値へ同期する
  useEffect(() => {
    setLangValue(lang || "__all");
  }, [lang]);

  const languageOptions = [
    { value: "__all", label: t("templates.allLanguages") },
    ...GAME_LANGUAGE_OPTIONS,
  ];

  return (
    <div className="space-y-6">
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

      <GuidesContentTabs active="templates" />

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
        <Button type="submit">
          <Search className="mr-2 h-4 w-4" />
          {t("templates.searchButton")}
        </Button>
      </Form>

      {templates.length > 0 ? (
        <div className="divide-y">
          {templates.map((template) => (
            <Link
              key={template.id}
              to={`/guides/templates/${template.id}`}
              prefetch="intent"
              className="flex items-center gap-3 py-3 px-1 hover:bg-muted/50 -mx-1 rounded transition-colors group"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-medium group-hover:text-primary transition-colors line-clamp-1">
                    {template.title}
                  </h3>
                  {/* ゲーム内言語（最重要メタ情報として目立たせる） */}
                  {template.gameLanguage && (
                    <span className="flex items-center gap-1.5 text-sm font-medium shrink-0">
                      <Languages className="h-4 w-4 text-primary" />
                      {getGameLanguageName(template.gameLanguage)}
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
                  <span>
                    {formatDistanceToNow(new Date(template.createdAt), {
                      addSuffix: true,
                      locale: ja,
                    })}
                  </span>
                </div>
              </div>
            </Link>
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
    </div>
  );
}
