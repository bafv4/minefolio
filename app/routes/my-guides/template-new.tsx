import { createTranslator } from "@/lib/messages";
import { localeFromMatches, resolveLocale } from "@/lib/locale";
import { useCallback, useEffect, useRef } from "react";
import { useLoaderData, useFetcher, useNavigate, Link } from "react-router";
import type { Route } from "./+types/template-new";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users, searchCraftTemplates } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { SEARCH_CRAFT_USER_WITH, loadEditorSettingsFromUser } from "@/lib/search-craft-templates.server";
import {
  parseEditorSubmission,
  toSubmittableLoops,
  MAX_TEMPLATES_PER_USER,
} from "@/lib/search-craft-templates";
import { useT } from "@/hooks/use-locale";
import { toast } from "sonner";
import { TemplateEditorForm } from "@/components/template-editor";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export const meta: Route.MetaFunction = ({ matches }) => {
  const t = createTranslator(localeFromMatches(matches));
  return [{ title: t("meTemplates.editorNewTitle") + " - Minefolio" }];
};

export async function loader({ request }: Route.LoaderArgs) {
  const t = createTranslator(resolveLocale(request));
  const env = getEnv();
  const db = createDb();
  const auth = createAuth(db, env);

  const session = await getSession(request, auth);

  const user = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
    with: SEARCH_CRAFT_USER_WITH,
  });

  if (!user) {
    throw new Response(t("meTemplates.userNotFound"), { status: 404 });
  }

  return {
    currentSettings: loadEditorSettingsFromUser(user),
    defaultGameLanguage: user.playerConfig?.gameLanguage ?? "",
    keyboardLayout: user.playerConfig?.keyboardLayout ?? null,
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
  const submission = parseEditorSubmission(t, formData);
  if ("error" in submission) {
    return { error: submission.error };
  }

  const existing = await db.query.searchCraftTemplates.findMany({
    where: eq(searchCraftTemplates.userId, user.id),
    columns: { id: true },
  });
  if (existing.length >= MAX_TEMPLATES_PER_USER) {
    return { error: t("meTemplates.templateLimitReached", { max: MAX_TEMPLATES_PER_USER }) };
  }

  const now = new Date();
  // 作成すると非公開（公開は編集画面の保存で行う。ガイドの新規作成と同じ）
  const [created] = await db.insert(searchCraftTemplates).values({
    userId: user.id,
    title: submission.title,
    description: submission.description,
    gameLanguage: submission.gameLanguage,
    craftsData: submission.craftsData,
    remapsData: submission.remapsData,
    loopsData: submission.loopsData,
    isPublished: false,
    publishedAt: null,
    createdAt: now,
    updatedAt: now,
  }).returning({ id: searchCraftTemplates.id });

  return { success: true, templateId: created.id };
}

export default function TemplateNewPage() {
  const t = useT();
  const { currentSettings, defaultGameLanguage, keyboardLayout } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const navigate = useNavigate();
  const prevDataRef = useRef<typeof fetcher.data>(undefined);

  useEffect(() => {
    const data = fetcher.data;
    if (!data || data === prevDataRef.current) return;
    prevDataRef.current = data;

    if ("success" in data && data.success) {
      toast.success(t("meTemplates.createSuccess"));
    } else if ("error" in data && data.error) {
      toast.error(data.error);
    }
  }, [fetcher.data]);

  // 作成後は編集画面へ（ガイドの新規作成と同じ。公開はそこで行う）
  const createdId = fetcher.data && "templateId" in fetcher.data ? fetcher.data.templateId : null;
  const handleSaved = useCallback(
    () => navigate(createdId ? `/my-guides/templates/${createdId}/edit` : "/my-guides/templates"),
    [navigate, createdId],
  );

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2 h-11 sm:h-8">
          <Link to="/my-guides/templates">
            <ArrowLeft className="h-4 w-4 mr-1" />
            {t("meTemplates.backToManagement")}
          </Link>
        </Button>
      </div>
      <div>
        <h1 className="text-2xl font-bold">{t("meTemplates.editorNewTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("meTemplates.editorNewDescription")}</p>
      </div>

      <TemplateEditorForm
        initial={{
          title: "",
          description: "",
          gameLanguage: defaultGameLanguage,
          crafts: [],
          remaps: [],
          loops: [],
        }}
        currentSettings={currentSettings}
        keyboardLayout={keyboardLayout}
        isSubmitting={fetcher.state === "submitting"}
        saveResult={fetcher.data}
        saveSucceeded={!!fetcher.data && "success" in fetcher.data && !!fetcher.data.success}
        onSaved={handleSaved}
        submitLabel={t("meTemplates.createSubmit")}
        onSubmit={(data) => {
          const formData = new FormData();
          formData.set("title", data.title);
          formData.set("description", data.description);
          formData.set("gameLanguage", data.gameLanguage);
          formData.set("crafts", JSON.stringify(data.crafts));
          formData.set("remaps", JSON.stringify(data.remaps));
          formData.set("loops", JSON.stringify(toSubmittableLoops(data.crafts, data.loops)));
          fetcher.submit(formData, { method: "post" });
        }}
      />
    </div>
  );
}
