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
  /** はみ出し時に「横にスクロールできます」を表示する（既定は狭い画面のみ。hintAtAllWidths で全幅） */
  showHint?: boolean;
  /**
   * true なら案内を md 以上でも出す（実際にはみ出しているときだけ）。デスクトップでも幅が足りない物
   * （記事のキー配置の鍵盤など）に使う。既定 false＝従来どおり md 未満のみ
   */
  hintAtAllWidths?: boolean;
  /** 端のフェードの色＝置き場所の面。既定はカード内（bg-card）、箱なしの欄に置くときは "background" */
  surface?: "card" | "background";
}

/**
 * 横にはみ出す要素を包み、続きがある側にだけ端のフェードを出すスクロール領域。
 * はみ出していないときはレイアウトも見た目も通常の overflow-x-auto と変わらない。
 * フェードの色は置き場所の面に合わせる（既定はカード内の bg-card、箱なしの欄では surface="background"）。
 */
export function HorizontalScrollArea({
  children,
  className,
  wrapperClassName,
  showHint = false,
  hintAtAllWidths = false,
  surface = "card",
}: HorizontalScrollAreaProps) {
  const fadeFrom = surface === "background" ? "from-background" : "from-card";
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
        <p className={cn("mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground", !hintAtAllWidths && "md:hidden")}>
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
            "pointer-events-none absolute inset-y-0 left-0 w-12 bg-gradient-to-r to-transparent transition-opacity",
            fadeFrom,
            edges.left ? "opacity-100" : "opacity-0",
          )}
        />
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l to-transparent transition-opacity",
            fadeFrom,
            edges.right ? "opacity-100" : "opacity-0",
          )}
        />
      </div>
    </div>
  );
}
