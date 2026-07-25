import { FilterXSS } from "xss";
import { isPaletteTextColor, isPaletteBgColor } from "./guide-colors";
import { isAllowedFontSize } from "./guide-font-sizes";

/**
 * ガイド本文（TipTap の getHTML() 出力）のサーバーサイドサニタイズ。
 *
 * 旧 sanitize-html 構成（defaults.allowedTags + 追加タグ・属性・スタイル）を
 * xss + cssfilter で同等に再現している。主な挙動:
 * - 許可外タグはタグのみ除去して中身のテキストは残す（stripIgnoreTag）。
 *   ただし script / style / textarea / option は中身ごと除去する。
 * - href / src は xss 既定の safeAttrValue が検査する
 *   （http(s) / mailto / tel / ftp / 相対 / # / data:image のみ許可。javascript: 等は除去）。
 * - style 属性は cssfilter が CSS_WHITELIST のプロパティのみ通す。
 *   出力は `min-width:601px;` 形式（コロン後の空白なし）に正規化される。
 * - 値が空の属性（TipTap のマーカー属性 data-callout="" 等）は裸属性（data-callout）として
 *   出力される。CSS の存在セレクタ [data-callout] や埋め込み検出の正規表現はどちらにもマッチする。
 * - iframe は YouTube 埋め込みホストのみ src を許可し、それ以外は src を除去して無効化する
 *   （sanitize-html の allowedIframeHostnames 相当）。
 * - HTML コメントは除去（xss 既定）。
 */

/** 許可タグ（sanitize-html defaults.allowedTags + img / iframe / details / summary） */
const ALLOWED_TAGS = [
  // Content sectioning
  "address", "article", "aside", "footer", "header",
  "h1", "h2", "h3", "h4", "h5", "h6", "hgroup",
  "main", "nav", "section",
  // Text content
  "blockquote", "dd", "div", "dl", "dt", "figcaption", "figure",
  "hr", "li", "menu", "ol", "p", "pre", "ul",
  // Inline text semantics
  "a", "abbr", "b", "bdi", "bdo", "br", "cite", "code", "data", "dfn",
  "em", "i", "kbd", "mark", "q",
  "rb", "rp", "rt", "rtc", "ruby",
  "s", "samp", "small", "span", "strong", "sub", "sup", "time", "u", "var", "wbr",
  // Table content
  "caption", "col", "colgroup", "table", "tbody", "td", "tfoot", "th",
  "thead", "tr",
  // ガイドで追加許可
  "img", "iframe", "details", "summary",
];

/** タグ別の許可属性（class は全タグ共通で許可するためここには書かない） */
const TAG_ATTRS: Record<string, string[]> = {
  a: ["href", "name", "target", "rel"],
  // data-align: 画像の横方向の配置（left / center / right。未設定は属性ごと無し）
  img: ["src", "alt", "title", "width", "height", "data-align"],
  iframe: ["src", "width", "height", "frameborder", "allowfullscreen", "allow"],
  div: [
    "data-youtube-video", "data-callout", "data-callout-type", "data-guide-link",
    "data-columns", "data-column", "data-keybind-embed", "data-searchcraft-embed",
    "data-user-slug", "data-preset-name",
  ],
  table: ["style"],
  col: ["style"],
  td: ["colspan", "rowspan", "style"],
  th: ["colspan", "rowspan", "style"],
  span: ["style"],
  mark: ["data-color", "style"],
};

/** style 属性で許可する CSS プロパティ
 * （true=任意の安全な値 / RegExp=一致する値のみ / 関数=true を返した値のみ）
 *
 * color / background-color はエディタのカラーパレット（hex / rgb 形式）のみ許可する。
 * 判定はペースト時の除去と同じ isPalette*Color（guide-colors.ts）を共有し、
 * 入口と出口で許可ルールがズレないようにする。外部ペースト由来で焼き付いた
 * 算出スタイル（閲覧テーマの色）は表示時にここで除去され、テーマ追従の
 * デフォルト色に戻る（保存データのマイグレーション不要）。 */
const CSS_WHITELIST: Record<string, boolean | RegExp | ((value: string) => boolean)> = {
  color: isPaletteTextColor,
  "background-color": isPaletteBgColor,
  // 段階指定のみ許可（任意サイズはエディタから設定できない。guide-font-sizes.ts 参照）
  "font-size": isAllowedFontSize,
  "text-align": /^(left|center|right|justify)$/,
  "min-width": true,
  width: true,
};

/** iframe の src に許可する埋め込みホスト */
const ALLOWED_IFRAME_HOSTS = new Set(["www.youtube.com", "www.youtube-nocookie.com"]);

function isAllowedIframeSrc(value: string): boolean {
  const trimmed = value.trim();
  let url: URL;
  try {
    // プロトコル相対（//host/…）は https として解釈する
    url = new URL(trimmed.startsWith("//") ? `https:${trimmed}` : trimmed);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  return ALLOWED_IFRAME_HOSTS.has(url.hostname);
}

const whiteList: Record<string, string[]> = Object.fromEntries(
  ALLOWED_TAGS.map((tag) => [tag, ["class", ...(TAG_ATTRS[tag] ?? [])]]),
);

const guideFilter = new FilterXSS({
  whiteList,
  stripIgnoreTag: true,
  stripIgnoreTagBody: ["script", "style", "textarea", "option"],
  css: { whiteList: CSS_WHITELIST },
  onTagAttr(tag, name, value) {
    if (tag === "iframe" && name === "src" && !isAllowedIframeSrc(value)) {
      return ""; // 属性ごと除去（空文字を返すと出力されない）
    }
    // undefined を返すと既定処理（safeAttrValue のスキーム検査 + エスケープ）に進む
  },
});

export function sanitizeGuideHtml(html: string): string {
  return guideFilter.process(html);
}
