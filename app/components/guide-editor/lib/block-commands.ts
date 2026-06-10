// ブロック操作の共通実装。toolbar / slash command / block handle の 3 箇所で再利用する。
// すべて「現在の選択位置」に対して作用する純コマンド。呼び出し側が事前に選択を移動する
// （旧実装は posAtCoords で DOM 座標から位置を解決していたが、選択ベースに統一して
//  タッチ環境での不安定さを排除する）。
import type { Editor } from "@tiptap/core";

/** ブロック種別 */
export type BlockType =
  | "paragraph"
  | "heading1"
  | "heading2"
  | "heading3"
  | "bulletList"
  | "orderedList"
  | "blockquote"
  | "codeBlock"
  | "callout"
  | "toggleList";

/** テーブル行・列・セル操作 */
export type TableOp =
  | "addRowBefore"
  | "addRowAfter"
  | "deleteRow"
  | "addColBefore"
  | "addColAfter"
  | "deleteCol"
  | "deleteTable"
  | "mergeOrSplit"
  | "toggleHeaderRow"
  | "toggleHeaderColumn";

/** 現在の選択ブロックを指定種別へ変換する */
export function setBlockType(editor: Editor, type: BlockType): void {
  const chain = editor.chain().focus();
  switch (type) {
    case "paragraph":
      chain.setParagraph().run();
      return;
    case "heading1":
      chain.toggleHeading({ level: 1 }).run();
      return;
    case "heading2":
      chain.toggleHeading({ level: 2 }).run();
      return;
    case "heading3":
      chain.toggleHeading({ level: 3 }).run();
      return;
    case "bulletList":
      chain.toggleBulletList().run();
      return;
    case "orderedList":
      chain.toggleOrderedList().run();
      return;
    case "blockquote":
      chain.toggleBlockquote().run();
      return;
    case "codeBlock":
      chain.toggleCodeBlock().run();
      return;
    case "callout":
      chain.run();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (editor.commands as any).toggleCallout({ calloutType: "tip" });
      return;
    case "toggleList":
      chain.run();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (editor.commands as any).setToggleList();
      return;
  }
}

/** テーブルの行・列操作を実行する（カーソルがテーブル内にある前提） */
export function applyTableOp(editor: Editor, op: TableOp): void {
  const chain = editor.chain().focus();
  switch (op) {
    case "addRowBefore":
      chain.addRowBefore().run();
      return;
    case "addRowAfter":
      chain.addRowAfter().run();
      return;
    case "deleteRow":
      chain.deleteRow().run();
      return;
    case "addColBefore":
      chain.addColumnBefore().run();
      return;
    case "addColAfter":
      chain.addColumnAfter().run();
      return;
    case "deleteCol":
      chain.deleteColumn().run();
      return;
    case "deleteTable":
      chain.deleteTable().run();
      return;
    case "mergeOrSplit":
      chain.mergeOrSplit().run();
      return;
    case "toggleHeaderRow":
      chain.toggleHeaderRow().run();
      return;
    case "toggleHeaderColumn":
      chain.toggleHeaderColumn().run();
      return;
  }
}

/** 3 行 3 列（ヘッダー付き）のテーブルを挿入する */
export function insertTable(editor: Editor): void {
  editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
}

/** 区切り線を挿入する */
export function insertHorizontalRule(editor: Editor): void {
  editor.chain().focus().setHorizontalRule().run();
}

/** N カラム（2 or 3）の段組を挿入する */
export function insertColumns(editor: Editor, cols: 2 | 3): void {
  editor
    .chain()
    .focus()
    .insertContent({
      type: "columns",
      attrs: { cols },
      content: Array.from({ length: cols }, () => ({
        type: "column",
        content: [{ type: "paragraph" }],
      })),
    })
    .run();
}

/** 現在のセルに背景色を適用する（null で解除） */
export function setCellBackground(editor: Editor, color: string | null): void {
  editor.chain().focus().setCellAttribute("backgroundColor", color).run();
}

/** 現在のセルに文字色を適用する（null で解除） */
export function setCellTextColor(editor: Editor, color: string | null): void {
  editor.chain().focus().setCellAttribute("textColor", color).run();
}

/** ガイドリンクカードを挿入する */
export function insertGuideLink(
  editor: Editor,
  guide: { url: string; title: string; authorName: string; coverImageUrl: string | null },
): void {
  editor
    .chain()
    .focus()
    .insertContent({
      type: "guideLink",
      attrs: {
        guideUrl: guide.url,
        guideTitle: guide.title,
        authorName: guide.authorName,
        coverImageUrl: guide.coverImageUrl,
      },
    })
    .run();
}

/** キーバインド / サーチクラフト埋め込みを挿入する */
export function insertEmbed(
  editor: Editor,
  kind: "keybind" | "searchcraft",
  userSlug: string,
  presetName: string | null,
): void {
  const type = kind === "keybind" ? "keybindEmbed" : "searchCraftEmbed";
  editor
    .chain()
    .focus()
    .insertContent({ type, attrs: { userSlug, presetName } })
    .run();
}
