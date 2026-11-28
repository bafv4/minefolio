import { createTranslator, type Translator } from "@/lib/messages";
import { localeFromMatches, resolveLocale } from "@/lib/locale";
import { getGuideTranslation, getGuideTranslations } from "@/lib/content-translation.server";
import { applyGuideTranslation } from "@/lib/guide-translation-list";
import { AutoTranslateNotice } from "@/components/auto-translate-notice";
import {
  useLoaderData,
  Link,
  useSearchParams,
  useLocation,
  redirect,
  data,
  isRouteErrorResponse,
  useRouteError,
  type LoaderFunctionArgs,
} from "react-router";
import { createDb, type Database } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getOptionalSession, loadUserByDiscordId } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users, guides, searchCraftTemplates } from "@/lib/schema";
import { eq, ne, and, sql, desc, inArray } from "drizzle-orm";
import { resolvePlayerSlugFallback } from "@/lib/player-slug-fallback.server";
import { resolveEmbedUsers } from "@/lib/guide-embed-users.server";
import { publiclyReferencableCondition } from "@/lib/users-filter";
import { sanitizeGuideHtml } from "@/lib/guide-sanitize.server";
import { parseGuideTags } from "@/lib/guide-tags";
import { getGuideLikeCount, guideLikeCountSql } from "@/lib/likes.server";
import { LikeButton } from "@/components/like-button";
import { ShareButton } from "@/components/share-button";
import { GuideRouteNotFound } from "@/components/guide-route-not-found";
import { useT, useLocale } from "@/hooks/use-locale";
import { getLocalizedDisplayName, pickDisplayName } from "@/lib/slug";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageSection, SectionHeaderLink } from "@/components/page-section";
import { ArrowLeft, Pencil } from "lucide-react";
import { GUIDE_TAG_HIT_AREA, GuideCardGrid, type GuideItem } from "@/components/guide-list-views";
import { format } from "date-fns";
import { dateFnsLocale, dateFormatPattern } from "@/lib/date-locale";
import { useEffect, useMemo, useRef } from "react";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import { buildTableOfContents } from "@/lib/guide-toc";
import { mergeEmbedGroupsIntoToc } from "@/lib/guide-embed-toc";
import { demoteGuideHeadings } from "@/lib/guide-heading-demote";
import { blankGenericImageAlt } from "@/lib/guide-image-alt";
import { GuideTocSidebar, GuideTocMobile } from "@/components/guide-toc-nav";
import { isGuideTableOverflowing, normalizeGuideTables } from "@/lib/guide-tables";
import {
  annotateGuideCallouts,
  leadingHeadingMatchesTitle,
  normalizeGuideIframes,
  removeLeadingHeading,
  titleGuideYouTubeIframes,
} from "@/lib/guide-view-html";
import { YouTubeClickEmbed } from "@/components/youtube-click-embed";
import { NoticeBanner } from "@/components/notice-banner";
import {
  extractEmbedRefs,
  extractTemplateEmbedIds,
  getUniqueEmbedSlugs,
  splitContentAtEmbeds,
  embedGroupHeadingLevels,
  embedOrdinals,
  embedTocSegments,
  EmbedUnavailable,
  KeybindEmbedView,
  SearchCraftEmbedView,
  SearchCraftTemplateEmbedView,
  type EmbedUserData,
  type EmbedTemplateData,
} from "@/components/guide-embeds";
import { collectPresetNames } from "@/lib/guide-embed-attrs";
import { readListPathState, readListSearchState } from "@/lib/list-back-state";

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
  // meta / OGP は常に原文（クローラーには日本語。docs/translation.md「SEO」）。本文表示が訳文でも変えない
  const title = `${loaderData.guide.metaTitle} - Minefolio`;
  const description = loaderData.guide.metaSummary || t("guideView.metaDescription", { name: pickDisplayName(loaderData.author, locale) || loaderData.author.mcid || "" });
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

/**
 * 本文のテンプレート埋め込み（data-template-id）を1クエリで解決する（N+1 にしない）。
 * 公開済みで、作者が非公開（private）プロフィールでないものだけ返す（テンプレート詳細ページと同じ規則）。
 * 該当しない ID はキーごと無い＝描画側で「表示できません」。クライアントへは表示に使う項目だけ渡す。
 */
