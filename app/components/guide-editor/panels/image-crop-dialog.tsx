// 画像トリミングのダイアログ。矩形の計算は lib/image-crop.ts（純粋関数）に委譲し、
// ここは表示・ポインタ操作・比率プリセットの UI だけを持つ。
// 実際の切り出しとアップロードは呼び出し側（ImageNodeView → GuideEditor）が行う。
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { t } from "@/lib/messages";
import {
  FULL_CROP,
  clampCropRect,
  moveCropRect,
  resizeCropRect,
  fitCropRectToAspect,
  toNormalizedAspect,
  toPixelRect,
  isCropped,
  type CropRect,
  type CropHandle,
} from "../lib/image-crop";

/** 比率プリセット（value はピクセル比。null = 自由変形）。
 *  比率表記は言語非依存なので key をそのままラベルに使い、「自由」だけ翻訳する */
const ASPECT_PRESETS: { key: string; value: number | null }[] = [
  { key: "free", value: null },
  { key: "1:1", value: 1 },
  { key: "4:3", value: 4 / 3 },
  { key: "3:4", value: 3 / 4 },
  { key: "16:9", value: 16 / 9 },
  { key: "9:16", value: 9 / 16 },
];

/** ハンドルの配置とカーソル。枠線の上に半分はみ出させて掴みやすくする */
const HANDLE_CLASS: Record<CropHandle, string> = {
  nw: "left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize",
  n: "left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize",
  ne: "right-0 top-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize",
  e: "right-0 top-1/2 translate-x-1/2 -translate-y-1/2 cursor-ew-resize",
  se: "right-0 bottom-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize",
  s: "left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-ns-resize",
  sw: "left-0 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize",
  w: "left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize",
};

const CORNER_HANDLES: CropHandle[] = ["nw", "ne", "se", "sw"];
// 比率固定中は辺ハンドルを出さない（片方の寸法だけ動かすと比率を保てないため、
// 角ドラッグに一本化する。lib/image-crop.ts の resizeCropRect もこの前提）
const EDGE_HANDLES: CropHandle[] = ["n", "e", "s", "w"];

interface ImageCropDialogProps {
  /** トリミング対象の画像 URL。null なら閉じている */
  src: string | null;
  onOpenChange: (open: boolean) => void;
  /** 切り出し矩形の確定（切り出し・アップロードは呼び出し側） */
  onApply: (rect: CropRect) => void;
  /** 適用処理の実行中（ボタンをスピナーにして二重送信を防ぐ） */
  applying?: boolean;
}

