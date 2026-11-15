// ガイド公開表示（/guides/:author/:slug）の本文 HTML に、サニタイズ後に施す a11y の変換と、
// 本文中の YouTube 埋め込みを読むための補助。クライアント/サーバー共用の純粋関数
// （loader が変換し、splitContentAtEmbeds が YouTube の分割に使う）。
//
// 変換はサニタイズの「後」に行う（role / aria-label / title はサニタイザの許可属性に無く、
// 前に付けると落ちる）。保存データ・エディタの HTML は変えない。
import { decodeHtmlAttr } from "./guide-embed-attrs";
import { getYouTubeEmbedUrl } from "./youtube-url";

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

/**
 * 本文の YouTube 埋め込み（TipTap の出力 `<div data-youtube-video><iframe …></iframe></div>`）
 * 1 個分に一致する正規表現の元。属性の順・裸属性（サニタイズ後は `data-youtube-video` に値が無い）の
 * どちらにも一致する。グループ 1 は iframe の属性列。
 */
export const GUIDE_YOUTUBE_BLOCK_SOURCE =
  String.raw`<div\b[^>]*\sdata-youtube-video(?:="[^"]*")?(?=[\s>])[^>]*>\s*<iframe\b([^>]*)>\s*<\/iframe>\s*<\/div>`;

/**
 * 本文の YouTube の iframe に、番号付きの `title`（読み上げでの名前）と `loading="lazy"` を付ける。
 * 番号は本文中の出現順（1 始まり）で、splitContentAtEmbeds の YouTube セグメントの番号と一致する。
 * 本文の直下の動画は押してから読み込む部品（YouTubeClickEmbed）に置き換わるので、ここでの title が
 * 実際に使われるのは、コールアウト・トグル・段組の中など分割できない位置に残る iframe。
 */
export function titleGuideYouTubeIframes(html: string, titleFor: (index: number) => string): string {
  let index = 0;
  return html.replace(new RegExp(GUIDE_YOUTUBE_BLOCK_SOURCE, "g"), (block, attrs: string) => {
    index += 1;
    if (/\stitle=/.test(attrs)) return block;
    const extra = ` title="${escapeAttr(titleFor(index))}"${/\sloading=/.test(attrs) ? "" : ' loading="lazy"'}`;
    return block.replace(`<iframe${attrs}>`, () => `<iframe${attrs}${extra}>`);
  });
}

/**
 * YouTube の iframe の属性列から、押してから読み込む埋め込み用の URL を作る。
 * 許可ホスト（youtube-nocookie 等。サニタイズ済み）の src から動画 ID を取り直し、
 * youtube-nocookie.com の埋め込み URL にする（getYouTubeEmbedUrl）。開始位置（`start`）は引き継ぐ。
 * src が無い（サニタイズで除去された）・動画 ID が取れないときは null。
 * 再生リスト（TipTap は `/embed/videoseries?list=…` を出す）と `list` 付きも null。動画 1 本の埋め込み URL に
 * 直すと再生リストが失われる（videoseries を動画 ID と取り違える）ため。呼び出し側は iframe のまま残す。
 */
export function parseGuideYouTubeEmbedUrl(iframeAttrs: string): string | null {
  const srcMatch = iframeAttrs.match(/\ssrc="([^"]*)"/);
  if (!srcMatch) return null;
  const raw = decodeHtmlAttr(srcMatch[1]).trim();
  const src = raw.startsWith("//") ? `https:${raw}` : raw;
  try {
    const url = new URL(src);
    if (url.pathname.includes("/videoseries") || url.searchParams.has("list")) return null;
  } catch {
    return null;
  }
  const embedUrl = getYouTubeEmbedUrl(src);
  if (!embedUrl) return null;
  let start: string | null = null;
  try {
    start = new URL(src).searchParams.get("start");
  } catch {
    start = null;
  }
  return start && /^\d+$/.test(start) ? `${embedUrl}?start=${start}` : embedUrl;
}

/** 閉じタグを持たない要素（開きタグだけで深さを変えない） */
const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr",
]);

/**
 * HTML 断片の要素の深さの増減（開きタグ +1、閉じタグ -1。空要素・自己終了は数えない）。
 * サニタイズ済みの本文（タグの対応が取れている・属性値の < > はエスケープ済み）を前提にした軽い計数で、
 * splitContentAtEmbeds が「本文の直下（深さ 0）」かどうかを判定するのに使う。
 */
export function htmlDepthDelta(fragment: string): number {
  let delta = 0;
  for (const m of fragment.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?(\/?)>/g)) {
    if (VOID_ELEMENTS.has(m[2].toLowerCase()) || m[3]) continue;
    delta += m[1] ? -1 : 1;
  }
  return delta;
}
