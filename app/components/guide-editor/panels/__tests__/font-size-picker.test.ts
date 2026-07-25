// @vitest-environment jsdom
// 「見出し（h1〜h3）では文字サイズを変更できない」の回帰テスト。
// FontSize マーク自体は ProseMirror 的には見出しのテキストにも付けられてしまう
// （textStyle マークはブロック種別を問わない）ため、ガードは本ファイルの
// isFontSizeEditable / applyGuideFontSize が担う。block-commands.test.ts と同様、
// React コンポーネントはマウントせず実 Editor インスタンスで直接検証する。
//
// 選択は selectAll() ではなくカーソル（空選択）を対象テキストの内側へ置く方式にする。
// tiptap のコア拡張 trailingNode は「見出しで終わる doc」に空段落を自動追加するため、
// selectAll だと選択範囲が見出し＋自動追加された空段落にまたがり isActive("heading") が
// false になってしまう（実際のカーソル操作では起きない、テスト固有の落とし穴）。
import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import { buildExtensions } from "../../editor-config";
import { isFontSizeEditable, applyGuideFontSize } from "../font-size-picker";

let editor: Editor;

afterEach(() => {
  editor?.destroy();
});

/** 指定テキストを持つテキストノードの内側（1文字目の直後）の位置を返す */
function posInText(ed: Editor, text: string): number {
  let found = -1;
  ed.state.doc.descendants((node, pos) => {
    if (found !== -1) return false;
    if (node.isText && node.text === text) {
      found = pos + 1;
      return false;
    }
  });
  if (found === -1) throw new Error(`text not found in doc: ${text}`);
  return found;
}

/** 指定テキストを持つテキストノードの全体を選択する（setFontSize は範囲選択でないと
 * 既存テキストへ反映されない = カーソル位置だけだと次の入力用の stored marks にしかならないため） */
function selectText(ed: Editor, text: string): void {
  const from = posInText(ed, text) - 1;
  ed.commands.setTextSelection({ from, to: from + text.length });
}

describe("isFontSizeEditable / applyGuideFontSize", () => {
  it("本文（段落）にカーソルがある場合は許可される", () => {
    editor = new Editor({
      element: document.createElement("div"),
      extensions: buildExtensions(),
      content: "<p>本文</p>",
    });
    editor.commands.setTextSelection(posInText(editor, "本文"));
    expect(isFontSizeEditable(editor)).toBe(true);

    // 反映確認は範囲選択で行う（空選択への適用は stored marks にしかならず HTML に出ない）
    selectText(editor, "本文");
    applyGuideFontSize(editor, "1.5em");
    expect(editor.getHTML()).toContain("font-size: 1.5em");
  });

  it.each([1, 2, 3] as const)("見出し h%i にカーソルがある場合は禁止される", (level) => {
    editor = new Editor({
      element: document.createElement("div"),
      extensions: buildExtensions(),
      content: `<h${level}>見出し</h${level}>`,
    });
    editor.commands.setTextSelection(posInText(editor, "見出し"));
    expect(isFontSizeEditable(editor)).toBe(false);

    // コマンド側のガード: 見出し内では setFontSize を呼んでも反映されない
    applyGuideFontSize(editor, "1.5em");
    expect(editor.getHTML()).not.toContain("font-size");
  });

  it("見出しの選択範囲（複数文字選択）でも禁止される", () => {
    editor = new Editor({
      element: document.createElement("div"),
      extensions: buildExtensions(),
      content: "<h2>見出し</h2>",
    });
    const from = posInText(editor, "見出し") - 1; // ノード先頭
    editor.commands.setTextSelection({ from, to: from + 3 });
    expect(editor.state.selection.empty).toBe(false);
    expect(isFontSizeEditable(editor)).toBe(false);
  });

  it("見出しから本文へカーソルを移せば再び許可される", () => {
    editor = new Editor({
      element: document.createElement("div"),
      extensions: buildExtensions(),
      content: "<h2>見出し</h2><p>本文</p>",
    });
    editor.commands.setTextSelection(posInText(editor, "本文"));
    expect(isFontSizeEditable(editor)).toBe(true);

    selectText(editor, "本文");
    applyGuideFontSize(editor, "0.75em");
    expect(editor.getHTML()).toContain("font-size: 0.75em");
  });

  it("既に文字サイズが付いた本文を見出しへ変換すると、その場では変更できなくなる（属性自体の除去はしない）", () => {
    editor = new Editor({
      element: document.createElement("div"),
      extensions: buildExtensions(),
      content: `<p><span style="font-size: 1.5em">大きい本文</span></p>`,
    });
    expect(editor.getHTML()).toContain("font-size: 1.5em");

    // ブロック種別変換（実運用の setBlockType と同じ setNode 経路）
    editor.commands.setTextSelection(posInText(editor, "大きい本文"));
    editor.chain().focus().setNode("heading", { level: 2 }).run();
    expect(editor.getHTML()).toContain("<h2>");
    expect(isFontSizeEditable(editor)).toBe(false);

    // ガード対象は「新規に変更する」操作。変換時点で既に焼き付いた font-size 属性は
    // ここでは消さない（表示側は app.css の :is(h1..h6) span[style*="font-size"] が無効化する）。
    expect(editor.getHTML()).toContain("font-size: 1.5em");

    // 見出し内なので、この状態からテキストを選択して変更しようとしても反映されない
    selectText(editor, "大きい本文");
    applyGuideFontSize(editor, "0.75em");
    expect(editor.getHTML()).not.toContain("0.75em");
    expect(editor.getHTML()).toContain("font-size: 1.5em"); // 元の値も保たれる
  });
});
