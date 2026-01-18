import { useState } from "react";
import { useFetcher } from "react-router";
import { Button } from "@/components/ui/button";
import { Heart } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCookieConsent, CookieConsentBanner } from "@/components/cookie-consent";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface FavoriteButtonProps {
  mcid: string;
  isFavorite: boolean;
  size?: "sm" | "default" | "lg" | "icon";
  variant?: "default" | "outline" | "ghost";
  showLabel?: boolean;
}

export function FavoriteButton({
  mcid,
  isFavorite,
  size = "sm",
  variant = "outline",
  showLabel = false,
}: FavoriteButtonProps) {
  const fetcher = useFetcher();
  const { hasConsent } = useCookieConsent();
  const [showConsentBanner, setShowConsentBanner] = useState(false);

  // Optimistic UI: fetcher送信中は逆の状態を表示
  const optimisticFavorite =
    fetcher.formData
      ? fetcher.formData.get("action") === "add"
      : isFavorite;

  const isSubmitting = fetcher.state === "submitting";

  // Cookie未承諾時のクリックハンドラー
  const handleClick = (e: React.MouseEvent) => {
    if (hasConsent === null || hasConsent === false) {
      e.preventDefault();
      setShowConsentBanner(true);
    }
  };

  const isDisabled = isSubmitting;

  const button = (
    <Button
      type={hasConsent === true ? "submit" : "button"}
      variant={variant}
      size={size}
      disabled={isDisabled}
      onClick={hasConsent !== true ? handleClick : undefined}
      className={cn(
        "transition-colors",
        optimisticFavorite && "text-red-500 hover:text-red-600"
      )}
    >
      <Heart
        className={cn(
          "h-4 w-4",
          optimisticFavorite && "fill-current",
          showLabel && "mr-2"
        )}
      />
      {showLabel && (optimisticFavorite ? "お気に入り解除" : "お気に入り")}
    </Button>
  );

  return (
    <>
      <fetcher.Form method="post" action="/api/favorites">
        <input type="hidden" name="mcid" value={mcid} />
        <input
          type="hidden"
          name="action"
          value={optimisticFavorite ? "remove" : "add"}
        />
        {button}
      </fetcher.Form>

      <CookieConsentBanner
        show={showConsentBanner}
        onAccept={() => setShowConsentBanner(false)}
        onDecline={() => setShowConsentBanner(false)}
      />
    </>
  );
}
