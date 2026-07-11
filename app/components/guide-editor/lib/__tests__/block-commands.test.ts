// @vitest-environment jsdom
// ブロック挿入コマンドが実際に動作するか（callout / toggle / columns / table 等）を検証する。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import { CellSelection } from "@tiptap/pm/tables";
import { buildExtensions } from "../../editor-config";
import {
  setBlockType,
  insertTable,
  insertColumns,
  insertHorizontalRule,
  setTableCellsStyle,
  unifyColumnWidths,
  selectTableLine,
  collapseCellSelection,
} from "../block-commands";
import { selectCellTextOnly } from "../../extensions/table";

let editor: Editor;

/** 現在のドキュメント内の全セル（tableCell / tableHeader）の attrs を集める */
function cellAttrs(ed: Editor): Record<string, unknown>[] {
  const cells: Record<string, unknown>[] = [];
  ed.state.doc.descendants((node) => {
    if (node.type.name === "tableCell" || node.type.name === "tableHeader") {
      cells.push(node.attrs);
    }
  });
  return cells;
}

beforeEach(() => {
  editor = new Editor({
    element: document.createElement("div"),
    extensions: buildExtensions(),
    content: "<p>hello</p>",
  });
});

afterEach(() => {
  editor.destroy();
});

describe("block insertion commands", () => {
  it("callout を挿入できる", () => {
    setBlockType(editor, "callout");
    expect(editor.getHTML()).toContain("data-callout");
  });

  it("toggleList を挿入できる", () => {
    setBlockType(editor, "toggleList");
    expect(editor.getHTML()).toContain("<details");
  });

  it("見出しに変換できる", () => {
    setBlockType(editor, "heading1");
    expect(editor.getHTML()).toContain("<h1");
  });

  it("箇条書きに変換できる", () => {
    setBlockType(editor, "bulletList");
    expect(editor.getHTML()).toContain("<ul");
  });

  it("コードブロックに変換できる", () => {
    setBlockType(editor, "codeBlock");
    expect(editor.getHTML()).toContain("<pre");
  });

  it("2 カラムを挿入できる", () => {
    insertColumns(editor, 2);
    expect(editor.getHTML()).toContain('data-columns="2"');
  });

  it("テーブルを挿入できる", () => {
    insertTable(editor);
    expect(editor.getHTML()).toContain("<table");
  });

  it("区切り線を挿入できる", () => {
    insertHorizontalRule(editor);
    expect(editor.getHTML()).toContain("<hr");
  });

  it("callout 内に箇条書きを入れられる", () => {
    setBlockType(editor, "callout");
    setBlockType(editor, "bulletList");
    const html = editor.getHTML();
    expect(html).toContain("data-callout");
    expect(html).toContain("<ul");
  });
});

describe("table style commands", () => {
  it("行スコープでスタイルを行全体（3セル）に適用する", () => {
    insertTable(editor); // 3x3 + ヘッダー行、カーソルは先頭セル
    setTableCellsStyle(editor, "row", "backgroundColor", "#ff0000");
    const withBg = cellAttrs(editor).filter((a) => a.backgroundColor === "#ff0000");
    expect(withBg.length).toBe(3);
  });

  it("列スコープでスタイルを列全体（3セル）に適用する", () => {
    insertTable(editor);
    setTableCellsStyle(editor, "column", "textAlign", "center");
    const centered = cellAttrs(editor).filter((a) => a.textAlign === "center");
    expect(centered.length).toBe(3);
  });

  it("セルスコープは現在のセルのみに適用する", () => {
    insertTable(editor);
    setTableCellsStyle(editor, "cell", "textAlign", "right");
    const aligned = cellAttrs(editor).filter((a) => a.textAlign === "right");
    expect(aligned.length).toBe(1);
  });

  it("列幅を統一すると全セルの colwidth がクリアされる", () => {
    insertTable(editor);
    editor.chain().focus().setCellAttribute("colwidth", [200]).run();
    expect(cellAttrs(editor).some((a) => a.colwidth)).toBe(true);
    unifyColumnWidths(editor);
    expect(cellAttrs(editor).every((a) => !a.colwidth)).toBe(true);
  });

  it("Ctrl+A(セル内)はセル内の文字だけを選択する（隣接セル・テーブル外は含まない）", () => {
    editor.commands.setContent(
      "<table><tbody><tr><td><p>hello</p></td><td><p>world</p></td></tr></tbody></table><p>outside</p>",
    );
    // 先頭セルの "hello" 内にカーソルを置く
    let helloPos = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text?.includes("hello")) helloPos = pos + 2;
    });
    editor.commands.setTextSelection(helloPos);

    expect(selectCellTextOnly(editor)).toBe(true);

    const sel = editor.state.selection;
    expect(editor.state.doc.textBetween(sel.from, sel.to)).toBe("hello");
  });

  it("Ctrl+A(テーブル外)は何もせず false を返す（既定の全体選択に委ねる）", () => {
    editor.commands.setContent("<p>alpha</p><p>beta</p>");
    editor.commands.setTextSelection(2);
    expect(selectCellTextOnly(editor)).toBe(false);
  });
});

