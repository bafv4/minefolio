import { useEffect, useRef } from "react";
import { useLoaderData, useFetcher, useNavigate, Link } from "react-router";
import type { Route } from "./+types/template-new";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users, searchCrafts, searchCraftTemplates } from "@/lib/schema";
import { eq, asc } from "drizzle-orm";
import { serializeSearchCrafts, serializeRemaps } from "@/lib/preset-utils";
import {
  parseTemplateCrafts,
  parseTemplateRemaps,
  parseEditorSubmission,
  toEditorCrafts,
  toEditorRemaps,
  MAX_TEMPLATES_PER_USER,
} from "@/lib/search-craft-templates";
import { t } from "@/lib/messages";
import { toast } from "sonner";
import { TemplateEditorForm } from "@/components/template-editor";
import { ArrowLeft } from "lucide-react";

export const meta: Route.MetaFunction = () => {
  return [{ title: t("meTemplates.editorNewTitle") + " - Minefolio" }];
};

export async function loader({ context, request }: Route.LoaderArgs) {
  const env = context.env ?? getEnv();
  const db = createDb();
  const auth = createAuth(db, env);

  const session = await getSession(request, auth);

  const user = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
    with: {
      searchCrafts: { orderBy: [asc(searchCrafts.sequence)] },
      keyRemaps: true,
      playerConfig: { columns: { gameLanguage: true, keyboardLayout: true } },
    },
  });

  if (!user) {
    throw new Response(t("meTemplates.userNotFound"), { status: 404 });
  }

  return {
    currentSettings: {
      crafts: toEditorCrafts(parseTemplateCrafts(serializeSearchCrafts(user.searchCrafts))),
      remaps: toEditorRemaps(parseTemplateRemaps(serializeRemaps(user.keyRemaps))),
    },
    defaultGameLanguage: user.playerConfig?.gameLanguage ?? "",
    keyboardLayout: user.playerConfig?.keyboardLayout ?? null,
  };
}

export async function action({ context, request }: Route.ActionArgs) {
  const env = context.env ?? getEnv();
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
  const submission = parseEditorSubmission(formData);
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
  await db.insert(searchCraftTemplates).values({
    userId: user.id,
    title: submission.title,
    description: submission.description,
    gameLanguage: submission.gameLanguage,
    craftsData: submission.craftsData,
    remapsData: submission.remapsData,
    isPublished: true,
    createdAt: now,
    updatedAt: now,
  });

  return { success: true };
}

export default function TemplateNewPage() {
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
