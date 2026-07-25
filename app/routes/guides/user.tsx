import {
  useLoaderData,
  Link,
  useNavigation,
  type LoaderFunctionArgs,
} from "react-router";
import { useState } from "react";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getOptionalSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users, guides } from "@/lib/schema";
import { eq, and, desc } from "drizzle-orm";
import { guideLikeCountSql } from "@/lib/likes.server";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import { BookOpen, ArrowLeft } from "lucide-react";
import {
  ViewToggle,
  GuideCardGrid,
  GuideListView,
  type GuideItem,
} from "@/components/guide-list-views";

export function meta({
  loaderData,
}: {
  loaderData: Awaited<ReturnType<typeof loader>> | undefined;
}) {
  if (!loaderData?.author) {
    return [{ title: "ユーザーが見つかりません - Minefolio" }];
  }
  const name = loaderData.author.displayName || loaderData.author.mcid || loaderData.author.slug;
  const title = `${name}のガイド - Minefolio`;
  const description = `${name}が公開しているガイド一覧`;
  const ogImage = `${loaderData.appUrl}/icon.png`;
  return [
    { title },
    { name: "description", content: description },
    { property: "og:type", content: "website" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:image", content: ogImage },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: ogImage },
  ];
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const env = getEnv();
  const db = createDb();
  const auth = createAuth(db, env);
  const session = await getOptionalSession(request, auth);

  const { authorSlug } = params as { authorSlug: string };

  const author = await db.query.users.findFirst({
    where: eq(users.slug, authorSlug),
    columns: {
      id: true,
      slug: true,
      mcid: true,
      uuid: true,
      displayName: true,
      discordAvatar: true,
      customSkinUrl: true,
      profileVisibility: true,
    },
  });

  if (!author) {
    throw new Response("Not Found", { status: 404 });
  }

  // プライベートプロフィールの著者のガイド一覧は本人以外に404を返す（プロフィール本体と挙動を揃える）
  let isOwner = false;
  if (session) {
    const currentUser = await db.query.users.findFirst({
      where: eq(users.discordId, session.user.id),
      columns: { id: true },
    });
    isOwner = currentUser?.id === author.id;
  }
  if (author.profileVisibility === "private" && !isOwner) {
    throw new Response("Not Found", { status: 404 });
  }

  const authorGuides = await db.query.guides.findMany({
    where: and(eq(guides.authorId, author.id), eq(guides.isPublished, true)),
    orderBy: [desc(guides.updatedAt)],
    columns: {
      id: true,
      slug: true,
      title: true,
      summary: true,
      tags: true,
      coverImageUrl: true,
      viewCount: true,
      updatedAt: true,
    },
    extras: { likeCount: guideLikeCountSql().as("like_count") },
  });

  const appUrl = env.APP_URL || "https://minefolio.app";
  return { author, guides: authorGuides, appUrl };
}


export default function UserGuidesPage() {
  const { author, guides: authorGuides } = useLoaderData<typeof loader>();
  const authorName = author.displayName || author.mcid || author.slug;
  const [viewMode, setViewMode] = useState<"card" | "list">("card");
  const navigation = useNavigation();
  const isNavigating = navigation.state === "loading";

  const linkFn = (guide: GuideItem) => `/guides/${author.slug}/${guide.slug}`;

  return (
    <div className="space-y-6">
      {/* Back */}
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link to="/guides">
          <ArrowLeft className="h-4 w-4 mr-1" />
          ガイド一覧
        </Link>
      </Button>

      {/* Author header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <MinecraftAvatar
            uuid={author.uuid ?? undefined}
            skinUrl={author.customSkinUrl}
            size={48}
            className="rounded-full shrink-0"
          />
          <div>
            <Link
              to={`/player/${author.slug}`}
              className="text-2xl font-bold hover:text-primary transition-colors"
            >
              {authorName}
            </Link>
            {author.mcid && (
              <p className="text-sm text-muted-foreground">@{author.mcid}</p>
            )}
            <p className="text-sm text-muted-foreground mt-0.5">
              {authorGuides.length} 件のガイド
            </p>
          </div>
        </div>
        <ViewToggle viewMode={viewMode} onChange={setViewMode} />
      </div>

      {/* Guide list */}
      {isNavigating ? (
        viewMode === "card" ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="border border-border/70 rounded-xl overflow-hidden">
                <Skeleton className="h-36 w-full" />
                <div className="p-4 space-y-2">
                  <Skeleton className="h-5 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-1">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 py-3 px-1">
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-32" />
                </div>
              </div>
            ))}
          </div>
        )
      ) : authorGuides.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <BookOpen className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p>まだガイドが公開されていません。</p>
        </div>
      ) : viewMode === "card" ? (
        <GuideCardGrid guides={authorGuides} linkFn={linkFn} />
      ) : (
        <GuideListView guides={authorGuides} linkFn={linkFn} />
      )}
    </div>
  );
}
