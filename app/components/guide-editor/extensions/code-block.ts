// コードブロック拡張。コピーボタン付き NodeView。
// 旧 index.tsx の CodeBlock.extend(...) から逐語移植（StarterKit は codeBlock:false で無効化）。
import { CodeBlock } from "@tiptap/extension-code-block";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { CodeBlockNodeView } from "../node-views/code-block-node-view";

export const CustomCodeBlock = CodeBlock.extend({
  addNodeView() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ReactNodeViewRenderer(CodeBlockNodeView as any);
  },
});
