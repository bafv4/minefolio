// 段組拡張。columns（data-columns="N", content: column+）と column（data-column, content: block+）。
// 旧 index.tsx ColumnsExtension / ColumnExtension から逐語移植。
import { Node as TiptapNode, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { ColumnsNodeView, ColumnNodeView } from "../node-views/columns-node-view";

export const ColumnsExtension = TiptapNode.create({
  name: "columns",
  group: "block",
  content: "column+",
  defining: true,

  addAttributes() {
    return {
      cols: {
        default: 2,
        parseHTML: (element: HTMLElement) => parseInt(element.getAttribute("data-columns") || "2"),
        renderHTML: (attributes: Record<string, unknown>) => ({
          "data-columns": String(attributes.cols),
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-columns]" }];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    return ["div", mergeAttributes(HTMLAttributes), 0];
  },

  addNodeView() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ReactNodeViewRenderer(ColumnsNodeView as any);
  },
});

export const ColumnExtension = TiptapNode.create({
  name: "column",
  content: "block+",
  isolating: true,

  parseHTML() {
    return [{ tag: "div[data-column]" }];
  },

  renderHTML() {
    return ["div", { "data-column": "" }, 0];
  },

  addNodeView() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ReactNodeViewRenderer(ColumnNodeView as any);
  },
});
