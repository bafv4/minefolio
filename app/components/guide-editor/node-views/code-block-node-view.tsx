// コードブロックの NodeView。コピーボタン付き。
// 旧 index.tsx CodeBlockNodeView から逐語移植（class 名 code-block-wrapper/code-block-copy を保持）。
import { useT } from "@/hooks/use-locale";
import { useState, useCallback } from "react";
import { NodeViewWrapper, NodeViewContent } from "@tiptap/react";
import { Copy, ClipboardCheck } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

export function CodeBlockNodeView({
  node,
}: {
  node: { attrs: Record<string, string>; textContent: string };
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(node.textContent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [node.textContent]);

  return (
    <NodeViewWrapper>
      <div className="code-block-wrapper">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleCopy}
              contentEditable={false}
              className="code-block-copy"
            >
              {copied ? (
                <ClipboardCheck className="h-3.5 w-3.5" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent>{t("guideEditor.ui.copy")}</TooltipContent>
        </Tooltip>
        <pre>
          {/* @ts-expect-error as="code" works at runtime */}
          <NodeViewContent as="code" />
        </pre>
      </div>
    </NodeViewWrapper>
  );
}
