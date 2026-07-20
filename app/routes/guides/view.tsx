import {
  useLoaderData,
  Link,
  type LoaderFunctionArgs,
} from "react-router";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getOptionalSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users, guides, keybindings, keyRemaps, playerConfigs, searchCrafts, configPresets } from "@/lib/schema";
import { eq, and, sql, asc, inArray } from "drizzle-orm";
import { decodePresetConfig } from "@/lib/preset-read";
import { publiclyReferencableCondition } from "@/lib/users-filter";
import { sanitizeGuideHtml } from "@/lib/guide-sanitize.server";
import { t } from "@/lib/messages";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Eye, ArrowLeft, Calendar, Pencil } from "lucide-react";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { useEffect, useRef } from "react";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import { buildTableOfContents } from "@/lib/guide-toc";
import { GuideTocSidebar, GuideTocMobile } from "@/components/guide-toc-nav";
import { normalizeGuideTables } from "@/lib/guide-tables";
import {
  extractEmbedRefs,
  getUniqueEmbedSlugs,
  splitContentAtEmbeds,
  KeybindEmbedView,
  SearchCraftEmbedView,
  type EmbedUserData,
} from "@/components/guide-embeds";

export function meta({
  loaderData,
}: {
  loaderData: Awaited<ReturnType<typeof loader>> | undefined;
}) {
  if (!loaderData?.guide) {
    return [{ title: "ガイドが見つかりません - Minefolio" }];
  }
  const title = `${loaderData.guide.title} - Minefolio`;
  const description = loaderData.guide.summary || `${loaderData.author.displayName || loaderData.author.mcid}のガイド`;
  const ogImage = loaderData.guide.coverImageUrl || `${loaderData.appUrl}/og-image`;
  return [
    { title },
    { name: "description", content: description },
    { property: "og:type", content: "article" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:image", content: ogImage },
    { name: "twitter:card", content: loaderData.guide.coverImageUrl ? "summary_large_image" : "summary" },
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

  // 著者本人なら ?draft=1 でドラフト（仮保存）内容をプレビューできる
  const wantDraft = new URL(request.url).searchParams.get("draft") === "1";
  let isOwner = false;
  if (session) {
    const currentUser = await db.query.users.findFirst({
      where: eq(users.discordId, session.user.id),
      columns: { id: true },
    });
    isOwner = currentUser?.id === author.id;
  }
  const draftPreview = wantDraft && isOwner;

  const guideConditions = [eq(guides.authorId, author.id), eq(guides.slug, guideSlug)];
  // ドラフトプレビュー時は未公開でも取得可。それ以外は公開済みのみ。
  if (!draftPreview) guideConditions.push(eq(guides.isPublished, true));

  const guide = await db.query.guides.findFirst({ where: and(...guideConditions) });

  if (!guide) {
    throw new Response("Not Found", { status: 404 });
  }

  // ドラフトが存在し、プレビュー指定時はドラフト各値を採用
  const previewingDraft = draftPreview && guide.draftUpdatedAt !== null;
  const viewTitle = previewingDraft ? guide.draftTitle ?? guide.title : guide.title;
  const viewSummary = previewingDraft ? guide.draftSummary : guide.summary;
  const viewCover = previewingDraft ? guide.draftCoverImageUrl : guide.coverImageUrl;
  const viewTags = previewingDraft ? guide.draftTags ?? guide.tags : guide.tags;
  const viewContent = previewingDraft ? guide.draftContent ?? guide.content : guide.content;

  // ドラフトプレビューでは閲覧数を増やさない
  if (!draftPreview) {
    db.update(guides)
      .set({ viewCount: sql`${guides.viewCount} + 1` })
      .where(eq(guides.id, guide.id))
      .then(() => {})
      .catch(() => {});
  }

  // Sanitize HTML on the server（許可タグ・属性等は guide-sanitize.server.ts 参照）
  const sanitizedContent = sanitizeGuideHtml(viewContent);

  // 列幅未指定の列が潰れないよう表の min-width を再計算する（guide-tables.ts 参照）
  const normalizedContent = normalizeGuideTables(sanitizedContent);

  // Wrap <table> in a scrollable container so wide tables scroll on mobile
  const wrappedContent = normalizedContent.replace(
    /<table(\s|>)/g,
    '<div class="table-scroll-wrapper"><table$1'
  ).replace(/<\/table>/g, '</table></div>');

  // 見出し(h1〜h3)に id を付与し、目次データを生成する
  const { html: contentWithIds, toc } = buildTableOfContents(wrappedContent);

  // Extract embed references and fetch user data
  const embedRefs = extractEmbedRefs(contentWithIds);
  const embedSlugs = getUniqueEmbedSlugs(embedRefs);
  const embedUsers: Record<string, EmbedUserData> = {};

  if (embedSlugs.length > 0) {
    // 非公開（private）ユーザーの設定はガイド埋め込みでも露出させない
    const embedUserRows = await db.query.users.findMany({
      where: and(inArray(users.slug, embedSlugs), publiclyReferencableCondition),
      columns: {
        id: true,
        slug: true,
        displayName: true,
        mcid: true,
      },
      with: {
        keybindings: { orderBy: [asc(keybindings.category), asc(keybindings.action)] },
        keyRemaps: { orderBy: [asc(keyRemaps.sourceKey)] },
        playerConfig: { columns: { keyboardLayout: true, fingerAssignments: true } },
        searchCrafts: { orderBy: [asc(searchCrafts.sequence)] },
        configPresets: {
          columns: {
            name: true,
            isActive: true,
            isMain: true,
            keybindingsData: true,
            remapsData: true,
            playerConfigData: true,
            fingerAssignmentsData: true,
            searchCraftsData: true,
          },
        },
      },
    });

    // Also try matching by mcid for slugs that didn't match
    const matchedSlugs = new Set(embedUserRows.map((u) => u.slug));
    const unmatchedSlugs = embedSlugs.filter((s) => !matchedSlugs.has(s));
    if (unmatchedSlugs.length > 0) {
      const byMcid = await db.query.users.findMany({
        where: and(inArray(users.mcid, unmatchedSlugs), publiclyReferencableCondition),
        columns: {
          id: true,
          slug: true,
          displayName: true,
          mcid: true,
        },
        with: {
          keybindings: { orderBy: [asc(keybindings.category), asc(keybindings.action)] },
          keyRemaps: { orderBy: [asc(keyRemaps.sourceKey)] },
          playerConfig: { columns: { keyboardLayout: true, fingerAssignments: true } },
          searchCrafts: { orderBy: [asc(searchCrafts.sequence)] },
          configPresets: {
            columns: {
              name: true,
              isActive: true,
              isMain: true,
              keybindingsData: true,
              remapsData: true,
              playerConfigData: true,
              fingerAssignmentsData: true,
              searchCraftsData: true,
            },
          },
        },
      });
      embedUserRows.push(...byMcid);
    }

    for (const u of embedUserRows) {
      // 既定表示（presetName 指定なし）はメイン（公開用）プリセットのスナップショットを優先。
      // メインが無いユーザーのみライブ（従来挙動）。メインがある場合、null の種別は「空」
      const mainPreset = u.configPresets.find((p) => p.isMain);
      let display: Pick<
        EmbedUserData,
        "keybindings" | "keyRemaps" | "playerConfig" | "searchCrafts"
      >;
      if (mainPreset) {
        const decoded = decodePresetConfig(mainPreset, u.id);
        display = {
          keybindings: decoded.keybindings,
          keyRemaps: decoded.keyRemaps,
          playerConfig: decoded.playerConfig
            ? {
                keyboardLayout: decoded.playerConfig.keyboardLayout ?? null,
                fingerAssignments: decoded.fingerAssignments,
              }
            : null,
          searchCrafts: decoded.searchCrafts,
        };
      } else {
        display = {
          keybindings: u.keybindings,
          keyRemaps: u.keyRemaps,
          playerConfig: u.playerConfig,
          searchCrafts: u.searchCrafts,
        };
      }
      const data: EmbedUserData = {
        slug: u.slug,
        displayName: u.displayName,
        mcid: u.mcid,
        // クライアント（guide-embeds）が使うフィールドのみ渡す
        // （fingerAssignmentsData 等のスナップショット列をペイロードに漏らさない）
        presets: u.configPresets.map((p) => ({
          name: p.name,
          isActive: p.isActive,
          keybindingsData: p.keybindingsData,
          remapsData: p.remapsData,
          playerConfigData: p.playerConfigData,
          searchCraftsData: p.searchCraftsData,
        })),
        ...display,
      };
      embedUsers[u.slug] = data;
      if (u.mcid) embedUsers[u.mcid] = data;
    }
  }

  const appUrl = env.APP_URL || "https://minefolio.app";
  return {
    guide: {
      ...guide,
      title: viewTitle,
      summary: viewSummary,
      coverImageUrl: viewCover,
      tags: viewTags,
      sanitizedContent: contentWithIds,
    },
    author,
    appUrl,
    embedUsers,
    isOwner,
    previewingDraft,
    toc,
  };
}


export default function GuideViewPage() {
  const { guide, author, embedUsers, isOwner, previewingDraft, toc } = useLoaderData<typeof loader>();
  let tags: string[] = [];
  try {
    tags = JSON.parse(guide.tags) as string[];
  } catch {
    // invalid JSON in tags — fallback to empty
  }
  const authorName = author.displayName || author.mcid || author.slug;
  const contentRef = useRef<HTMLDivElement>(null);

  // Inject copy buttons on code blocks
  useEffect(() => {
    if (!contentRef.current) return;
    const pres = contentRef.current.querySelectorAll("pre");
    const controllers: AbortController[] = [];
    const timeouts: ReturnType<typeof setTimeout>[] = [];

    pres.forEach((pre) => {
      if (pre.querySelector(".code-copy-btn")) return;
      const btn = document.createElement("button");
      btn.className = "code-copy-btn";
      btn.title = "コピー";
      btn.textContent = "📋";
      const controller = new AbortController();
      controllers.push(controller);
      btn.addEventListener("click", () => {
        const code = pre.querySelector("code");
        const text = code?.textContent ?? pre.textContent ?? "";
        navigator.clipboard.writeText(text).then(() => {
          btn.textContent = "✓";
          const tid = setTimeout(() => { btn.textContent = "📋"; }, 1500);
          timeouts.push(tid);
        });
      }, { signal: controller.signal });
      pre.style.position = "relative";
      pre.appendChild(btn);
    });

    return () => {
      controllers.forEach((c) => c.abort());
      timeouts.forEach((t) => clearTimeout(t));
      pres.forEach((pre) => {
        pre.querySelectorAll(".code-copy-btn").forEach((btn) => btn.remove());
      });
    };
  }, []);

  return (
    <article className="w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
      {previewingDraft && (
        <div className="mb-4 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-foreground">
          ドラフト（仮保存）のプレビューを表示しています。公開中の内容とは異なる場合があります。
        </div>
      )}
      {/* Back button + Owner edit button */}
      <div className="mb-6 flex items-center justify-between">
        <Button variant="ghost" size="sm" asChild className="-ml-2">
          <Link to="/guides">
            <ArrowLeft className="h-4 w-4 mr-1" />
            {t("guides.pageTitle")}
          </Link>
        </Button>
        {isOwner && (
          <Button variant="outline" size="sm" asChild>
            <Link to={`/my-guides/${guide.slug}/edit`}>
              <Pencil className="h-4 w-4 mr-1" />
              {t("guideEditor.edit")}
            </Link>
          </Button>
        )}
      </div>

      {/* GitBook 風 2 カラム: 広い画面は左に目次サイドバー、狭い画面は上部バー + ドロワー */}
      <div className="xl:grid xl:grid-cols-[15rem_minmax(0,1fr)] xl:gap-10">
        {/* 目次サイドバー（xl 以上） */}
        <aside className="hidden xl:block">
          <GuideTocSidebar items={toc} />
        </aside>

        {/* 本文カラム */}
        <div className="min-w-0">
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
          <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground border-y py-3 mb-6">
            <Link
              to={`/player/${author.slug}`}
              className="flex items-center gap-2 hover:text-foreground transition-colors"
            >
              <MinecraftAvatar
                uuid={author.uuid ?? undefined}
                skinUrl={author.customSkinUrl}
                size={20}
                className="rounded-full shrink-0"
              />
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

          {/* 目次（狭い画面のみ: 上部固定バー + 左ドロワー） */}
          <div className="xl:hidden">
            <GuideTocMobile items={toc} />
          </div>

          {/* Content */}
          <GuideContent
            contentRef={contentRef}
            html={guide.sanitizedContent}
            embedUsers={embedUsers}
          />

          {/* Author card at bottom */}
          <div className="border-t mt-12 pt-8">
            <Link
              to={`/player/${author.slug}`}
              className="flex items-center gap-3 group"
            >
              <MinecraftAvatar
                uuid={author.uuid ?? undefined}
                skinUrl={author.customSkinUrl}
                size={40}
                className="rounded-full"
              />
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
        </div>
      </div>
    </article>
  );
}

// コンテンツ描画（embed部分をReactコンポーネントに分離）
function GuideContent({
  contentRef,
  html,
  embedUsers,
}: {
  contentRef: React.RefObject<HTMLDivElement | null>;
  html: string;
  embedUsers: Record<string, EmbedUserData>;
}) {
  const segments = splitContentAtEmbeds(html);
  const hasEmbeds = segments.some((s) => s.type !== "html");

  // embedが無ければ従来通り
  if (!hasEmbeds) {
    return (
      <div
        ref={contentRef}
        className="guide-content prose prose-neutral dark:prose-invert max-w-none"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  return (
    <div ref={contentRef} className="guide-content prose prose-neutral dark:prose-invert max-w-none">
      {segments.map((seg, i) => {
        if (seg.type === "html") {
          return <div key={i} dangerouslySetInnerHTML={{ __html: seg.content }} />;
        }
        const userData = embedUsers[seg.userSlug];
        if (!userData) {
          return (
            <div key={i} className="my-4 rounded-lg border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
              ユーザー「{seg.userSlug}」が見つかりません
            </div>
          );
        }
        if (seg.type === "keybind-embed") {
          return <KeybindEmbedView key={i} userData={userData} presetName={seg.presetName} />;
        }
        return <SearchCraftEmbedView key={i} userData={userData} presetName={seg.presetName} />;
      })}
    </div>
  );
}
