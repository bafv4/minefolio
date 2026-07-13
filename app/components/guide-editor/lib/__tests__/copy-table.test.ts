// @vitest-environment jsdom
// copyTableToClipboard の TSV 生成の検証（結合セル・複数段落セル）
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { buildExtensions } from "../../editor-config";
import { copyTableToClipboard } from "../block-commands";

let editor: Editor;
let host: HTMLElement;
let written: { html?: string; text?: string };

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  written = {};
  // jsdom には ClipboardItem がないため writeText フォールバック経路を通る
  Object.defineProperty(navigator, "clipboard", {
    value: {
      writeText: vi.fn((t: string) => {
        written.text = t;
        return Promise.resolve();
      }),
    },
    configurable: true,
  });
});

afterEach(() => {
  editor.destroy();
  document.body.innerHTML = "";
});

function setup(tableHtml: string): void {
  editor = new Editor({ element: host, extensions: buildExtensions(), content: tableHtml });
  // 先頭セル内にカーソルを置く（isInTable を満たす）
  let cellPos = -1;
  editor.state.doc.descendants((node, pos) => {
    if (cellPos === -1 && (node.type.name === "tableCell" || node.type.name === "tableHeader")) {
      cellPos = pos;
    }
  });
  editor.commands.setTextSelection(cellPos + 2);
}

describe("copyTableToClipboard の TSV", () => {
  it("colspan 結合セルでも列位置がずれない（被覆位置は空欄）", async () => {
    setup(
      "<table><tbody>" +
        '<tr><th colspan="2"><p>AB</p></th><th><p>C</p></th></tr>' +
        "<tr><td><p>1</p></td><td><p>2</p></td><td><p>3</p></td></tr>" +
        "</tbody></table>",
    );
    expect(await copyTableToClipboard(editor)).toBe(true);
    expect(written.text).toBe("AB\t\tC\n1\t2\t3");
  });

  it("rowspan 結合セルの継続行も列数が揃う", async () => {
    setup(
      "<table><tbody>" +
        '<tr><td rowspan="2"><p>tall</p></td><td><p>r1</p></td></tr>' +
        "<tr><td><p>r2</p></td></tr>" +
        "</tbody></table>",
    );
    expect(await copyTableToClipboard(editor)).toBe(true);
    expect(written.text).toBe("tall\tr1\n\tr2");
  });

  it("複数段落セルは段落境界をスペースで区切る", async () => {
    setup(
      "<table><tbody>" +
        "<tr><td><p>金ヘルメットと併せて</p><p>ノージャンク</p></td><td><p>x</p></td></tr>" +
        "</tbody></table>",
    );
    expect(await copyTableToClipboard(editor)).toBe(true);
    expect(written.text).toBe("金ヘルメットと併せて ノージャンク\tx");
  });

  it("テーブル外では false を返す", async () => {
    editor = new Editor({ element: host, extensions: buildExtensions(), content: "<p>本文</p>" });
    editor.commands.setTextSelection(1);
    expect(await copyTableToClipboard(editor)).toBe(false);
  });
});
