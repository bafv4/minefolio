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
    };
  },
  addNodeView() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ReactNodeViewRenderer(ImageNodeView as any);
  },
});
