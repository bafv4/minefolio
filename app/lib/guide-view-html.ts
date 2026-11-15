// ガイド公開表示（/guides/:author/:slug）の本文 HTML に、サニタイズ後に施す a11y の変換。
// クライアント/サーバー共用の純粋関数（loader が変換する）。
//
// 変換はサニタイズの「後」に行う（role / aria-label / title はサニタイザの許可属性に無く、
// 前に付けると落ちる）。保存データ・エディタの HTML は変えない。
import { decodeHtmlAttr } from "./guide-embed-attrs";

/** 属性値に入れる文字列のエスケープ */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** `data-callout` 属性（`data-callout-type` ではない）を持つ開きタグか */
const CALLOUT_ATTR = /(?:^|\s)data-callout(?=\s|=|$)/;
const CALLOUT_TYPE_ATTR = /\sdata-callout-type="([^"]*)"/;

/**
 * コールアウト（`<div data-callout data-callout-type="tip" …>`）に `role="note"` と
 * 種類名の `aria-label` を付け、読み上げで種類（ヒント・警告など）を伝える。
 * 見た目のアイコンは CSS の装飾で、読み上げには出ない（app/app.css の .callout::before）。
 * labelFor が null を返す種類（未知の種類）は role だけ付ける。
 */
export function annotateGuideCallouts(
  html: string,
  labelFor: (calloutType: string) => string | null,
): string {
  return html.replace(/<div\b([^>]*)>/g, (tag, attrs: string) => {
    if (!CALLOUT_ATTR.test(attrs) || /\srole=/.test(attrs)) return tag;
    const type = attrs.match(CALLOUT_TYPE_ATTR)?.[1] ?? "";
    const label = labelFor(decodeHtmlAttr(type));
    const labelAttr = label ? ` aria-label="${escapeAttr(label)}"` : "";
    return `<div${attrs} role="note"${labelAttr}>`;
  });
}
