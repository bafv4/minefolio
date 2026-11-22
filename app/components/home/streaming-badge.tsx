import { useT } from "@/hooks/use-locale";
import { cn } from "@/lib/utils";

/**
 * 「配信中」の印（赤い点＋文言）。filled はカード見出し用の塗りつぶしピル、
 * 既定は行内に添える文字だけの表示。余白・表示切替は className で足す
 */
export function StreamingBadge({ filled, className }: { filled?: boolean; className?: string }) {
  const t = useT();
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[11px] font-medium text-live",
        // 塗りピルの文字は前景色にし、--live は点と淡い地で示す（淡い地に --live の文字は light で 4.5:1 ぎりぎりなので避ける。
        // 不透明な --live に白文字は、dark の --live が明るいため割る）
        filled && "shrink-0 rounded-full bg-live-tint px-2 py-0.5 text-foreground",
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-live" aria-hidden="true" />
      {t("home.liveStreaming")}
    </span>
  );
}
