// コールアウトの NodeView。タイプは挿入時に確定し、固定（クリックでの切替なし）。
// 旧 index.tsx CalloutNodeView から移植（class 名 callout/callout-${type} を保持）。
import { NodeViewWrapper, NodeViewContent } from "@tiptap/react";
import { CALLOUT_ICONS } from "../constants";

export function CalloutNodeView({ node }: {
  node: { attrs: Record<string, string> };
}) {
  const calloutType = node.attrs.calloutType || "tip";

  return (
    <NodeViewWrapper>
      <div className={`callout callout-${calloutType}`}>
        <span className="callout-icon" contentEditable={false}>
          {CALLOUT_ICONS[calloutType] || "💡"}
        </span>
        <div className="callout-body">
          <NodeViewContent />
        </div>
      </div>
    </NodeViewWrapper>
  );
}
