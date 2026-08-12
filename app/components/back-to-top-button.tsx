// 一定量スクロールしたら右下に出るページトップ復帰ボタン。
// グローバルに /_layout で配置し全ページで利用可能。
import { useEffect, useState } from "react";
import { useT } from "@/hooks/use-locale";
import { ArrowUp } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
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
  const [visible, setVisible] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    let ticking = false;
    const check = () => {
      ticking = false;
      setVisible(window.scrollY > threshold);
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
          className={cn(
            "fixed bottom-6 right-6 z-50 inline-flex items-center justify-center",
            "h-11 w-11 rounded-full bg-brand text-brand-foreground shadow-lg",
            "transition-all duration-200 ease-out will-change-transform",
            "hover:bg-brand/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            visible
              ? "translate-y-0 opacity-100 pointer-events-auto"
              : "translate-y-4 opacity-0 pointer-events-none",
          )}
        >
          <ArrowUp className="h-5 w-5" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent>{t("backToTop.label")}</TooltipContent>
    </Tooltip>
  );
}
