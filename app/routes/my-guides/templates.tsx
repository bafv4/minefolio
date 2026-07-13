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
import { t } from "@/lib/messages";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  Pencil,
  Eye,
  EyeOff,
  ExternalLink,
  LayoutTemplate,
  Search,
  Keyboard,
  Download,
  Languages,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ja } from "date-fns/locale";

export const meta: Route.MetaFunction = () => {
  return [{ title: t("meTemplates.title") }];
};

export async function loader({ request }: Route.LoaderArgs) {
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
      applyCount: template.applyCount,
      craftCount: parseTemplateCrafts(template.craftsData).length,
      hasRemaps: !!template.remapsData,
      createdAt: template.createdAt.toISOString(),
    })),
  };
}

export async function action({ request }: Route.ActionArgs) {
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
  const now = new Date();

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

  if (actionType === "toggle-publish") {
    await db
      .update(searchCraftTemplates)
      .set({ isPublished: !template.isPublished, updatedAt: now })
      .where(eq(searchCraftTemplates.id, template.id));

    return {
      success: true,
      action: "toggle-publish",
      published: !template.isPublished,
    };
  }

  if (actionType === "delete") {
    await db.delete(searchCraftTemplates).where(eq(searchCraftTemplates.id, template.id));
    return { success: true, action: "delete" };
  }

  return { error: t("meTemplates.unknownAction") };
}

export default function MyTemplatesPage() {
  const { templates } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const prevDataRef = useRef<typeof fetcher.data>(undefined);

  const isSubmitting = fetcher.state === "submitting";

  useEffect(() => {
    const data = fetcher.data;
    if (!data || data === prevDataRef.current) return;
    prevDataRef.current = data;

    if ("success" in data && data.success) {
      if (data.action === "toggle-publish") {
        toast.success(
          "published" in data && data.published
            ? t("meTemplates.publishSuccess")
            : t("meTemplates.unpublishSuccess"),
        );
      } else if (data.action === "delete") {
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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t("meTemplates.pageTitle")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("meTemplates.pageDescription")}
          </p>
        </div>
        <Button asChild className="w-full sm:w-auto h-11 sm:h-10">
          <Link to="/my-guides/templates/new">
            <Plus className="mr-2 h-4 w-4" />
            {t("meTemplates.create")}
          </Link>
        </Button>
      </div>

      <MyContentTabs active="templates" />

      <div className="rounded-lg border border-dashed bg-secondary/30 p-4 text-sm text-muted-foreground">
        {t("meTemplates.hint")}{" "}
        <Link to="/guides/templates" className="text-primary hover:underline inline-flex items-center gap-1">
          {t("meTemplates.viewGallery")}
          <ExternalLink className="h-3 w-3" />
        </Link>
      </div>

      {templates.length > 0 ? (
        <div className="space-y-3">
          {templates.map((template) => (
            <Card key={template.id}>
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
                      {template.isPublished ? (
                        <Badge variant="secondary" className="text-xs">
                          <Eye className="h-3 w-3 mr-1" />
                          {t("meTemplates.published")}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs text-muted-foreground">
                          <EyeOff className="h-3 w-3 mr-1" />
                          {t("meTemplates.unpublished")}
                        </Badge>
                      )}
                    </div>
                    {template.description && (
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {template.description}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Search className="h-3 w-3" />
                        {t("meTemplates.craftCount", { count: template.craftCount })}
                      </span>
                      {template.gameLanguage && (
                        <span className="inline-flex items-center gap-1">
                          <Languages className="h-3 w-3" />
                          {getGameLanguageName(template.gameLanguage)}
                        </span>
                      )}
                      {template.hasRemaps && (
                        <span className="inline-flex items-center gap-1">
                          <Keyboard className="h-3 w-3" />
                          {t("meTemplates.includesRemaps")}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1">
                        <Download className="h-3 w-3" />
                        {t("meTemplates.applyCount", { count: template.applyCount })}
                      </span>
                      <span>
                        {formatDistanceToNow(new Date(template.createdAt), {
                          addSuffix: true,
                          locale: ja,
                        })}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2"
                      disabled={isSubmitting}
                      onClick={() =>
                        submitAction({ _action: "toggle-publish", templateId: template.id })
                      }
                    >
                      {template.isPublished ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                      <span className="ml-1 hidden sm:inline">
                        {template.isPublished
                          ? t("meTemplates.unpublish")
                          : t("meTemplates.publish")}
                      </span>
                    </Button>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0" asChild>
                      <Link to={`/my-guides/templates/${template.id}/edit`}>
                        <Pencil className="h-4 w-4" />
                      </Link>
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                          <Trash2 className="h-4 w-4 text-destructive" />
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
                          <AlertDialogAction
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
        <Card>
          <CardContent className="text-center py-12">
            <LayoutTemplate className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
            <p className="text-lg font-medium">{t("meTemplates.emptyTitle")}</p>
            <p className="text-sm text-muted-foreground mb-4">
              {t("meTemplates.emptyDescription")}
            </p>
            <Button asChild>
              <Link to="/my-guides/templates/new">
                <Plus className="mr-2 h-4 w-4" />
                {t("meTemplates.create")}
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
