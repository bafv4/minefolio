// サーチクラフト埋め込み拡張（atom）。data-searchcraft-embed + data-user-slug + 条件付き data-preset-name。
// 旧 index.tsx SearchCraftEmbedExtension から renderHTML を逐語移植。
import { Node as TiptapNode, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { SearchCraftEmbedNodeView } from "../node-views/embed-node-view";

export const SearchCraftEmbedExtension = TiptapNode.create({
  name: "searchCraftEmbed",
  group: "block",
  atom: true,

  addAttributes() {
    return {
      // 旧実装は parseHTML を欠き、既存ガイドの編集→再保存で slug が消えていた。
      // 出力形式は不変のまま、data-* を読み戻して round-trip を安定させる。
      userSlug: {
        default: "",
        parseHTML: (element: HTMLElement) => element.getAttribute("data-user-slug") || "",
      },
      presetName: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("data-preset-name") || null,
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-searchcraft-embed]" }];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    return [
      "div",
      mergeAttributes({
        "data-searchcraft-embed": "",
        "data-user-slug": HTMLAttributes.userSlug as string,
        ...(HTMLAttributes.presetName ? { "data-preset-name": HTMLAttributes.presetName as string } : {}),
      }),
    ];
  },

  addNodeView() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ReactNodeViewRenderer(SearchCraftEmbedNodeView as any);
  },
});
