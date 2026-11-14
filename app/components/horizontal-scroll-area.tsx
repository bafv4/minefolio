import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/hooks/use-locale";
import { cn } from "@/lib/utils";
import { ChevronsRight } from "lucide-react";

interface HorizontalScrollAreaProps {
  children: React.ReactNode;
  /** スクロールコンテナ側に追加するクラス */
  className?: string;
  /** 外側ラッパーに追加するクラス */
  wrapperClassName?: string;
  /** はみ出し時に「横にスクロールできます」を表示する（狭い画面のみ） */
  showHint?: boolean;
}

/**
 * 横にはみ出す要素を包み、続きがある側にだけ端のフェードを出すスクロール領域。
 * はみ出していないときはレイアウトも見た目も通常の overflow-x-auto と変わらない。
 * フェードは bg-card 想定（カード内で使う）。
 */
export function HorizontalScrollArea({
  children,
  className,
  wrapperClassName,
  showHint = false,
}: HorizontalScrollAreaProps) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const left = el.scrollLeft > 1;
    const right = max - el.scrollLeft > 1;
    setEdges((prev) =>
      prev.left === left && prev.right === right ? prev : { left, right },
    );
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => ro.disconnect();
  }, [update]);

  const overflowing = edges.left || edges.right;

  return (
    <div className={cn("w-full", wrapperClassName)}>
      {/* ヒントはスクロール領域の上に置く（下に置くと、縦に長い内容ではヒントに気づく前に
          はみ出した側を見落とす。モバイルではクッキーバナー等の下端固定 UI にも隠れやすい） */}
      {showHint && overflowing && (
        <p className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground md:hidden">
          {t("common.scrollHorizontalHint")}
          <ChevronsRight className="h-3 w-3" aria-hidden />
        </p>
      )}
      <div className="relative w-full">
        <div
          ref={ref}
          onScroll={update}
          className={cn("custom-scrollbar overflow-x-auto pb-2 w-full", className)}
        >
          {children}
        </div>
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-y-0 left-0 w-12 bg-gradient-to-r from-card to-transparent transition-opacity",
            edges.left ? "opacity-100" : "opacity-0",
          )}
        />
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-card to-transparent transition-opacity",
            edges.right ? "opacity-100" : "opacity-0",
          )}
        />
      </div>
    </div>
  );
}