async function resolveEmbedTemplates(
  db: Database,
  templateIds: string[],
  locale: ReturnType<typeof resolveLocale>,
): Promise<Record<string, EmbedTemplateData>> {
  const result: Record<string, EmbedTemplateData> = {};
  if (templateIds.length === 0) return result;
  const rows = await db
    .select({
      id: searchCraftTemplates.id,
      title: searchCraftTemplates.title,
      gameLanguage: searchCraftTemplates.gameLanguage,
      craftsData: searchCraftTemplates.craftsData,
      remapsData: searchCraftTemplates.remapsData,
      loopsData: searchCraftTemplates.loopsData,
      authorSlug: users.slug,
      authorDisplayName: users.displayName,
      authorDisplayNameAlphabet: users.displayNameAlphabet,
      authorMcid: users.mcid,
      authorUuid: users.uuid,
      authorCustomSkinUrl: users.customSkinUrl,
    })
    .from(searchCraftTemplates)
    .innerJoin(users, eq(searchCraftTemplates.userId, users.id))
    .where(
      and(
        inArray(searchCraftTemplates.id, templateIds),
        eq(searchCraftTemplates.isPublished, true),
        publiclyReferencableCondition,
      ),
    );
  for (const row of rows) {
    result[row.id] = {
      id: row.id,
      title: row.title,
      gameLanguage: row.gameLanguage,
      craftsData: row.craftsData,
      remapsData: row.remapsData,
      loopsData: row.loopsData,
      authorSlug: row.authorSlug,
      authorUuid: row.authorUuid,
      authorSkinUrl: row.authorCustomSkinUrl,
      authorName: getLocalizedDisplayName(
        {
          displayName: row.authorDisplayName,
          displayNameAlphabet: row.authorDisplayNameAlphabet,
          mcid: row.authorMcid,
          slug: row.authorSlug,
        },
        locale,
      ),
    };
  }
  return result;
}


