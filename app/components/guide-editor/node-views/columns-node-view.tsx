// 段組（columns / column）の NodeView。
// 旧 index.tsx ColumnsNodeView / ColumnNodeView から逐語移植（class 名 columns-editor*/column-editor を保持）。
import { NodeViewWrapper, NodeViewContent } from "@tiptap/react";
import { Trash2 } from "lucide-react";

export function ColumnsNodeView({
  node,
  deleteNode,
}: {
  node: { attrs: Record<string, unknown> };
  deleteNode: () => void;
}) {
  const cols = (node.attrs.cols as number) || 2;
  return (
    <NodeViewWrapper>
      <div className={`columns-editor columns-editor-${cols}`}>
        <div className="columns-editor-label" contentEditable={false}>
          <span>{cols}カラム</span>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              deleteNode();
            }}
            title="段組を削除"
            className="columns-editor-delete"
          >
            <Trash2 className="h-3 w-3" />
          </button>
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
