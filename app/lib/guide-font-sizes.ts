// ガイド本文の文字サイズ（段階指定）の単一情報源。
// 利用箇所:
// - エディタの文字サイズピッカー（app/components/guide-editor/constants.ts が re-export）
// - ペースト時の許可外サイズの除去（app/components/guide-editor/hooks/use-guide-editor.ts）
// - 表示時サニタイズの font-size ホワイトリスト（app/lib/guide-sanitize.server.ts が
//   isAllowedFontSize を cssfilter の判定関数として使用）
//
// 背景・方針は guide-colors.ts と同じ。外部リッチテキストのペーストでは
// コピー元の算出スタイル（font-size: 14px 等）がそのまま取り込まれ、保存 HTML に
// 焼き付いて本文サイズがばらつく。任意サイズはエディタから設定する手段が無いため、
// 「許可した段階のみ」を入口（ペースト）と出口（サニタイズ）の両方で徹底する。
//
// 単位に em を使う理由: 表示側（app.css の .guide-content.prose）が全て em 基準で、
// ルートの 1rem に対する相対値として自然に合成されるため。
// 見出し h1〜h3 が 1.15〜1.875em を担うので、本文のサイズ変更は
// 「注釈で小さく」「少し強調」が主な用途になる想定。

import type { MessageKey } from "@/lib/messages";

/** 文字サイズの段階（value 空文字 = 標準 / 指定なし。名称は翻訳キー） */
export const GUIDE_FONT_SIZES = [
  { nameKey: "guideEditor.fontSizes.xs", value: "0.75em" },
  { nameKey: "guideEditor.fontSizes.sm", value: "0.875em" },
  { nameKey: "guideEditor.fontSizes.base", value: "" },
  { nameKey: "guideEditor.fontSizes.lg", value: "1.25em" },
  { nameKey: "guideEditor.fontSizes.xl", value: "1.5em" },
] as const satisfies ReadonlyArray<{ nameKey: MessageKey; value: string }>;

export type GuideFontSize = (typeof GUIDE_FONT_SIZES)[number]["value"];

/** 比較用に値を正規化する（小文字化・空白除去） */
function normalizeFontSize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

const allowedFontSizes = new Set(
  GUIDE_FONT_SIZES.map(({ value }) => value)
    .filter((value) => value !== "")
    .map(normalizeFontSize),
);

/** 許可された段階の文字サイズか */
export function isAllowedFontSize(value: string): boolean {
  return allowedFontSizes.has(normalizeFontSize(value));
}

/**
 * ペースト HTML から許可外の font-size を除去する。
 * ガイドエディタの transformPastedHTML から呼ばれる（DOM 環境前提）。
 * 許可段階（エディタ内コピーや他ガイドからのコピー由来）は保持する。
 */
export function stripDisallowedFontSizesFromHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const el of doc.body.querySelectorAll<HTMLElement>("[style]")) {
    const fontSize = el.style.fontSize;
    if (fontSize && !isAllowedFontSize(fontSize)) {
      el.style.removeProperty("font-size");
    }
    if (!el.getAttribute("style")) el.removeAttribute("style");
  }
  return doc.body.innerHTML;
}
