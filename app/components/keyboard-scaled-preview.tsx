import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useT } from "@/hooks/use-locale";
import { Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

const useIsomorphicLayoutEffect = typeof document !== "undefined" ? useLayoutEffect : useEffect;

interface KeyboardScaledPreviewProps {
  /** 縮小表示と拡大 Dialog の両方で描く中身（実寸で描くこと。2回描画される） */
  children: ReactNode;
  dialogTitle: string;
  /** 縮小表示を覆うボタンの aria-label。省略時は keyboardView.expandPreview */
  expandLabel?: string;
  className?: string;
}

/** 計測前（SSR・ハイドレーション直後）に確保する高さの縦横比の仮値（キーボード約 928x300） */
const FALLBACK_ASPECT = 0.34;

/**
 * 実寸の中身（キーボード等）をラッパー幅に合わせて縮小表示し、タップで全画面 Dialog に実寸表示する。
 * 縮小レイヤーは inert（中のボタンを操作・フォーカス対象から外す）で、その上に重ねた1つの button が開閉を受ける。
 * 計測前は縮小レイヤーを visibility:hidden にし、高さは幅×仮の縦横比で確保する（実寸が一瞬出るのを避ける）。
 */
export function KeyboardScaledPreview({
  children,
  dialogTitle,
  expandLabel,
  className,
}: KeyboardScaledPreviewProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState<{ scale: number; height: number } | null>(null);
  const [wrapperWidth, setWrapperWidth] = useState(0);

  useIsomorphicLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    const content = contentRef.current;
    if (!wrapper || !content) return;
    const measure = () => {
      const w = wrapper.clientWidth;
      const cw = content.offsetWidth;
      const ch = content.offsetHeight;
      if (w <= 0 || cw <= 0) return;
      const scale = Math.min(1, w / cw);
      setWrapperWidth(w);
      setMeasured({ scale, height: ch * scale });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrapper);
    ro.observe(content);
    return () => ro.disconnect();
  }, []);

  // Dialog で全体を包み、重ねたボタンを DialogTrigger にする（Radix は閉じたときに trigger へフォーカスを戻すため、
  // trigger が無いとフォーカスが body に落ちる）
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div
        ref={wrapperRef}
        className={cn("relative w-full overflow-hidden", className)}
        style={{ height: measured ? measured.height : wrapperWidth * FALLBACK_ASPECT || undefined, minHeight: measured ? undefined : 96 }}
      >
        <div
          ref={contentRef}
          inert
          className="w-max origin-top-left"
          style={{
            transform: measured ? `scale(${measured.scale})` : undefined,
            visibility: measured ? "visible" : "hidden",
          }}
        >
          {children}
        </div>
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
      </div>
      {open && (
        <DialogContent className="h-[calc(100dvh-2rem)] max-w-[calc(100%-1rem)] grid-rows-[auto_1fr] overflow-auto p-4 sm:max-w-[calc(100%-2rem)]">
          <DialogTitle className="text-sm">{dialogTitle}</DialogTitle>
          <div className="min-h-0 overflow-auto" style={{ touchAction: "pan-x pan-y pinch-zoom" }}>
            <div className="w-max">{children}</div>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
