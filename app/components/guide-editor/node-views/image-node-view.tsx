// 画像ブロックの NodeView。リサイズ（ドラッグ）・削除・幅ラベルを提供。
// 旧 index.tsx ImageNodeView から逐語移植（互換性のため描画/属性更新を変更しない）。
import { useState, useCallback, useRef } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import { Trash2 } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

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
      <div className={cn("relative group my-2 inline-block", (selected || resizing) && "ring-2 ring-primary/50 rounded-lg")}>
        <img
          ref={imgRef}
          src={String(node.attrs.src)}
          alt={String(node.attrs.alt || "")}
          className="max-w-full rounded-lg"
          style={{ width: width ? `${width}px` : undefined }}
          draggable={false}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                deleteNode();
              }}
              className="absolute top-2 right-2 h-7 w-7 flex items-center justify-center bg-black/60 text-white rounded-md opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>画像を削除</TooltipContent>
        </Tooltip>
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
