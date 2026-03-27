import {
  useLoaderData,
  Link,
  useNavigation,
  type LoaderFunctionArgs,
} from "react-router";
import { useState } from "react";
import { createDb } from "@/lib/db";
import { getEnv } from "@/lib/env.server";
import { users, guides } from "@/lib/schema";
import { eq, and, desc } from "drizzle-orm";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BookOpen, ArrowLeft } from "lucide-react";
import { lazy, Suspense } from "react";
import {
  ViewToggle,
  GuideCardGrid,
  GuideListView,
  type GuideItem,
} from "@/components/guide-list-views";

export function meta({
  data,
}: {
  data: Awaited<ReturnType<typeof loader>> | undefined;
}) {
  if (!data?.author) {
    return [{ title: "ユーザーが見つかりません - Minefolio" }];
  }
  const name = data.author.displayName || data.author.mcid || data.author.slug;
  const title = `${name}のガイド - Minefolio`;
  const description = `${name}が公開しているガイド一覧`;
  const ogImage = `${data.appUrl}/og-image?slug=${encodeURIComponent(data.author.slug)}`;
  return [
    { title },
    { name: "description", content: description },
    { property: "og:type", content: "website" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:image", content: ogImage },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: ogImage },
  ];
}

export async function loader({ context, params }: LoaderFunctionArgs) {
  const env = context.env ?? getEnv();
  const db = createDb();

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
    },
  });

  if (!author) {
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
  });

  const appUrl = env.APP_URL || "https://minefolio.pages.dev";
  return { author, guides: authorGuides, appUrl };
}

const MinecraftAvatarLazy = lazy(() =>
  import("@/components/minecraft-avatar").then((mod) => ({
    default: mod.MinecraftAvatar,
  }))
);

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
          <Suspense fallback={<div className="w-12 h-12 rounded-full bg-muted shrink-0" />}>
            <MinecraftAvatarLazy
              uuid={author.uuid ?? undefined}
              skinUrl={author.customSkinUrl}
              size={48}
              className="rounded-full shrink-0"
            />
          </Suspense>
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
        <GuideCardGrid guides={authorGuides as GuideItem[]} linkFn={linkFn} />
      ) : (
        <GuideListView guides={authorGuides as GuideItem[]} linkFn={linkFn} />
      )}
    </div>
  );
}
