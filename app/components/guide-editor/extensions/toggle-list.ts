// トグルリスト拡張。<details><summary> + div.toggle-content。
// 旧 index.tsx ToggleListExtension から逐語移植。
import { Node as TiptapNode, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { ToggleListNodeView } from "../node-views/toggle-node-view";

export const ToggleListExtension = TiptapNode.create({
  name: "toggleList",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      summaryText: {
        default: "トグル",
        parseHTML: (element: HTMLElement) => {
          const summary = element.querySelector("summary");
          return summary?.textContent || "トグル";
        },
      },
    };
  },

  parseHTML() {
    // 旧実装は contentElement を指定せず、summary のテキストまで本文として取り込み、
    // 編集→再保存のたびにサマリーが本文へ複製されていた。
    // 本文は .toggle-content に限定して round-trip を安定させる（出力形式は不変）。
    return [
      {
        tag: "details",
        contentElement: (element: HTMLElement) =>
          element.querySelector<HTMLElement>(".toggle-content") ?? element,
      },
    ];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    const { summaryText, ...rest } = HTMLAttributes;
    return [
      "details",
      mergeAttributes(rest as Record<string, unknown>),
      ["summary", {}, (summaryText as string) || "トグル"],
      ["div", { class: "toggle-content" }, 0],
    ];
  },

  addNodeView() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ReactNodeViewRenderer(ToggleListNodeView as any);
  },

  // @ts-expect-error custom commands not in RawCommands
  addCommands() {
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setToggleList: () => ({ commands }: any) => {
        return commands.wrapIn(this.name);
      },
    };
  },
});
