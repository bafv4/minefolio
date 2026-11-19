import { createTranslator } from "@/lib/messages";
import { localeFromMatches, resolveLocale } from "@/lib/locale";
import { useEffect, useRef } from "react";
import { useLoaderData, useFetcher, Link } from "react-router";
import type { Route } from "./+types/templates";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users, searchCraftTemplates } from "@/lib/schema";
import { eq, desc, and } from "drizzle-orm";
import { parseTemplateCrafts } from "@/lib/search-craft-templates";
import { getGameLanguageName } from "@/lib/game-languages";
import { useT, useLocale } from "@/hooks/use-locale";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StatusPill } from "@/components/status-pill";
import { EmptyState } from "@/components/empty-state";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { MyContentTabs } from "@/components/content-tabs";
import { TabContentSkeleton } from "@/components/tab-content-skeleton";
import { useTabNavigation } from "@/hooks/use-tab-navigation";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  Pencil,
  PencilLine,
  Globe,
  Lock,
  LayoutTemplate,
  Search,
  Keyboard,
  Download,
  Languages,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { dateFnsLocale } from "@/lib/date-locale";

export const meta: Route.MetaFunction = ({ matches }) => {
  const t = createTranslator(localeFromMatches(matches));
  return [{ title: t("meTemplates.title") }];
};

export async function loader({ request }: Route.LoaderArgs) {
  const t = createTranslator(resolveLocale(request));
  const env = getEnv();
  const db = createDb();
  const auth = createAuth(db, env);

  const session = await getSession(request, auth);

  const user = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
  });

  if (!user) {
    throw new Response(t("meTemplates.userNotFound"), { status: 404 });
  }

  const templates = await db.query.searchCraftTemplates.findMany({
    where: eq(searchCraftTemplates.userId, user.id),
    orderBy: [desc(searchCraftTemplates.createdAt)],
  });

  return {
    templates: templates.map((template) => ({
      id: template.id,
      title: template.title,
      description: template.description,
      gameLanguage: template.gameLanguage,
      isPublished: template.isPublished,
      // 下書き本体は返さない（有無だけ）
      hasDraft: template.draftUpdatedAt !== null,
      applyCount: template.applyCount,
      craftCount: parseTemplateCrafts(template.craftsData).length,
      hasRemaps: !!template.remapsData,
      createdAt: template.createdAt.toISOString(),
    })),
  };
}

export async function action({ request }: Route.ActionArgs) {
  const t = createTranslator(resolveLocale(request));
  const env = getEnv();
  const db = createDb();
  const auth = createAuth(db, env);

  const session = await getSession(request, auth);

  const user = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
  });

  if (!user) {
    return { error: t("meTemplates.userNotFound") };
  }

  const formData = await request.formData();
  const actionType = formData.get("_action") as string;

  // 対象テンプレートの所有権を検証する
  const templateId = formData.get("templateId") as string | null;
  if (!templateId) {
    return { error: t("meTemplates.templateNotFound") };
  }
  const template = await db.query.searchCraftTemplates.findFirst({
    where: and(
      eq(searchCraftTemplates.id, templateId),
      eq(searchCraftTemplates.userId, user.id),
    ),
  });
  if (!template) {
    return { error: t("meTemplates.templateNotFound") };
  }

  if (actionType === "delete") {
    await db.delete(searchCraftTemplates).where(eq(searchCraftTemplates.id, template.id));
    return { success: true, action: "delete" };
  }

  return { error: t("meTemplates.unknownAction") };
}

