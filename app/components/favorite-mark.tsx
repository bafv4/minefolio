import type { ReactNode } from "react";
import { Heart } from "lucide-react";
import { useT } from "@/hooks/use-locale";
import { cn } from "@/lib/utils";

/**
 * お気に入り走者の印（小さな塗りハート＋「お気に入り」の淡いピル。表示専用で押せない）。
 * 文字は前景色にし、ハートの色は淡い地とハートで示す（--favorite を文字色にすると 3 テーマで 4.5:1 を割る）。
 * 余白・表示切替は className で足す
 */
export function FavoriteMark({ className }: { className?: string }) {
  const t = useT();
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full bg-favorite/10 px-2 py-0.5 text-[11px] font-medium text-foreground",
        className,
      )}
    >
      <Heart className="h-3 w-3 fill-favorite text-favorite" aria-hidden="true" />
      {t("favorites.favoriteMark")}
    </span>
  );
}

/**
 * 「お気に入りを先頭に出している」補足行（/browse とホームのライブ欄で共有）。2行に折り返してもハートは1行目に揃える
 * （items-start + 行高 20px に対する 3px 下げ）。本文が意味を言うので FavoriteMark の sr-only は付けない
 */
export function FavoritesFirstNote({
  children,
  className,
  compactOnMobile = false,
}: {
  children: ReactNode;
  className?: string;
  /** true で md 未満を text-xs（1行）にする。縦を詰めたい一覧ページ向け（ハートの下げ幅も行高に合わせる） */
  compactOnMobile?: boolean;
}) {
  return (
    <p className={cn("flex items-start gap-1.5 text-sm text-muted-foreground", compactOnMobile && "max-sm:text-xs", className)}>
      <Heart
        className={cn("mt-[3px] h-3.5 w-3.5 shrink-0 fill-favorite text-favorite", compactOnMobile && "max-sm:mt-px")}
        aria-hidden="true"
      />
      {children}
    </p>
  );
}
