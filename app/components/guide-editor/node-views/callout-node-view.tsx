// コールアウトの NodeView。アイコンクリックで tip→info→warning→danger を循環。
// 旧 index.tsx CalloutNodeView から逐語移植（class 名 callout/callout-${type} を保持）。
import { NodeViewWrapper, NodeViewContent } from "@tiptap/react";
import { CALLOUT_ICONS } from "../constants";

export function CalloutNodeView({ node, updateAttributes }: {
  node: { attrs: Record<string, string> };
  updateAttributes: (attrs: Record<string, string>) => void;
}) {
  const calloutType = node.attrs.calloutType || "tip";
  const types = ["tip", "info", "warning", "danger"] as const;

  return (
    <NodeViewWrapper>
      <div className={`callout callout-${calloutType}`}>
        <button
          type="button"
          className="callout-icon"
          contentEditable={false}
          onMouseDown={(e) => {
            e.preventDefault();
            const idx = types.indexOf(calloutType as typeof types[number]);
            const next = types[(idx + 1) % types.length];
            updateAttributes({ calloutType: next });
          }}
          title="タイプ切替"
        >
          {CALLOUT_ICONS[calloutType] || "💡"}
        </button>
        <div className="callout-body">
          <NodeViewContent />
        </div>
      </div>
    </NodeViewWrapper>
  );
}
