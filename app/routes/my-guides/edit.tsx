import {
  useLoaderData,
  redirect,
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from "react-router";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users, guides } from "@/lib/schema";
import { eq, and } from "drizzle-orm";
import { GuideEditor } from "@/components/guide-editor";
import { normalizeSlug } from "@/lib/guide-slug";
import { createTranslator } from "@/lib/messages";
import { localeFromMatches, resolveLocale } from "@/lib/locale";

// 公開ガイド本文の最大文字数（多層防御。下書きには適用しない）
const MAX_PUBLISHED_CONTENT_LENGTH = 500_000;

export function meta({
  loaderData,
  matches,
}: {
  loaderData: { guide: { title: string } } | undefined;
  matches: ReadonlyArray<{ id: string; loaderData?: unknown }>;
}) {
  const t = createTranslator(localeFromMatches(matches));
  if (!loaderData?.guide) return [{ title: t("meGuides.editTitle") }];
  return [{ title: `${loaderData.guide.title} - ${t("guideEditor.edit")} | Minefolio` }];
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const t = createTranslator(resolveLocale(request));
  const env = getEnv();
  const db = createDb();
  const auth = createAuth(db, env);
  const session = await getSession(request, auth);

  const user = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
  });
  if (!user) return redirect("/onboarding");

  const guide = await db.query.guides.findFirst({
    where: and(
      eq(guides.slug, params.guideSlug as string),
      eq(guides.authorId, user.id)
    ),
  });
  if (!guide) return redirect("/my-guides");

  // 未コミットのドラフトがあれば、編集対象としてドラフトを優先する。
  const hasDraft = guide.draftUpdatedAt !== null;
  const resolved = hasDraft
    ? {
        title: guide.draftTitle ?? guide.title,
        summary: guide.draftSummary,
        content: guide.draftContent ?? guide.content,
        coverImageUrl: guide.draftCoverImageUrl,
        tags: guide.draftTags ?? guide.tags,
      }
    : {
        title: guide.title,
        summary: guide.summary,
        content: guide.content,
        coverImageUrl: guide.coverImageUrl,
        tags: guide.tags,
      };

  // 公開版のスナップショット（ロールバック時にエディタを公開版へ戻すため）。
  const published = {
    title: guide.title,
    summary: guide.summary ?? "",
    content: guide.content,
    coverImageUrl: guide.coverImageUrl,
    tags: guide.tags,
    isPublished: guide.isPublished,
  };

  return { guide: { ...guide, ...resolved }, user, hasDraft, published };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const t = createTranslator(resolveLocale(request));
  const env = getEnv();
  const db = createDb();
  const auth = createAuth(db, env);
  const session = await getSession(request, auth);

  const user = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
  });
  if (!user) {
    return { error: t("meGuides.errorUnauthorized") };
  }

  const guide = await db.query.guides.findFirst({
    where: and(
      eq(guides.slug, params.guideSlug as string),
      eq(guides.authorId, user.id)
    ),
  });
  if (!guide) {
    return { error: t("meGuides.errorNotFound") };
  }

  const formData = await request.formData();
  const action = formData.get("_action");

  // "discard" = ドラフトを破棄し公開版へロールバック（ドラフト列を null に戻す）。
  // スラッグはドラフト対象外のライブ列のため discard では変更しない。
  if (action === "discard") {
    await db
      .update(guides)
      .set({
        draftTitle: null,
        draftSummary: null,
        draftContent: null,
        draftCoverImageUrl: null,
        draftTags: null,
        draftUpdatedAt: null,
      })
      .where(eq(guides.id, guide.id));
    return { success: true, mode: "discard", slug: guide.slug };
  }

  // "draft" = 仮保存（ドラフト列へ）, "publish" = 保存（公開版を書き換え）。
  // _action は allowlist で判定する（discard は上で処理済み）。未知・欠落値は
  // publish に倒さず拒否する — 誤って publish 扱いすると公開版を意図せず
  // 上書きしてしまうため（クライアント側の _action typo・送信漏れ対策）。
  if (action !== "draft" && action !== "publish") {
    return { error: t("meGuides.errorInvalidAction") };
  }
  const saveMode = action;

  const title = (formData.get("title") as string)?.trim() || guide.title;
  const content = (formData.get("content") as string) ?? guide.content;
  const summary = (formData.get("summary") as string) || null;

  // 検証導入前に保存された上限超過の既存ガイドを救済するため、値が変更された場合のみ検証する
  // （フィールドを触っていない保存は通し、変更した時点で上限を強制する）
  if (title !== guide.title && title.length > 200) {
    return { error: t("meGuides.errorTitleTooLong") };
  }
  if (summary && summary !== guide.summary && summary.length > 500) {
    return { error: t("meGuides.errorSummaryTooLong") };
  }

  const tagsRaw = (formData.get("tags") as string) || "[]";
  const isPublished = formData.get("isPublished") === "true";
  const coverImageUrl = formData.has("coverImageUrl")
    ? (formData.get("coverImageUrl") as string) || null
    : guide.coverImageUrl;

  // スラッグの正規化・検証（draft / publish 共通。ライブ列なのでどちらの保存でも反映する）
  const submittedSlug = normalizeSlug((formData.get("slug") as string) ?? "");
  if (!submittedSlug) {
    return { error: t("meGuides.errorSlugRequired") };
  }
  let nextSlug = guide.slug;
  if (submittedSlug !== guide.slug) {
    const dup = await db.query.guides.findFirst({
      where: and(eq(guides.authorId, user.id), eq(guides.slug, submittedSlug)),
      columns: { id: true },
    });
    if (dup && dup.id !== guide.id) {
      return { error: t("meGuides.errorSlugTaken") };
    }
    nextSlug = submittedSlug;
  }

  // tags の検証: JSON 配列であること、最大 10 件、各タグは 50 文字以内
  const jsonError = (key: "errorTagsInvalid" | "errorTagsTooMany" | "errorTagTooLong") => ({
    error: t(`meGuides.${key}`),
  });

  let validatedTags: string[];
  try {
    const parsed: unknown = JSON.parse(tagsRaw);
    if (!Array.isArray(parsed)) {
      return jsonError("errorTagsInvalid");
    }
    if (parsed.length > 10) {
      return jsonError("errorTagsTooMany");
    }
    const cleaned: string[] = [];
    for (const raw of parsed) {
      if (typeof raw !== "string") {
        return jsonError("errorTagsInvalid");
      }
      const trimmed = raw.trim();
      if (trimmed.length === 0) continue;
      if (trimmed.length > 50) {
        return jsonError("errorTagTooLong");
      }
      cleaned.push(trimmed);
    }
    validatedTags = cleaned;
  } catch {
    return jsonError("errorTagsInvalid");
  }

  const tags = JSON.stringify(validatedTags);

  // 公開時のみ本文の長さ上限を適用する（下書きは work 温存のため無制限）。
  if (saveMode !== "draft" && content.length > MAX_PUBLISHED_CONTENT_LENGTH) {
    return { error: t("meGuides.errorContentTooLong") };
  }

  if (saveMode === "draft") {
    // 仮保存: ドラフト列のみ更新。公開版（content 等）と isPublished は変更しない。
    // スラッグはライブ列なので仮保存でも反映する。
    await db
      .update(guides)
      .set({
        slug: nextSlug,
        draftTitle: title,
        draftSummary: summary,
        draftContent: content,
        draftCoverImageUrl: coverImageUrl,
        draftTags: tags,
        draftUpdatedAt: new Date(),
      })
      .where(eq(guides.id, guide.id));
  } else {
    // 保存: 公開版を書き換え、ドラフトはコミット済みとしてクリア。
    await db
      .update(guides)
      .set({
        slug: nextSlug,
        title,
        content,
        summary,
        tags,
        isPublished,
        coverImageUrl,
        updatedAt: new Date(),
        draftTitle: null,
        draftSummary: null,
        draftContent: null,
        draftCoverImageUrl: null,
        draftTags: null,
        draftUpdatedAt: null,
      })
      .where(eq(guides.id, guide.id));
  }

  return { success: true, mode: saveMode, slug: nextSlug };
}

/** tags は JSON 文字列だが、データ不整合があってもクラッシュしないよう防御的に解析する */
function safeParseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed.filter((t) => typeof t === "string") as string[]) : [];
  } catch {
    return [];
  }
}

export default function GuideEditPage() {
  const { guide, user, hasDraft, published } = useLoaderData<typeof loader>();

  return (
    <GuideEditor
      guideId={guide.id}
      userId={user.id}
      initialTitle={guide.title}
      initialContent={guide.content}
      initialSummary={guide.summary ?? ""}
      initialTags={safeParseTags(guide.tags)}
      initialIsPublished={guide.isPublished}
      initialCoverImageUrl={guide.coverImageUrl}
      initialHasDraft={hasDraft}
      publishedSnapshot={{
        title: published.title,
        summary: published.summary,
        content: published.content,
        coverImageUrl: published.coverImageUrl,
        tags: safeParseTags(published.tags),
        isPublished: published.isPublished,
      }}
      authorSlug={user.slug}
      guideSlug={guide.slug}
    />
  );
}
