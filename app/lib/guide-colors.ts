// ガイドの文字色・背景色パレット（Notion 準拠）の単一情報源。
// 利用箇所:
// - エディタのカラーピッカー（app/components/guide-editor/constants.ts が re-export）
// - ペースト時の非パレット色の除去（app/components/guide-editor/hooks/use-guide-editor.ts）
// - 表示時サニタイズの色ホワイトリスト（app/lib/guide-sanitize.server.ts）
//
// 背景: 外部リッチテキストのペーストでは、コピー元の算出スタイル（閲覧テーマの
// 文字色 = rgb(...) 形式や #000000 等）がそのままインライン style として取り込まれ、
// 保存 HTML に焼き付いてテーマ非追従になる。パレット外の色はエディタから設定する
// 手段が無いため、「パレット色のみ許可」を入口（ペースト）と出口（サニタイズ）の
// 両方で徹底する。パレット色は hex（ピッカー由来）と rgb 形式
// （公開ページからのコピー等でブラウザが正規化した形）の両方を受理する。

/** 文字色パレット（value 空文字 = デフォルト / 色指定なし） */
export const GUIDE_TEXT_COLORS = [
  { name: "デフォルト", value: "" },
  { name: "グレー", value: "#787774" },
  { name: "赤", value: "#D44C47" },
  { name: "オレンジ", value: "#CB7B2C" },
  { name: "黄", value: "#998A2B" },
  { name: "緑", value: "#448361" },
  { name: "青", value: "#337EA9" },
  { name: "紫", value: "#9065B0" },
  { name: "ピンク", value: "#C14C8A" },
] as const;

/** 背景色パレット（value 空文字 = なし） */
export const GUIDE_BG_COLORS = [
  { name: "なし", value: "" },
  { name: "グレー", value: "#F1F1EF" },
  { name: "赤", value: "#FDEBEC" },
  { name: "オレンジ", value: "#FBF3DB" },
  { name: "黄", value: "#FBF3DB" },
  { name: "緑", value: "#EDF3EC" },
  { name: "青", value: "#E7F3F8" },
  { name: "紫", value: "#F6F3F9" },
  { name: "ピンク", value: "#F9F0F5" },
] as const;

/**
 * 過去バージョンで保存されたハイライト色（旧既定の Tailwind yellow-200 等）。
 * ピッカーには表示しないが、既存ガイドの表示を壊さないため許可は維持する。
 */
const LEGACY_BG_COLORS = [{ value: "#FEF08A" }] as const;

function parseHex(hex: string): { r: number; g: number; b: number } {
  const value = hex.replace("#", "");
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

/** 比較用に色値を正規化する（小文字化・空白除去。"rgb(1, 2, 3)" → "rgb(1,2,3)"） */
function normalizeColorValue(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

/** パレットの hex + 対応する rgb 形式を正規化して集合にする */
function buildAllowedSet(colors: ReadonlyArray<{ value: string }>): Set<string> {
  const set = new Set<string>();
  for (const { value } of colors) {
    if (!value) continue;
    const { r, g, b } = parseHex(value);
    set.add(normalizeColorValue(value));
    set.add(`rgb(${r},${g},${b})`);
  }
  return set;
}

const allowedTextColors = buildAllowedSet(GUIDE_TEXT_COLORS);
const allowedBgColors = buildAllowedSet([...GUIDE_BG_COLORS, ...LEGACY_BG_COLORS]);

/** 文字色としてパレットに含まれるか（hex / rgb 両形式を受理） */
export function isPaletteTextColor(value: string): boolean {
  return allowedTextColors.has(normalizeColorValue(value));
}

/** 背景色としてパレットに含まれるか（hex / rgb 両形式を受理） */
export function isPaletteBgColor(value: string): boolean {
  return allowedBgColors.has(normalizeColorValue(value));
}

function buildWhitelistRegex(colors: ReadonlyArray<{ value: string }>): RegExp {
  const parts: string[] = [];
  for (const { value } of colors) {
    if (!value) continue;
    const { r, g, b } = parseHex(value);
    parts.push(value, `rgb\\(\\s*${r}\\s*,\\s*${g}\\s*,\\s*${b}\\s*\\)`);
  }
  return new RegExp(`^(${parts.join("|")})$`, "i");
}

/**
 * ペースト HTML からパレット外の color / background-color を除去する。
 * ガイドエディタの transformPastedHTML から呼ばれる（DOM 環境前提）。
 * パレット色（エディタ内コピーや他ガイドからのコピー由来）は保持する。
 */
export function stripNonPaletteColorsFromHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const el of doc.body.querySelectorAll<HTMLElement>("[style]")) {
    const color = el.style.color;
    if (color && !isPaletteTextColor(color)) {
      el.style.removeProperty("color");
    }
    const bg = el.style.backgroundColor;
    if (bg && !isPaletteBgColor(bg)) {
      el.style.removeProperty("background-color");
    }
    if (!el.getAttribute("style")) el.removeAttribute("style");
  }
  return doc.body.innerHTML;
}

/** サニタイズ用: 文字色として許可する値（パレットの hex / rgb のみ） */
export const guideTextColorWhitelist = buildWhitelistRegex(GUIDE_TEXT_COLORS);

/** サニタイズ用: 背景色として許可する値（パレット + レガシー色の hex / rgb のみ） */
export const guideBgColorWhitelist = buildWhitelistRegex([
  ...GUIDE_BG_COLORS,
  ...LEGACY_BG_COLORS,
]);
