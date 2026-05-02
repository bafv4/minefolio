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

  return { guide, user };
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

  const title = (formData.get("title") as string)?.trim() || guide.title;
  const content = (formData.get("content") as string) ?? guide.content;
  const summary = (formData.get("summary") as string) || null;
  const tagsRaw = (formData.get("tags") as string) || "[]";
  const isPublished = formData.get("isPublished") === "true";
  const coverImageUrl = formData.has("coverImageUrl")
    ? (formData.get("coverImageUrl") as string) || null
    : guide.coverImageUrl;

  await db
    .update(guides)
    .set({
      title,
      content,
      summary,
      tags: tagsRaw,
      isPublished,
      coverImageUrl,
      updatedAt: new Date(),
    })
    .where(eq(guides.id, guide.id));

  return new Response(JSON.stringify({ success: true }), {
    headers: { "Content-Type": "application/json" },
  });
}

export default function GuideEditPage() {
  const { guide, user } = useLoaderData<typeof loader>();

  return (
    <GuideEditor
      guideId={guide.id}
      userId={user.id}
      initialTitle={guide.title}
      initialContent={guide.content}
      initialSummary={guide.summary ?? ""}
      initialTags={JSON.parse(guide.tags) as string[]}
      initialIsPublished={guide.isPublished}
      initialCoverImageUrl={guide.coverImageUrl}
      authorSlug={user.slug}
      guideSlug={guide.slug}
    />
  );
}
