// 段組（columns / column）の NodeView。
// 旧 index.tsx ColumnsNodeView / ColumnNodeView から逐語移植（class 名 columns-editor*/column-editor を保持）。
import { useT } from "@/hooks/use-locale";
import { NodeViewWrapper, NodeViewContent } from "@tiptap/react";
import { Trash2 } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

export function ColumnsNodeView({
  node,
  deleteNode,
}: {
  node: { attrs: Record<string, unknown> };
  deleteNode: () => void;
}) {
  const t = useT();
  const cols = (node.attrs.cols as number) || 2;
  return (
    <NodeViewWrapper>
      <div className={`columns-editor columns-editor-${cols}`}>
        <div className="columns-editor-label" contentEditable={false}>
          <span>{t("guideEditor.ui.columnsCount", { count: cols })}</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  deleteNode();
                }}
                className="columns-editor-delete"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t("guideEditor.ui.deleteColumns")}</TooltipContent>
          </Tooltip>
        </div>
        <NodeViewContent className="columns-content" />
      </div>
    </NodeViewWrapper>
  );
}

export function ColumnNodeView() {
  return (
    <NodeViewWrapper>
      <NodeViewContent className="column-editor" />
    </NodeViewWrapper>
  );
}
