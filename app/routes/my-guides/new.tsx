import { createTranslator } from "@/lib/messages";
import { localeFromMatches, resolveLocale } from "@/lib/locale";
import { useState } from "react";
import {
  redirect,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
  Form,
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from "react-router";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users, guides } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import {
  normalizeSlug,
  softNormalizeSlug,
  MAX_GUIDE_SLUG_LENGTH,
} from "@/lib/guide-slug";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UnsavedChangesDialog } from "@/components/unsaved-changes-dialog";
import { ArrowLeft } from "lucide-react";
import { useT } from "@/hooks/use-locale";
import { useUnsavedWarning } from "@/hooks/use-unsaved-warning";

export const meta = ({ matches }: { matches: ReadonlyArray<{ id: string; loaderData?: unknown }> }) => {
  const t = createTranslator(localeFromMatches(matches));
  return [{ title: `${t("meGuides.newTitle")} - Minefolio` }];
};

export async function loader({ request }: LoaderFunctionArgs) {
  const env = getEnv();
  const db = createDb();
  const auth = createAuth(db, env);
  const session = await getSession(request, auth);

  // 公開URLのプレビュー（/guides/<著者>/<スラッグ>）に著者スラッグが要る
  const user = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
    columns: { slug: true },
  });
  if (!user) return redirect("/onboarding");

  return { authorSlug: user.slug };
}

export async function action({ request }: ActionFunctionArgs) {
  const t = createTranslator(resolveLocale(request));
  const env = getEnv();
  const db = createDb();
  const auth = createAuth(db, env);
  const session = await getSession(request, auth);

  const user = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
  });
  if (!user) return redirect("/onboarding");

  const formData = await request.formData();
  const title = (formData.get("title") as string)?.trim();

  if (!title) {
    return { error: t("meGuides.errorTitleRequired"), field: "title" as const };
  }
  if (title.length > 200) {
    return { error: t("meGuides.errorTitleTooLong"), field: "title" as const };
  }

  // スラッグは作成時の必須入力。自動生成にすると日本語タイトルでは空になり、
  // `guide-<ランダム6文字>` のような意味のないURLで公開されてしまうため、ここで必ず受け取る。
  const slug = normalizeSlug((formData.get("slug") as string) ?? "");
  if (!slug) {
    return { error: t("meGuides.errorSlugRequired"), field: "slug" as const };
  }

  // Count check
  const userGuides = await db.query.guides.findMany({
    where: eq(guides.authorId, user.id),
    columns: { id: true },
  });
  if (userGuides.length >= 100) {
    return { error: t("meGuides.errorLimitReached") };
  }

  // 同一著者内でスラッグは一意。重複は自動で連番/乱数を付けず、入力し直してもらう
  const existing = await db.query.guides.findFirst({
    where: and(eq(guides.authorId, user.id), eq(guides.slug, slug)),
    columns: { id: true },
  });
  if (existing) {
    return { error: t("meGuides.errorSlugTaken"), field: "slug" as const };
  }

  const [newGuide] = await db
    .insert(guides)
    .values({
      authorId: user.id,
      slug,
      title,
      // 本文は空の段落で始める（タイトルはガイド設定と公開ページの h1 が持つ。本文に繰り返すと公開ページで重なる）
      content: "<p></p>",
      isPublished: false,
      tags: "[]",
      viewCount: 0,
    })
    .returning();

  return redirect(`/my-guides/${newGuide.slug}/edit`);
}

export default function NewGuidePage() {
  const t = useT();
  const { authorSlug } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  // 入力があれば離脱確認を出す（floating-save-bar と同じく送信中は外す。作成に成功すると action が
  // 編集ページへリダイレクトするので、その遷移を止めない）。失敗して戻ってきたら入力が残るので再び確認を出す
  const navigation = useNavigation();
  const isSubmitting = navigation.state !== "idle" && navigation.formMethod != null;
  const blocker = useUnsavedWarning((title.trim() !== "" || slug.trim() !== "") && !isSubmitting);

  // 入力中はゆるい正規化にとどめ、確定形（保存される値）だけをプレビューに出す
  const resolvedSlug = normalizeSlug(slug);

  // 失敗はどの欄の問題かを action が返す（URL の重複など）。その欄へ aria-invalid と説明（role=alert）を結ぶ。
  // 欄を特定できない失敗（上限など）は、メッセージだけを欄の外に出す
  const errorMessage = actionData && "error" in actionData ? actionData.error : null;
  const errorField = actionData && "field" in actionData ? actionData.field : null;

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2 h-11 sm:h-8">
          <Link to="/my-guides">
            <ArrowLeft className="h-4 w-4 mr-1" />
            {t("meGuides.backToManagement")}
          </Link>
        </Button>
      </div>
      <div>
        <h1 className="text-2xl font-bold">{t("meGuides.newTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("meGuides.newDesc")}</p>
      </div>

      <Form method="post" className="max-w-lg space-y-4">
        <div className="space-y-2">
          <Label htmlFor="title">{t("meGuides.titleLabel")}</Label>
          <Input
            id="title"
            name="title"
            placeholder={t("meGuides.titlePlaceholder")}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            autoFocus
            maxLength={200}
            aria-invalid={errorField === "title" || undefined}
            aria-describedby={errorField === "title" ? "new-guide-error" : undefined}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="slug">{t("meGuides.slugLabel")}</Label>
          <Input
            id="slug"
            name="slug"
            value={slug}
            onChange={(e) => setSlug(softNormalizeSlug(e.target.value))}
            placeholder={t("guideEditor.slugPlaceholder")}
            required
            maxLength={MAX_GUIDE_SLUG_LENGTH}
            aria-invalid={errorField === "slug" || undefined}
            aria-describedby={
              errorField === "slug"
                ? "new-guide-slug-preview new-guide-slug-hint new-guide-error"
                : "new-guide-slug-preview new-guide-slug-hint"
            }
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
          <p id="new-guide-slug-preview" className="text-xs text-muted-foreground break-all">
            /guides/{authorSlug}/
            <span className="text-foreground font-medium">
              {resolvedSlug || t("meGuides.slugEmptyPreview")}
            </span>
          </p>
          <p id="new-guide-slug-hint" className="text-xs text-muted-foreground">
            {t("meGuides.slugHint")}
          </p>
        </div>
        {errorMessage && (
          <p id="new-guide-error" role="alert" className="text-sm text-destructive">
            {errorMessage}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? t("meGuides.creating") : t("meGuides.createAndEdit")}
        </Button>
      </Form>
      <UnsavedChangesDialog blocker={blocker} />
    </div>
  );
}
