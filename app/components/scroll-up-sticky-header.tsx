// 対象要素のヘッダがビューポート外にスクロールアウトしたあと、
// **上方向にスクロールした瞬間** に画面上部から「にゅっと」出てくる sticky ヘッダ。
//
// - ヘッダのクローン（`stickyHeader`）を fixed で描画
// - 対象要素の x 位置と幅にトラッキング（テーブル本体と列幅を合わせる）
// - 対象要素自体が画面外に出たら隠す
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

interface Props {
  /** スクロールに合わせて出し入れする sticky ヘッダの中身（テーブルヘッダのクローン） */
  stickyHeader: ReactNode;
  /** 通常のテーブル（オリジナルヘッダを内包） */
  children: ReactNode;
  /** グローバルヘッダの高さ（px） */
  offsetTop?: number;
  /** ラッパの className */
  className?: string;
}

export function ScrollUpStickyHeader({
  stickyHeader,
  children,
  offsetTop = 64,
  className,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [rect, setRect] = useState<{ left: number; width: number }>({
    left: 0,
    width: 0,
  });

  useEffect(() => {
    let ticking = false;
    const syncRect = () => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setRect((prev) =>
        prev.left === r.left && prev.width === r.width
          ? prev
          : { left: r.left, width: r.width },
      );
    };
    const update = () => {
      ticking = false;
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const headerOut = r.top < offsetTop;
      const tableInView = r.bottom > offsetTop + 80;
      const nextVisible = headerOut && tableInView;
      if (nextVisible) syncRect();
      setVisible((prev) => (prev === nextVisible ? prev : nextVisible));
    };
    const onScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(update);
        ticking = true;
      }
    };

    // 初回マウント時に rect を一度取得（リサイズ前に幅 0 のままになるのを防ぐ）
    syncRect();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", syncRect);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", syncRect);
    };
  }, [offsetTop]);

  return (
    <div ref={ref} className={className}>
      <div
        aria-hidden={!visible}
        className={cn(
          "fixed z-30 bg-card border-b-2 shadow-md rounded-t-lg overflow-hidden",
          "transition-transform duration-200 ease-out will-change-transform",
          visible
            ? "translate-y-0 opacity-100 pointer-events-auto"
            : "-translate-y-full opacity-0 pointer-events-none",
        )}
        style={{
          top: offsetTop,
          left: rect.left,
          width: rect.width,
        }}
      >
        {stickyHeader}
      </div>
      {children}
    </div>
  );
}
