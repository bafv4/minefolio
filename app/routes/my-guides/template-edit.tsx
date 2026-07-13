import { useEffect, useRef } from "react";
import { useLoaderData, useFetcher, useNavigate, Link } from "react-router";
import type { Route } from "./+types/template-edit";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users, searchCrafts, searchCraftTemplates } from "@/lib/schema";
import { eq, and, asc } from "drizzle-orm";
import { serializeSearchCrafts, serializeRemaps } from "@/lib/preset-utils";
import {
  parseTemplateCrafts,
  parseTemplateRemaps,
  parseEditorSubmission,
  toEditorCrafts,
  toEditorRemaps,
} from "@/lib/search-craft-templates";
import { t } from "@/lib/messages";
import { toast } from "sonner";
import { TemplateEditorForm } from "@/components/template-editor";
import { ArrowLeft } from "lucide-react";

export const meta: Route.MetaFunction = () => {
  return [{ title: t("meTemplates.editorEditTitle") + " - Minefolio" }];
};

export async function loader({ context, request, params }: Route.LoaderArgs) {
  const env = getEnv();
  const db = createDb();
  const auth = createAuth(db, env);

  const session = await getSession(request, auth);

  const user = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
    with: {
      searchCrafts: { orderBy: [asc(searchCrafts.sequence)] },
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

  return {
    template: {
      id: template.id,
      title: template.title,
      description: template.description ?? "",
      gameLanguage: template.gameLanguage ?? "",
      crafts: toEditorCrafts(parseTemplateCrafts(template.craftsData)),
      remaps: toEditorRemaps(parseTemplateRemaps(template.remapsData)),
    },
    currentSettings: {
      crafts: toEditorCrafts(parseTemplateCrafts(serializeSearchCrafts(user.searchCrafts))),
      remaps: toEditorRemaps(parseTemplateRemaps(serializeRemaps(user.keyRemaps))),
    },
    keyboardLayout: user.playerConfig?.keyboardLayout ?? null,
  };
}

export async function action({ context, request, params }: Route.ActionArgs) {
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
  const submission = parseEditorSubmission(formData);
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
      updatedAt: new Date(),
    })
    .where(eq(searchCraftTemplates.id, template.id));

  return { success: true };
}

export default function TemplateEditPage() {
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
          fetcher.submit(formData, { method: "post" });
        }}
      />
    </div>
  );
}
