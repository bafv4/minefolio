// ガイドリンクカードの NodeView。カバー画像 + タイトル + 著者を表示。
// 旧 index.tsx GuideLinkNodeView から逐語移植（class 名 guide-link-* を保持）。
import { useT } from "@/hooks/use-locale";
import { NodeViewWrapper } from "@tiptap/react";
import { Trash2 } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

export function GuideLinkNodeView({
  node,
  deleteNode,
}: {
  node: { attrs: Record<string, string> };
  deleteNode: () => void;
}) {
  const t = useT();
  return (
    <NodeViewWrapper>
      <div className="guide-link-card group" contentEditable={false}>
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
            {/* 保存 HTML（guide-link.ts の renderHTML）と同じ span。印は app.css が描く */}
            <span className="guide-link-icon" aria-hidden>
              📄
            </span>
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
          <TooltipContent>{t("guideEditor.ui.removeLink")}</TooltipContent>
        </Tooltip>
      </div>
    </NodeViewWrapper>
  );
}
