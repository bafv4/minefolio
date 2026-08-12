import { createTranslator } from "@/lib/messages";
import { localeFromMatches } from "@/lib/locale";
import {
  useLoaderData,
  Link,
  type LoaderFunctionArgs,
} from "react-router";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getOptionalSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users, guides, keybindings, keyRemaps, playerConfigs, searchCrafts, searchCraftLoops, configPresets } from "@/lib/schema";
import { eq, and, sql, asc, inArray } from "drizzle-orm";
import { parseLoopSteps } from "@/lib/search-craft-loops";
import { decodePresetConfig, shouldUsePresetSnapshot } from "@/lib/preset-read";
import { publiclyReferencableCondition } from "@/lib/users-filter";
import { sanitizeGuideHtml } from "@/lib/guide-sanitize.server";
import { getGuideLikeCount } from "@/lib/likes.server";
import { LikeButton } from "@/components/like-button";
import { useT, useLocale } from "@/hooks/use-locale";
import { getLocalizedDisplayName, pickDisplayName } from "@/lib/slug";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Eye, ArrowLeft, Calendar, Pencil } from "lucide-react";
import { format } from "date-fns";
import { dateFnsLocale, dateFormatPattern } from "@/lib/date-locale";
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

// コードブロックのコピーボタンに innerHTML で挿入する lucide アイコン（Copy / Check）。
// stroke="currentColor" のため、ボタンの text-muted-foreground / hover 色がそのまま反映される。
const COPY_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
const CHECK_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

export function meta({
  loaderData,
  matches,
}: {
  loaderData: Awaited<ReturnType<typeof loader>> | undefined;
  matches: ReadonlyArray<{ id: string; loaderData?: unknown }>;
}) {
  const locale = localeFromMatches(matches);
  const t = createTranslator(locale);
  if (!loaderData?.guide) {
    return [{ title: t("guideView.notFoundTitle") }];
  }
  const title = `${loaderData.guide.title} - Minefolio`;
  const description = loaderData.guide.summary || t("guideView.metaDescription", { name: pickDisplayName(loaderData.author, locale) || loaderData.author.mcid || "" });
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
      displayNameAlphabet: true,
      discordAvatar: true,
      customSkinUrl: true,
      slimSkin: true,
      profileVisibility: true,
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

  // プライベートプロフィールの著者のガイドは本人以外に404を返す（プロフィール本体と挙動を揃える）
  if (author.profileVisibility === "private" && !isOwner) {
    throw new Response("Not Found", { status: 404 });
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
        displayNameAlphabet: true,
        mcid: true,
      },
      with: {
        keybindings: { orderBy: [asc(keybindings.category), asc(keybindings.action)] },
        keyRemaps: { orderBy: [asc(keyRemaps.sourceKey)] },
        playerConfig: { columns: { keyboardLayout: true, fingerAssignments: true } },
        searchCrafts: { orderBy: [asc(searchCrafts.sequence)] },
        searchCraftLoops: { orderBy: [asc(searchCraftLoops.sequence)] },
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
            searchCraftLoopsData: true,
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
          displayNameAlphabet: true,
          mcid: true,
        },
        with: {
          keybindings: { orderBy: [asc(keybindings.category), asc(keybindings.action)] },
          keyRemaps: { orderBy: [asc(keyRemaps.sourceKey)] },
          playerConfig: { columns: { keyboardLayout: true, fingerAssignments: true } },
          searchCrafts: { orderBy: [asc(searchCrafts.sequence)] },
          searchCraftLoops: { orderBy: [asc(searchCraftLoops.sequence)] },
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
              searchCraftLoopsData: true,
            },
          },
        },
      });
      embedUserRows.push(...byMcid);
    }

    for (const u of embedUserRows) {
      // 既定表示（presetName 指定なし）はメイン（公開用）プリセットのスナップショットを優先。
      // メインが無いユーザー、およびメインが編集中（isActive＝ライブが現在適用中の設定そのもの）の
      // ユーザーはライブ（従来挙動）。スナップショットを使う場合、null の種別は「空」
      const mainPreset = u.configPresets.find((p) => p.isMain);
      let display: Pick<
        EmbedUserData,
        "keybindings" | "keyRemaps" | "playerConfig" | "searchCrafts" | "searchCraftLoops"
      >;
      if (shouldUsePresetSnapshot(mainPreset)) {
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
          // decodePresetSearchCraftLoops は既に craftId をこのスナップショットの
          // searchCrafts（合成id）へ解決済み。timing はスナップショットに欠落していると
          // undefined になり得るため null へ正規化する
          searchCraftLoops: decoded.searchCraftLoops.map((l) => ({
            id: l.id,
            sequence: l.sequence,
            steps: l.steps,
            comment: l.comment,
            timing: l.timing ?? null,
          })),
        };
      } else {
        display = {
          keybindings: u.keybindings,
          keyRemaps: u.keyRemaps,
          playerConfig: u.playerConfig,
          searchCrafts: u.searchCrafts,
          searchCraftLoops: u.searchCraftLoops.map((row) => ({
            id: row.id,
            sequence: row.sequence,
            steps: parseLoopSteps(row.steps),
            comment: row.comment,
            timing: row.timing,
          })),
        };
      }
      const data: EmbedUserData = {
        slug: u.slug,
        displayName: u.displayName,
        displayNameAlphabet: u.displayNameAlphabet,
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
          searchCraftLoopsData: p.searchCraftLoopsData,
        })),
        ...display,
      };
      embedUsers[u.slug] = data;
      if (u.mcid) embedUsers[u.mcid] = data;
    }
  }

  const appUrl = env.APP_URL || "https://minefolio.app";
  const likeCount = await getGuideLikeCount(db, guide.id);
  return {
    // クライアントが使うフィールドのみ渡す。行をそのまま展開すると、著者の
    // 未公開ドラフト（draftTitle / draftContent 等）とサニタイズ前の生 content が
    // 全閲覧者のSSRペイロードに載ってしまう（埋め込みユーザーと同じ方針）。
    guide: {
      id: guide.id,
      slug: guide.slug,
      title: viewTitle,
      summary: viewSummary,
      coverImageUrl: viewCover,
      tags: viewTags,
      viewCount: guide.viewCount,
      updatedAt: guide.updatedAt,
      sanitizedContent: contentWithIds,
      likeCount,
    },
    // 同様に、著者も表示に使う分だけ渡す（id / profileVisibility は可視性判定用のサーバー内部値）
    author: {
      slug: author.slug,
      mcid: author.mcid,
      uuid: author.uuid,
      displayName: author.displayName,
      displayNameAlphabet: author.displayNameAlphabet,
      customSkinUrl: author.customSkinUrl,
    },
    appUrl,
    embedUsers,
    isOwner,
    previewingDraft,
    toc,
  };
}


