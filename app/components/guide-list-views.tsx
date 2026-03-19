import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Eye, LayoutGrid, List } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import { ja } from "date-fns/locale";

export type GuideItem = {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  tags: string;
  coverImageUrl: string | null;
  viewCount: number;
  updatedAt: string | Date;
  /** Per-guide author display name (for multi-author listings) */
  authorName?: string;
};

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
  return (
    <div className={`grid gap-4 ${gridCols}`}>
      {guides.map((guide) => {
        const tags = JSON.parse(guide.tags) as string[];
        return (
          <Link key={guide.id} to={linkFn(guide)} prefetch="intent" className="group">
            <Card className="h-full transition-all group-hover:shadow-sm group-hover:border-primary/40 group-hover:-translate-y-0.5">
              {guide.coverImageUrl && (
                <img
                  src={guide.coverImageUrl}
                  alt={guide.title}
                  className="w-full h-36 object-cover rounded-t-xl"
                />
              )}
              <CardHeader className="pb-3">
                <CardTitle className="text-base line-clamp-2 group-hover:text-primary transition-colors">
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
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  {guide.authorName && <span>{guide.authorName}</span>}
                  <span className="flex items-center gap-1">
                    <Eye className="h-3 w-3" />
                    {guide.viewCount}
                  </span>
                  <span>
                    {formatDistanceToNow(guide.updatedAt, {
                      addSuffix: true,
                      locale: ja,
                    })}
                  </span>
                </div>
              </CardContent>
            </Card>
          </Link>
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
  return (
    <div className="divide-y">
      {guides.map((guide) => {
        const tags = JSON.parse(guide.tags) as string[];
        return (
          <Link
            key={guide.id}
            to={linkFn(guide)}
            prefetch="intent"
            className="flex items-center gap-3 py-3 px-1 hover:bg-muted/50 -mx-1 rounded transition-colors group"
          >
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-medium group-hover:text-primary transition-colors line-clamp-1">
                {guide.title}
              </h3>
              {guide.summary && (
                <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                  {guide.summary}
                </p>
              )}
              <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                {guide.authorName && <span>{guide.authorName}</span>}
                <span className="flex items-center gap-0.5">
                  <Eye className="h-3 w-3" />
                  {guide.viewCount}
                </span>
                <span>
                  {formatDistanceToNow(guide.updatedAt, {
                    addSuffix: true,
                    locale: ja,
                  })}
                </span>
              </div>
            </div>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1 shrink-0">
                {tags.slice(0, 3).map((tag) => (
                  <Badge key={tag} variant="secondary" className="rounded-full px-2 py-0.5 text-[11px]">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
          </Link>
        );
      })}
    </div>
  );
}
