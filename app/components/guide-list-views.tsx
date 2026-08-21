import { Link } from "react-router";
import { useLocale } from "@/hooks/use-locale";
import { parseGuideTags } from "@/lib/guide-tags";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Eye, FileText, Pin } from "lucide-react";
import { LikeButton } from "@/components/like-button";
import { PageViews7dMeta } from "@/components/page-views-meta";
import { formatDistanceToNow } from "date-fns";
import { dateFnsLocale } from "@/lib/date-locale";

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
  /** プロフィールのガイドタブでのピン留め（カード表示で先頭・拡大） */
  isPinned?: boolean;
  /** 閲覧者自身のガイドか（自分のガイドにはいいねできない） */
  isOwn?: boolean;
};

/** guides/index・home が内部リンク生成に使う拡張（著者スラッグ付き） */
export type GuideItemWithAuthorSlug = GuideItem & { _authorSlug: string };

/** Card grid view */
export function GuideCardGrid({
  guides,
  linkFn,
  gridCols = "sm:grid-cols-2 lg:grid-cols-3",
  pageViewsMode = "additional",
}: {
  guides: GuideItem[];
  linkFn: (guide: GuideItem) => string;
  gridCols?: string;
  /**
   * `pageViews7d`（直近7日PV）の表示方法。
   * - "additional"（既定）: 累計View数（Eye）の隣に追加表示する（/guides の人気順など）
   * - "replace": 累計View数の代わりに直近7日PVを表示する（ホームの「よく読まれているガイド」専用）
   */
  pageViewsMode?: "additional" | "replace";
}) {
  const locale = useLocale();
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
              "hover:-translate-y-0.5",
              // ピン留めカードはグリッド2列分に拡大して強調する
              guide.isPinned && "sm:col-span-2",
            )}
          >
            <Link
              to={linkFn(guide)}
              prefetch="intent"
              className="absolute inset-0 z-0 rounded-xl"
              aria-label={guide.title}
            />
            <div
              className={cn(
                "flex h-full flex-col overflow-hidden rounded-xl border border-border/70 bg-background/80 transition-all group-hover:border-primary/40 group-hover:shadow-md",
                guide.isPinned && "border-primary/40",
              )}
            >
              {guide.coverImageUrl ? (
                <img
                  src={guide.coverImageUrl}
                  alt={guide.title}
                  className={cn("w-full object-cover", guide.isPinned ? "h-48" : "h-36")}
                />
              ) : (
                <div
                  className={cn(
                    "w-full bg-muted/50 flex items-center justify-center",
                    guide.isPinned ? "h-48" : "h-36",
                  )}
                >
                  <FileText className="h-8 w-8 text-muted-foreground/30" />
                </div>
              )}
              <div className="flex flex-1 flex-col p-4">
                <h3 className="flex items-start gap-1.5 text-base font-semibold leading-none line-clamp-2 transition-colors group-hover:text-primary">
                  {guide.isPinned && <Pin className="h-4 w-4 text-primary shrink-0 mt-0.5" />}
                  {guide.title}
                </h3>
                {guide.summary && (
                  <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">
                    {guide.summary}
                  </p>
                )}
                {tags.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1">
                    {tags.slice(0, 3).map((tag) => (
                      <Badge key={tag} variant="secondary" className="rounded-full px-2 py-0.5 text-[11px]">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}
                {/* 伸縮スペーサー: タイトル行数等の差を吸収し、フッターの水平線位置を兄弟カード間で下端に揃える */}
                <div className="flex-1" />
                {/* 狭幅（グリッドが詰まった時）でも折り返しで崩れないよう flex-wrap + gap-x/gap-y に。
                    時刻は ml-auto shrink-0 で折り返し後も行内右端に揃える */}
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border/60 pt-3 text-xs text-muted-foreground">
                  {guide.authorName && (
                    <span className="min-w-0 truncate">{guide.authorName}</span>
                  )}
                  {/* "replace" モードでは pageViews7d がある間だけ累計View数を隠し、7日間PVに差し替える
                      （ホームの「よく読まれているガイド」専用。/guides の人気順は "additional" のまま両方出す） */}
                  {!(pageViewsMode === "replace" && guide.pageViews7d !== undefined) && (
                    <span className="flex shrink-0 items-center gap-1">
                      <Eye className="h-3 w-3" />
                      {guide.viewCount}
                    </span>
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
                  {/* 相対時刻はSSR時とhydration時で基準時刻がずれるため警告を抑制 */}
                  <span className="ml-auto shrink-0" suppressHydrationWarning>
                    {formatDistanceToNow(guide.updatedAt, {
                      addSuffix: true,
                      locale: dateFnsLocale(locale),
                    })}
                  </span>
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
}: {
  guides: GuideItem[];
  linkFn: (guide: GuideItem) => string;
}) {
  const locale = useLocale();
  return (
    <div className="divide-y">
      {guides.map((guide) => {
        const tags = parseGuideTags(guide.tags);
        return (
          // カード全体のクリックはオーバーレイのリンクが担う（カード表示と同じ理由）
          <div
            key={guide.id}
            className="group relative flex items-center gap-3 py-3 px-1 hover:bg-muted/50 -mx-1 rounded transition-colors"
          >
            <Link
              to={linkFn(guide)}
              prefetch="intent"
              className="absolute inset-0 z-0 rounded"
              aria-label={guide.title}
            />
            {guide.coverImageUrl ? (
              <img
                src={guide.coverImageUrl}
                alt={guide.title}
                className="w-20 h-14 object-cover rounded-md shrink-0"
              />
            ) : (
              <div className="w-20 h-14 rounded-md bg-muted/50 flex items-center justify-center shrink-0">
                <FileText className="h-5 w-5 text-muted-foreground/30" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-medium group-hover:text-primary transition-colors line-clamp-1 flex items-center gap-1.5">
                {guide.isPinned && <Pin className="h-3.5 w-3.5 text-primary shrink-0" />}
                {guide.title}
              </h3>
              {guide.summary && (
                <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                  {guide.summary}
                </p>
              )}
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {tags.slice(0, 3).map((tag) => (
                    <Badge key={tag} variant="secondary" className="rounded-full px-2 py-0.5 text-[11px]">
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                {guide.authorName && <span className="truncate">{guide.authorName}</span>}
                <span className="flex items-center gap-1">
                  <Eye className="h-3 w-3" />
                  {guide.viewCount}
                </span>
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
                <span className="ml-auto shrink-0" suppressHydrationWarning>
                  {formatDistanceToNow(guide.updatedAt, {
                    addSuffix: true,
                    locale: dateFnsLocale(locale),
                  })}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
