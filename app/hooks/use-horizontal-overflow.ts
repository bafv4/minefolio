import { useEffect, useRef, useState } from "react";

/**
 * 要素が横にはみ出しているか（中身の幅 > 器の幅）を ResizeObserver で追う。
 * はみ出しているときだけ器を Tab で止まれる名前付きの領域にするため（収まっている表・コードに停止点を増やさない）。
 * JS 前（SSR）は false＝停止点なしのまま
 */
export function useHorizontalOverflow<T extends HTMLElement>(label: string) {
  const ref = useRef<T>(null);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const update = () => setOverflowing(el.scrollWidth - el.clientWidth > 1);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);
    return () => observer.disconnect();
  }, []);

  const regionProps = overflowing
    ? { tabIndex: 0, role: "region" as const, "aria-label": label }
    : {};
  return { ref, overflowing, regionProps };
}
