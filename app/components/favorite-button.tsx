import { useFetcher } from "react-router";
import { Button } from "@/components/ui/button";
import { Heart } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCookieConsent } from "@/components/cookie-consent";
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

  // Optimistic UI: fetcher送信中は逆の状態を表示
  const optimisticFavorite =
    fetcher.formData
      ? fetcher.formData.get("action") === "add"
      : isFavorite;

  const isSubmitting = fetcher.state === "submitting";

  // Cookie未承諾の場合は無効化
  const isDisabled = isSubmitting || hasConsent === false;

  const button = (
    <Button
      type="submit"
      variant={variant}
      size={size}
      disabled={isDisabled}
      className={cn(
        "transition-colors",
        optimisticFavorite && "text-red-500 hover:text-red-600",
        hasConsent === false && "opacity-50 cursor-not-allowed"
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

  // Cookie未承諾の場合はツールチップで説明
  if (hasConsent === false) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0}>{button}</span>
        </TooltipTrigger>
        <TooltipContent>
          <p>お気に入り機能を使用するにはCookieの承諾が必要です</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <fetcher.Form method="post" action="/api/favorites">
      <input type="hidden" name="mcid" value={mcid} />
      <input
        type="hidden"
        name="action"
        value={optimisticFavorite ? "remove" : "add"}
      />
      {button}
    </fetcher.Form>
  );
}
