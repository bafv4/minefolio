// テーブル拡張。セルの style 系属性（背景色 / 文字色 / 文字揃え）を共通定義で cell/header に付与し、
// テーブル内の Ctrl+A を「セル内の文字のみ」に限定する。
import type { Editor } from "@tiptap/core";
import { Table } from "@tiptap/extension-table";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TextSelection } from "@tiptap/pm/state";
import { isInTable, selectionCell } from "@tiptap/pm/tables";
import { columnSnapPlugin } from "./column-snap";

type StyleAttrs = Record<string, string | null>;

// セルの style 系属性を1か所で定義し cell / header で共有する。
// 各属性は自分の style 宣言だけを返し、TipTap の mergeAttributes が
// プロパティ単位でマージ（"; " 連結）する。
const cellStyleAttributes = {
  backgroundColor: {
    default: null,
    parseHTML: (el: HTMLElement) => el.style.backgroundColor || null,
    renderHTML: (attrs: StyleAttrs) =>
      attrs.backgroundColor ? { style: `background-color: ${attrs.backgroundColor}` } : {},
  },
  textColor: {
    default: null,
    parseHTML: (el: HTMLElement) => el.style.color || null,
    renderHTML: (attrs: StyleAttrs) =>
      attrs.textColor ? { style: `color: ${attrs.textColor}` } : {},
  },
  textAlign: {
    default: null,
    parseHTML: (el: HTMLElement) => el.style.textAlign || null,
    renderHTML: (attrs: StyleAttrs) =>
      attrs.textAlign ? { style: `text-align: ${attrs.textAlign}` } : {},
  },
};

export const CustomTableCell = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellStyleAttributes };
  },
});

export const CustomTableHeader = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellStyleAttributes };
  },
});

/**
 * カーソルがテーブルセル内にある場合、そのセル内の文字だけを選択する。
 * テーブル外なら何もせず false を返す（Ctrl+A の既定＝ドキュメント全体選択に委ねる）。
 */
export function selectCellTextOnly(editor: Editor): boolean {
  const { state } = editor;
  if (!isInTable(state)) return false;
  const $cell = selectionCell(state);
  const cell = $cell.nodeAfter;
  if (!cell) return false;
  const from = $cell.pos + 1;
  const to = $cell.pos + cell.nodeSize - 1;
  const selection = TextSelection.between(state.doc.resolve(from), state.doc.resolve(to));
  editor.view.dispatch(state.tr.setSelection(selection));
  return true;
}

export const CustomTable = Table.extend({
  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      // Ctrl/Cmd+A: テーブル内では現在のセル内の文字だけを選択する。
      "Mod-a": ({ editor }) => selectCellTextOnly(editor),
    };
  },
  addProseMirrorPlugins() {
    const parent = this.parent?.() ?? [];
    // 列幅スナップは columnResizing が有効なとき（= リサイズ可能な編集時）のみ意味を持つ
    if (this.options.resizable && this.editor.isEditable) {
      return [...parent, columnSnapPlugin()];
    }
    return parent;
  },
});
