import { Link } from "react-router";
import { useT } from "@/hooks/use-locale";
import { parseGuideTags } from "@/lib/guide-tags";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Eye, Languages, Pin } from "lucide-react";
import { LikeButton } from "@/components/like-button";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import { PageViews7dMeta } from "@/components/page-views-meta";
import { RelativeTime } from "@/components/relative-time";

export type GuideItem = {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  tags: string;
  coverImageUrl: string | null;
  viewCount: number;
  /** いいね数。必須にして各ローダーの取得漏れを型検査で捕まえる */
  likeCount: number;
  /**
   * 直近7日のページビュー（page_view_stats）。人気順で並べたときの根拠数値。
   * 任意（渡した一覧だけが表示する）。他の一覧では集計クエリを走らせないため未指定。
   */
  pageViews7d?: number;
  updatedAt: string | Date;
  /** Per-guide author display name (for multi-author listings) */
  authorName?: string;
  /**
   * 著者の顔（MinecraftAvatar に渡すスキン情報）。渡した一覧だけが著者名の左にアバターを出す。
   * 未指定の呼び出し元（走者画面のガイドタブなど著者が全部同じ一覧）は従来どおり文字だけ
   */
  authorAvatar?: { uuid: string | null; skinUrl: string | null };
  /** プロフィールのガイドタブでのピン留め（先頭に並べ、タイトルにピンを付ける） */
  isPinned?: boolean;
  /** 閲覧者自身のガイドか（自分のガイドにはいいねできない） */
  isOwn?: boolean;
  /** title / summary が自動翻訳の訳文に差し替え済みか（applyGuideTranslation）。マーカーを出す */
  autoTranslated?: boolean;
};

/** 自動翻訳マーカー（アイコン＋ツールチップ）。オーバーレイリンクより手前（z-10）で hover を受ける */
function AutoTranslatedMark() {
  const t = useT();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="relative z-10 inline-flex shrink-0 items-center text-muted-foreground"
          aria-label={t("guides.autoTranslatedMark")}
        >
          <Languages className="h-3 w-3" aria-hidden />
        </span>
      </TooltipTrigger>
      <TooltipContent>{t("guides.autoTranslatedMark")}</TooltipContent>
    </Tooltip>
  );
}

/** 著者名（任意で左に 20px の顔）。名前が隣にあるので顔は alt=""、20px は rounded-md（ui.md 6 章） */
function GuideAuthorMeta({ guide, className }: { guide: GuideItem; className?: string }) {
  if (!guide.authorName) return null;
  return (
    <span className={cn("flex min-w-0 items-center gap-1.5", className)}>
      {guide.authorAvatar && (
        <MinecraftAvatar
          uuid={guide.authorAvatar.uuid}
          skinUrl={guide.authorAvatar.skinUrl}
          size={20}
          alt=""
          className="shrink-0 rounded-md"
        />
      )}
      <span className="truncate">{guide.authorName}</span>
    </span>
  );
}

/** 累計閲覧数。アイコンは飾り（aria-hidden）、数字は sr-only の「閲覧 N」で意味を付ける（見た目は数字のまま） */
function ViewCountMeta({ count, className }: { count: number; className?: string }) {
  const t = useT();
  return (
    <span className={cn("flex items-center gap-1", className)}>
      <Eye className="h-3 w-3" aria-hidden />
      <span aria-hidden>{count}</span>
      <span className="sr-only">{t("guideView.viewCount", { count })}</span>
    </span>
  );
}

/**
 * タイトルのリンクをカード全体へ広げるクラス（ui.md 9 章「オーバーレイリンク」の after 方式）。
 * 外枠が `group relative` で、::after がその外枠いっぱいに広がる。フォーカスリングは ::after に出す
 */
const OVERLAY_LINK_BASE =
  "outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-ring";
const OVERLAY_LINK_CLASS_CARD = `${OVERLAY_LINK_BASE} after:rounded-xl`;
const OVERLAY_LINK_CLASS_LIST = `${OVERLAY_LINK_BASE} after:rounded`;

/**
 * タグのリンク（Badge asChild）の押せる範囲を、見た目（22px のピル）を変えずに ::after で広げるクラス。
 * 狭い画面は 44px 四方以上（高さ 44px・幅は文字幅か 44px の大きいほう）、`sm` / `md` 以上は 24px 以上。
 * ::after は padding box 基準なので、border の 1px ぶんを inset で数えずに h / w で寸法を指定している。
 * 呼び出し側の折り返し方に合わせ、中身が 2 行以上に折り返す幅（記事は sm、一覧は md）を選ぶ。
 */
