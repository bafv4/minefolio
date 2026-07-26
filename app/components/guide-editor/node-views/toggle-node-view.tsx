// トグルリスト（details/summary）の NodeView。サマリーをインライン編集可能。
// 旧 index.tsx ToggleListNodeView から逐語移植（class 名 toggle-content/toggle-summary-input を保持）。
import { useT } from "@/hooks/use-locale";
import { NodeViewWrapper, NodeViewContent } from "@tiptap/react";

export function ToggleListNodeView({ node, updateAttributes }: {
  node: { attrs: Record<string, string> };
  updateAttributes: (attrs: Record<string, string>) => void;
}) {
  const t = useT();
  const summaryText =
    node.attrs.summaryText || t("guideEditor.ui.toggleSummaryDefault");

  return (
    <NodeViewWrapper>
      <details open>
        <summary contentEditable={false}>
          <input
            type="text"
            value={summaryText}
            onChange={(e) => updateAttributes({ summaryText: e.target.value })}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            className="toggle-summary-input"
            placeholder={t("guideEditor.ui.toggleSummaryDefault")}
          />
        </summary>
        <div className="toggle-content">
          <NodeViewContent />
        </div>
      </details>
    </NodeViewWrapper>
  );
}