describe("table line selection (row/column handles)", () => {
  /** 3x3 テーブルを挿入し、全セルの開始位置を document 順で返す（先頭 3 つはヘッダー行） */
  function insertTableAndGetCellPositions(): number[] {
    insertTable(editor);
    const positions: number[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "tableCell" || node.type.name === "tableHeader") {
        positions.push(pos);
      }
    });
    return positions;
  }

  it("セル内の位置から行全体を CellSelection で選択する", () => {
    const cells = insertTableAndGetCellPositions();
    // index 4 = 2 行目 2 列目（0-2 がヘッダー行）
    expect(selectTableLine(editor, cells[4] + 1, "row")).toBe(true);
    const sel = editor.state.selection;
    expect(sel).toBeInstanceOf(CellSelection);
    expect((sel as CellSelection).isRowSelection()).toBe(true);
    let count = 0;
    (sel as CellSelection).forEachCell(() => count++);
    expect(count).toBe(3);
  });

  it("セル内の位置から列全体を CellSelection で選択する", () => {
    const cells = insertTableAndGetCellPositions();
    expect(selectTableLine(editor, cells[4] + 1, "column")).toBe(true);
    const sel = editor.state.selection;
    expect(sel).toBeInstanceOf(CellSelection);
    expect((sel as CellSelection).isColSelection()).toBe(true);
    let count = 0;
    (sel as CellSelection).forEachCell(() => count++);
    expect(count).toBe(3);
  });

  it("行選択後にスタイルを行スコープで適用すると選択行の 3 セルに反映される", () => {
    const cells = insertTableAndGetCellPositions();
    selectTableLine(editor, cells[4] + 1, "row");
    setTableCellsStyle(editor, "row", "backgroundColor", "#00ff00");
    const withBg: number[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.attrs.backgroundColor === "#00ff00") withBg.push(pos);
    });
    // ヘッダー行（cells[0..2]）ではなく 2 行目（cells[3..5]）に適用される
    expect(withBg).toEqual([cells[3], cells[4], cells[5]]);
  });

  it("テーブル外の位置では false を返し選択を変えない", () => {
    editor.commands.setContent("<p>hello</p>");
    const before = editor.state.selection;
    expect(selectTableLine(editor, 2, "row")).toBe(false);
    expect(editor.state.selection.eq(before)).toBe(true);
  });

  it("collapseCellSelection は CellSelection をアンカーセル内のテキスト選択へ畳む", () => {
    const cells = insertTableAndGetCellPositions();
    selectTableLine(editor, cells[4] + 1, "row");
    expect(editor.state.selection).toBeInstanceOf(CellSelection);
    collapseCellSelection(editor);
    expect(editor.state.selection).not.toBeInstanceOf(CellSelection);
    expect(editor.state.selection.empty).toBe(true);
  });

  it("collapseCellSelection は通常のテキスト選択では何もしない", () => {
    editor.commands.setContent("<p>hello</p>");
    editor.commands.setTextSelection({ from: 1, to: 4 });
    const before = editor.state.selection;
    collapseCellSelection(editor);
    expect(editor.state.selection.eq(before)).toBe(true);
  });
});
