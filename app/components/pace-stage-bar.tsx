import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { LIVE_STAGES } from "@/lib/home-live";
import { LIVE_EASE, prefersReducedMotion, reachedStages } from "@/lib/live-motion";

const GROW_MS = 450;

/** 7点の区間進行バー。到達済みは塗り、現在区間（最新）を強調する（muted＝終了カードは強調しない）。更新時は 200ms で遷移（reduced-motion では即時）。
 *  マウント後に stage が増えたとき（同じカードが次の区間に着いたとき）は、新しく到達した段を左から右へ伸ばす
 *  （Web Animations API。初回表示・muted・reduced-motion では動かさない）。
 *  区間名は呼び出し側のテキスト（PaceManSplitMark 等）で出すため aria-hidden。 */
export function StageBar({ stage, muted }: { stage: number; muted?: boolean }) {
  const segs = useRef<(HTMLSpanElement | null)[]>([]);
  const prev = useRef(stage);
  const anims = useRef<Animation[]>([]);

  useEffect(() => {
    const before = prev.current;
    prev.current = stage;
    if (muted || prefersReducedMotion()) return;
    const reached = reachedStages(before, stage, LIVE_STAGES.length);
    if (reached.length === 0) return;
    anims.current.forEach((a) => a.cancel());
    anims.current = [];
    reached.forEach((n, i) => {
      const el = segs.current[n - 1];
      if (!el || typeof el.animate !== "function") return;
      anims.current.push(
        el.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], {
          duration: GROW_MS,
          delay: i * 80,
          easing: LIVE_EASE,
          fill: "backwards",
        }),
      );
    });
  }, [stage, muted]);
  useEffect(() => () => anims.current.forEach((a) => a.cancel()), []);

  return (
    <div className="flex items-center gap-1" aria-hidden="true">
      {LIVE_STAGES.map((name, i) => {
        const n = i + 1;
        return (
          <span
            key={name}
            ref={(el) => {
              segs.current[i] = el;
            }}
            className={cn(
              "h-1.5 flex-1 origin-left rounded-full transition-all duration-200 motion-reduce:transition-none",
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
