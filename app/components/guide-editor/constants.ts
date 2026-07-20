// ガイドエディタの共有定数。旧 index.tsx から逐語移植（互換性のため値を変更しない）。
import { GUIDE_TEXT_COLORS, GUIDE_BG_COLORS } from "@/lib/guide-colors";

/** 文字色パレット（Notion 準拠）。単一情報源は app/lib/guide-colors.ts */
export const TEXT_COLORS = GUIDE_TEXT_COLORS;

/** 背景色パレット。単一情報源は app/lib/guide-colors.ts */
export const BG_COLORS = GUIDE_BG_COLORS;

/** テーブルセルの背景色（BG_COLORS を流用） */
export const CELL_COLORS = BG_COLORS;

/** コールアウト種別 */
export const CALLOUT_TYPES = [
  { type: "tip", icon: "💡", label: "ヒント" },
  { type: "info", icon: "ℹ️", label: "情報" },
  { type: "warning", icon: "⚠️", label: "警告" },
  { type: "danger", icon: "🚨", label: "危険" },
] as const;

export const CALLOUT_ICONS: Record<string, string> = {
  tip: "💡",
  info: "ℹ️",
  warning: "⚠️",
  danger: "🚨",
};

/** 画像サイズの離散プリセット（px、null = 原寸/フル幅） */
export const IMAGE_SIZE_PRESETS = [
  { key: "S", label: "S", width: 320 },
  { key: "M", label: "M", width: 480 },
  { key: "L", label: "L", width: 640 },
  { key: "Full", label: "原寸", width: null },
] as const;

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
