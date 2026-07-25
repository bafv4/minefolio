// 画像ブロックの NodeView。リサイズ（ドラッグ）・削除・幅ラベルを提供。
// 旧 index.tsx ImageNodeView から逐語移植（互換性のため描画/属性更新を変更しない）。
import { useState, useCallback, useRef } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import { Trash2, AlignLeft, AlignCenter, AlignRight, X } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** 配置ボタン（TableAlignRow と同じ「3つのアイコン + ✕で解除」の形） */
const ALIGN_BUTTONS = [
  { value: "left", icon: AlignLeft, label: "左揃え" },
  { value: "center", icon: AlignCenter, label: "中央揃え" },
  { value: "right", icon: AlignRight, label: "右揃え" },
] as const;

/** 配置に応じたラッパーの寄せ方（公開ページの app.css と対になる） */
const WRAPPER_ALIGN_CLASS: Record<string, string> = {
  left: "mr-auto",
  center: "mx-auto",
  right: "ml-auto",
};

export function ImageNodeView({
  node,
  deleteNode,
  updateAttributes,
  selected,
}: {
  node: { attrs: Record<string, string | number | null> };
  deleteNode: () => void;
  updateAttributes: (attrs: Record<string, unknown>) => void;
  selected: boolean;
}) {
  const [resizing, setResizing] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const width = node.attrs.width ? Number(node.attrs.width) : undefined;
  const align = node.attrs.align ? String(node.attrs.align) : "";

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
          src={String(node.attrs.src)}
          alt={String(node.attrs.alt || "")}
          className="max-w-full rounded-lg"
          style={{ width: width ? `${width}px` : undefined }}
          draggable={false}
        />
        {/* 配置 + 削除。ホバー時のみ表示する */}
        <div className="absolute top-2 right-2 flex items-center gap-0.5 rounded-md bg-black/60 p-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          {ALIGN_BUTTONS.map(({ value, icon: Icon, label }) => (
            <Tooltip key={value}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    // 同じ配置をもう一度押したら解除する
                    updateAttributes({ align: align === value ? null : value });
                  }}
                  aria-label={label}
                  aria-pressed={align === value}
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded text-white transition-colors",
                    align === value ? "bg-white/30" : "hover:bg-white/20",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{label}</TooltipContent>
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
                  aria-label="配置を解除"
                  className="flex h-6 w-6 items-center justify-center rounded text-white transition-colors hover:bg-white/20"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>配置を解除</TooltipContent>
            </Tooltip>
          )}
          <span className="mx-0.5 h-4 w-px bg-white/30" aria-hidden />
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  deleteNode();
                }}
                aria-label="画像を削除"
                className="flex h-6 w-6 items-center justify-center rounded text-white transition-colors hover:bg-white/20"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>画像を削除</TooltipContent>
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
    </NodeViewWrapper>
  );
}
