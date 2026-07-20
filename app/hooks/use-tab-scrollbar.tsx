import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * タブ列の横スクロール用カスタムスクロールバー。
 *
 * ネイティブのスクロールバーはスクロールコンテナ内に高さを確保するため、
 * タブがベースライン（-mb-px の 1px 重なり）から浮いてフォルダ連結が壊れる。
 * そこでネイティブは非表示のまま、レイアウト高さを取らないオーバーレイの
 * つまみを重ねる。スクロール可能なときのみ表示され、ドラッグで操作できる。
 *
 * 使い方:
 *   const { scrollerRef, scrollbar } = useTabScrollbar();
 *   <div className="relative ...">          // 非スクロールの relative 親
 *     <Scroller ref={scrollerRef} ... />    // overflow-x-auto の要素
 *     {scrollbar}
 *   </div>
 */
export function useTabScrollbar() {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState({ visible: false, left: 0, width: 100 });

  const update = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    if (scrollWidth <= clientWidth + 1) {
      setState((s) => (s.visible ? { ...s, visible: false } : s));
      return;
    }
    setState({
      visible: true,
      left: (scrollLeft / scrollWidth) * 100,
      width: (clientWidth / scrollWidth) * 100,
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
    const startX = e.clientX;
    const startScroll = el.scrollLeft;
    const ratio = el.scrollWidth / el.clientWidth;
    const move = (ev: PointerEvent) => {
      el.scrollLeft = startScroll + (ev.clientX - startX) * ratio;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, []);

  const scrollbar: ReactNode = state.visible ? (
    // タブ帯の上側（帯上部の余白部分）に重ねる。レイアウト高さは取らない。
    // トラックはカードの端まで伸ばし（inset-x-0）、カードの overflow-hidden で
    // 角丸に沿ってクリップされる。カーソルはネイティブスクロールバー同様デフォルトのまま
    <div aria-hidden className="pointer-events-none absolute inset-x-2 top-[2px] h-1">
      <div
        className="pointer-events-auto absolute top-0 h-full touch-none rounded-[2px] bg-muted-foreground/30 transition-colors hover:bg-muted-foreground/60 active:bg-muted-foreground/60"
        style={{ left: `${state.left}%`, width: `${state.width}%` }}
        onPointerDown={onPointerDown}
      />
    </div>
  ) : null;

  // isScrollable: スクロールが必要なときだけ true。呼び出し側でスクロールバー用の
  // 余白（カードとタブの間の padding）を条件付きで広げるのに使う
  return { scrollerRef, scrollbar, isScrollable: state.visible };
}
