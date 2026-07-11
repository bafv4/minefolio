// @vitest-environment jsdom
// テーブル行・列ハンドルの統合テスト。実際に TableHandles をマウントし、
// ホバー → ピル表示 → クリックで行・列選択 → メニュー操作の一連の流れを検証する。
// jsdom では getBoundingClientRect が常に 0 のため、位置ではなく表示・選択・
// ドキュメント変更を検証する。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Editor } from "@tiptap/core";
import { CellSelection } from "@tiptap/pm/tables";
import { buildExtensions } from "../../editor-config";
import { TableHandles } from "../table-handles";

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// Radix Popover（floating-ui）が要求するが jsdom に無い API のスタブ
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// mousemove が PM の columnResizing プラグインにも届き elementFromPoint を呼ぶ。
// jsdom には無いためスタブする（null 返しで「境界セルなし」として扱われる）。
if (!document.elementFromPoint) {
  Document.prototype.elementFromPoint = () => null;
}

// 2 列 × 3 行（ヘッダー行 + 2 行）
const TABLE_HTML =
  "<table><tbody>" +
  "<tr><th><p>h1</p></th><th><p>h2</p></th></tr>" +
  "<tr><td><p>a1</p></td><td><p>a2</p></td></tr>" +
  "<tr><td><p>b1</p></td><td><p>b2</p></td></tr>" +
  "</tbody></table>";

let editor: Editor;
let root: Root;
let host: HTMLElement;
let mount: HTMLElement;

beforeEach(async () => {
  host = document.createElement("div");
  document.body.appendChild(host);
  editor = new Editor({
    element: host,
    extensions: buildExtensions(),
    content: TABLE_HTML,
  });
  mount = document.createElement("div");
  document.body.appendChild(mount);
  root = createRoot(mount);
  await act(async () => {
    root.render(createElement(TableHandles, { editor }));
  });
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  editor.destroy();
  document.body.innerHTML = "";
});

/** エディタ内の全セル（th/td）を document 順で返す */
function cells(): HTMLTableCellElement[] {
  return Array.from(editor.view.dom.querySelectorAll("td, th"));
}

/** 指定セルへ mousemove を送ってホバー状態にする */
async function hoverCell(index: number): Promise<void> {
  await act(async () => {
    cells()[index].dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
  });
}

function rowPill(): HTMLButtonElement | null {
  return document.querySelector('button[aria-label="行を選択"]');
}

function colPill(): HTMLButtonElement | null {
  return document.querySelector('button[aria-label="列を選択"]');
}

