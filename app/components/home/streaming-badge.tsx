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
        "inline-flex items-center gap-1 text-[11px] font-medium text-destructive",
        filled && "shrink-0 rounded-full bg-destructive/10 px-2 py-0.5",
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-destructive" aria-hidden="true" />
      {t("home.liveStreaming")}
    </span>
  );
}
