// ガイドリンクカードの NodeView。カバー画像 + タイトル + 著者を表示。
// 旧 index.tsx GuideLinkNodeView から逐語移植（class 名 guide-link-* を保持）。
import { NodeViewWrapper } from "@tiptap/react";
import { FileText, Trash2 } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

export function GuideLinkNodeView({
  node,
  deleteNode,
}: {
  node: { attrs: Record<string, string> };
  deleteNode: () => void;
}) {
  return (
    <NodeViewWrapper>
      <div className="guide-link-card" contentEditable={false}>
        <a
          href={node.attrs.guideUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="guide-link-inner"
        >
          {node.attrs.coverImageUrl && (
            <img
              src={node.attrs.coverImageUrl}
              alt=""
              className="guide-link-cover"
            />
          )}
          <div className="guide-link-body">
            <div className="guide-link-icon">
              <FileText className="h-4 w-4" />
            </div>
            <div className="guide-link-text">
              <span className="guide-link-title">{node.attrs.guideTitle}</span>
              {node.attrs.authorName && (
                <span className="guide-link-author">{node.attrs.authorName}</span>
              )}
            </div>
          </div>
        </a>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                deleteNode();
              }}
              className="absolute top-2 right-2 h-6 w-6 flex items-center justify-center bg-black/60 text-white rounded-md opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </TooltipTrigger>
          <TooltipContent>リンクを削除</TooltipContent>
        </Tooltip>
      </div>
    </NodeViewWrapper>
  );
}
