// 短い補足説明（警告・「-」の理由など）を、ポインタ端末ではホバー/フォーカス、
// タッチ端末ではタップで開けるヒント。
//
// Radix Tooltip はタップでは開かない（ホバー/フォーカス起点）ため、粗いポインタ環境
// （pointer: coarse）では Popover に差し替える。デスクトップ/タッチで出し分ける方針は
// KeyInfoTrigger（components/key-info-trigger.tsx）と同じ。
//
// トリガーは button にして、キーボード（フォーカス→Tooltip / Enter→Popover）と
// スクリーンリーダー（aria-label = 説明文）の双方から届くようにする。
import { type ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useMediaQuery } from "@/hooks/use-media-query";

export function HintTip({
  message,
  children,
  className,
}: {
  /** 説明文。ヒント本文とトリガーのアクセシブルネームに使う */
  message: string;
  /** トリガーとして表示する内容（値・警告アイコンなど） */
  children: ReactNode;
  className?: string;
}) {
  // SSR ではポインタ端末として描画し、ハイドレーション後にタッチなら Popover へ切り替える
  const isTouch = useMediaQuery("(pointer: coarse)", false);

  const trigger = (
    <button
      type="button"
      aria-label={message}
      className={cn(
        "inline-flex items-center gap-1 rounded-sm cursor-help align-middle",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {children}
    </button>
  );

  if (isTouch) {
    return (
      <Popover>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent className="w-auto max-w-64 p-3 text-xs">
          {message}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{trigger}</TooltipTrigger>
      <TooltipContent className="max-w-xs">{message}</TooltipContent>
    </Tooltip>
  );
}
