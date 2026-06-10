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
import { t } from "@/lib/messages";

export function meta({ data }: { data: { guide: { title: string } } | undefined }) {
  if (!data?.guide) return [{ title: t("meGuides.editTitle") }];
  return [{ title: `${data.guide.title} - 編集 | Minefolio` }];
}

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const env = context.env ?? getEnv();
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

  return { guide: { ...guide, ...resolved }, user, hasDraft };
}

export async function action({ context, request, params }: ActionFunctionArgs) {
  const env = context.env ?? getEnv();
  const db = createDb();
  const auth = createAuth(db, env);
  const session = await getSession(request, auth);

  const user = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
  });
  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const guide = await db.query.guides.findFirst({
    where: and(
      eq(guides.slug, params.guideSlug as string),
      eq(guides.authorId, user.id)
    ),
  });
  if (!guide) {
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const formData = await request.formData();
  // "draft" = 仮保存（ドラフト列へ）, "publish" = 保存（公開版を書き換え）。
  const saveMode = formData.get("_action") === "draft" ? "draft" : "publish";

  const title = (formData.get("title") as string)?.trim() || guide.title;
  const content = (formData.get("content") as string) ?? guide.content;
  const summary = (formData.get("summary") as string) || null;
  const tagsRaw = (formData.get("tags") as string) || "[]";
  const isPublished = formData.get("isPublished") === "true";
  const coverImageUrl = formData.has("coverImageUrl")
    ? (formData.get("coverImageUrl") as string) || null
    : guide.coverImageUrl;

  // tags の検証: JSON 配列であること、最大 10 件、各タグは 50 文字以内
  const jsonError = (key: "errorTagsInvalid" | "errorTagsTooMany" | "errorTagTooLong") =>
    new Response(JSON.stringify({ error: t(`meGuides.${key}`) }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
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

  if (saveMode === "draft") {
    // 仮保存: ドラフト列のみ更新。公開版（content 等）と isPublished は変更しない。
    await db
      .update(guides)
      .set({
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

  return new Response(JSON.stringify({ success: true, mode: saveMode }), {
    headers: { "Content-Type": "application/json" },
  });
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
  const { guide, user, hasDraft } = useLoaderData<typeof loader>();

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
      authorSlug={user.slug}
      guideSlug={guide.slug}
    />
  );
}
