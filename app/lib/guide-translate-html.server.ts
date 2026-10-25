// ガイド本文（TipTap の getHTML() 出力）の自動翻訳用 HTML 加工。仕様は docs/translation.md「中核」。
//
// HTML をモデルへ丸ごと渡さず、**テキストノードだけを配列で取り出し、訳文を元のノードへ書き戻す**。
// マークアップ（タグ・属性・埋め込み）は一切モデルに触れさせないため、定義上壊れない。
//
// このモジュールは DB・翻訳 API・サニタイザのいずれにも依存しない純関数（テストしやすくするため）。
// 書き戻した HTML は呼び出し側が sanitizeGuideHtml() を通す。
import { parseFragment, serialize, type DefaultTreeAdapterMap } from "parse5";

type ChildNode = DefaultTreeAdapterMap["childNode"];
type ParentNode = DefaultTreeAdapterMap["parentNode"];
type Element = DefaultTreeAdapterMap["element"];
type TextNode = DefaultTreeAdapterMap["textNode"];

/** 中身を訳さないタグ（コマンド・座標・seed・キー名・スクリプト類） */
const SKIP_TAGS = new Set(["code", "pre", "kbd", "samp", "script", "style", "textarea", "template"]);

/** 埋め込みノード（atom。中身を持たないが明示的にスキップする）を示す属性 */
const EMBED_ATTRS = ["data-keybind-embed", "data-searchcraft-embed", "data-guide-link"];

/** 訳文の書き戻し先 1 つ分（テキストノード、または img の alt 属性） */
interface Slot {
  /** 訳文を書き戻す。前後の空白は元のまま保つ */
  write(translated: string): void;
}

export interface ExtractedHtmlTexts {
  /** 翻訳対象の文字列（前後の空白は除き、空白のみのノードは含まない） */
  texts: string[];
  /**
   * 訳文を元の位置へ書き戻した HTML を返す（**未サニタイズ**。呼び出し側が sanitizeGuideHtml() を通す）。
   * translated の長さが texts と違うなら例外（欠けたまま書き戻すと本文が壊れるため）。
   */
  apply(translated: string[]): string;
}

function isElement(node: ChildNode): node is Element {
  return "tagName" in node;
}

function isTextNode(node: ChildNode): node is TextNode {
  return node.nodeName === "#text";
}

function isEmbed(element: Element): boolean {
  return element.attrs.some((attr) => EMBED_ATTRS.includes(attr.name));
}

/** 前後の空白と本体に分ける（空白は書き戻しで元のまま保持する） */
function splitWhitespace(value: string): { lead: string; core: string; trail: string } {
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(value);
  return { lead: match?.[1] ?? "", core: match?.[2] ?? value, trail: match?.[3] ?? "" };
}

/** HTML から翻訳対象のテキストを抽出する */
export function extractGuideHtmlTexts(html: string): ExtractedHtmlTexts {
  const fragment = parseFragment(html);
  const texts: string[] = [];
  const slots: Slot[] = [];

  function addText(node: TextNode): void {
    const { lead, core, trail } = splitWhitespace(node.value);
    if (core === "") return; // 空白のみのノードは送らない
    texts.push(core);
    slots.push({
      write(translated) {
        node.value = lead + translated + trail;
      },
    });
  }

  function addImgAlt(element: Element): void {
    const attr = element.attrs.find((a) => a.name === "alt");
    if (!attr) return;
    const { lead, core, trail } = splitWhitespace(attr.value);
    if (core === "") return;
    texts.push(core);
    slots.push({
      write(translated) {
        attr.value = lead + translated + trail;
      },
    });
  }

  function walk(parent: ParentNode): void {
    for (const child of parent.childNodes) {
      if (isTextNode(child)) {
        addText(child);
      } else if (isElement(child)) {
        if (SKIP_TAGS.has(child.tagName) || isEmbed(child)) continue;
        if (child.tagName === "img") addImgAlt(child);
        walk(child);
      }
      // コメント等は対象外
    }
  }

  walk(fragment);

  return {
    texts,
    apply(translated) {
      if (translated.length !== slots.length) {
        throw new Error(
          `translated texts length mismatch: expected ${slots.length}, got ${translated.length}`,
        );
      }
      slots.forEach((slot, i) => slot.write(translated[i]));
      return serialize(fragment);
    },
  };
}

/**
 * 文字列配列を、合計文字数が maxChars 以下になるよう連続した区間に分ける（順序は保つ）。
 * 1 要素だけで maxChars を超える場合は、その要素単独の区間になる（呼び出し側で失敗扱いになりうる）。
 * @returns 各区間の [start, end) インデックス
 */
export function chunkTexts(texts: string[], maxChars: number): Array<[number, number]> {
  const chunks: Array<[number, number]> = [];
  let start = 0;
  let size = 0;
  for (let i = 0; i < texts.length; i++) {
    const len = texts[i].length;
    if (i > start && size + len > maxChars) {
      chunks.push([start, i]);
      start = i;
      size = 0;
    }
    size += len;
  }
  if (start < texts.length) chunks.push([start, texts.length]);
  return chunks;
}