export async function loader({ request, params }: LoaderFunctionArgs) {
  const env = getEnv();
  const db = createDb();
  const auth = createAuth(db, env);

  const { authorSlug, guideSlug } = params as {
    authorSlug: string;
    guideSlug: string;
  };

  const url = new URL(request.url);
  const locale = resolveLocale(request);

  // セッション解決（→ isOwner 判定用の currentUser 取得へ連鎖）と著者取得は互いに独立なので並行する
  const [currentUser, author] = await Promise.all([
    getOptionalSession(request, auth).then((session) =>
      session?.user?.id
        ? loadUserByDiscordId(request, db, session.user.id)
        : null
    ),
    db.query.users.findFirst({
      // slug の大文字小文字を区別せず一致させる（/player/:slug と同じポリシー）
      where: sql`lower(${users.slug}) = ${authorSlug.toLowerCase()}`,
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
    }),
  ]);

  if (!author) {
    // MCID変更等でslugが変わった旧URLを、slug_history → Mojang API の順で救済する
    // （publicly referencable なユーザーのみ。private は漏らさない）
    const target = await resolvePlayerSlugFallback(db, authorSlug);
    if (target) {
      throw redirect(
        `/guides/${encodeURIComponent(target)}/${encodeURIComponent(guideSlug)}${url.search}`
      );
    }
    throw new Response("Not Found", { status: 404 });
  }

  // 著者本人なら ?draft=1 でドラフト（下書き保存）内容をプレビューできる
  const wantDraft = url.searchParams.get("draft") === "1";
  const isOwner = currentUser?.id === author.id;

  // プライベートプロフィールの著者のガイドは本人以外に404を返す（プロフィール本体と挙動を揃える）
  if (author.profileVisibility === "private" && !isOwner) {
    throw new Response("Not Found", { status: 404 });
  }

  const draftPreview = wantDraft && isOwner;

  const guideConditions = [eq(guides.authorId, author.id), eq(guides.slug, guideSlug)];
  // ドラフトプレビュー時は未公開でも取得可。それ以外は公開済みのみ。
  if (!draftPreview) guideConditions.push(eq(guides.isPublished, true));

  // 公開閲覧では draft 系の列（下書き本文など）を読まない。所有者のドラフトプレビュー時だけ取得する。
  // （`as true` は型を draft 列ありに揃えるための断り。draftPreview が false のとき draft* は
  //  実行時に undefined だが、下の previewingDraft が draftPreview && で守っているので読まれない）
  const guide = await db.query.guides.findFirst({
    where: and(...guideConditions),
    columns: {
      id: true,
      slug: true,
      title: true,
      summary: true,
      content: true,
      coverImageUrl: true,
      tags: true,
      viewCount: true,
      updatedAt: true,
      isPublished: true,
      allowAutoTranslation: true,
      draftUpdatedAt: draftPreview as true,
      draftTitle: draftPreview as true,
      draftSummary: draftPreview as true,
      draftCoverImageUrl: draftPreview as true,
      draftTags: draftPreview as true,
      draftContent: draftPreview as true,
    },
  });

  if (!guide) {
    // 著者は実在し本人以外にも見える（private はここへ来ない）ので、404 の画面から著者のガイド一覧へ案内できるよう slug を載せる
    // 表示名も載せ、補助リンクを「{名前}のガイド」にできるようにする（選び方は他の著者表示と同じ getLocalizedDisplayName）
    throw data(
      { authorSlug: author.slug, authorName: getLocalizedDisplayName(author, locale) },
      { status: 404 },
    );
  }

  // ドラフトが存在し、プレビュー指定時はドラフト各値を採用
  const previewingDraft = draftPreview && guide.draftUpdatedAt !== null;
  // 著者本人が非公開のガイドを見ている（非公開を見せる経路はドラフトプレビューだけ。?draft=1 なしは上の条件で 404）
  const unpublished = !guide.isPublished;
  const viewTitle = previewingDraft ? guide.draftTitle ?? guide.title : guide.title;
  const viewSummary = previewingDraft ? guide.draftSummary : guide.summary;
  const viewCover = previewingDraft ? guide.draftCoverImageUrl : guide.coverImageUrl;
  const viewTags = previewingDraft ? guide.draftTags ?? guide.tags : guide.tags;
  const viewContent = previewingDraft ? guide.draftContent ?? guide.content : guide.content;

  // 自動翻訳（docs/translation.md）。公開版の閲覧のみ対象（ドラフトプレビューは翻訳しない）。
  // 訳文が使えない（機能無効・opt-out・失効・未公開・原文と閲覧ロケールが同じ）ときは null で原文。
  // ?original=1 は原文への切替（SSR で切り替えるので共有・再読み込みでも状態が保てる）。
  // 切替リンクを出すため、original 指定でも訳文の有無は引く
  // いいね数（guide.id にのみ依存）は翻訳取得と独立なので並行する
  // 末尾の「ほかのガイド」用に、同じ著者の公開済みガイドを最大3件（このガイドは除く。下書き・非公開は含めない）
  const [translation, likeCount, otherGuides] = await Promise.all([
    draftPreview ? null : getGuideTranslation(db, guide, locale),
    getGuideLikeCount(db, guide.id),
    db.query.guides
      .findMany({
        where: and(
          eq(guides.authorId, author.id),
          eq(guides.isPublished, true),
          ne(guides.id, guide.id)
        ),
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
        orderBy: [desc(guides.updatedAt)],
        limit: 3,
      })
      // 「ほかのガイド」のカードも一覧と同じく、自動翻訳の訳文があれば title / summary を差し替える
      // （0 件なら訳文を引かない。上の取得と並行して進む）
      .then(async (rows) => {
        if (rows.length === 0) return rows;
        const translations = await getGuideTranslations(db, rows.map((g) => g.id), locale);
        return rows.map((g) => applyGuideTranslation(g, translations));
      }),
  ]);
  const showOriginal = url.searchParams.get("original") === "1";
  const translated = translation !== null && !showOriginal ? translation : null;
  const displayTitle = translated?.title ?? viewTitle;
  const displaySummary = translated?.summary ?? viewSummary;
  const displayContent = translated?.content ?? viewContent;

  // 閲覧数はここでは数えない（?original=1 の切替で loader が再実行されて水増しされるため）。
  // ページ表示時にクライアントから /api/guides/view-count へ1回だけ送る（GuideViewPage 参照）。

  // Sanitize HTML on the server（許可タグ・属性等は guide-sanitize.server.ts 参照）
  const sanitizedContent = sanitizeGuideHtml(displayContent);

  // 本文の最初のブロックがタイトルと同じ文の見出しなら、表示しない（目次からも外す）。旧仕様の新規作成が本文を
  // `<h1>タイトル</h1>` で始めていたため、ページのタイトルの h1 の直後に同じ文が重なって見える。保存データ・エディタは変えない。
  // 訳文では、タイトルと本文の見出しが別々の文として訳されて食い違うことがあるので、原文の組で一致していれば
  // 訳文の先頭の見出し（同じ見出しの訳）も外す。訳文の組そのものが一致する場合も外す
  const stripTitleHeading =
    leadingHeadingMatchesTitle(sanitizedContent, displayTitle) ||
    (translated !== null &&
      leadingHeadingMatchesTitle(sanitizeGuideHtml(viewContent), viewTitle));
  const bodyContent = stripTitleHeading ? removeLeadingHeading(sanitizedContent) : sanitizedContent;

  // 列幅未指定の列が潰れないよう表の min-width を再計算する（guide-tables.ts 参照）
  const normalizedContent = normalizeGuideTables(bodyContent);

  // Wrap <table> in a scrollable container so wide tables scroll on mobile
  const wrappedContent = normalizedContent.replace(
    /<table(\s|>)/g,
    '<div class="table-scroll-wrapper"><table$1'
  ).replace(/<\/table>/g, '</table></div>');

  // 見出し(h1〜h3)に id を付与し、目次データを生成する
  // 目次は元のレベルで抽出し、その後に本文見出しを1段下げる（ページタイトルが h1 のため。guide-heading-demote.ts）
  const { html: tocHtml, toc } = buildTableOfContents(wrappedContent);
  // コールアウトに role="note" と種類名の aria-label を付け（アイコンは装飾なので種類を読み上げで伝える）、
  // YouTube の iframe に番号付きの title を付ける（どちらもサニタイズで落ちる属性なので後段で足す。guide-view-html.ts）
  const tView = createTranslator(locale);
  const calloutLabels: Record<string, string> = {
    tip: tView("guideEditor.callout.tip"),
    info: tView("guideEditor.callout.info"),
    warning: tView("guideEditor.callout.warning"),
    danger: tView("guideEditor.callout.danger"),
  };
  // 包まれていない YouTube の iframe も埋め込みの形に揃え（押してから読み込む表示にするため）、src の無い iframe は外す
  const contentWithIds = titleGuideYouTubeIframes(
    normalizeGuideIframes(
      annotateGuideCallouts(
        blankGenericImageAlt(demoteGuideHeadings(tocHtml)),
        (type) => calloutLabels[type] ?? null,
      ),
    ),
    (n) => tView("guideView.youtubeTitle", { n }),
  );

  // Extract embed references and fetch user data
  const embedRefs = extractEmbedRefs(contentWithIds);
  const embedSlugs = getUniqueEmbedSlugs(embedRefs);
  const appUrl = env.APP_URL || "https://minefolio.app";
  // 埋め込みが data-preset-name で参照しているプリセット名（クライアントへ送るプリセットの絞り込み用）。
  // extractEmbedRefs の正規表現には取りこぼし得る形があるため、属性値を本文全体から集める（上位集合）
  // 属性値は js-xss で HTML エスケープされているため、デコードして DB のプリセット名と比べる
  const presetNames = collectPresetNames(contentWithIds);
  const [embedUsers, embedTemplates] = await Promise.all([
    resolveEmbedUsers(db, embedSlugs, presetNames),
    resolveEmbedTemplates(db, extractTemplateEmbedIds(contentWithIds), locale),
  ]);
  // 目次に、サーチクラフト埋め込み（ユーザー参照・テンプレート）のグループ見出し（OW・Bastion 等）を文書順で差し込む。
  // 埋め込みの中身は HTML に無く、解決したデータから描くので、ここ（埋め込みの解決後）で合流させる（lib/guide-embed-toc.ts）
  // 解決できた埋め込みが無ければ（見出しが増えないので）本文の分割も目次の合流も省く
  const hasResolvedEmbeds = Object.keys(embedUsers).length > 0 || Object.keys(embedTemplates).length > 0;
  const tocWithEmbeds = hasResolvedEmbeds
    ? mergeEmbedGroupsIntoToc(
        embedTocSegments(splitContentAtEmbeds(contentWithIds), embedUsers, embedTemplates, tView, locale),
        toc,
      )
    : toc;
  return {
    // クライアントが使うフィールドのみ渡す。行をそのまま展開すると、著者の
    // 未公開ドラフト（draftTitle / draftContent 等）とサニタイズ前の生 content が
    // 全閲覧者のSSRペイロードに載ってしまう（埋め込みユーザーと同じ方針）。
    guide: {
      id: guide.id,
      slug: guide.slug,
      title: displayTitle,
      summary: displaySummary,
      // meta / OGP 用の原文（本文が訳文でも常に原文）
      metaTitle: viewTitle,
      metaSummary: viewSummary,
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
    otherGuides,
    appUrl,
    embedUsers,
    embedTemplates,
    isOwner,
    previewingDraft,
    unpublished,
    toc: tocWithEmbeds,
    // 訳文が存在するとき（原文表示中も含む）だけ非 null。バナーの文言と切替リンクに使う
    autoTranslation: translation
      ? { sourceLocale: translation.sourceLocale, showingOriginal: showOriginal }
      : null,
  };
}


/** 閲覧数を送信済みのガイド id（このページの寿命の間だけ。リロードで消える） */
const countedGuideIds = new Set<string>();

export default function GuideViewPage() {
  const t = useT();
  const locale = useLocale();
  const { guide, author, appUrl, otherGuides, embedUsers, embedTemplates, isOwner, previewingDraft, unpublished, toc, autoTranslation } = useLoaderData<typeof loader>();
  // シェアは公開 URL を渡すので、読者に見えない状態（下書きのプレビュー・非公開）では出さない。
  // いいねは非公開の記事では意味が無い（読者が居ない）ので出さない。公開済みガイドの下書きのプレビューでは従来どおり出す
  const showShare = !previewingDraft && !unpublished;
  const showLike = !unpublished;
  const [searchParams] = useSearchParams();
  // 一覧から来たときは、一覧の絞り込み（?tag= など）へ戻る。直接開いたときは素の /guides
  const location = useLocation();
  const guideListSearch = readListSearchState(location.state, "guideListSearch");
  // 著者のガイド一覧（/guides/:author）から来たときは、全体の一覧ではなくその著者の一覧へ戻る。
  // 戻り先はこの記事の著者のパスだけを許す（state は履歴に残る任意の値なので、任意のパスへは飛ばさない。
  // URL の slug は大文字小文字を区別しないので、比べるときだけ小文字にそろえる）
  const authorListBack = readListPathState(location.state, "guideListPath", `/guides/${author.slug}`);
  // 原文/訳文の切替は ?original=1 の有無（ローダーが SSR で出し分ける）
  const translationToggleSearch = (() => {
    const next = new URLSearchParams(searchParams);
    if (autoTranslation?.showingOriginal) next.delete("original");
    else next.set("original", "1");
    const s = next.toString();
    return s ? `?${s}` : "";
  })();
  const tags = parseGuideTags(guide.tags);
  const authorName = getLocalizedDisplayName(author, locale);
  const contentRef = useRef<HTMLDivElement>(null);

  // 1回のページ訪問につき1回だけ閲覧数を加算する。コンポーネントは search param（?original=1 等）の
  // 変更では再マウントされず guide.id も変わらないため、切替では再送されない。ドラフトプレビューは数えない。
  // 送信済みの guide.id はモジュールのメモリ（countedGuideIds）に覚える。StrictMode の effect 二重実行と、
  // SPA 遷移で同じページへ戻ってきたとき（ページの寿命の間）の再送を抑える。ブラウザのストレージは使わない。
  const guideId = guide.id;
  useEffect(() => {
    if (previewingDraft || countedGuideIds.has(guideId)) return;
    countedGuideIds.add(guideId);
    fetch("/api/guides/view-count", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guideId }),
      keepalive: true,
    }).catch(() => {});
  }, [guideId, previewingDraft]);

  // モバイルの左右パディングは main（_layout.tsx）側の px-4 と二重にならないよう、
  // article 側は 0 にする（sm 以上は main と article の両方で加算する既存の見た目を維持）。
  // GuideTocMobile 側の -mx-* もこの調整に合わせている（guide-toc-nav.tsx 参照）。
  return (
    // xl〜2xl 未満で本文を右へ寄せるのは、サイドバーの目次を出すとき（見出し 2 つ以上。GuideTocSidebar と同じ条件）だけ
    <article
      className={`relative w-full max-w-5xl mx-auto px-0 sm:px-6 lg:px-8${
        toc.length >= 2 ? " xl:max-w-[74rem] xl:pl-60 2xl:max-w-5xl 2xl:pl-8" : ""
      }`}
    >
      {/* デスクトップ目次: 本文幅は削らず、中央寄せ本文の左余白（ガター）に固定表示する。
          2xl ではガター幅が w-56 と一致し、right-full（右端＝本文パディング左端）と
          合わせて左端がコンテナ左端（ヘッダーのロゴ始点）になる。xl〜2xl 未満はガターが狭いので、
          本文を右へ寄せて（xl:pl-60）その左の余白（w-52）にサイドバーを置く。xl 未満は上部バー + ドロワーを使う。 */}
      <div className="hidden xl:block absolute inset-y-0 left-0 w-52 2xl:left-auto 2xl:right-full 2xl:w-56">
        <GuideTocSidebar key={guide.id} items={toc} />
      </div>

      {/* 非公開のときは非公開の帯を優先する（下書きが残っている非公開ガイドでも「公開中の内容とは…」は当てはまらない） */}
      {(unpublished || previewingDraft) && (
        <NoticeBanner tone="warning" className="mb-4 px-3 py-2">
          {unpublished ? t("guideView.unpublishedPreviewNotice") : t("guideView.draftPreviewNotice")}
        </NoticeBanner>
      )}
      {/* Back button + Owner edit button */}
      <div className="mb-6 flex items-center justify-between">
        <Button variant="ghost" size="sm" asChild className="-ml-2 h-11 sm:h-8">
          <Link to={authorListBack ?? `/guides${guideListSearch}`}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            {authorListBack
              ? t("guides.userGuidesTitle", { name: getLocalizedDisplayName(author, locale) })
              : t("guides.guideList")}
          </Link>
        </Button>
        {isOwner && (
          <Button variant="outline" size="sm" asChild className="h-11 sm:h-8">
            <Link to={`/my-guides/${guide.slug}/edit`}>
              <Pencil className="h-4 w-4 mr-1" />
              {t("guideEditor.edit")}
            </Link>
          </Button>
        )}
      </div>

      {/* Title + summary */}
      <div className="mb-4">
        <h1 className="text-3xl sm:text-4xl font-bold leading-tight tracking-tight mb-3">
          {guide.title}
        </h1>
        {guide.summary && (
          <p className="text-lg text-muted-foreground leading-relaxed">
            {guide.summary}
          </p>
        )}
      </div>

      {/* 筆者の行（走者。名前＋@MCID、いいね・シェア、更新日・閲覧数）。メタ行の罫線は廃止してここへ統合。
          いいね・シェアは1行目の右端（名前が折り返しても右端に残る）。モバイルはアイコン＋件数だけ */}
      <div className="mb-4">
        {/* 1行目は折り返さない（折り返すと、いいね・シェアだけの行ができて本文が下がる）。
            長い名前は省略し、狭い画面では @MCID を2行目へ回す */}
        <div className="flex items-center gap-x-2.5">
          <Link
            to={`/player/${author.slug}`}
            className="group flex min-h-11 min-w-0 items-center gap-2.5 sm:min-h-9"
          >
            <MinecraftAvatar
              uuid={author.uuid ?? undefined}
              skinUrl={author.customSkinUrl}
              size={36}
              alt=""
              className="shrink-0 rounded-lg"
            />
            <span className="truncate font-medium transition-colors group-hover:text-primary">{authorName}</span>
          </Link>
          {author.mcid && (
            <span className="hidden min-w-0 truncate text-sm text-muted-foreground sm:inline">@{author.mcid}</span>
          )}
          {(showLike || showShare) && (
            <div className="ml-auto flex shrink-0 items-center gap-2">
              {showLike && (
                <LikeButton
                  variant="detail"
                  targetType="guide"
                  targetId={guide.id}
                  likeCount={guide.likeCount}
                  isOwn={isOwner}
                  compactLabel
                  className="h-11 max-sm:min-w-11 sm:h-8"
                />
              )}
              {showShare && (
                <ShareButton
                  title={`${guide.title} | Minefolio`}
                  url={`${appUrl}/guides/${author.slug}/${guide.slug}`}
                  compactOnMobile
                  compactBelow="sm"
                  className="h-11 max-sm:min-w-11 sm:h-8"
                />
              )}
            </div>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
          {author.mcid && <span className="sm:hidden">@{author.mcid}</span>}
          <span>
            {t("guideView.updatedOn", {
              date: format(guide.updatedAt, dateFormatPattern(locale), { locale: dateFnsLocale(locale) }),
            })}
          </span>
          <span className="tabular-nums">
            {t("guideView.viewCount", { count: guide.viewCount.toLocaleString(locale) })}
          </span>
        </div>
      </div>

      {/* Tags（クリックで /guides?tag= の絞り込みへ） */}
      {tags.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-x-2 gap-y-3 sm:gap-y-2">
          {tags.map((tag) => (
            <Badge
              key={tag}
              variant="secondary"
              asChild
              className={GUIDE_TAG_HIT_AREA.sm}
            >
              <Link to={`/guides?tag=${encodeURIComponent(tag)}`}>{tag}</Link>
            </Badge>
          ))}
        </div>
      )}

      {/* 自動翻訳の注記と原文切替（自動翻訳を著者の言葉として黙って出さない。docs/translation.md） */}
      {autoTranslation && (
        <AutoTranslateNotice
          showOriginal={autoTranslation.showingOriginal}
          to={{ search: translationToggleSearch }}
          className="mb-4"
        />
      )}

      {/* Cover image（装飾扱い: 隣の h1 と同文の重複読み上げを避けて alt=""。ファーストビュー近くなので eager） */}
      {guide.coverImageUrl && (
        <img
          src={guide.coverImageUrl}
          alt=""
          className="mb-6 aspect-2/1 w-full rounded-xl object-cover sm:aspect-auto sm:h-[min(40vh,320px)]"
        />
      )}

      {/* 目次（xl 未満: 上部固定バー + 左ドロワー）。
          xl:hidden と sticky はコンポーネント側のバー本体に付く（ラッパーで包むと
          sticky の可動域が無くなるため、ここでは素で描画する） */}
      <GuideTocMobile key={guide.id} items={toc} />

      {/* Content */}
      <GuideContent
        contentRef={contentRef}
        html={guide.sanitizedContent}
        embedUsers={embedUsers}
        embedTemplates={embedTemplates}
      />

      {/* 読み終えた地点のいいね・シェア（上の筆者行と同じ部品。欄にも箱にもしない）。
          出し分けは上の筆者行と同じ（showLike / showShare）。両方出ない非公開のときは行ごと出さない */}
      {(showLike || showShare) && (
        <div className="mt-10 flex flex-wrap items-center gap-2">
          {showLike && (
            <LikeButton
              variant="detail"
              targetType="guide"
              targetId={guide.id}
              likeCount={guide.likeCount}
              isOwn={isOwner}
              className="h-11 sm:h-8"
            />
          )}
          {showShare && (
            <ShareButton
              title={`${guide.title} | Minefolio`}
              url={`${appUrl}/guides/${author.slug}/${guide.slug}`}
              className="h-11 sm:h-8"
            />
          )}
        </div>
      )}

      {/* 末尾: この走者のほかのガイド（0件なら筆者とプロフィールへのリンクだけ）。
          0件でも欄（h2）は残して筆者への導線を置き、見出しだけ中身に合わせて「筆者」にする */}
      <PageSection
        id="guide-more-by-author"
        title={otherGuides.length > 0 ? t("guideView.moreFromAuthor") : t("guideView.aboutAuthor")}
        className="mt-12"
        action={
          otherGuides.length > 0 ? (
            <SectionHeaderLink to={`/guides/${author.slug}`} label={t("guideView.allGuidesByAuthor")} />
          ) : undefined
        }
      >
        {/* 主は筆者（顔と名前。走者画面へ）。ガイドページへのリンクは同じ行の右に添える副の導線にする */}
        <div className="flex flex-wrap items-center justify-between gap-x-4">
          <Link
            to={`/player/${author.slug}`}
            className="group flex min-h-11 items-center gap-2.5"
          >
            <MinecraftAvatar
              uuid={author.uuid ?? undefined}
              skinUrl={author.customSkinUrl}
              size={36}
              alt=""
              className="shrink-0 rounded-lg"
            />
            <span className="min-w-0">
              <span className="block truncate font-medium transition-colors group-hover:text-primary">
                {authorName}
              </span>
              {author.mcid && (
                <span className="block truncate text-sm text-muted-foreground">@{author.mcid}</span>
              )}
            </span>
          </Link>
          {otherGuides.length === 0 && (
            // ほかのガイドが無くても、筆者のガイドページ（作者のテンプレートへの導線もそこにある）へ行けるようにする
            <Link
              to={`/guides/${author.slug}`}
              className="flex min-h-11 items-center text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              {t("guideView.authorGuidesPage")}
            </Link>
          )}
        </div>
        {otherGuides.length > 0 && (
          <GuideCardGrid
            guides={otherGuides.map((g): GuideItem => ({ ...g, isOwn: isOwner }))}
            linkFn={(g) => `/guides/${author.slug}/${g.slug}`}
            surface="card"
          />
        )}
      </PageSection>
    </article>
  );
}

