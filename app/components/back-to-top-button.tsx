// 一定量スクロールしたら右下に出るページトップ復帰ボタン。
// グローバルに /_layout で配置し全ページで利用可能。
import { useEffect, useState } from "react";
import { useT } from "@/hooks/use-locale";
import { ArrowUp } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { INITIAL_BACK_TO_TOP_STATE, nextBackToTopState } from "@/lib/back-to-top";
import { useCookieConsent } from "@/components/cookie-consent";

interface Props {
  /** 表示し始める縦スクロール量（px） */
  threshold?: number;
}

export function BackToTopButton({ threshold = 200 }: Props) {
  const t = useT();
  // Cookie 同意バナー（fixed bottom-4 right-4）と同じ位置に重なるため、
  // 未回答（バナー表示中）の間はこのボタンを描画しない
  const { hasConsent } = useCookieConsent();
  const [scrollVisible, setScrollVisible] = useState(false);
  // キーボードでフォーカスがある間は隠さない
  const [focused, setFocused] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const visible = scrollVisible || focused;

  useEffect(() => {
    let ticking = false;
    let state = INITIAL_BACK_TO_TOP_STATE;
    const check = () => {
      ticking = false;
      state = nextBackToTopState(state, {
        y: window.scrollY,
        docHeight: document.documentElement.scrollHeight,
        viewportHeight: window.innerHeight,
        threshold,
      });
      setScrollVisible(state.visible);
    };
    const onScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(check);
        ticking = true;
      }
    };
    const rafId = window.requestAnimationFrame(check);
    window.addEventListener("scroll", onScroll, { passive: true });
    setPrefersReducedMotion(
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("scroll", onScroll);
    };
  }, [threshold]);

  const handleClick = () => {
    window.scrollTo({
      top: 0,
      behavior: prefersReducedMotion ? "auto" : "smooth",
    });
  };

  // 未回答（hasConsent === null）の間は Cookie 同意バナーが表示されるため、
  // 同じ右下の位置に重ならないよう描画自体をやめる
  if (hasConsent === null) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={handleClick}
          aria-label={t("backToTop.label")}
          onFocus={(e) => setFocused(e.currentTarget.matches(":focus-visible"))}
          onBlur={() => setFocused(false)}
          className={cn(
            "fixed bottom-[calc(1.5rem+var(--bottom-dock-height,0px))] right-6 z-50 inline-flex items-center justify-center",
            "h-11 w-11 rounded-full border border-border/70 bg-card text-foreground shadow-md",
            "transition-[opacity,transform,visibility,background-color,border-color] duration-200 ease-out will-change-transform",
            "motion-reduce:translate-y-0 motion-reduce:transition-opacity",
            "hover:border-primary/40 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            // 隠れている間は visibility: hidden で Tab 順からも外す
            visible
              ? "visible translate-y-0 opacity-100 pointer-events-auto"
              : "invisible translate-y-4 opacity-0 pointer-events-none",
          )}
        >
          <ArrowUp className="h-5 w-5" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent>{t("backToTop.label")}</TooltipContent>
    </Tooltip>
  );
}
