import type { ReactNode } from "react";
import { Heart } from "lucide-react";
import { useT } from "@/hooks/use-locale";
import { cn } from "@/lib/utils";

/** お気に入り走者の印（塗りつぶしハート）。読み上げ用の文言を sr-only で添える。サイズ・余白は className で指定する */
export function FavoriteMark({ className }: { className: string }) {
  const t = useT();
  return (
    <>
      <Heart className={cn("shrink-0 fill-favorite text-favorite", className)} aria-hidden="true" />
      <span className="sr-only">{t("favorites.favoriteMark")}</span>
    </>
  );
}

/**
 * 「お気に入りを先頭に出している」補足行（/browse とホームのライブ欄で共有）。2行に折り返してもハートは1行目に揃える
 * （items-start + 行高 20px に対する 3px 下げ）。本文が意味を言うので FavoriteMark の sr-only は付けない
 */
export function FavoritesFirstNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("flex items-start gap-1.5 text-sm text-muted-foreground", className)}>
      <Heart className="mt-[3px] h-3.5 w-3.5 shrink-0 fill-favorite text-favorite" aria-hidden="true" />
      {children}
    </p>
  );
}