// コンテンツ描画（embed部分をReactコンポーネントに分離）
function GuideContent({
  contentRef,
  html,
  embedUsers,
  embedTemplates,
}: {
  contentRef: React.RefObject<HTMLDivElement | null>;
  html: string;
  embedUsers: Record<string, EmbedUserData>;
  embedTemplates: Record<string, EmbedTemplateData>;
}) {
  const t = useT();
  const statusRef = useRef<HTMLSpanElement>(null);
  const { segments, headingLevels, ordinals, hasEmbeds } = useMemo(() => {
    const segments = splitContentAtEmbeds(html);
    return {
      segments,
      // 埋め込みのグループ見出しの段（直前の本文の見出しの1つ下。html は降格済みなので SSR とハイドレーションで一致する）
      headingLevels: embedGroupHeadingLevels(segments),
      // 埋め込みの通し番号（グループ見出しの id＝目次のアンカー。loader の目次と同じ番号）
      ordinals: embedOrdinals(segments),
      hasEmbeds: segments.some((s) => s.type !== "html"),
    };
  }, [html]);

  useCodeCopyButtons(contentRef, statusRef, html, t);
  useGuideTableScroll(contentRef, html, t);

  // コピー成功の読み上げ（ボタンの名前の差し替えだけでは読まれないことがあるため併用する）
  const copyStatus = <span ref={statusRef} role="status" className="sr-only" />;

  // embedが無ければ従来通り
  if (!hasEmbeds) {
    return (
      <>
        <div
          ref={contentRef}
          className="guide-content guide-content-demoted prose max-w-none"
          dangerouslySetInnerHTML={{ __html: html }}
        />
        {copyStatus}
      </>
    );
  }

  return (
    <>
      <div ref={contentRef} className="guide-content guide-content-demoted prose max-w-none">
        {segments.map((seg, i) => {
          if (seg.type === "html") {
            return <div key={i} data-guide-segment="" dangerouslySetInnerHTML={{ __html: seg.content }} />;
          }
          if (seg.type === "youtube") {
            // 本文の直下の動画は押してから読み込む（ui.md 8 章。入れ子の動画は iframe のまま。guide-embeds.tsx）
            return (
              <YouTubeClickEmbed
                key={i}
                embedUrl={seg.embedUrl}
                title={t("guideView.youtubeTitle", { n: seg.index })}
                playLabel={t("guideView.youtubePlay", { n: seg.index })}
                className="guide-youtube-embed not-prose rounded-xl"
              />
            );
          }
          if (seg.type === "sctemplate-embed") {
            return (
              <SearchCraftTemplateEmbedView
                key={i}
                template={seg.templateId ? (embedTemplates[seg.templateId] ?? null) : null}
                groupHeadingLevel={headingLevels[i] ?? undefined}
                embedIndex={ordinals[i] ?? undefined}
                showInputKeys={!seg.hideKeys}
              />
            );
          }
          const userData = embedUsers[seg.userSlug];
          if (!userData) {
            return (
              <EmbedUnavailable key={i} variant="missing">
                {t("guideView.embedUserNotFound", { slug: seg.userSlug })}
              </EmbedUnavailable>
            );
          }
          if (seg.type === "keybind-embed") {
            return <KeybindEmbedView key={i} userData={userData} presetName={seg.presetName} />;
          }
          return (
            <SearchCraftEmbedView
              key={i}
              userData={userData}
              presetName={seg.presetName}
              groupHeadingLevel={headingLevels[i] ?? undefined}
              embedIndex={ordinals[i] ?? undefined}
              showInputKeys={!seg.hideKeys}
            />
          );
        })}
      </div>
      {copyStatus}
    </>
  );
}

