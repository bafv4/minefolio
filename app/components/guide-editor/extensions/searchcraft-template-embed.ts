// サーチクラフトテンプレート埋め込み拡張（atom）。data-sctemplate-embed + data-template-id。
// 属性は templateId のみ。parseHTML で data-template-id を読み戻し、編集→再保存で ID が消えないようにする
// （searchcraft-embed が過去に parseHTML 欠落で slug を失った不具合の再発防止）。
import { Node as TiptapNode, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { SearchCraftTemplateEmbedNodeView } from "../node-views/template-embed-node-view";

export const SearchCraftTemplateEmbedExtension = TiptapNode.create({
  name: "searchCraftTemplateEmbed",
  group: "block",
  atom: true,

  addAttributes() {
    return {
      templateId: {
        default: "",
        parseHTML: (element: HTMLElement) => element.getAttribute("data-template-id") || "",
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-sctemplate-embed]" }];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    return [
      "div",
      mergeAttributes({
        "data-sctemplate-embed": "",
        "data-template-id": HTMLAttributes.templateId as string,
      }),
    ];
  },

  addNodeView() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ReactNodeViewRenderer(SearchCraftTemplateEmbedNodeView as any);
  },
});
