// 対象要素のヘッダがビューポート外にスクロールアウトしたあと、
// **上方向にスクロールした瞬間** に画面上部から「にゅっと」出てくる sticky ヘッダ。
//
// - ヘッダのクローン（`stickyHeader`）を fixed で描画
// - 対象要素の x 位置と幅にトラッキング（テーブル本体と列幅を合わせる）
// - 対象要素自体が画面外に出たら隠す
// - `scrollRegionLabel` を渡すと、children を横スクロールの器で包む。クローンは器の位置・幅に合わせ、
//   器の scrollLeft に追従する（クローン自身も overflow-hidden のスクロールの器なので、`sticky left-0` の列も本体と同じく残る）
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";
import { useHorizontalOverflow } from "@/hooks/use-horizontal-overflow";

interface Props {
  /** スクロールに合わせて出し入れする sticky ヘッダの中身（テーブルヘッダのクローン） */
  stickyHeader: ReactNode;
  /** 通常のテーブル（オリジナルヘッダを内包） */
  children: ReactNode;
  /** グローバルヘッダの高さ（px） */
  offsetTop?: number;
  /** ラッパの className */
  className?: string;
  /**
   * 指定すると children を横スクロールの器で包む。はみ出しているときだけ、この名前の region として
   * キーボードで止まれるようにする（収まっているときは Tab の停止点を増やさない）
   */
  scrollRegionLabel?: string;
}

export function ScrollUpStickyHeader({
  stickyHeader,
  children,
  offsetTop = 64,
  className,
  scrollRegionLabel,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const cloneRef = useRef<HTMLDivElement>(null);
  const { ref: scrollRef, regionProps } = useHorizontalOverflow<HTMLDivElement>(
    scrollRegionLabel ?? "",
  );
  const scrollable = scrollRegionLabel !== undefined;
  const [visible, setVisible] = useState(false);
  const [rect, setRect] = useState<{ left: number; width: number }>({
    left: 0,
    width: 0,
  });

  useEffect(() => {
    let ticking = false;
    // 横スクロールの器があるときはクローンの位置・幅を器（枠線の内側）に合わせ、scrollLeft も写す
    const syncScrollLeft = () => {
      const scrollEl = scrollRef.current;
      const clone = cloneRef.current;
      if (!scrollable || !scrollEl || !clone) return;
      if (clone.scrollLeft !== scrollEl.scrollLeft) clone.scrollLeft = scrollEl.scrollLeft;
    };
    const syncRect = () => {
      const el = scrollable ? scrollRef.current : ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = scrollable ? el.clientWidth : r.width;
      setRect((prev) =>
        prev.left === r.left && prev.width === width
          ? prev
          : { left: r.left, width },
      );
      syncScrollLeft();
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
    const scrollEl = scrollable ? scrollRef.current : null;
    scrollEl?.addEventListener("scroll", syncScrollLeft, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", syncRect);
      scrollEl?.removeEventListener("scroll", syncScrollLeft);
    };
  }, [offsetTop, scrollable, scrollRef]);

  // 幅が変わってクローンが描き直された直後にも scrollLeft を合わせ直す
  useEffect(() => {
    const scrollEl = scrollRef.current;
    const clone = cloneRef.current;
    if (!scrollable || !scrollEl || !clone) return;
    clone.scrollLeft = scrollEl.scrollLeft;
  }, [rect, visible, scrollable, scrollRef]);

  return (
    <div ref={ref} className={className}>
      <div
        ref={cloneRef}
        aria-hidden={!visible}
        className={cn(
          // 角丸は重ねる先の表の枠（rankings.tsx の TABLE_FRAME_CLASS = rounded-xl）と揃える
          "fixed z-30 bg-card border-b-2 shadow-md rounded-t-xl overflow-hidden",
          "transition-transform duration-200 ease-out will-change-transform motion-reduce:transition-none",
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
      {scrollable ? (
        <>
          {/* isolate: 中の sticky セルの z-index を器の中に閉じ、後ろのフォーカスリングの層が確実に上に来るようにする */}
          <div
            ref={scrollRef}
            className="peer custom-scrollbar isolate overflow-x-auto focus-visible:outline-none"
            {...regionProps}
          >
            {children}
          </div>
          {/* キーボードで器に止まったときのリング（不透明の --ring の 2px、内側）。
              sticky セルに隠されないよう、器の外の上の層に描く */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 z-10 rounded-[inherit] peer-focus-visible:ring-2 peer-focus-visible:ring-inset peer-focus-visible:ring-ring"
          />
        </>
      ) : (
        children
      )}
    </div>
  );
}
