// コールアウトの NodeView。タイプは挿入時に確定し、固定（クリックでの切替なし）。
// 旧 index.tsx CalloutNodeView から移植（class 名 callout/callout-${type} を保持）。
// アイコンは公開ビューの ::before と同じ CSS（app/app.css の .callout-icon。lucide の線画を mask で
// 種類の意味色に塗る）で描くので、ここでは中身の無い装飾の span を置くだけ。
import { NodeViewWrapper, NodeViewContent } from "@tiptap/react";

export function CalloutNodeView({ node }: {
  node: { attrs: Record<string, string> };
}) {
  const calloutType = node.attrs.calloutType || "tip";

  return (
    <NodeViewWrapper>
      <div className={`callout callout-${calloutType}`}>
        <span className="callout-icon" contentEditable={false} aria-hidden="true" />
        <div className="callout-body">
          <NodeViewContent />
        </div>
      </div>
    </NodeViewWrapper>
  );
}
