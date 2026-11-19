import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useT } from "@/hooks/use-locale";
import { Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

const useIsomorphicLayoutEffect = typeof document !== "undefined" ? useLayoutEffect : useEffect;

interface KeyboardScaledPreviewProps {
  /** 縮小表示と拡大 Dialog の両方で描く中身（実寸で描くこと。2回描画される） */
  children: ReactNode;
  dialogTitle: string;
  /** 縮小表示を覆うボタンの aria-label。省略時は keyboardView.expandPreview */
  expandLabel?: string;
  className?: string;
  /**
   * 切り出し表示。`media` に一致する間だけ、中身の左端から `width`（実寸 px）までをラッパー幅に合わせて
   * 縮小し、右側は切り落とす（スクロールさせない）。切り落とした側には「続きがある」ことを示すフェードを重ねる。
   * 省略時（既定）は従来どおり中身の全幅を収める。拡大 Dialog の中身はどちらでも全体のまま
   */
  crop?: {
    width: number;
    /** matchMedia に渡すクエリ（例: "(width < 48rem)"） */
    media: string;
    /** フェードの色を置き場所の面に合わせる（HorizontalScrollArea の surface と同じ考え方。既定は card） */
    surface?: "card" | "background";
  };
  /**
   * 計測前（SSR・ハイドレーション直後）だけラッパーに付けるクラス。高さの見込み（`aspect-*` 等）を
   * 置き場所ごとに確保して、計測後に高さが跳ねないようにする。省略時は従来の仮の高さ
   */
  unmeasuredClassName?: string;
  /**
   * true のとき、縮小・切り出し中も中身を操作できる（inert・拡大ボタン・拡大 Dialog を出さない。
   * 編集画面のようにキーを押して使う置き場所向け）。全体を見る手段は呼び出し側が別に用意する。
   * 省略時（既定）は読み取り専用の表示
   */
  interactive?: boolean;
}

/**
 * md 未満の切り出し表示（キーボードの左手側）。仮想キーボードの 1 ユニットは 60px ＋ 間隔 2px で、
 * 左から 7.75 ユニット（Z 段の B の右端＝7.25 ユニット〔447.5px〕に、右端のフェード〔画面 16px ≒ 中身 25px〕が
 * B に掛からない分を足す）を幅いっぱいに見せる。公開の一覧（card-view）と編集画面で共有する
 */
const LEFT_HAND_CROP_UNITS = 7.75;
const KEY_PITCH_PX = 62;
export const LEFT_HAND_CROP = {
  width: LEFT_HAND_CROP_UNITS * KEY_PITCH_PX - 2, // 478.5px
  media: "(width < 48rem)",
} as const;

/** 計測前（SSR・ハイドレーション直後）に確保する高さの縦横比の仮値（キーボード約 928x300） */
const FALLBACK_ASPECT = 0.34;

/**
 * 実寸の中身（キーボード等）をラッパー幅に合わせて縮小表示し、タップで全画面 Dialog に実寸表示する。
 * 縮小レイヤーは inert（中のボタンを操作・フォーカス対象から外す）で、その上に重ねた1つの button が開閉を受ける。
 * 縮小していない（scale が 1）ときは、拡大の印・ボタン・inert を出さず、ツールチップが効く通常の表示にする。
 * 計測前は縮小レイヤーを visibility:hidden にし、高さは幅×仮の縦横比で確保する（実寸が一瞬出るのを避ける）。
 */
export function KeyboardScaledPreview({
  children,
  dialogTitle,
  expandLabel,
  className,
  crop,
  unmeasuredClassName,
  interactive = false,
}: KeyboardScaledPreviewProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState<{ scale: number; height: number; cropped: boolean } | null>(
    null,
  );
  const [wrapperWidth, setWrapperWidth] = useState(0);
  const cropWidth = crop?.width;
  const cropMedia = crop?.media;

  useIsomorphicLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    const content = contentRef.current;
    if (!wrapper || !content) return;
    // 切り出しの有無は計測（クライアントのみ）の中で決める。描画の分岐に使うのは計測後の状態だけなので SSR とずれない
    const mql =
      cropWidth != null && cropMedia && typeof window.matchMedia === "function"
        ? window.matchMedia(cropMedia)
        : null;
    const measure = () => {
      const w = wrapper.clientWidth;
      const cw = content.offsetWidth;
      const ch = content.offsetHeight;
      if (w <= 0 || cw <= 0) return;
      const cropped = mql != null && mql.matches && cropWidth != null && cropWidth < cw;
      const fitWidth = cropped ? cropWidth : cw;
      const scale = Math.min(1, w / fitWidth);
      setWrapperWidth(w);
      setMeasured({ scale, height: ch * scale, cropped });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrapper);
    ro.observe(content);
    // content-visibility:auto の祖先は、画面外では描画（レイアウト）が省かれ、ResizeObserver も届かない。
    // 幅が変わった後に画面へ入ったときに測り直せるよう、交差の変化でも再計測する。
    // ウィンドウの幅変更も直接拾う（監視対象のサイズ変化が通知されない経路の保険）
    const io = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(measure);
    io?.observe(wrapper);
    window.addEventListener("resize", measure);
    mql?.addEventListener("change", measure);
    return () => {
      ro.disconnect();
      io?.disconnect();
      window.removeEventListener("resize", measure);
      mql?.removeEventListener("change", measure);
    };
  }, [cropWidth, cropMedia]);

  // 縮小しているとき・切り出しているときだけ、拡大の操作（ボタン・印）を出して中身を inert にする
  // （切り出し中は scale が 1 でも右側が見えないので、拡大で全体を見られるようにし、見えないキーに Tab を止めない）
  const scaled = !interactive && (measured == null || measured.scale < 1 || measured.cropped);

  // Dialog で全体を包み、重ねたボタンを DialogTrigger にする（Radix は閉じたときに trigger へフォーカスを戻すため、
  // trigger が無いとフォーカスが body に落ちる）
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div
        ref={wrapperRef}
        className={cn("relative w-full overflow-hidden", className, !measured && unmeasuredClassName)}
        style={{ height: measured ? measured.height : wrapperWidth * FALLBACK_ASPECT || undefined, minHeight: measured ? undefined : 96 }}
      >
        <div
          ref={contentRef}
          inert={scaled}
          className="w-max origin-top-left"
          style={{
            transform: measured ? `scale(${measured.scale})` : undefined,
            visibility: measured ? "visible" : "hidden",
          }}
        >
          {children}
        </div>
        {/* 切り出したときだけ、切り落とした右端に「続きがある」ことを示すフェード（面の色に合わせる） */}
        {measured?.cropped && (
          <div
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute inset-y-0 right-0 w-4 bg-gradient-to-l to-transparent",
              crop?.surface === "background" ? "from-background" : "from-card",
            )}
          />
        )}
        {scaled && (
          <>
            <DialogTrigger asChild>
              <button
                type="button"
                aria-label={expandLabel ?? t("keyboardView.expandPreview")}
                className="absolute inset-0 cursor-zoom-in rounded-lg focus-visible:ring-2 focus-visible:ring-ring"
              />
            </DialogTrigger>
            {/* 拡大できることを示す装飾チップ（クリックは下のボタンに通す） */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute bottom-2 right-2 inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background/75 px-2.5 py-1 text-xs text-muted-foreground"
            >
              <Maximize2 className="h-3 w-3" />
              {t("keyboardView.expandChip")}
            </span>
          </>
        )}
      </div>
      {open && scaled && (
        <DialogContent className="h-[calc(100dvh-2rem)] max-w-[calc(100%-1rem)] grid-rows-[auto_1fr] overflow-auto p-4 sm:max-w-[calc(100%-2rem)]">
          <DialogHeader className="gap-1">
            <DialogTitle className="text-sm">{dialogTitle}</DialogTitle>
            {/* タッチ向けの案内（md 未満のみ。キーボード操作の案内は各キーボードの arrowKeyHint が担う） */}
            <DialogDescription className="text-xs md:hidden">{t("keyboardView.touchHint")}</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 overflow-auto" style={{ touchAction: "pan-x pan-y pinch-zoom" }}>
            <div className="w-max">{children}</div>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
