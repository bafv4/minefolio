// @vitest-environment jsdom
// 列幅スナップの統合テスト。prosemirror-tables のドラッグ確定と同じ形
// （plugin state に dragging がある状態で colwidth を確定する tr）を再現し、
// 既存列幅への吸着を検証する。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import { columnResizingPluginKey } from "@tiptap/pm/tables";
import { buildExtensions } from "../../editor-config";
import { findSnapTarget, SNAP_TOLERANCE_PX } from "../column-snap";

// 2 列 × 3 行（ヘッダー行 + 2 行）
const TABLE_HTML =
  "<table><tbody>" +
  "<tr><th><p>h1</p></th><th><p>h2</p></th></tr>" +
  "<tr><td><p>a1</p></td><td><p>a2</p></td></tr>" +
  "<tr><td><p>b1</p></td><td><p>b2</p></td></tr>" +
  "</tbody></table>";

const COL0 = ["h1", "a1", "b1"];
const COL1 = ["h2", "a2", "b2"];

let editor: Editor;
let host: HTMLElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  editor = new Editor({ element: host, extensions: buildExtensions(), content: TABLE_HTML });
});

afterEach(() => {
  editor.destroy();
  document.body.innerHTML = "";
});

/** テキスト一致で最初のセルの位置（セルノード直前の pos）を返す */
function cellPos(text: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (
      found === -1 &&
      (node.type.name === "tableCell" || node.type.name === "tableHeader") &&
      node.textContent === text
    ) {
      found = pos;
    }
  });
  expect(found, `セル「${text}」が見つからない`).toBeGreaterThanOrEqual(0);
  return found;
}

function colwidthOf(text: string): number[] | null {
  return editor.state.doc.nodeAt(cellPos(text))?.attrs.colwidth ?? null;
}

/** 指定セル群の colwidth を width に設定する（1 トランザクション） */
function setColwidths(texts: string[], width: number): void {
  const { state, view } = editor;
  const tr = state.tr;
  for (const text of texts) {
    const pos = cellPos(text);
    const node = state.doc.nodeAt(pos)!;
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, colwidth: [width] });
  }
  view.dispatch(tr);
}

/** prosemirror-tables のドラッグ確定を再現する（setHandle → setDragging → 幅確定 → 解除） */
function simulateResizeCommit(anchorText: string, columnTexts: string[], width: number): void {
  const { view } = editor;
  view.dispatch(view.state.tr.setMeta(columnResizingPluginKey, { setHandle: cellPos(anchorText) }));
  view.dispatch(
    view.state.tr.setMeta(columnResizingPluginKey, { setDragging: { startX: 0, startWidth: 0 } }),
  );
  setColwidths(columnTexts, width); // ← ここで appendTransaction がスナップする
  view.dispatch(view.state.tr.setMeta(columnResizingPluginKey, { setDragging: null }));
}

describe("findSnapTarget", () => {
  it("許容誤差内で最も近い既存幅を返す", () => {
    expect(findSnapTarget([200], 205)).toBe(200);
    expect(findSnapTarget([195, 204], 200)).toBe(204); // 差 4 < 差 5
  });

  it("許容誤差の外・完全一致は null", () => {
    expect(findSnapTarget([200], 200 + SNAP_TOLERANCE_PX + 1)).toBeNull();
    expect(findSnapTarget([200], 200)).toBeNull();
    expect(findSnapTarget([], 200)).toBeNull();
  });
});

describe("columnSnapPlugin", () => {
  it("ドラッグ確定した列幅が既存列幅の許容誤差内ならスナップする", () => {
    setColwidths(COL1, 200); // 既存列: 200px（ドラッグなし = スナップ対象外の設定）
    expect(colwidthOf("h2")).toEqual([200]);

    simulateResizeCommit("h1", COL0, 203); // 200 との差 3 ≤ 8
    expect(colwidthOf("h1")).toEqual([200]);
    expect(colwidthOf("a1")).toEqual([200]);
    expect(colwidthOf("b1")).toEqual([200]);
    // 既存列は無傷
    expect(colwidthOf("h2")).toEqual([200]);
  });

  it("許容誤差の外ならスナップしない", () => {
    setColwidths(COL1, 200);
    simulateResizeCommit("h1", COL0, 250);
    expect(colwidthOf("h1")).toEqual([250]);
  });

  it("ドラッグを伴わない colwidth 変更（テンプレ挿入・undo 等）には反応しない", () => {
    setColwidths(COL1, 200);
    setColwidths(COL0, 203); // dragging なしの直接設定
    expect(colwidthOf("h1")).toEqual([203]); // スナップされない
  });

  it("列境界ホバー中（activeHandle あり・dragging=false）の doc 変更ではスナップしない", () => {
    setColwidths(COL1, 200);
    setColwidths(COL0, 203);
    // ホバー相当: setHandle のみ（prosemirror-tables は ResizeState(pos, false) を作る）
    editor.view.dispatch(
      editor.state.tr.setMeta(columnResizingPluginKey, { setHandle: cellPos("h1") }),
    );
    editor.commands.insertContentAt(cellPos("a2") + 2, "x"); // 無関係な doc 変更
    expect(colwidthOf("h1")).toEqual([203]); // 勝手に 200 へ吸着しない
  });

  it("ドラッグ中でも列幅が変わらない doc 変更（文字入力等）ではスナップしない", () => {
    setColwidths(COL1, 200);
    setColwidths(COL0, 203);
    const { view } = editor;
    view.dispatch(view.state.tr.setMeta(columnResizingPluginKey, { setHandle: cellPos("h1") }));
    view.dispatch(
      view.state.tr.setMeta(columnResizingPluginKey, { setDragging: { startX: 0, startWidth: 0 } }),
    );
    editor.commands.insertContentAt(cellPos("a2") + 2, "x"); // ドラッグ中の無関係な doc 変更
    expect(colwidthOf("h1")).toEqual([203]);
    view.dispatch(view.state.tr.setMeta(columnResizingPluginKey, { setDragging: null }));
  });
});
