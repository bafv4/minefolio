// ガイド公開表示（/guides/:author/:slug）の本文 HTML に、サニタイズ後に施す変換（先頭のタイトルの見出しの除去・
// a11y の属性付け）と、本文中の YouTube 埋め込みを読むための補助。クライアント/サーバー共用の純粋関数
// （loader が変換し、splitContentAtEmbeds が YouTube の分割に使う）。
//
// 変換はサニタイズの「後」に行う（role / aria-label / title はサニタイザの許可属性に無く、
// 前に付けると落ちる）。タイトルの見出しの除去だけは、目次の生成より前に行う。保存データ・エディタの HTML は変えない。
import { decodeHtmlAttr } from "./guide-embed-attrs";
import { headingText } from "./guide-toc";
import { getYouTubeEmbedUrl } from "./youtube-url";

/** 属性値に入れる文字列のエスケープ */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** 本文の最初のブロックが見出し（h1〜h6）のとき、その開きタグ（タグ名と `>`）に一致する。先頭の空白は許す */
const LEADING_HEADING_OPEN = /^\s*<([hH])([1-6])(?:\s[^>]*)?>/;

/** 比較用の正規化（前後の空白を落とし、全角・半角・改行などの空白の並びを半角1つにそろえる） */
function normalizeTitleText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * 本文の最初のブロックの見出し（h1〜h6）の位置とテキストを返す。最初のブロックが見出しでなければ null。
 * 段組み・コールアウトなどの入れ物の中の見出しは見ない（本文の直下の最初のブロックだけ）。
 * 閉じタグは indexOf で探す（遅延一致の正規表現で末尾まで読み直さない。guide-toc.ts の ReDoS の注記と同じ理由）。
 */
function findLeadingHeading(html: string): { end: number; text: string } | null {
  const open = LEADING_HEADING_OPEN.exec(html);
  if (!open) return null;
  const innerStart = open[0].length;
  const closeTag = `</${open[1]}${open[2]}>`;
  let close = html.indexOf(closeTag, innerStart);
  // サニタイズ後は小文字だが、大文字の閉じタグも受ける
  if (close === -1) close = html.toLowerCase().indexOf(closeTag.toLowerCase(), innerStart);
  if (close === -1) return null;
  return { end: close + closeTag.length, text: headingText(html.slice(innerStart, close)) };
}

/**
 * 本文の最初のブロックが、タイトル（title）と同じ文の見出しか。
 * 比較は目次と同じ正規化（タグ除去・文字参照の復号・空白の並びを1つに）のうえでの完全一致で、
 * 言い換えた見出し（語の足し引き・装飾の文字の違い）は一致しない。タイトルか見出しが空なら false。
 */
export function leadingHeadingMatchesTitle(html: string, title: string): boolean {
  const heading = findLeadingHeading(html);
  if (!heading) return false;
  const expected = normalizeTitleText(title);
  return expected !== "" && normalizeTitleText(heading.text) === expected;
}

/**
 * 本文の最初のブロックが見出しなら、それを取り除いた本文を返す（見出しでなければそのまま）。
 * 旧仕様の新規作成は本文を `<h1>タイトル</h1>` で始めていたため、公開ページではタイトルの h1 の直後に
 * 同じ文の見出しが出ていた。loader が leadingHeadingMatchesTitle で一致を確かめてから呼ぶ
 * （目次の生成より前に呼び、目次からも外す）。保存データ・エディタの本文は変えない。
 */
export function removeLeadingHeading(html: string): string {
  const heading = findLeadingHeading(html);
  return heading ? html.slice(heading.end).replace(/^\s+/, "") : html;
}

/** 見出しの開きタグ（閉じタグ `</hN` は `<` の直後が `/` なので一致しない） */
const HEADING_OPEN_TAG = /<[hH]([1-6])(?=[\s>/])/g;

/**
 * HTML の中で最後に現れる見出しの段（開きタグのタグ名の数字、1〜6）。見出しが無ければ null。
 * 公開表示の本文は降格（guide-heading-demote.ts）の後なので、タグ名の数字が実際に描かれる段になる
 * （data-guide-level は元の段なので見ない）。入れ物の中の見出しも文書順に数える。
 * 本文中の埋め込みの見出しの段を、直前の本文の見出しから決めるのに使う（guide-embeds.tsx の embedGroupHeadingLevels）。
 */
export function lastHeadingLevel(html: string): number | null {
  let level: number | null = null;
  for (const m of html.matchAll(HEADING_OPEN_TAG)) level = Number(m[1]);
  return level;
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