/**
 * コードブロックにコピーボタンを差し込む。本文は innerHTML で描くので DOM へ直接足す。
 * 原文/訳文の切替（?original=1）ではこのコンポーネントが再マウントされず innerHTML だけ差し替わるため、
 * html を依存に入れて差し込み直す。成功時はボタンの名前を「コピーしました」に替え、読み上げ用の
 * status 領域にも同じ文言を入れる。見た目（28px・タッチ端末では常に表示）は app/app.css の .code-copy-btn
 */
function useCodeCopyButtons(
  contentRef: React.RefObject<HTMLDivElement | null>,
  statusRef: React.RefObject<HTMLSpanElement | null>,
  html: string,
  t: Translator,
) {
  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    const pres = root.querySelectorAll("pre");
    const controller = new AbortController();
    const timeouts: ReturnType<typeof setTimeout>[] = [];
    const copyLabel = t("guideView.copy");
    const copiedLabel = t("guideView.copied");
    const setLabel = (btn: HTMLButtonElement, label: string) => {
      btn.title = label;
      btn.setAttribute("aria-label", label);
    };

    pres.forEach((pre) => {
      if (pre.querySelector(".code-copy-btn")) return;
      const btn = document.createElement("button");
      btn.className = "code-copy-btn";
      btn.type = "button";
      setLabel(btn, copyLabel);
      btn.innerHTML = COPY_ICON_SVG;
      let resetTimer: ReturnType<typeof setTimeout> | null = null;
      btn.addEventListener("click", () => {
        const code = pre.querySelector("code");
        const text = code?.textContent ?? pre.textContent ?? "";
        navigator.clipboard.writeText(text).then(() => {
          btn.innerHTML = CHECK_ICON_SVG;
          setLabel(btn, copiedLabel);
          const status = statusRef.current;
          if (status) {
            // 続けて押したときも読ませるため、いったん空にしてから入れる
            status.textContent = "";
            timeouts.push(setTimeout(() => { status.textContent = copiedLabel; }, 50));
          }
          if (resetTimer) clearTimeout(resetTimer);
          resetTimer = setTimeout(() => {
            btn.innerHTML = COPY_ICON_SVG;
            setLabel(btn, copyLabel);
            if (status) status.textContent = "";
          }, 1500);
          timeouts.push(resetTimer);
        });
      }, { signal: controller.signal });
      pre.style.position = "relative";
      pre.appendChild(btn);
    });

    return () => {
      controller.abort();
      timeouts.forEach((id) => clearTimeout(id));
      pres.forEach((pre) => {
        pre.querySelectorAll(".code-copy-btn").forEach((btn) => btn.remove());
      });
      if (statusRef.current) statusRef.current.textContent = "";
    };
  }, [contentRef, statusRef, html, t]);
}