export default function MyTemplatesPage() {
  const t = useT();
  const locale = useLocale();
  const { templates } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const prevDataRef = useRef<typeof fetcher.data>(undefined);
  // タブ切替（→ /my-guides）中は一覧をスケルトンに差し替える
  const { isTabSwitching } = useTabNavigation();

  useEffect(() => {
    const data = fetcher.data;
    if (!data || data === prevDataRef.current) return;
    prevDataRef.current = data;

    if ("success" in data && data.success) {
      if (data.action === "delete") {
        toast.success(t("meTemplates.deleteSuccess"));
      }
    } else if ("error" in data && data.error) {
      toast.error(data.error);
    }
  }, [fetcher.data]);

  const submitAction = (fields: Record<string, string>) => {
    const formData = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      formData.set(key, value);
    }
    fetcher.submit(formData, { method: "post" });
  };

  return (
    <div className="space-y-6">
      <MyContentTabs active="templates" />

      {/* タブ切替中はタイトル含むコンテンツ全体をスケルトンに（タイトルはタブ内側にあるため、
          先行切替済みのタブと旧ページのタイトルが食い違って見えないようにする） */}
      {isTabSwitching ? (
        <TabContentSkeleton variant="list" />
      ) : (
      <>
      {/* タイトル・説明・作成ボタンはタブの内側（コンテンツ側）に置く */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t("meTemplates.pageTitle")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("meTemplates.pageDescription")}
          </p>
        </div>
        {/* 0 件のときは空状態の action に同じボタンがあるので出さない */}
        {templates.length > 0 && (
          <Button asChild className="h-11 w-full shrink-0 sm:h-9 sm:w-auto">
            <Link to="/my-guides/templates/new">
              <Plus className="mr-2 h-4 w-4" />
              {t("meTemplates.create")}
            </Link>
          </Button>
        )}
      </div>

      <p className="text-sm text-muted-foreground">
        {t("meTemplates.hint")}{" "}
        {/* 同じタブで開く内部リンクなので、外部リンクのアイコンは付けない */}
        <Link to="/guides/templates" className="text-primary hover:underline">
          {t("meTemplates.viewGallery")}
        </Link>
      </p>

      {templates.length > 0 ? (
        <div className="space-y-3">
          {templates.map((template) => (
            <Card key={template.id} className="py-0">
              <CardContent className="p-4">
                <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        to={`/guides/templates/${template.id}`}
                        className="font-medium hover:underline truncate"
                      >
                        {template.title}
                      </Link>
                      <StatusPill icon={template.isPublished ? Globe : Lock} className="shrink-0">
                        {template.isPublished ? t("meTemplates.published") : t("meTemplates.unpublished")}
                      </StatusPill>
                      {/* 公開中のテンプレートに下書き保存した未公開の変更があるときだけ（ガイド一覧と同じ見た目・文言） */}
                      {template.isPublished && template.hasDraft && (
                        <StatusPill icon={PencilLine} tone="warning" className="shrink-0">
                          {t("meGuides.statusUnpublishedChanges")}
                        </StatusPill>
                      )}
                    </div>
                    {template.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {template.description}
                      </p>
                    )}
                    {/* 非公開のテンプレートは、編集画面の保存（公開スイッチ）で公開できることを示す */}
                    {!template.isPublished && (
                      <p className="text-xs text-muted-foreground">
                        {t("meTemplates.unpublishedHint")}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Search className="h-3 w-3" aria-hidden />
                        {t("meTemplates.craftCount", { count: template.craftCount })}
                      </span>
                      {template.gameLanguage && (
                        <span className="inline-flex items-center gap-1">
                          <Languages className="h-3 w-3" aria-hidden />
                          {getGameLanguageName(t, locale, template.gameLanguage)}
                        </span>
                      )}
                      {template.hasRemaps && (
                        <span className="inline-flex items-center gap-1">
                          <Keyboard className="h-3 w-3" aria-hidden />
                          {t("meTemplates.includesRemaps")}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1">
                        <Download className="h-3 w-3" aria-hidden />
                        {t("meTemplates.applyCount", { count: template.applyCount })}
                      </span>
                      {/* 相対時刻はSSR時とhydration時で基準時刻がずれるため警告を抑制 */}
                      <span suppressHydrationWarning>
                        {formatDistanceToNow(new Date(template.createdAt), {
                          addSuffix: true,
                          locale: dateFnsLocale(locale),
                        })}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Button variant="ghost" size="sm" asChild>
                      <Link
                        to={`/my-guides/templates/${template.id}/edit`}
                        aria-label={t("guideEditor.edit")}
                        title={t("guideEditor.edit")}
                      >
                        <Pencil className="h-4 w-4" aria-hidden />
                      </Link>
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={t("meTemplates.delete")}
                          title={t("meTemplates.delete")}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" aria-hidden />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            {t("meTemplates.deleteTitle")}
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            {t("meTemplates.deleteDescription", { name: template.title })}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{t("meTemplates.cancel")}</AlertDialogCancel>
                          {/* 取り消せない削除の確定はガイドの削除と同じ destructive */}
                          <AlertDialogAction
                            className={buttonVariants({ variant: "destructive" })}
                            onClick={() =>
                              submitAction({ _action: "delete", templateId: template.id })
                            }
                          >
                            {t("meTemplates.delete")}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<LayoutTemplate className="h-12 w-12" />}
          title={t("meTemplates.emptyTitle")}
          description={t("meTemplates.emptyDescription")}
          action={
            <Button asChild size="sm" className="min-h-11 sm:min-h-9">
              <Link to="/my-guides/templates/new">
                <Plus className="mr-2 h-4 w-4" />
                {t("meTemplates.create")}
              </Link>
            </Button>
          }
        />
      )}
      </>
      )}
    </div>
  );
}
