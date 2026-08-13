import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Heart } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCookieConsent, CookieConsentBanner } from "@/components/cookie-consent";
import { useFavorites } from "@/hooks/use-favorites";
import { useT } from "@/hooks/use-locale";

interface FavoriteButtonProps {
  /** お気に入り対象のスラッグ */
  slug: string;
  size?: "sm" | "default" | "lg" | "icon";
  variant?: "default" | "outline" | "ghost";
  showLabel?: boolean;
}

export function FavoriteButton({
  slug,
  size = "sm",
  variant = "outline",
  showLabel = false,
}: FavoriteButtonProps) {
  const t = useT();
  const { hasConsent } = useCookieConsent();
  const { isFavorite, toggleFavorite, needsCookieConsent } = useFavorites();
  const [showConsentBanner, setShowConsentBanner] = useState(false);
  const [isPending, setIsPending] = useState(false);

  const favorite = isFavorite(slug);
  const label = favorite ? t("favorites.remove") : t("favorites.add");

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    // Cookie同意がない未ログインユーザーには同意プロンプトを出す
    if (needsCookieConsent && hasConsent !== true) {
      setShowConsentBanner(true);
      return;
    }
    if (isPending) return;
    setIsPending(true);
    try {
      await toggleFavorite(slug);
    } finally {
      setIsPending(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        disabled={isPending}
        onClick={handleClick}
        aria-label={label}
        aria-pressed={favorite}
        className={cn(
          "transition-colors",
          favorite && "text-favorite hover:text-favorite/80",
        )}
      >
        <Heart
          className={cn("h-4 w-4", favorite && "fill-current", showLabel && "mr-2")}
        />
        {showLabel && label}
      </Button>

      <CookieConsentBanner
        show={showConsentBanner}
        onAccept={() => setShowConsentBanner(false)}
        onDecline={() => setShowConsentBanner(false)}
      />
    </>
  );
}
