// ブロック操作の共通実装。toolbar / slash command / block handle の 3 箇所で再利用する。
// すべて「現在の選択位置」に対して作用する純コマンド。呼び出し側が事前に選択を移動する
// （旧実装は posAtCoords で DOM 座標から位置を解決していたが、選択ベースに統一して
//  タッチ環境での不安定さを排除する）。
import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { DOMSerializer } from "@tiptap/pm/model";
import {
  CellSelection,
  TableMap,
  cellAround,
  isInTable,
  selectionCell,
  selectedRect,
} from "@tiptap/pm/tables";

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
      // focus + wrap を 1 チェーンで原子的に実行（ドロップダウンからのフォーカス喪失対策）
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (chain as any).toggleCallout({ calloutType: "tip" }).run();
      return;
    case "toggleList":
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (chain as any).setToggleList().run();
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

/** コールアウト種別 */
export type CalloutType = "tip" | "info" | "warning" | "danger";

/** 指定タイプのコールアウトで現在ブロックを包む */
export function insertCallout(editor: Editor, calloutType: CalloutType): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (editor.chain().focus() as any).toggleCallout({ calloutType }).run();
}

/** トグルリストで現在ブロックを包む */
export function insertToggle(editor: Editor): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (editor.chain().focus() as any).setToggleList().run();
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

/** スタイル適用の範囲（セル単体 / 行全体 / 列全体） */
export type TableStyleScope = "cell" | "row" | "column";

/** セルに設定できる style 系属性 */
export type TableCellStyleAttr = "backgroundColor" | "textColor" | "textAlign";

/**
 * テーブルの style 系属性を、指定範囲（セル / 行 / 列）のセルへ一括適用する。
 * value が null の場合は解除。カーソルがテーブル内にある前提。
 */
export function setTableCellsStyle(
  editor: Editor,
  scope: TableStyleScope,
  attr: TableCellStyleAttr,
  value: string | null,
): void {
  editor
    .chain()
    .focus()
    .command(({ state, tr, dispatch }) => {
      if (!isInTable(state)) return false;
      const $cell = selectionCell(state);
      let selection: CellSelection;
      if (scope === "row") {
        selection = CellSelection.rowSelection($cell);
      } else if (scope === "column") {
        selection = CellSelection.colSelection($cell);
      } else {
        // セル範囲: ドラッグ選択（CellSelection）があればそれを、無ければ現在セル1つ
        selection =
          state.selection instanceof CellSelection ? state.selection : new CellSelection($cell);
      }
      if (dispatch) {
        // 属性変更はノードサイズを変えないため、走査中も位置は不変で安全
        selection.forEachCell((node, pos) => {
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, [attr]: value });
        });
      }
      return true;
    })
    .run();
}

/** テーブルの行 / 列を指す軸 */
export type TableLineAxis = "row" | "column";

/**
 * 指定位置（セル内を指す pos）が属する行 / 列全体を CellSelection で選択する。
 * 行・列ハンドルのクリック時に使用。テーブル外の pos なら何もせず false を返す。
 */
export function selectTableLine(editor: Editor, pos: number, axis: TableLineAxis): boolean {
  const { state, view } = editor;
  if (pos < 0 || pos > state.doc.content.size) return false;
  const $cell = cellAround(state.doc.resolve(pos));
  if (!$cell) return false;
  const selection =
    axis === "row" ? CellSelection.rowSelection($cell) : CellSelection.colSelection($cell);
  view.dispatch(state.tr.setSelection(selection));
  view.focus();
  return true;
}

/**
 * 現在の選択が CellSelection の場合、アンカーセル内のテキスト選択へ畳む。
 * 行・列メニューを閉じた後に CellSelection が残ると、次のキー入力で
 * 選択セル全体が上書きされてしまうのを防ぐ。
 */
export function collapseCellSelection(editor: Editor): void {
  const { state, view } = editor;
  if (!(state.selection instanceof CellSelection)) return;
  const selection = TextSelection.near(
    state.doc.resolve(state.selection.$anchorCell.pos + 1),
    1,
  );
  view.dispatch(state.tr.setSelection(selection));
}

/** 現在のセルに背景色を適用する（null で解除） */
export function setCellBackground(editor: Editor, color: string | null): void {
  setTableCellsStyle(editor, "cell", "backgroundColor", color);
}

/** 現在のセルに文字色を適用する（null で解除） */
export function setCellTextColor(editor: Editor, color: string | null): void {
  setTableCellsStyle(editor, "cell", "textColor", color);
}

/**
 * カーソル位置のテーブル全体をクリップボードへコピーする。
 * text/html はスキーマの toDOM 直列化（エディタへの貼り付けで属性込みの完全復元が可能）、
 * text/plain は TSV（表計算ソフトやテキストへの貼り付け用）。
 * テーブル外・クリップボード不可の場合は false を返す。
 */
export async function copyTableToClipboard(editor: Editor): Promise<boolean> {
  const { state } = editor;
  if (!isInTable(state)) return false;
  const $cell = selectionCell(state);
  const table = $cell.node(-1);

  const dom = DOMSerializer.fromSchema(state.schema).serializeNode(table) as HTMLElement;
  const html = dom.outerHTML;

  // TSV は TableMap で展開したグリッドから作る（colspan/rowspan の結合セルでも
  // 列位置がずれない）。結合セルの本文は左上のグリッド位置にだけ出し、被覆位置は空欄。
  // セル内の段落境界はスペースで区切る（タブ・改行だと TSV 構造が壊れる）。
  const map = TableMap.get(table);
  const lines: string[] = [];
  for (let r = 0; r < map.height; r++) {
    const cols: string[] = [];
    for (let c = 0; c < map.width; c++) {
      const pos = map.map[r * map.width + c];
      const cell = table.nodeAt(pos);
      const isOrigin =
        (c === 0 || map.map[r * map.width + c - 1] !== pos) &&
        (r === 0 || map.map[(r - 1) * map.width + c] !== pos);
      cols.push(cell && isOrigin ? cell.textBetween(0, cell.content.size, " ") : "");
    }
    lines.push(cols.join("\t"));
  }
  const text = lines.join("\n");

  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        }),
      ]);
      return true;
    }
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * テーブルの全セルの列幅（colwidth）をクリアし、列幅を等幅にそろえる。
 * table-layout: fixed のもとで幅指定を外すと列が均等配分される。
 */
export function unifyColumnWidths(editor: Editor): void {
  editor
    .chain()
    .focus()
    .command(({ state, tr, dispatch }) => {
      if (!isInTable(state)) return false;
      if (dispatch) {
        const rect = selectedRect(state);
        const seen = new Set<number>();
        rect.map.map.forEach((relPos) => {
          if (seen.has(relPos)) return;
          seen.add(relPos);
          const pos = rect.tableStart + relPos;
          const node = tr.doc.nodeAt(pos);
          if (node) tr.setNodeMarkup(pos, undefined, { ...node.attrs, colwidth: null });
        });
      }
      return true;
    })
    .run();
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
