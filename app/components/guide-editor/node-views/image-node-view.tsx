// 画像ブロックの NodeView。リサイズ（ドラッグ）・配置・トリミング・削除・幅ラベルを提供。
// 切り出しとアップロードは宿主（GuideEditor）が持ち、extensions/image.ts の
// ストレージ経由で注入された GuideMediaContext から呼ぶ。
import type { MessageKey } from "@/lib/messages";
import { useState, useCallback, useRef } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import { Trash2, AlignLeft, AlignCenter, AlignRight, X, Crop } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useT } from "@/hooks/use-locale";
import { getImageMediaContext } from "../extensions/image";
import { ImageCropDialog } from "../panels/image-crop-dialog";
import type { CropRect } from "../lib/image-crop";

/** 配置ボタン（TableAlignRow と同じ「3つのアイコン + ✕で解除」の形） */
const ALIGN_BUTTONS = [
  { value: "left", icon: AlignLeft, labelKey: "guideEditor.ui.alignLeft" },
  { value: "center", icon: AlignCenter, labelKey: "guideEditor.ui.alignCenter" },
  { value: "right", icon: AlignRight, labelKey: "guideEditor.ui.alignRight" },
] as const satisfies ReadonlyArray<{ value: string; icon: unknown; labelKey: MessageKey }>;

/** 配置に応じたラッパーの寄せ方（公開ページの app.css と対になる） */
const WRAPPER_ALIGN_CLASS: Record<string, string> = {
  left: "mr-auto",
  center: "mx-auto",
  right: "ml-auto",
};

export function ImageNodeView({
  editor,
  node,
  deleteNode,
  updateAttributes,
  selected,
}: {
  editor: Editor;
  node: { attrs: Record<string, string | number | null> };
  deleteNode: () => void;
  updateAttributes: (attrs: Record<string, unknown>) => void;
  selected: boolean;
}) {
  const t = useT();
  const [resizing, setResizing] = useState(false);
  const [cropOpen, setCropOpen] = useState(false);
  const [cropping, setCropping] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const src = String(node.attrs.src);
  const width = node.attrs.width ? Number(node.attrs.width) : undefined;
  const align = node.attrs.align ? String(node.attrs.align) : "";

  const handleCropApply = useCallback(
    async (rect: CropRect) => {
      const media = getImageMediaContext(editor);
      if (!media) return;
      setCropping(true);
      try {
        const url = await media.cropImage(src, rect);
        if (!url) return;
        updateAttributes({
          src: url,
          // 表示幅は残した領域の割合だけ縮める。こうすると切り出した部分の
          // 画面上の大きさが操作前と変わらず、レイアウトが跳ねない
          width: width ? Math.max(100, Math.round(width * rect.width)) : null,
        });
        setCropOpen(false);
      } finally {
        setCropping(false);
      }
    },
    [editor, src, width, updateAttributes],
  );

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!imgRef.current) return;
    setResizing(true);
    startXRef.current = e.clientX;
    startWidthRef.current = imgRef.current.offsetWidth;

    const onMove = (ev: MouseEvent) => {
      const diff = ev.clientX - startXRef.current;
      const newWidth = Math.max(100, startWidthRef.current + diff);
      updateAttributes({ width: newWidth });
    };
    const onUp = () => {
      setResizing(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [updateAttributes]);

  return (
    <NodeViewWrapper>
      <div
        className={cn(
          "relative group my-2",
          // 配置指定時はブロック化して寄せる（inline-block のままだと margin:auto が効かない）。
          // 未設定は従来どおり inline-block ＝ 行の流れに従う
          align ? cn("w-fit", WRAPPER_ALIGN_CLASS[align]) : "inline-block",
          (selected || resizing) && "ring-2 ring-primary/50 rounded-lg",
        )}
      >
        <img
          ref={imgRef}
          src={src}
          alt={String(node.attrs.alt || "")}
          className="max-w-full rounded-lg"
          style={{ width: width ? `${width}px` : undefined }}
          draggable={false}
        />
        {/* 配置 + トリミング + 削除。ホバー時、および選択中（ホバーできないタッチ環境）に表示する */}
        <div
          className={cn(
            "absolute top-2 right-2 flex items-center gap-0.5 rounded-md bg-black/60 p-0.5 opacity-0 transition-opacity group-hover:opacity-100",
            selected && "opacity-100",
          )}
        >
          {ALIGN_BUTTONS.map(({ value, icon: Icon, labelKey }) => (
            <Tooltip key={value}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    // 同じ配置をもう一度押したら解除する
                    updateAttributes({ align: align === value ? null : value });
                  }}
                  aria-label={t(labelKey)}
                  aria-pressed={align === value}
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded text-white transition-colors",
                    align === value ? "bg-white/30" : "hover:bg-white/20",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{t(labelKey)}</TooltipContent>
            </Tooltip>
          ))}
          {align && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    updateAttributes({ align: null });
                  }}
                  aria-label={t("guideEditor.ui.clearImageAlign")}
                  className="flex h-6 w-6 items-center justify-center rounded text-white transition-colors hover:bg-white/20"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{t("guideEditor.ui.clearImageAlign")}</TooltipContent>
            </Tooltip>
          )}
          <span className="mx-0.5 h-4 w-px bg-white/30" aria-hidden />
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setCropOpen(true);
                }}
                aria-label={t("guideEditor.cropTitle")}
                className="flex h-6 w-6 items-center justify-center rounded text-white transition-colors hover:bg-white/20"
              >
                <Crop className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t("guideEditor.cropTitle")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  deleteNode();
                }}
                aria-label={t("guideEditor.ui.deleteImage")}
                className="flex h-6 w-6 items-center justify-center rounded text-white transition-colors hover:bg-white/20"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t("guideEditor.ui.deleteImage")}</TooltipContent>
          </Tooltip>
        </div>
        {/* Resize handle */}
        <div
          onMouseDown={handleResizeStart}
          className="absolute right-0 bottom-0 w-4 h-4 cursor-se-resize opacity-0 group-hover:opacity-100 transition-opacity"
          style={{
            background: "linear-gradient(135deg, transparent 50%, var(--primary) 50%)",
            borderRadius: "0 0 0.5rem 0",
          }}
        />
        {width && (
          <span className="absolute bottom-1 left-1 text-[10px] text-white bg-black/50 rounded px-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {width}px
          </span>
        )}
      </div>
      {/* Dialog ルート自体は DOM を持たず、中身は Radix の Portal で body 直下に描画される */}
      <ImageCropDialog
        src={cropOpen ? src : null}
        onOpenChange={(open) => !open && setCropOpen(false)}
        onApply={handleCropApply}
        applying={cropping}
      />
    </NodeViewWrapper>
  );
}
