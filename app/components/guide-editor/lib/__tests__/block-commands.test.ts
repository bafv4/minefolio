// @vitest-environment jsdom
// ブロック挿入コマンドが実際に動作するか（callout / toggle / columns / table 等）を検証する。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import { buildExtensions } from "../../editor-config";
import {
  setBlockType,
  insertTable,
  insertColumns,
  insertHorizontalRule,
} from "../block-commands";

let editor: Editor;

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