/**
 * 本文の表の器（.table-scroll-wrapper。loader が表を包む）を、表がはみ出しているかで切り替える。
 * - はみ出している: 横スクロールのまま、キーボードで届くよう tabindex="0"・role="region"・aria-label を付ける
 * - 収まっている: data-fits を付ける。app/app.css が器の overflow を外し、最初の行が全部 th なら
 *   その行をページに貼り付ける（overflow のある器の中では sticky がページに効かないため）
 * 判定は表の実幅と器の幅の比較（isGuideTableOverflowing）。JS 前（SSR）は従来どおり横スクロールの器のまま。
 * 器・表の大きさが変わる（画面幅・画像の読み込み・トグルの開閉）たびに ResizeObserver で判定し直す。
 * 貼り付く位置のため、xl 未満の目次バー（GuideTocMobile、data-guide-toc-bar）の高さを
 * --guide-toc-bar-height に入れる（バーが無い・xl 以上で非表示なら 0）
 */
function useGuideTableScroll(
  contentRef: React.RefObject<HTMLDivElement | null>,
  html: string,
  t: Translator,
) {
  useEffect(() => {
    const root = contentRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const wrappers = Array.from(root.querySelectorAll<HTMLElement>(".table-scroll-wrapper"));
    if (wrappers.length === 0) return;
    const label = t("guideView.tableScrollRegion");

    const update = (wrapper: HTMLElement) => {
      const table = wrapper.querySelector("table");
      if (!table) return;
      if (isGuideTableOverflowing(table.getBoundingClientRect().width, wrapper.clientWidth)) {
        delete wrapper.dataset.fits;
        wrapper.tabIndex = 0;
        wrapper.setAttribute("role", "region");
        wrapper.setAttribute("aria-label", label);
      } else {
        wrapper.dataset.fits = "";
        wrapper.removeAttribute("tabindex");
        wrapper.removeAttribute("role");
        wrapper.removeAttribute("aria-label");
      }
    };

    const tocBar = document.querySelector<HTMLElement>("[data-guide-toc-bar]");
    const updateTocBar = () => {
      root.style.setProperty("--guide-toc-bar-height", `${tocBar?.offsetHeight ?? 0}px`);
    };

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === tocBar) {
          updateTocBar();
          continue;
        }
        const wrapper = (entry.target as HTMLElement).closest<HTMLElement>(".table-scroll-wrapper");
        if (wrapper) update(wrapper);
      }
    });
    updateTocBar();
    if (tocBar) observer.observe(tocBar);
    for (const wrapper of wrappers) {
      update(wrapper);
      observer.observe(wrapper);
      const table = wrapper.querySelector("table");
      if (table) observer.observe(table);
    }

    return () => {
      observer.disconnect();
      root.style.removeProperty("--guide-toc-bar-height");
      for (const wrapper of wrappers) {
        delete wrapper.dataset.fits;
        wrapper.removeAttribute("tabindex");
        wrapper.removeAttribute("role");
        wrapper.removeAttribute("aria-label");
      }
    };
  }, [contentRef, html, t]);
}

export function ErrorBoundary() {
  const t = useT();
  const error = useRouteError();
  // 著者が実在するとき（loader が 404 の data に slug と表示名を載せる）は、その走者のガイド一覧へも案内する
  const authorData =
    isRouteErrorResponse(error) &&
    error.status === 404 &&
    typeof error.data === "object" &&
    error.data !== null &&
    typeof (error.data as { authorSlug?: unknown }).authorSlug === "string"
      ? (error.data as { authorSlug: string; authorName?: unknown })
      : null;
  const authorSlug = authorData?.authorSlug ?? null;
  const authorName = typeof authorData?.authorName === "string" ? authorData.authorName : authorSlug;
  return (
    <GuideRouteNotFound
      title={t("guides.notFoundGuide")}
      description={t("guides.notFoundHint")}
      backTo="/guides"
      backLabel={t("guides.guideList")}
      secondaryTo={authorSlug ? `/guides/${encodeURIComponent(authorSlug)}` : undefined}
      secondaryLabel={authorSlug ? t("guides.userGuidesTitle", { name: authorName ?? "" }) : undefined}
      showFindRunner={!authorSlug}
    />
  );
}
