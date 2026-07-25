// 画像拡張。width 属性 + リサイズ NodeView。
// 旧 index.tsx の Image.configure(...).extend(...) から逐語移植。
import { Image } from "@tiptap/extension-image";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { ImageNodeView } from "../node-views/image-node-view";

export const CustomImage = Image.configure({ inline: false, allowBase64: true }).extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("width"),
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes.width) return {};
          return { width: attributes.width };
        },
      },
      // 横方向の配置（left / center / right）。未設定は属性ごと出力しない＝従来の流し込み表示。
      // <img> はサニタイズで style を許可していないため data 属性で持つ
      // （guide-sanitize.server.ts の TAG_ATTRS.img に data-align を許可済み）。
      // 表示は app.css の .guide-content.prose img[data-align=...] が担う
      align: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("data-align"),
        renderHTML: (attributes: Record<string, unknown>) => {
          if (!attributes.align) return {};
          return { "data-align": attributes.align };
        },
      },
    };
  },
  addNodeView() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ReactNodeViewRenderer(ImageNodeView as any);
  },
});
