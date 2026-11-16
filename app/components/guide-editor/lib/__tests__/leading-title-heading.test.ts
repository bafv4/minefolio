// @vitest-environment jsdom
// 本文の先頭の見出しがタイトルと同じかの判定（公開ページと同じ leadingHeadingMatchesTitle）と、
// その見出しの削除（1トランザクション・Undo で戻る・見出しだけの本文でも壊れない）を検証する。
import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import { buildExtensions } from "../../editor-config";
import { deleteLeadingHeading, leadingBlockMatchesTitle } from "../leading-title-heading";

let editor: Editor | null = null;

function makeEditor(content: string): Editor {
  editor = new Editor({
    element: document.createElement("div"),
    extensions: buildExtensions(),
    content,
  });
  return editor;
}

const matches = (ed: Editor, title: string) =>
  leadingBlockMatchesTitle(ed.state.doc.firstChild, ed.schema, title);

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("leadingBlockMatchesTitle", () => {
  it("先頭の見出しの文がタイトルと同じなら true（空白の並び・装飾のマークは無視）", () => {
    expect(matches(makeEditor("<h1>ネザー  の入り方</h1><p>本文</p>"), " ネザー の入り方 ")).toBe(true);
    editor?.destroy();
    expect(matches(makeEditor("<h2><strong>ネザー</strong>の入り方</h2>"), "ネザーの入り方")).toBe(true);
  });

  it("文が違う・先頭が見出しでない・タイトルが空なら false", () => {
    expect(matches(makeEditor("<h1>ネザーの入り方（改訂）</h1>"), "ネザーの入り方")).toBe(false);
    editor?.destroy();
    expect(matches(makeEditor("<p>ネザーの入り方</p><h1>ネザーの入り方</h1>"), "ネザーの入り方")).toBe(false);
    editor?.destroy();
    expect(matches(makeEditor("<h1>ネザーの入り方</h1>"), "  ")).toBe(false);
  });

  it("文字参照になる文字（& < >）を含むタイトルも一致する", () => {
    expect(matches(makeEditor("<h1>A &amp; B &lt;1.16&gt;</h1>"), "A & B <1.16>")).toBe(true);
  });
});

describe("deleteLeadingHeading", () => {
  it("先頭の見出しだけを消し、Undo で戻せる", () => {
    const ed = makeEditor("<h1>タイトル</h1><p>本文</p>");
    expect(deleteLeadingHeading(ed)).toBe(true);
    expect(ed.getHTML()).toBe("<p>本文</p>");
    ed.commands.undo();
    expect(ed.getHTML()).toBe("<h1>タイトル</h1><p>本文</p>");
  });

  it("本文が見出しだけなら空の段落に置き換える", () => {
    const ed = makeEditor("<h1>タイトル</h1>");
    expect(deleteLeadingHeading(ed)).toBe(true);
    expect(ed.getHTML()).toBe("<p></p>");
    expect(ed.state.doc.childCount).toBe(1);
    ed.commands.undo();
    // 見出しが戻る（StarterKit の trailingNode が、末尾が見出しの文書に空の段落を足す）
    expect(ed.getHTML()).toMatch(/^<h1>タイトル<\/h1>(<p><\/p>)?$/);
  });

  it("先頭が見出しでなければ何もしない", () => {
    const ed = makeEditor("<p>本文</p><h1>タイトル</h1>");
    expect(deleteLeadingHeading(ed)).toBe(false);
    expect(ed.getHTML()).toBe("<p>本文</p><h1>タイトル</h1>");
  });
});