export function ImageCropDialog({ src, onOpenChange, onApply, applying }: ImageCropDialogProps) {
  const [rect, setRect] = useState<CropRect>(FULL_CROP);
  const [aspectKey, setAspectKey] = useState("free");
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  // 開き直すたびに初期状態へ戻す（前回の矩形が別の画像に持ち越されないように）
  useEffect(() => {
    if (!src) return;
    setRect(FULL_CROP);
    setAspectKey("free");
    setNatural(null);
  }, [src]);

  const pixelAspect = ASPECT_PRESETS.find((p) => p.key === aspectKey)?.value ?? null;
  // 正規化座標系は画像の縦横比の分だけ歪んでいるので、ピクセル比を変換して使う
  const aspect = useMemo(
    () =>
      pixelAspect && natural
        ? toNormalizedAspect(pixelAspect, natural.width, natural.height)
        : null,
    [pixelAspect, natural],
  );

  const selectAspect = (key: string) => {
    setAspectKey(key);
    const preset = ASPECT_PRESETS.find((p) => p.key === key)?.value ?? null;
    if (!preset || !natural) return;
    setRect((current) =>
      fitCropRectToAspect(toNormalizedAspect(preset, natural.width, natural.height), current),
    );
  };

  /** 枠の移動（handle = null）とリサイズを共通で扱う */
  const startDrag = useCallback(
    (e: React.PointerEvent<HTMLElement>, handle: CropHandle | null) => {
      // ダイアログのドラッグ選択や、枠移動とハンドル操作の二重発火を止める
      e.preventDefault();
      e.stopPropagation();
      const bounds = frameRef.current?.getBoundingClientRect();
      if (!bounds || bounds.width === 0 || bounds.height === 0) return;

      const startX = e.clientX;
      const startY = e.clientY;
      const startRect = rect;
      // 枠の外や画面外までドラッグしても追従させる。capture は補助で、
      // 失敗しても window のリスナーだけで成立する（合成イベント等では例外になる）
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* 捕捉できなくても window のリスナーで追従する */
      }

      const onMove = (ev: PointerEvent) => {
        const dx = (ev.clientX - startX) / bounds.width;
        const dy = (ev.clientY - startY) / bounds.height;
        setRect(
          handle
            ? resizeCropRect(startRect, handle, dx, dy, aspect)
            : moveCropRect(startRect, dx, dy),
        );
      };
      const onEnd = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onEnd);
        window.removeEventListener("pointercancel", onEnd);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onEnd);
      window.addEventListener("pointercancel", onEnd);
    },
    [rect, aspect],
  );

  const pixels = natural ? toPixelRect(rect, natural.width, natural.height) : null;
  const cropped = isCropped(rect);
  const handles = aspect ? CORNER_HANDLES : [...CORNER_HANDLES, ...EDGE_HANDLES];

  return (
    <Dialog open={src !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("guideEditor.cropTitle")}</DialogTitle>
          <DialogDescription>{t("guideEditor.cropDesc")}</DialogDescription>
        </DialogHeader>

        {/* 比率プリセット */}
        <div className="flex flex-wrap gap-1.5">
          {ASPECT_PRESETS.map((preset) => (
            <Button
              key={preset.key}
              type="button"
              size="sm"
              variant={aspectKey === preset.key ? "default" : "outline"}
              className="h-7 px-2.5 text-xs"
              onClick={() => selectAspect(preset.key)}
              disabled={!natural}
            >
              {preset.value === null ? t("guideEditor.cropAspectFree") : preset.key}
            </Button>
          ))}
        </div>

        <div className="flex justify-center">
          <div
            ref={frameRef}
            className="relative touch-none overflow-hidden rounded-md bg-muted/40 select-none"
          >
            {src && (
              <img
                src={src}
                alt=""
                className="block max-h-[55vh] max-w-full"
                draggable={false}
                onLoad={(e) =>
                  setNatural({
                    width: e.currentTarget.naturalWidth,
                    height: e.currentTarget.naturalHeight,
                  })
                }
              />
            )}
            {natural && (
              <div
                className="absolute cursor-move border border-white/90"
                style={{
                  left: `${rect.x * 100}%`,
                  top: `${rect.y * 100}%`,
                  width: `${rect.width * 100}%`,
                  height: `${rect.height * 100}%`,
                  // 枠の外側を一様に暗くする（要素 1 つで済むよう巨大な box-shadow を使い、
                  // 親の overflow-hidden で切り取る）
                  boxShadow: "0 0 0 9999px rgba(0,0,0,0.5)",
                }}
                onPointerDown={(e) => startDrag(e, null)}
              >
                {/* 三分割ガイド */}
                <div className="pointer-events-none absolute inset-0">
                  <div className="absolute top-1/3 right-0 left-0 border-t border-white/30" />
                  <div className="absolute bottom-1/3 left-0 w-full border-t border-white/30" />
                  <div className="absolute top-0 bottom-0 left-1/3 border-l border-white/30" />
                  <div className="absolute top-0 right-1/3 bottom-0 border-l border-white/30" />
                </div>
                {handles.map((handle) => (
                  <span
                    key={handle}
                    role="presentation"
                    onPointerDown={(e) => startDrag(e, handle)}
                    className={cn(
                      "absolute h-3.5 w-3.5 rounded-sm border border-black/40 bg-white",
                      HANDLE_CLASS[handle],
                    )}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          {pixels
            ? t("guideEditor.cropSize", { width: pixels.sw, height: pixels.sh })
            : t("guideEditor.cropLoading")}
        </p>

        <DialogFooter className="sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setRect(clampCropRect(FULL_CROP))}
            disabled={!cropped || applying}
          >
            {t("guideEditor.cropReset")}
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={applying}
            >
              {t("guideEditor.cropCancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => onApply(rect)}
              disabled={!cropped || applying}
            >
              {applying && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t("guideEditor.cropApply")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