export const GUIDE_TAG_HIT_AREA = {
  sm: "relative overflow-visible after:absolute after:left-1/2 after:top-1/2 after:h-11 after:w-full after:min-w-11 after:-translate-x-1/2 after:-translate-y-1/2 after:content-[''] sm:after:h-6 sm:after:min-w-6",
  md: "relative overflow-visible after:absolute after:left-1/2 after:top-1/2 after:h-11 after:w-full after:min-w-11 after:-translate-x-1/2 after:-translate-y-1/2 after:content-[''] md:after:h-6 md:after:min-w-6",
} as const;

/**
 * カードの絞り込みタグ（最大3個）。記事内のタグ・一覧のタグチップと同じ `/guides?tag=` へのリンク。
 * カード全面のオーバーレイリンクより手前（z-10）に出す（いいねボタンと同じ扱い。ui.md 9 章）。
 * 押せる範囲は GUIDE_TAG_HIT_AREA で見た目（22px のピル）を変えずに広げる。
 * `tagHref` は /guides の一覧が検索語・並び順を引き継ぐために渡す（既定は tag だけの `/guides?tag=`）
 */
function GuideCardTags({
  tags,
  tagHref,
  className,
}: {
  tags: string[];
  tagHref?: (tag: string) => string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {tags.slice(0, 3).map((tag) => (
        <Badge
          key={tag}
          asChild
          variant="secondary"
          className={cn(GUIDE_TAG_HIT_AREA.sm, "z-10 rounded-full px-2 py-0.5 text-[11px]")}
        >
          <Link to={tagHref ? tagHref(tag) : `/guides?tag=${encodeURIComponent(tag)}`}>{tag}</Link>
        </Badge>
      ))}
    </div>
  );
}

/** guides/index・home が内部リンク生成に使う拡張（著者スラッグ付き） */
export type GuideItemWithAuthorSlug = GuideItem & { _authorSlug: string };

