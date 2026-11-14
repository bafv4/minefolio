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
