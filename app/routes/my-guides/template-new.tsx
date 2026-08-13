import { createTranslator } from "@/lib/messages";
import { localeFromMatches, resolveLocale } from "@/lib/locale";
import { useEffect, useRef } from "react";
import { useLoaderData, useFetcher, useNavigate, Link } from "react-router";
import type { Route } from "./+types/template-new";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users, searchCrafts, searchCraftLoops, searchCraftTemplates } from "@/lib/schema";
import { eq, asc } from "drizzle-orm";
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
    with: {
      searchCrafts: { orderBy: [asc(searchCrafts.sequence)] },
      searchCraftLoops: { orderBy: [asc(searchCraftLoops.sequence)] },
      keyRemaps: true,
      playerConfig: { columns: { gameLanguage: true, keyboardLayout: true } },
    },
  });

  if (!user) {
    throw new Response(t("meTemplates.userNotFound"), { status: 404 });
  }

  const currentCrafts = toEditorCrafts(parseTemplateCrafts(serializeSearchCrafts(user.searchCrafts)));
  // ライブの Loop（craftId 参照）を、いったんプリセットと同一の craftSeq 形式に変換してから
  // craftIndex 形式へデコードし、現在の crafts の draft id へ解決する
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
    currentSettings: {
      crafts: currentCrafts,
      // テンプレートは chat 用途のため、trigger 専用リマップはプレフィルに含めない
      remaps: toEditorRemaps(filterRemapsForChat(parseTemplateRemaps(serializeRemaps(user.keyRemaps)))),
      loops: currentLoops,
    },
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
  await db.insert(searchCraftTemplates).values({
    userId: user.id,
    title: submission.title,
    description: submission.description,
    gameLanguage: submission.gameLanguage,
    craftsData: submission.craftsData,
    remapsData: submission.remapsData,
    loopsData: submission.loopsData,
    isPublished: true,
    createdAt: now,
    updatedAt: now,
  });

  return { success: true };
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
      navigate("/my-guides/templates");
    } else if ("error" in data && data.error) {
      toast.error(data.error);
    }
  }, [fetcher.data, navigate]);

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2">
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
