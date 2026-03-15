import {
  useLoaderData,
  Link,
  type LoaderFunctionArgs,
} from "react-router";
import { createDb } from "@/lib/db";
import { getEnv } from "@/lib/env.server";
import { users, guides } from "@/lib/schema";
import { eq, and, sql } from "drizzle-orm";
import sanitizeHtml from "sanitize-html";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Eye, ArrowLeft, Calendar } from "lucide-react";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { lazy, Suspense, useEffect, useRef } from "react";

export function meta({
  data,
}: {
  data: Awaited<ReturnType<typeof loader>> | undefined;
}) {
  if (!data?.guide) {
    return [{ title: "ガイドが見つかりません - Minefolio" }];
  }
  return [
    { title: `${data.guide.title} - Minefolio` },
    {
      name: "description",
      content: data.guide.summary || `${data.author.displayName || data.author.mcid}のガイド`,
    },
  ];
}

export async function loader({ context, params }: LoaderFunctionArgs) {
  const env = context.env ?? getEnv();
  const db = createDb();

  const { authorSlug, guideSlug } = params as {
    authorSlug: string;
    guideSlug: string;
  };

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
      slimSkin: true,
    },
  });

  if (!author) {
    throw new Response("Not Found", { status: 404 });
  }

  const guide = await db.query.guides.findFirst({
    where: and(
      eq(guides.authorId, author.id),
      eq(guides.slug, guideSlug),
      eq(guides.isPublished, true)
    ),
  });

  if (!guide) {
    throw new Response("Not Found", { status: 404 });
  }

  // Increment view count (fire and forget)
  db.update(guides)
    .set({ viewCount: sql`${guides.viewCount} + 1` })
    .where(eq(guides.id, guide.id))
    .then(() => {})
    .catch(() => {});

  // Sanitize HTML on the server
  const sanitizedContent = sanitizeHtml(guide.content, {
    allowedTags: [
      ...sanitizeHtml.defaults.allowedTags,
      "h1", "h2", "h3", "h4", "h5", "h6",
      "img", "iframe", "div", "figure", "figcaption",
      "details", "summary", "span", "mark",
    ],
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      "*": ["class"],
      img: ["src", "alt", "title", "width", "height"],
      a: ["href", "name", "target", "rel"],
      iframe: ["src", "width", "height", "frameborder", "allowfullscreen", "allow"],
      div: ["data-youtube-video", "data-callout", "data-callout-type", "data-guide-link", "data-columns", "data-column", "class"],
      td: ["colspan", "rowspan", "style"],
      th: ["colspan", "rowspan", "style"],
      span: ["style"],
      mark: ["data-color", "style"],
    },
    allowedStyles: {
      "*": {
        color: [/.*/],
        "background-color": [/.*/],
      },
    },
    allowedIframeHostnames: ["www.youtube.com", "www.youtube-nocookie.com"],
  });

  return { guide: { ...guide, sanitizedContent }, author };
}

const MinecraftAvatarLazy = lazy(() =>
  import("@/components/minecraft-avatar").then((mod) => ({
    default: mod.MinecraftAvatar,
  }))
);

export default function GuideViewPage() {
  const { guide, author } = useLoaderData<typeof loader>();
  const tags = JSON.parse(guide.tags) as string[];
  const authorName = author.displayName || author.mcid || author.slug;
  const contentRef = useRef<HTMLDivElement>(null);

  // Inject copy buttons on code blocks
  useEffect(() => {
    if (!contentRef.current) return;
    const pres = contentRef.current.querySelectorAll("pre");
    pres.forEach((pre) => {
      if (pre.querySelector(".code-copy-btn")) return;
      const btn = document.createElement("button");
      btn.className = "code-copy-btn";
      btn.title = "コピー";
      btn.textContent = "📋";
      btn.addEventListener("click", () => {
        const code = pre.querySelector("code");
        const text = code?.textContent ?? pre.textContent ?? "";
        navigator.clipboard.writeText(text).then(() => {
          btn.textContent = "✓";
          setTimeout(() => { btn.textContent = "📋"; }, 1500);
        });
      });
      pre.style.position = "relative";
      pre.appendChild(btn);
    });
  }, []);

  return (
    <article className="w-full max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
      {/* Back button */}
      <div className="mb-6">
        <Button variant="ghost" size="sm" asChild className="-ml-2">
          <Link to="/guides">
            <ArrowLeft className="h-4 w-4 mr-1" />
            ガイド一覧
          </Link>
        </Button>
      </div>

      {/* Cover image */}
      {guide.coverImageUrl && (
        <img
          src={guide.coverImageUrl}
          alt={guide.title}
          className="w-full rounded-xl object-cover aspect-2/1 mb-8"
        />
      )}

      {/* Title + summary */}
      <div className="mb-5">
        <h1 className="text-4xl font-bold leading-tight tracking-tight mb-3">
          {guide.title}
        </h1>
        {guide.summary && (
          <p className="text-lg text-muted-foreground leading-relaxed">
            {guide.summary}
          </p>
        )}
      </div>

      {/* Tags */}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {tags.map((tag) => (
            <Badge key={tag} variant="secondary">
              {tag}
            </Badge>
          ))}
        </div>
      )}

      {/* Meta */}
      <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground border-y py-3 mb-10">
        <Link
          to={`/player/${author.slug}`}
          className="flex items-center gap-2 hover:text-foreground transition-colors"
        >
          <Suspense
            fallback={<div className="w-5 h-5 rounded-full bg-muted shrink-0" />}
          >
            <MinecraftAvatarLazy
              uuid={author.uuid ?? undefined}
              size={20}
              className="rounded-full shrink-0"
            />
          </Suspense>
          <span className="font-medium">{authorName}</span>
        </Link>
        <span className="flex items-center gap-1">
          <Calendar className="h-3.5 w-3.5" />
          {format(guide.updatedAt, "yyyy/MM/dd", { locale: ja })}
        </span>
        <span className="flex items-center gap-1">
          <Eye className="h-3.5 w-3.5" />
          {guide.viewCount}
        </span>
      </div>

      {/* Content */}
      <div
        ref={contentRef}
        className="guide-content prose prose-neutral dark:prose-invert max-w-none"
        dangerouslySetInnerHTML={{ __html: guide.sanitizedContent }}
      />

      {/* Author card at bottom */}
      <div className="border-t mt-12 pt-8">
        <Link
          to={`/player/${author.slug}`}
          className="flex items-center gap-3 group"
        >
          <Suspense
            fallback={<div className="w-10 h-10 rounded-full bg-muted" />}
          >
            <MinecraftAvatarLazy
              uuid={author.uuid ?? undefined}
              size={40}
              className="rounded-full"
            />
          </Suspense>
          <div>
            <p className="font-medium group-hover:text-primary transition-colors">
              {authorName}
            </p>
            {author.mcid && (
              <p className="text-sm text-muted-foreground">@{author.mcid}</p>
            )}
          </div>
        </Link>
      </div>
    </article>
  );
}
