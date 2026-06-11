// ガイドエディタの共有定数。旧 index.tsx から逐語移植（互換性のため値を変更しない）。

/** 文字色パレット（Notion 準拠） */
export const TEXT_COLORS = [
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

/** 背景色パレット */
export const BG_COLORS = [
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
  toolbar: 30,
  handle: 40,
  bubble: 50,
  slash: 60,
  dialog: 70,
} as const;
