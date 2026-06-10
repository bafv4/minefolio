// コールアウト拡張。data-callout + data-callout-type + class="callout callout-${type}"。
// 旧 index.tsx CalloutExtension から parseHTML/renderHTML を逐語移植（HTML 互換性の核）。
import { Node as TiptapNode, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { CalloutNodeView } from "../node-views/callout-node-view";

export const CalloutExtension = TiptapNode.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      calloutType: {
        default: "tip",
        parseHTML: (element: HTMLElement) => element.getAttribute("data-callout-type") || "tip",
        renderHTML: (attributes: Record<string, string>) => ({
          "data-callout": "",
          "data-callout-type": attributes.calloutType,
          class: `callout callout-${attributes.calloutType}`,
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-callout]" }];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    return ["div", mergeAttributes(HTMLAttributes), 0];
  },

  addNodeView() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ReactNodeViewRenderer(CalloutNodeView as any);
  },

  // @ts-expect-error custom commands not in RawCommands
  addCommands() {
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setCallout: (attrs?: { calloutType?: string }) => ({ commands }: any) => {
        return commands.wrapIn(this.name, attrs);
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      toggleCallout: (attrs?: { calloutType?: string }) => ({ commands, editor }: any) => {
        if (editor.isActive(this.name)) {
          return commands.lift(this.name);
        }
        return commands.wrapIn(this.name, attrs);
      },
    };
  },
});