/** Card grid view */
export function GuideCardGrid({
  guides,
  linkFn,
  gridCols = "sm:grid-cols-2 lg:grid-cols-3",
  pageViewsMode = "additional",
  surface = "default",
  titleLevel: TitleHeading = "h3",
  tagHref,
  linkState,
}: {
  guides: GuideItem[];
  linkFn: (guide: GuideItem) => string;
  /** 記事へのリンクに載せる location.state（記事の「ガイド一覧」が、来たときの絞り込みへ戻るのに使う） */
  linkState?: unknown;
  /** タグの行き先。省略時は `/guides?tag=`。/guides の一覧は検索語・並び順を引き継ぐものを渡す */
  tagHref?: (tag: string) => string;
  gridCols?: string;
  /** カードタイトルの見出しレベル。既定 h3。h1 直下の一覧ページ（/guides）は h2、欄見出し（h3）の下に置く面（走者画面のガイドタブ）は h4 */
  titleLevel?: "h2" | "h3" | "h4";
  /**
   * カードの面。"default"（既定）はサイト共通の `bg-background/80`、"card" は不透明の `bg-card`
   * （ホームのように箱なしのセクションでページ背景に直接置くとき。dark 系で背景と同化しないように）
   */
  surface?: "default" | "card";
  /**
   * `pageViews7d`（直近7日PV）の表示方法。
   * - "additional"（既定）: 累計View数（Eye）の隣に追加表示する（/guides の人気順など）
   * - "replace": 累計View数の代わりに直近7日PVを表示する（ホームの「よく読まれているガイド」専用）
   */
  pageViewsMode?: "additional" | "replace";
}) {
  const t = useT();
  // ログイン状態は LikesProvider が持つ（未ログインなら LikeButton が静的表示に落ちる）
  return (
    <div className={`grid gap-4 ${gridCols}`}>
      {guides.map((guide) => {
        const tags = parseGuideTags(guide.tags);
        return (
          // カード全体のクリックはオーバーレイのリンクが担う（いいねボタンを <a> の
          // 子孫に置くと不正なHTMLになるため。pace-feed-card と同じ構造）
          <div
            key={guide.id}
            className={cn(
              "group relative transition-all",
              // ホバー時の浮き上がりは必ずこの外枠に持たせる。Card 側に transform を置くと
              // Card が重ね合わせコンテキストを作り、兄弟のオーバーレイリンク（z-0）より
              // 手前に描画されてカードのクリックが届かなくなる（ホバーしないと押せないため実質死ぬ）
              "hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0",
            )}
          >
            <div
              className={cn(
                "flex h-full flex-col overflow-hidden rounded-xl border border-border/70 transition-all group-hover:border-primary/40 group-hover:shadow-md",
                surface === "card" ? "bg-card" : "bg-background/80",
              )}
            >
              {/* 表紙が無いカードは帯を出さず、タイトルから始める。表紙の下端の線は、白地の表紙（国旗など）が
                  カードの面に溶けないため */}
              {guide.coverImageUrl && (
                <img
                  src={guide.coverImageUrl}
                  alt="" loading="lazy" decoding="async"
                  className="h-36 w-full border-b border-border/60 object-cover"
                />
              )}
              <div className="flex flex-1 flex-col p-4">
                {/* leading-none（16px）だと Zen Kaku Gothic New のディセンダー（g/y/p）が line-clamp の
                    overflow:hidden で約2px切れるため leading-snug（22px）。Pin は1行目の中央に揃える */}
                {/* オーバーレイはタイトルのリンクの ::after で敷く（読み上げがタイトル1回になる）。
                    line-clamp は flex 要素では効かないため、内側のブロック（span）に付ける */}
                <TitleHeading className="flex items-start gap-1.5 text-base font-semibold leading-snug">
                  {guide.isPinned && (
                    <Pin className="h-4 w-4 text-foreground shrink-0 mt-[3px]" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1 line-clamp-2">
                    <Link
                      to={linkFn(guide)}
                      state={linkState}
                      prefetch="intent"
                      data-guide-link
                      className={OVERLAY_LINK_CLASS_CARD}
                    >
                      {guide.title}
                    </Link>
                  </span>
                </TitleHeading>
                {guide.summary && (
                  <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">
                    {guide.summary}
                  </p>
                )}
                {tags.length > 0 && (
                  <GuideCardTags tags={tags} tagHref={tagHref} className="mt-3" />
                )}
                {/* 伸縮スペーサー: タイトル行数等の差を吸収し、フッターの水平線位置を兄弟カード間で下端に揃える */}
                <div className="flex-1" />
                {/* 狭幅（グリッドが詰まった時）でも折り返しで崩れないよう flex-wrap + gap-x/gap-y に。
                    時刻は ml-auto shrink-0 で折り返し後も行内右端に揃える */}
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border/60 pt-3 text-xs text-muted-foreground">
                  <GuideAuthorMeta guide={guide} />
                  {guide.autoTranslated && <AutoTranslatedMark />}
                  {/* "replace" モードでは pageViews7d がある間だけ累計View数を隠し、7日間PVに差し替える
                      （ホームの「よく読まれているガイド」専用。/guides の人気順は "additional" のまま両方出す） */}
                  {!(pageViewsMode === "replace" && guide.pageViews7d !== undefined) && (
                    <ViewCountMeta count={guide.viewCount} className="shrink-0" />
                  )}
                  {guide.pageViews7d !== undefined && (
                    <PageViews7dMeta count={guide.pageViews7d} />
                  )}
                  <LikeButton
                    variant="compact"
                    targetType="guide"
                    targetId={guide.id}
                    likeCount={guide.likeCount}
                    isOwn={guide.isOwn}
                    className="shrink-0"
                  />
                  <RelativeTime date={guide.updatedAt} className="ml-auto shrink-0" />
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Compact list view */
export function GuideListView({
  guides,
  linkFn,
  titleLevel: TitleHeading = "h3",
  tagHref,
  linkState,
}: {
  guides: GuideItem[];
  linkFn: (guide: GuideItem) => string;
  /** タグの行き先（GuideCardGrid と同じ） */
  tagHref?: (tag: string) => string;
  /** 記事へのリンクに載せる location.state（GuideCardGrid と同じ） */
  linkState?: unknown;
  /** タイトルの見出しレベル。既定 h3（GuideCardGrid と同じ） */
  titleLevel?: "h2" | "h3" | "h4";
}) {
  const t = useT();
  return (
    <div className="divide-y divide-border/60">
      {guides.map((guide) => {
        const tags = parseGuideTags(guide.tags);
        return (
          // カード全体のクリックはオーバーレイのリンクが担う（カード表示と同じ理由）
          <div
            key={guide.id}
            className="group relative flex items-center gap-3 py-3 px-1 hover:bg-muted/50 -mx-1 rounded transition-colors"
          >
            {/* カバー画像が無い行はサムネイルの枠を描かない（飾りの面を作らない。カード表示の帯と同じ扱い） */}
            {guide.coverImageUrl && (
              <img
                src={guide.coverImageUrl}
                alt="" loading="lazy" decoding="async"
                className="w-20 h-14 object-cover rounded-md border border-border/60 shrink-0"
              />
            )}
            <div className="flex-1 min-w-0">
              <TitleHeading className="flex items-center gap-1.5 text-sm font-medium">
                {guide.isPinned && <Pin className="h-3.5 w-3.5 text-foreground shrink-0" aria-hidden />}
                <span className="min-w-0 flex-1 line-clamp-1">
                  <Link
                    to={linkFn(guide)}
                    state={linkState}
                    prefetch="intent"
                    data-guide-link
                    className={OVERLAY_LINK_CLASS_LIST}
                  >
                    {guide.title}
                  </Link>
                </span>
              </TitleHeading>
              {guide.summary && (
                <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                  {guide.summary}
                </p>
              )}
              {tags.length > 0 && (
                <GuideCardTags tags={tags} tagHref={tagHref} className="mt-1.5" />
              )}
              <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                <GuideAuthorMeta guide={guide} />
                {guide.autoTranslated && <AutoTranslatedMark />}
                <ViewCountMeta count={guide.viewCount} />
                {guide.pageViews7d !== undefined && (
                  <PageViews7dMeta count={guide.pageViews7d} />
                )}
                <LikeButton
                  variant="compact"
                  targetType="guide"
                  targetId={guide.id}
                  likeCount={guide.likeCount}
                  isOwn={guide.isOwn}
                />
                <RelativeTime date={guide.updatedAt} className="ml-auto shrink-0" />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * テンプレート一覧（/guides/templates）の行のスケルトン。本物の行（タイトル・説明・メタ行）と同じ配置。
 * 同じ一覧の中の遷移と、ガイド一覧からのタブ切替の両方で使う
 */
export function TemplateListSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="divide-y divide-border/60" aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="-mx-1 flex items-center gap-3 px-1 py-3">
          <div className="min-w-0 flex-1">
            <Skeleton className="h-5 w-48 max-w-full" />
            <Skeleton className="mt-0.5 h-4 w-2/3" />
            <div className="mt-1.5 flex items-center gap-3">
              <Skeleton className="size-5 rounded-md" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-12" />
              <Skeleton className="ml-auto h-4 w-16" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * 一覧の読み込み中スケルトン（`GuideCardGrid` / `GuideListView` と同じ配置・同じ高さの目安）。
 * 読み込みの前後でレイアウトが跳ねないようにし、読み上げには出さない（aria-hidden。ui.md 8 章）。
 * 表紙画像の無いガイドが多数派なので、表紙の帯・サムネイルは描かない（常に描くと、本物より背が高くなる）
 */
export function GuideListSkeleton({
  viewMode,
  count = 6,
}: {
  viewMode: "card" | "list";
  count?: number;
}) {
  if (viewMode === "card") {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden>
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="flex flex-col overflow-hidden rounded-xl border border-border/70 bg-background/80">
            <div className="p-4">
              <Skeleton className="h-[22px] w-3/4" />
              <Skeleton className="mt-1.5 h-4 w-1/2" />
              <div className="mt-3 flex items-center gap-3 border-t border-border/60 pt-3">
                <Skeleton className="size-5 rounded-md" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="ml-auto h-4 w-16" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="divide-y divide-border/60" aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="-mx-1 flex items-center gap-3 px-1 py-3">
          <div className="min-w-0 flex-1">
            <Skeleton className="h-5 w-48 max-w-full" />
            <Skeleton className="mt-0.5 h-4 w-2/3" />
            <div className="mt-1.5 flex items-center gap-3">
              <Skeleton className="size-5 rounded-md" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="ml-auto h-4 w-16" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
