import { useEffect, useRef } from "react";

/** スクロール量に対する背景模様の追随率（8% ＝ 奥にあるように見える視差） */
const PARALLAX_FACTOR = 0.08;

/**
 * 背景模様タイルの巻き戻し周期（px）。
 * LCM(16, 34) = 272 — .page-bg-pattern の background-size（16px, 34px）の
 * 最小公倍数なので、この周期で translateY を巻き戻しても継ぎ目が見えない。
 */
const PATTERN_PERIOD_PX = 272;

/**
 * ページ背景の模様（ドット＋グリッド線）レイヤー。
 * viewport 固定で敷いた上で、スクロールの約8%の速度で追随させることで
 * 「模様が奥にある」視差効果を出す。`background-attachment: fixed` は
 * iOS Safari で崩れるため使わず、transform で移動させる。
 */
export function BackgroundPattern() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    const el = ref.current;
    if (!el) return;

    let rafId: number | null = null;

    const update = () => {
      rafId = null;
      const offset = (window.scrollY * PARALLAX_FACTOR) % PATTERN_PERIOD_PX;
      el.style.transform = `translate3d(0, -${offset}px, 0)`;
    };

    const onScroll = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", onScroll);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, []);

  return <div aria-hidden className="page-bg-pattern" ref={ref} />;
}