async function clickPill(pill: HTMLButtonElement): Promise<void> {
  await act(async () => {
    pill.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/** 開いているメニューから label 一致の項目を探して押す（MenuItem は mousedown 発火） */
async function clickMenuItem(label: string): Promise<void> {
  const item = Array.from(document.querySelectorAll('[role="menuitem"]')).find(
    (el) => el.textContent?.trim() === label,
  );
  expect(item, `メニュー項目「${label}」が見つからない`).toBeTruthy();
  await act(async () => {
    item!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  });
}

function rowCount(): number {
  return editor.view.dom.querySelectorAll("tr").length;
}

function colCount(): number {
  return editor.view.dom.querySelectorAll("tr")!.item(0).querySelectorAll("th, td").length;
}

describe("TableHandles", () => {
  it("セルにホバーすると行・列ハンドルが表示される", async () => {
    expect(rowPill()).toBeNull();
    await hoverCell(2); // 2 行目 1 列目
    expect(rowPill()).toBeTruthy();
    expect(colPill()).toBeTruthy();
  });

  it("テーブル外では表示されない（ホバー解除で消える）", async () => {
    await hoverCell(2);
    expect(rowPill()).toBeTruthy();
    // テーブル外（エディタ直下の段落等が無いので view.dom 自体）へ移動 → 遅延後に消える
    await act(async () => {
      editor.view.dom.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 500));
    });
    expect(rowPill()).toBeNull();
  });

  it("行ハンドルをクリックすると行全体が選択されメニューが開く", async () => {
    await hoverCell(2);
    await clickPill(rowPill()!);
    const sel = editor.state.selection;
    expect(sel).toBeInstanceOf(CellSelection);
    expect((sel as CellSelection).isRowSelection()).toBe(true);
    // 2 行目のセル（a1）がアンカーであること
    expect((sel as CellSelection).$anchorCell.nodeAfter?.textContent).toContain("a1");
    expect(
      Array.from(document.querySelectorAll('[role="menuitem"]')).some(
        (el) => el.textContent?.trim() === "上に行を追加",
      ),
    ).toBe(true);
  });

  it("「下に行を追加」で行が増える", async () => {
    expect(rowCount()).toBe(3);
    await hoverCell(2);
    await clickPill(rowPill()!);
    await clickMenuItem("下に行を追加");
    expect(rowCount()).toBe(4);
    // メニューは閉じ、選択は CellSelection のままではない
    expect(editor.state.selection).not.toBeInstanceOf(CellSelection);
  });

  it("「行を削除」で行が減る", async () => {
    expect(rowCount()).toBe(3);
    await hoverCell(2);
    await clickPill(rowPill()!);
    await clickMenuItem("行を削除");
    expect(rowCount()).toBe(2);
  });

  it("列ハンドルをクリックすると列全体が選択される", async () => {
    await hoverCell(3); // 2 行目 2 列目
    await clickPill(colPill()!);
    const sel = editor.state.selection;
    expect(sel).toBeInstanceOf(CellSelection);
    expect((sel as CellSelection).isColSelection()).toBe(true);
  });

  it("「右に列を追加」で列が増える", async () => {
    expect(colCount()).toBe(2);
    await hoverCell(2);
    await clickPill(colPill()!);
    await clickMenuItem("右に列を追加");
    expect(colCount()).toBe(3);
  });

  it("背景色スウォッチで行全体に色が付き、メニューは開いたまま連続適用できる", async () => {
    await hoverCell(2);
    await clickPill(rowPill()!);
    // 背景色セクションの「赤」スウォッチ（#FDEBEC）を押す
    const swatch = Array.from(document.querySelectorAll('button[aria-label="赤"]')).find((el) =>
      (el as HTMLElement).style.backgroundColor,
    );
    expect(swatch, "背景色スウォッチが見つからない").toBeTruthy();
    await act(async () => {
      swatch!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    // 2 行目の 2 セルに適用され、他の行には付かない
    const colored: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.attrs.backgroundColor) colored.push(node.textContent);
    });
    expect(colored).toEqual(["a1", "a2"]);
    // メニューは開いたまま（連続適用できる）
    expect(
      Array.from(document.querySelectorAll('[role="menuitem"]')).some(
        (el) => el.textContent?.trim() === "上に行を追加",
      ),
    ).toBe(true);
  });

  it("「テーブルを削除」でテーブルが消えハンドルも消える", async () => {
    await hoverCell(2);
    await clickPill(rowPill()!);
    await clickMenuItem("テーブルを削除");
    expect(editor.view.dom.querySelector("table")).toBeNull();
    expect(rowPill()).toBeNull();
    expect(colPill()).toBeNull();
  });

  it("メニュー表示中のキー入力はメニューを閉じて選択を畳む（行の内容は消えない）", async () => {
    await hoverCell(2);
    await clickPill(rowPill()!);
    expect(editor.state.selection).toBeInstanceOf(CellSelection);
    await act(async () => {
      editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    });
    // メニューが閉じ、CellSelection は畳まれ、行の内容は無傷
    expect(document.querySelectorAll('[role="menuitem"]').length).toBe(0);
    expect(editor.state.selection).not.toBeInstanceOf(CellSelection);
    expect(editor.view.dom.textContent).toContain("a1");
    expect(editor.view.dom.textContent).toContain("a2");
  });

  it("メニュー表示中にホバー先の行が外部操作で消えてもハンドルが復帰する（デッドロック回帰）", async () => {
    await hoverCell(4); // 3 行目（最終行）
    await clickPill(rowPill()!);
    expect(editor.state.selection).toBeInstanceOf(CellSelection);
    // undo 相当: メニュー経由でなくホバー先の行が消える
    await act(async () => {
      editor.commands.deleteRow();
    });
    expect(rowPill()).toBeNull();
    expect(document.querySelectorAll('[role="menuitem"]').length).toBe(0);
    // 再ホバーでハンドルが復帰する（openAxis 残留による恒久無効化がないこと）
    await hoverCell(2);
    expect(rowPill()).toBeTruthy();
  });
});