export default function GuideViewPage() {
  const t = useT();
  const locale = useLocale();
  const { guide, author, embedUsers, isOwner, previewingDraft, toc } = useLoaderData<typeof loader>();
  let tags: string[] = [];
  try {
    tags = JSON.parse(guide.tags) as string[];
  } catch {
    // invalid JSON in tags — fallback to empty
  }
  const authorName = getLocalizedDisplayName(author, locale);
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
      btn.title = t("guideView.copy");
      btn.innerHTML = COPY_ICON_SVG;
      const controller = new AbortController();
      controllers.push(controller);
      btn.addEventListener("click", () => {
        const code = pre.querySelector("code");
        const text = code?.textContent ?? pre.textContent ?? "";
        navigator.clipboard.writeText(text).then(() => {
          btn.innerHTML = CHECK_ICON_SVG;
          const tid = setTimeout(() => { btn.innerHTML = COPY_ICON_SVG; }, 1500);
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

  // モバイルの左右パディングは main（_layout.tsx）側の px-4 と二重にならないよう、
  // article 側は 0 にする（sm 以上は main と article の両方で加算する既存の見た目を維持）。
  // GuideTocMobile 側の -mx-* もこの調整に合わせている（guide-toc-nav.tsx 参照）。
  return (
    <article className="relative w-full max-w-5xl mx-auto px-0 sm:px-6 lg:px-8">
      {/* デスクトップ目次: 本文幅は削らず、中央寄せ本文の左余白（ガター）に固定表示する。
          左端はヘッダーのロゴ始点（コンテナ左端）と揃える。2xl ではガター幅が w-56 と一致し、
          right-full（右端＝本文パディング左端）と合わせて左端がコンテナ左端になる。
          2xl 未満は下部の上部バー + ドロワーを使う。 */}
      <div className="hidden 2xl:block absolute inset-y-0 right-full w-56">
        <GuideTocSidebar items={toc} />
      </div>

      {previewingDraft && (
        <div className="mb-4 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-foreground">
          {t("guideView.draftPreviewNotice")}
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
          {format(guide.updatedAt, dateFormatPattern(locale), { locale: dateFnsLocale(locale) })}
        </span>
        <span className="flex items-center gap-1">
          <Eye className="h-3.5 w-3.5" />
          {guide.viewCount}
        </span>
        <LikeButton
          variant="detail"
          targetType="guide"
          targetId={guide.id}
          likeCount={guide.likeCount}
          isOwn={isOwner}
          className="ml-auto"
        />
      </div>

      {/* 目次（2xl 未満: 上部固定バー + 左ドロワー）。
          2xl:hidden と sticky はコンポーネント側のバー本体に付く（ラッパーで包むと
          sticky の可動域が無くなるため、ここでは素で描画する） */}
      <GuideTocMobile items={toc} />

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
  const t = useT();
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
              {t("guideView.embedUserNotFound", { slug: seg.userSlug })}
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
