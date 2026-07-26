// 画像拡張。width / align 属性 + リサイズ・トリミング NodeView。
// 旧 index.tsx の Image.configure(...).extend(...) から逐語移植。
import { Image } from "@tiptap/extension-image";
import { ReactNodeViewRenderer } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import { ImageNodeView } from "../node-views/image-node-view";
import type { GuideMediaContext } from "../types";

/** 画像拡張のストレージ。NodeView から宿主のアップロード処理を呼ぶための注入口 */
interface ImageStorage {
  ctx: GuideMediaContext | null;
}

function imageStorage(editor: Editor): ImageStorage | undefined {
  return (editor.storage as unknown as Record<string, unknown>).image as ImageStorage | undefined;
}

/** 宿主（GuideEditor）からメディア操作を注入する */
export function setImageMediaContext(editor: Editor, ctx: GuideMediaContext): void {
  const storage = imageStorage(editor);
  if (storage) storage.ctx = ctx;
}

/** NodeView からメディア操作を取り出す（未注入なら null） */
export function getImageMediaContext(editor: Editor): GuideMediaContext | null {
  return imageStorage(editor)?.ctx ?? null;
}

export const CustomImage = Image.configure({ inline: false, allowBase64: true }).extend({
  // ストレージ経由で宿主の処理を受け取る（スラッシュコマンドと同じ注入方式）。
  // 本文 HTML の生成には関与しないため、round-trip の不変条件には影響しない。
  addStorage(): ImageStorage {
    return { ctx: null };
  },
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
