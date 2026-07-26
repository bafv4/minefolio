// ガイドエディタの共有定数。旧 index.tsx から逐語移植（互換性のため値を変更しない）。
import { GUIDE_TEXT_COLORS, GUIDE_BG_COLORS } from "@/lib/guide-colors";
import { GUIDE_FONT_SIZES } from "@/lib/guide-font-sizes";

/** 文字色パレット（Notion 準拠）。単一情報源は app/lib/guide-colors.ts */
export const TEXT_COLORS = GUIDE_TEXT_COLORS;

/** 背景色パレット。単一情報源は app/lib/guide-colors.ts */
export const BG_COLORS = GUIDE_BG_COLORS;

/** テーブルセルの背景色（BG_COLORS を流用） */
export const CELL_COLORS = BG_COLORS;

/** 文字サイズの段階。単一情報源は app/lib/guide-font-sizes.ts */
export const FONT_SIZES = GUIDE_FONT_SIZES;

export type ImageAlign = "left" | "center" | "right";

/** コールアウト種別ごとのアイコン（種別と表示名は desktop-toolbar.tsx が持つ） */
export const CALLOUT_ICONS: Record<string, string> = {
  tip: "💡",
  info: "ℹ️",
  warning: "⚠️",
  danger: "🚨",
};

/** オートセーブの debounce（ミリ秒） */
export const AUTO_SAVE_DEBOUNCE_MS = 2000;

/**
 * エディタ内 UI の z-index 層。
 * 旧実装の z-40 / z-200 / z-9999 のばらつきを 1 箇所に集約。
 */
export const EDITOR_Z = {
  // テーブル行・列ハンドルはツールバーより下 = スクロールでテーブル上端が
  // ツールバー裏に隠れたとき、ハンドルも一緒に隠れる（ツールバー上に浮かない）。
  tableHandle: 29,
  toolbar: 30,
  handle: 40,
  bubble: 50,
  slash: 60,
  dialog: 70,
} as const;
