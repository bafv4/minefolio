// ガイドリンク埋め込み拡張。div[data-guide-link].guide-link-card > a > (img? + body)。
// 旧 index.tsx GuideLinkExtension から renderHTML を逐語移植（子配列構造を保持）。
import { Node as TiptapNode, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { GuideLinkNodeView } from "../node-views/guide-link-node-view";

export const GuideLinkExtension = TiptapNode.create({
  name: "guideLink",
  group: "block",
  atom: true,

  addAttributes() {
    // 旧実装は parseHTML を欠き、既存ガイドの編集→再保存でリンク情報が全消失していた。
    // renderHTML が生成する DOM 構造から読み戻して round-trip を安定させる（出力形式は不変）。
    return {
      guideUrl: {
        default: "",
        parseHTML: (element: HTMLElement) => element.querySelector("a")?.getAttribute("href") || "",
      },
      guideTitle: {
        default: "",
        parseHTML: (element: HTMLElement) => element.querySelector(".guide-link-title")?.textContent || "",
      },
      authorName: {
        default: "",
        parseHTML: (element: HTMLElement) => element.querySelector(".guide-link-author")?.textContent || "",
      },
      coverImageUrl: {
        default: null,
        parseHTML: (element: HTMLElement) => element.querySelector(".guide-link-cover")?.getAttribute("src") || null,
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-guide-link]" }];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, unknown> }) {
    const { guideUrl, guideTitle, authorName, coverImageUrl, ...rest } = HTMLAttributes;
    const children: unknown[] = [];

    if (coverImageUrl) {
      children.push(["img", { src: coverImageUrl, alt: "", class: "guide-link-cover" }]);
    }

    children.push([
      "div",
      { class: "guide-link-body" },
      ["span", { class: "guide-link-icon" }, "📄"],
      [
        "div",
        { class: "guide-link-text" },
        ["span", { class: "guide-link-title" }, guideTitle as string],
        ...(authorName ? [["span", { class: "guide-link-author" }, authorName as string]] : []),
      ],
    ]);

    return [
      "div",
      mergeAttributes(rest as Record<string, unknown>, {
        "data-guide-link": "",
        class: "guide-link-card",
      }),
      [
        "a",
        {
          href: guideUrl as string,
          class: "guide-link-inner",
          rel: "noopener noreferrer",
        },
        ...children,
      ],
    ];
  },

  addNodeView() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ReactNodeViewRenderer(GuideLinkNodeView as any);
  },
});
