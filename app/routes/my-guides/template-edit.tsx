import { createTranslator } from "@/lib/messages";
import { localeFromMatches, resolveLocale } from "@/lib/locale";
import { useEffect, useRef } from "react";
import { useLoaderData, useFetcher, useNavigate, Link } from "react-router";
import type { Route } from "./+types/template-edit";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users, searchCrafts, searchCraftLoops, searchCraftTemplates } from "@/lib/schema";
import { eq, and, asc } from "drizzle-orm";
import { serializeSearchCrafts, serializeRemaps, serializeSearchCraftLoops } from "@/lib/preset-utils";
import { filterRemapsForChat } from "@/lib/remap-utils";
import {
  parseTemplateCrafts,
  parseTemplateRemaps,
  parseTemplateLoops,
  parseEditorSubmission,
  toEditorCrafts,
  toEditorRemaps,
  toSubmittableLoops,
  draftId,
} from "@/lib/search-craft-templates";
import { useT } from "@/hooks/use-locale";
import { toast } from "sonner";
import { TemplateEditorForm } from "@/components/template-editor";
import { ArrowLeft } from "lucide-react";

export const meta: Route.MetaFunction = ({ matches }) => {
  const t = createTranslator(localeFromMatches(matches));
  return [{ title: t("meTemplates.editorEditTitle") + " - Minefolio" }];
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const t = createTranslator(resolveLocale(request));
  const env = getEnv();
  const db = createDb();
  const auth = createAuth(db, env);

  const session = await getSession(request, auth);

  const user = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
    with: {
      searchCrafts: { orderBy: [asc(searchCrafts.sequence)] },
      searchCraftLoops: { orderBy: [asc(searchCraftLoops.sequence)] },
      keyRemaps: true,
      playerConfig: { columns: { keyboardLayout: true } },
    },
  });

  if (!user) {
    throw new Response(t("meTemplates.userNotFound"), { status: 404 });
  }

  const template = await db.query.searchCraftTemplates.findFirst({
    where: and(
      eq(searchCraftTemplates.id, params.templateId),
      eq(searchCraftTemplates.userId, user.id),
    ),
  });

  if (!template) {
    throw new Response(t("meTemplates.templateNotFound"), { status: 404 });
  }

  const templateCrafts = toEditorCrafts(parseTemplateCrafts(template.craftsData));
  // loopsData（craftIndex 参照）を、上で振った crafts の draft id へ解決する
  const templateLoops = parseTemplateLoops(template.loopsData, templateCrafts.length).map((loop) => ({
    id: draftId("loop"),
    steps: loop.steps.map((s) => ({
      craftId: templateCrafts[s.craftIndex].id,
      transition: s.transition,
    })),
    comment: loop.comment,
    timing: loop.timing,
  }));

  const currentCrafts = toEditorCrafts(parseTemplateCrafts(serializeSearchCrafts(user.searchCrafts)));
  const currentLoops = parseTemplateLoops(
    serializeSearchCraftLoops(user.searchCraftLoops, user.searchCrafts),
    currentCrafts.length,
  ).map((loop) => ({
    id: draftId("loop"),
    steps: loop.steps.map((s) => ({
      craftId: currentCrafts[s.craftIndex].id,
      transition: s.transition,
    })),
    comment: loop.comment,
    timing: loop.timing,
  }));

  return {
    template: {
      id: template.id,
      title: template.title,
      description: template.description ?? "",
      gameLanguage: template.gameLanguage ?? "",
      crafts: templateCrafts,
      remaps: toEditorRemaps(parseTemplateRemaps(template.remapsData)),
      loops: templateLoops,
    },
    currentSettings: {
      crafts: currentCrafts,
      // テンプレートは chat 用途のため、trigger 専用リマップはプレフィルに含めない
      remaps: toEditorRemaps(filterRemapsForChat(parseTemplateRemaps(serializeRemaps(user.keyRemaps)))),
      loops: currentLoops,
    },
    keyboardLayout: user.playerConfig?.keyboardLayout ?? null,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
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

  const template = await db.query.searchCraftTemplates.findFirst({
    where: and(
      eq(searchCraftTemplates.id, params.templateId),
      eq(searchCraftTemplates.userId, user.id),
    ),
  });
  if (!template) {
    return { error: t("meTemplates.templateNotFound") };
  }

  const formData = await request.formData();
  const submission = parseEditorSubmission(t, formData);
  if ("error" in submission) {
    return { error: submission.error };
  }

  await db
    .update(searchCraftTemplates)
    .set({
      title: submission.title,
      description: submission.description,
      gameLanguage: submission.gameLanguage,
      craftsData: submission.craftsData,
      remapsData: submission.remapsData,
      loopsData: submission.loopsData,
      updatedAt: new Date(),
    })
    .where(eq(searchCraftTemplates.id, template.id));

  return { success: true };
}

export default function TemplateEditPage() {
  const t = useT();
  const { template, currentSettings, keyboardLayout } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const navigate = useNavigate();
  const prevDataRef = useRef<typeof fetcher.data>(undefined);

  useEffect(() => {
    const data = fetcher.data;
    if (!data || data === prevDataRef.current) return;
    prevDataRef.current = data;

    if ("success" in data && data.success) {
      toast.success(t("meTemplates.updateSuccess"));
      navigate("/my-guides/templates");
    } else if ("error" in data && data.error) {
      toast.error(data.error);
    }
  }, [fetcher.data, navigate]);

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/my-guides/templates"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("meTemplates.backToManagement")}
        </Link>
      </div>
      <div>
        <h1 className="text-2xl font-bold">{t("meTemplates.editorEditTitle")}</h1>
        <p className="text-sm text-muted-foreground">{template.title}</p>
      </div>

      <TemplateEditorForm
        key={template.id}
        initial={{
          title: template.title,
          description: template.description,
          gameLanguage: template.gameLanguage,
          crafts: template.crafts,
          remaps: template.remaps,
          loops: template.loops,
        }}
        currentSettings={currentSettings}
        keyboardLayout={keyboardLayout}
        isSubmitting={fetcher.state === "submitting"}
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
