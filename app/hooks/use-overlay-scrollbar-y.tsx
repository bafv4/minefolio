import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * 縦スクロール用のオーバーレイ・スクロールバー（useTabScrollbar の縦版）。
 *
 * ネイティブの縦スクロールバーはコンテナ内に横幅を確保するため、狭いカード内では
 * 本文が削られたり右端に隙間ができたりする。そこでネイティブは非表示にし、
 * レイアウト幅を取らないオーバーレイのつまみを右端に重ねる。
 * スクロール可能なときのみ表示され、ドラッグでも操作できる。
 *
 * 使い方:
 *   const { scrollerRef, scrollbar } = useOverlayScrollbarY();
 *   <div className="relative min-h-0 flex-1">                 // 非スクロールの relative 親
 *     <div ref={scrollerRef}
 *          className="h-full overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
 *       ...content...
 *     </div>
 *     {scrollbar}
 *   </div>
 */
export function useOverlayScrollbarY() {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState({ visible: false, top: 0, height: 100 });

  const update = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    if (scrollHeight <= clientHeight + 1) {
      setState((s) => (s.visible ? { ...s, visible: false } : s));
      return;
    }
    setState({
      visible: true,
      top: (scrollTop / scrollHeight) * 100,
      height: (clientHeight / scrollHeight) * 100,
    });
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    for (const child of el.children) ro.observe(child);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [update]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const el = scrollerRef.current;
    if (!el) return;
    e.preventDefault();
    const startY = e.clientY;
    const startScroll = el.scrollTop;
    const ratio = el.scrollHeight / el.clientHeight;
    const move = (ev: PointerEvent) => {
      el.scrollTop = startScroll + (ev.clientY - startY) * ratio;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, []);

  const scrollbar: ReactNode = state.visible ? (
    // 右端に重ねる。レイアウト幅は取らない（overlay）。
    <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-1.5">
      <div
        className="pointer-events-auto absolute right-0 w-full touch-none rounded-full bg-muted-foreground/30 transition-colors hover:bg-muted-foreground/60 active:bg-muted-foreground/60"
        style={{ top: `${state.top}%`, height: `${state.height}%` }}
        onPointerDown={onPointerDown}
      />
    </div>
  ) : null;

  return { scrollerRef, scrollbar, isScrollable: state.visible };
}
