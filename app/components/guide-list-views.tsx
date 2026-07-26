import { Link } from "react-router";
import { useLocale } from "@/hooks/use-locale";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Eye, FileText, LayoutGrid, List, Pin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LikeButton } from "@/components/like-button";
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

type ViewMode = "card" | "list";

export function ViewToggle({
  viewMode,
  onChange,
}: {
  viewMode: ViewMode;
  onChange: (mode: ViewMode) => void;
}) {
  return (
    <div className="flex border rounded-md">
      <Button
        variant={viewMode === "card" ? "default" : "ghost"}
        size="icon"
        className="h-8 w-8 rounded-r-none"
        onClick={() => onChange("card")}
      >
        <LayoutGrid className="h-4 w-4" />
      </Button>
      <Button
        variant={viewMode === "list" ? "default" : "ghost"}
        size="icon"
        className="h-8 w-8 rounded-l-none"
        onClick={() => onChange("list")}
      >
        <List className="h-4 w-4" />
      </Button>
    </div>
  );
}

/** Card grid view */
export function GuideCardGrid({
  guides,
  linkFn,
  gridCols = "sm:grid-cols-2 lg:grid-cols-3",
}: {
  guides: GuideItem[];
  linkFn: (guide: GuideItem) => string;
  gridCols?: string;
}) {
  const locale = useLocale();
  // ログイン状態は LikesProvider が持つ（未ログインなら LikeButton が静的表示に落ちる）
  return (
    <div className={`grid gap-4 ${gridCols}`}>
      {guides.map((guide) => {
        const tags = JSON.parse(guide.tags) as string[];
        return (
          // カード全体のクリックはオーバーレイのリンクが担う（いいねボタンを <a> の
          // 子孫に置くと不正なHTMLになるため。pace-feed-card と同じ構造）
          <div
            key={guide.id}
            // ピン留めカードはグリッド2列分に拡大して強調する
            className={cn("group relative", guide.isPinned && "sm:col-span-2")}
          >
            <Link
              to={linkFn(guide)}
              prefetch="intent"
              className="absolute inset-0 z-0 rounded-xl"
              aria-label={guide.title}
            />
            <Card
              className={cn(
                "h-full pt-0 overflow-hidden transition-all group-hover:shadow-sm group-hover:border-primary/40 group-hover:-translate-y-0.5",
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
              <CardHeader className="pb-3">
                <CardTitle className="text-base line-clamp-2 group-hover:text-primary transition-colors flex items-start gap-1.5">
                  {guide.isPinned && <Pin className="h-4 w-4 text-primary shrink-0 mt-0.5" />}
                  {guide.title}
                </CardTitle>
                {guide.summary && (
                  <CardDescription className="line-clamp-2 text-xs">
                    {guide.summary}
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent className="pt-0">
                {tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-3">
                    {tags.slice(0, 3).map((tag) => (
                      <Badge key={tag} variant="secondary" className="rounded-full px-2 py-0.5 text-[11px]">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}
                {/* justify-between は子3つ前提で崩れるため gap + ml-auto に統一（リスト表示と同じ） */}
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  {guide.authorName && <span className="truncate">{guide.authorName}</span>}
                  <span className="flex items-center gap-1">
                    <Eye className="h-3 w-3" />
                    {guide.viewCount}
                  </span>
                  <LikeButton
                    variant="compact"
                    targetType="guide"
                    targetId={guide.id}
                    likeCount={guide.likeCount}
                    isOwn={guide.isOwn}
                  />
                  <span className="ml-auto shrink-0">
                    {formatDistanceToNow(guide.updatedAt, {
                      addSuffix: true,
                      locale: dateFnsLocale(locale),
                    })}
                  </span>
                </div>
              </CardContent>
            </Card>
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
        const tags = JSON.parse(guide.tags) as string[];
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
            {guide.coverImageUrl && (
              <img
                src={guide.coverImageUrl}
                alt={guide.title}
                className="w-20 h-14 object-cover rounded-md shrink-0"
              />
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
                <LikeButton
                  variant="compact"
                  targetType="guide"
                  targetId={guide.id}
                  likeCount={guide.likeCount}
                  isOwn={guide.isOwn}
                />
                <span className="ml-auto shrink-0">
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
