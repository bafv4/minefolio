import { createTranslator } from "@/lib/messages";
import { localeFromMatches, resolveLocale } from "@/lib/locale";
import { useCallback, useEffect, useRef } from "react";
import { useLoaderData, useFetcher, useNavigate, Link } from "react-router";
import type { Route } from "./+types/template-edit";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users, searchCraftTemplates } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { SEARCH_CRAFT_USER_WITH, loadEditorSettingsFromUser } from "@/lib/search-craft-templates.server";
import {
  parseTemplateCrafts,
  parseTemplateRemaps,
  parseTemplateLoops,
  parseEditorSubmission,
  toEditorCrafts,
  toEditorLoops,
  toEditorRemaps,
  toSubmittableLoops,
} from "@/lib/search-craft-templates";
import { useT } from "@/hooks/use-locale";
import { toast } from "sonner";
import { TemplateEditorForm } from "@/components/template-editor";
import { Button } from "@/components/ui/button";
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
    with: SEARCH_CRAFT_USER_WITH,
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

  // 下書きの有無は draftUpdatedAt だけで判定する。NULL 可の列（説明・言語・リマップ・Loop）は
  // 下書きで「空にした」ことを表すので、?? で公開版へ落とさない（ガイドの edit.tsx と同じ）
  const hasDraft = template.draftUpdatedAt !== null;
  const src = hasDraft
    ? {
        title: template.draftTitle ?? template.title,
        description: template.draftDescription,
        gameLanguage: template.draftGameLanguage,
        craftsData: template.draftCraftsData ?? template.craftsData,
        remapsData: template.draftRemapsData,
        loopsData: template.draftLoopsData,
      }
    : template;

  const templateCrafts = toEditorCrafts(parseTemplateCrafts(src.craftsData));
  // loopsData（craftIndex 参照）を、上で振った crafts の draft id へ解決する
  const templateLoops = toEditorLoops(
    parseTemplateLoops(src.loopsData, templateCrafts.length),
    templateCrafts,
  );

  return {
    template: {
      id: template.id,
      title: src.title,
      description: src.description ?? "",
      gameLanguage: src.gameLanguage ?? "",
      crafts: templateCrafts,
      remaps: toEditorRemaps(parseTemplateRemaps(src.remapsData)),
      loops: templateLoops,
      isPublished: template.isPublished,
      hasDraft,
      draftUpdatedAt: template.draftUpdatedAt?.toISOString() ?? null,
    },
    currentSettings: loadEditorSettingsFromUser(user),
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
  // _action は allowlist で判定する（未知の値は拒否）
  const actionType = formData.get("_action");
  if (actionType !== "draft" && actionType !== "publish" && actionType !== "discard") {
    return { error: t("meTemplates.unknownAction") };
  }

  // 下書きを破棄する（公開版は変えない）
  if (actionType === "discard") {
    await db
      .update(searchCraftTemplates)
      .set({
        draftTitle: null,
        draftDescription: null,
        draftGameLanguage: null,
        draftCraftsData: null,
        draftRemapsData: null,
        draftLoopsData: null,
        draftUpdatedAt: null,
      })
      .where(eq(searchCraftTemplates.id, template.id));
    return { success: true, action: "discard" };
  }

  // 下書き・公開のどちらにも同じ検証（タイトル・件数・大きさの上限）を掛ける
  const submission = parseEditorSubmission(t, formData);
  if ("error" in submission) {
    return { error: submission.error };
  }

  const now = new Date();

  if (actionType === "draft") {
    // 下書き保存は、読者に見える公開版がある（公開中の）テンプレートだけ。公開版の列・isPublished・
    // updatedAt・publishedAt は変えない
    if (!template.isPublished) {
      return { error: t("meTemplates.draftNeedsPublished") };
    }
    await db
      .update(searchCraftTemplates)
      .set({
        draftTitle: submission.title,
        draftDescription: submission.description,
        draftGameLanguage: submission.gameLanguage,
        draftCraftsData: submission.craftsData,
        draftRemapsData: submission.remapsData,
        draftLoopsData: submission.loopsData,
        draftUpdatedAt: now,
      })
      .where(eq(searchCraftTemplates.id, template.id));
    return { success: true, action: "draft" };
  }

  // publish: フォームの値を公開版へ書き、下書きを消す。isPublished はフォームの公開スイッチの値
  // （未公開のままの保存もこの経路）。publishedAt は初めて公開したときにだけ入れる
  const isPublished = formData.get("isPublished") === "true";
  await db
    .update(searchCraftTemplates)
    .set({
      title: submission.title,
      description: submission.description,
      gameLanguage: submission.gameLanguage,
      craftsData: submission.craftsData,
      remapsData: submission.remapsData,
      loopsData: submission.loopsData,
      isPublished,
      publishedAt: template.publishedAt ?? (isPublished ? now : null),
      updatedAt: now,
      draftTitle: null,
      draftDescription: null,
      draftGameLanguage: null,
      draftCraftsData: null,
      draftRemapsData: null,
      draftLoopsData: null,
      draftUpdatedAt: null,
    })
    .where(eq(searchCraftTemplates.id, template.id));

  return { success: true, action: "publish" };
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
      toast.success(
        data.action === "draft"
          ? t("meTemplates.draftSaved")
          : data.action === "discard"
            ? t("meTemplates.revertSuccess")
            : t("meTemplates.updateSuccess"),
      );
    } else if ("error" in data && data.error) {
      toast.error(data.error);
    }
  }, [fetcher.data]);

  const handleSaved = useCallback(() => navigate("/my-guides/templates"), [navigate]);

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
        <h1 className="text-2xl font-bold">{t("meTemplates.editorEditTitle")}</h1>
        <p className="text-sm text-muted-foreground">{template.title}</p>
      </div>

      <TemplateEditorForm
        key={`${template.id}:${template.draftUpdatedAt ?? ""}`}
        initial={{
          title: template.title,
          description: template.description,
          gameLanguage: template.gameLanguage,
          crafts: template.crafts,
          remaps: template.remaps,
          loops: template.loops,
        }}
        initialPublished={template.isPublished}
        publishState={{
          livePublished: template.isPublished,
          hasDraft: template.hasDraft,
          isDiscarding: fetcher.state !== "idle" && fetcher.formData?.get("_action") === "discard",
          onDiscard: () => {
            const formData = new FormData();
            formData.set("_action", "discard");
            fetcher.submit(formData, { method: "post" });
          },
        }}
        currentSettings={currentSettings}
        keyboardLayout={keyboardLayout}
        isSubmitting={fetcher.state === "submitting"}
        saveResult={fetcher.data}
        // 破棄はフォームの保存ではない（中身は key の変更で入れ替わる）ので、保存成功として扱わない
        saveSucceeded={
          !!fetcher.data &&
          "success" in fetcher.data &&
          !!fetcher.data.success &&
          fetcher.data.action !== "discard"
        }
        onSaved={handleSaved}
        onSubmit={(data, mode, isPublished) => {
          const formData = new FormData();
          formData.set("_action", mode);
          formData.set("isPublished", String(isPublished));
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
