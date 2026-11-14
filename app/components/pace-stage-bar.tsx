import { cn } from "@/lib/utils";
import { LIVE_STAGES } from "@/lib/home-live";

/** 7点の区間進行バー。到達済みは塗り、現在区間（最新）を強調する（muted＝終了カードは強調しない）。更新時は 200ms で遷移（reduced-motion では即時）。
 *  区間名は呼び出し側のテキスト（PaceManSplitMark 等）で出すため aria-hidden。 */
export function StageBar({ stage, muted }: { stage: number; muted?: boolean }) {
  return (
    <div className="flex items-center gap-1" aria-hidden="true">
      {LIVE_STAGES.map((name, i) => {
        const n = i + 1;
        return (
          <span
            key={name}
            className={cn(
              "h-1.5 flex-1 rounded-full transition-all duration-200 motion-reduce:transition-none",
              n < stage && "bg-brand/40",
              // muted（終了カード）: 現在区間の強調なし。到達済みと同じ薄さにする
              n === stage && (muted ? "bg-brand/40" : "h-2.5 bg-brand"),
              n > stage && "bg-muted",
            )}
          />
        );
      })}
    </div>
  );
}
