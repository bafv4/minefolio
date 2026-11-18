import type { MessageKey } from "@/lib/messages";
import { memo, useId, type CSSProperties } from "react";
import { useT } from "@/hooks/use-locale";
import { useRovingKeyFocus, type RovingItemProps } from "@/hooks/use-roving-key-focus";
import type { Translator } from "@/lib/messages";
import { ArrowBigUp, ChevronUp, Command, Option, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { getKeyLabel, getKeyCodeAliases, isJisLayout, isTklLayout, getActionLabel, getShortActionLabel, normalizeKeyCode, keysEqual, DEFAULT_FINGER_ASSIGNMENTS, parseKeyCombination, type FingerType, type KeyboardLayout } from "@/lib/keybindings";
import { getRemapOutputLabel, getRemapSourceLabel, type RemapInfo } from "@/lib/remap-utils";
import { TooltipProvider } from "@/components/ui/tooltip";
import { KeyInfoTrigger, hasKeyInfo, type KeyInfoData, type KeyInfoCustomAction } from "@/components/key-info-trigger";

// キーのフォーカスリング。横スクロールの枠（padding 0）で左端・上端のキーのリングが切れないよう、内側に描く
const KEY_FOCUS_RING = "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring";

// カスタムアクションのトリガーキー（修飾キー組み合わせ可）が指定キーコードに一致するものを抽出。
// リマップと同様、修飾キー組み合わせ（"Ctrl+KeyX"）はベースキー（KeyX）で照合する。
// layout を渡すと、JIS の半角キー（IntlYen）には別名の Backquote をトリガーにするものも含める。
function getCustomActionsForKeyCode(
  customActions: KeyInfoCustomAction[],
  keyCode: string,
  layout?: string | null,
): KeyInfoCustomAction[] {
  const codes = getKeyCodeAliases(keyCode, layout);
  return customActions.filter((ca) => {
    const baseKey = ca.triggerKey.includes("+")
      ? parseKeyCombination(ca.triggerKey).keyCode
      : ca.triggerKey;
    return codes.some((c) => keysEqual(baseKey, c));
  });
}

// 修飾キーの lucide アイコンマップ（リマップ表示用）。
// Shift = ArrowBigUp、Ctrl = ChevronUp、Alt = Option、Meta = Command。
const MODIFIER_ICON_MAP: Record<string, LucideIcon> = {
  Ctrl: ChevronUp,
  Shift: ArrowBigUp,
  Alt: Option,
  Meta: Command,
};

/** 共通: キー/ボタンの aria-label を組み立てる */
function buildKeyAriaLabel(t: Translator, opts: {
  displayLabel: string;
  noun?: string; // 「キー」 or 「ボタン」
  bindings: Array<{ action: string }>;
  remaps: RemapInfo[];
  layout?: string | null;
}): string {
  const noun = opts.noun ?? t("keyboardView.ariaKeyNoun");
  return [
    `${opts.displayLabel} ${noun}`,
    ...opts.bindings.map((b) => getActionLabel(t, b.action)),
    ...opts.remaps.map((r) =>
      t("keyboardView.ariaRemap", {
        from: getRemapSourceLabel(t, r.sourceKey, opts.layout),
        // 無効化は見える表示が「×」だが、読み上げでは意味が伝わらないので文言にする
        to: r.targetKey === null ? t("keyboardView.remapDisabled") : getRemapOutputLabel(t, r, opts.layout),
      }),
    ),
  ].join(t("keyboardView.ariaSeparator"));
}

// キーボードレイアウト定義
type KeyDefinition = {
  code: string;
  label?: string;
  /** label より優先される翻訳キー（ロケール依存のキーキャップ表記用） */
  labelKey?: MessageKey;
  width?: number; // 1 = 1unit (40px base)
  height?: number;
  /** キー外観の追加クラス */
  className?: string;
  /** JIS の L 字 Enter として専用描画する（2段分の単一ボタン・上方向に伸長） */
  jisEnter?: boolean;
};

type KeyboardRow = KeyDefinition[];

// US配列キーボード定義（メイン部分）
const US_MAIN_LAYOUT: KeyboardRow[] = [
  // Row 1: ESC, F1-F12
  [
    { code: "Escape", label: "Esc" },
    { code: "_spacer1", width: 0.5 },
    { code: "F1" },
    { code: "F2" },
    { code: "F3" },
    { code: "F4" },
    { code: "_spacer2", width: 0.5 },
    { code: "F5" },
    { code: "F6" },
    { code: "F7" },
    { code: "F8" },
    { code: "_spacer3", width: 0.5 },
    { code: "F9" },
    { code: "F10" },
    { code: "F11" },
    { code: "F12" },
  ],
  // Row 2: Number row
  [
    { code: "Backquote", label: "`" },
    { code: "Digit1", label: "1" },
    { code: "Digit2", label: "2" },
    { code: "Digit3", label: "3" },
    { code: "Digit4", label: "4" },
    { code: "Digit5", label: "5" },
    { code: "Digit6", label: "6" },
    { code: "Digit7", label: "7" },
    { code: "Digit8", label: "8" },
    { code: "Digit9", label: "9" },
    { code: "Digit0", label: "0" },
    { code: "Minus", label: "-" },
    { code: "Equal", label: "=" },
    { code: "Backspace", width: 2 },
  ],
  // Row 3: QWERTY row
  [
    { code: "Tab", width: 1.5 },
    { code: "KeyQ", label: "Q" },
    { code: "KeyW", label: "W" },
    { code: "KeyE", label: "E" },
    { code: "KeyR", label: "R" },
    { code: "KeyT", label: "T" },
    { code: "KeyY", label: "Y" },
    { code: "KeyU", label: "U" },
    { code: "KeyI", label: "I" },
    { code: "KeyO", label: "O" },
    { code: "KeyP", label: "P" },
    { code: "BracketLeft", label: "[" },
    { code: "BracketRight", label: "]" },
    { code: "Backslash", label: "\\", width: 1.5 },
  ],
  // Row 4: ASDF row
  [
    { code: "CapsLock", label: "Caps", width: 1.75 },
    { code: "KeyA", label: "A" },
    { code: "KeyS", label: "S" },
    { code: "KeyD", label: "D" },
    { code: "KeyF", label: "F" },
    { code: "KeyG", label: "G" },
    { code: "KeyH", label: "H" },
    { code: "KeyJ", label: "J" },
    { code: "KeyK", label: "K" },
    { code: "KeyL", label: "L" },
    { code: "Semicolon", label: ";" },
    { code: "Quote", label: "'" },
    { code: "Enter", width: 2.25 },
  ],
  // Row 5: ZXCV row
  [
    { code: "ShiftLeft", label: "Shift", width: 2.25 },
    { code: "KeyZ", label: "Z" },
    { code: "KeyX", label: "X" },
    { code: "KeyC", label: "C" },
    { code: "KeyV", label: "V" },
    { code: "KeyB", label: "B" },
    { code: "KeyN", label: "N" },
    { code: "KeyM", label: "M" },
    { code: "Comma", label: "," },
    { code: "Period", label: "." },
    { code: "Slash", label: "/" },
    { code: "ShiftRight", label: "Shift", width: 2.75 },
  ],
  // Row 6: Bottom row
  [
    { code: "ControlLeft", label: "Ctrl", width: 1.25 },
    { code: "MetaLeft", label: "Win", width: 1.25 },
    { code: "AltLeft", label: "Alt", width: 1.25 },
    { code: "Space", label: "Space", width: 6.25 },
    { code: "AltRight", label: "Alt", width: 1.25 },
    { code: "MetaRight", label: "Win", width: 1.25 },
    { code: "ContextMenu", label: "Menu", width: 1.25 },
    { code: "ControlRight", label: "Ctrl", width: 1.25 },
  ],
];

// JIS配列キーボード定義（メイン部分）
const JIS_MAIN_LAYOUT: KeyboardRow[] = [
  // Row 1: ESC, F1-F12
  US_MAIN_LAYOUT[0],
  // Row 2: Number row (半角/全角追加)
  [
    { code: "IntlYen", labelKey: "keyLabels.hankaku" },
    { code: "Digit1", label: "1" },
    { code: "Digit2", label: "2" },
    { code: "Digit3", label: "3" },
    { code: "Digit4", label: "4" },
    { code: "Digit5", label: "5" },
    { code: "Digit6", label: "6" },
    { code: "Digit7", label: "7" },
    { code: "Digit8", label: "8" },
    { code: "Digit9", label: "9" },
    { code: "Digit0", label: "0" },
    { code: "Minus", label: "-" },
    { code: "Equal", label: "^" },
    { code: "IntlBackslash", label: "¥" },
    { code: "Backspace", width: 1 },
  ],
  // Row 3: QWERTY row
  [
    { code: "Tab", width: 1.5 },
    { code: "KeyQ", label: "Q" },
    { code: "KeyW", label: "W" },
    { code: "KeyE", label: "E" },
    { code: "KeyR", label: "R" },
    { code: "KeyT", label: "T" },
    { code: "KeyY", label: "Y" },
    { code: "KeyU", label: "U" },
    { code: "KeyI", label: "I" },
    { code: "KeyO", label: "O" },
    { code: "KeyP", label: "P" },
    { code: "BracketLeft", label: "@" },
    { code: "BracketRight", label: "[" },
    // 下段の Enter（2段分の高さ）が上方向へ伸びる領域を確保するスペーサー
    // （右端を他段（15ユニット）に揃える）
    { code: "_spacer_jis", width: 1.5 },
  ],
  // Row 4: ASDF row（Enter は2段分の単一ボタン）
  [
    { code: "CapsLock", label: "Caps", width: 1.75 },
    { code: "KeyA", label: "A" },
    { code: "KeyS", label: "S" },
    { code: "KeyD", label: "D" },
    { code: "KeyF", label: "F" },
    { code: "KeyG", label: "G" },
    { code: "KeyH", label: "H" },
    { code: "KeyJ", label: "J" },
    { code: "KeyK", label: "K" },
    { code: "KeyL", label: "L" },
    { code: "Semicolon", label: ";" },
    { code: "Quote", label: ":" },
    { code: "Backslash", label: "]" },
    // JIS Enter: 専用コンポーネントで L 字・2段分の単一ボタンとして描画
    // （右端を他段（15ユニット）に揃える）
    { code: "Enter", label: "Enter", width: 1.25, height: 2, jisEnter: true },
  ],
  // Row 5: ZXCV row
  [
    { code: "ShiftLeft", label: "Shift", width: 2.25 },
    { code: "KeyZ", label: "Z" },
    { code: "KeyX", label: "X" },
    { code: "KeyC", label: "C" },
    { code: "KeyV", label: "V" },
    { code: "KeyB", label: "B" },
    { code: "KeyN", label: "N" },
    { code: "KeyM", label: "M" },
    { code: "Comma", label: "," },
    { code: "Period", label: "." },
    { code: "Slash", label: "/" },
    { code: "IntlRo", label: "\\" },
    { code: "ShiftRight", label: "Shift", width: 1.75 },
  ],
  // Row 6: Bottom row (変換・無変換・右Win・メニュー含む)
  [
    { code: "ControlLeft", label: "Ctrl", width: 1.25 },
    { code: "MetaLeft", label: "Win", width: 1.25 },
    { code: "AltLeft", label: "Alt", width: 1.25 },
    { code: "NonConvert", labelKey: "keyLabels.nonConvert", width: 1.25 },
    { code: "Space", label: "Space", width: 3 },
    { code: "Convert", labelKey: "keyLabels.convert", width: 1.25 },
    { code: "KanaMode", labelKey: "keyLabels.kana", width: 1.25 },
    { code: "AltRight", label: "Alt", width: 1.25 },
    { code: "MetaRight", label: "Win", width: 1 },
    { code: "ContextMenu", label: "Menu", width: 1 },
    { code: "ControlRight", label: "Ctrl", width: 1.25 },
  ],
];

// 指の種類から基本色名へのマッピング
type FingerColorName = "pinky" | "ring" | "middle" | "index" | "thumb" | "palm";

const FINGER_TO_COLOR: Record<FingerType, FingerColorName> = {
  "left-pinky": "pinky",
  "left-ring": "ring",
  "left-middle": "middle",
  "left-index": "index",
  "left-thumb": "thumb",
  "left-palm": "palm",
  "right-palm": "palm",
  "right-thumb": "thumb",
  "right-index": "index",
  "right-middle": "middle",
  "right-ring": "ring",
  "right-pinky": "pinky",
};

// 指の色（キー背景用）- CSS変数を使用
export const FINGER_KEY_COLORS: Record<FingerType, string> = {
  "left-pinky": "bg-finger-pinky/30 border-finger-pinky/60 text-foreground",
  "left-ring": "bg-finger-ring/30 border-finger-ring/60 text-foreground",
  "left-middle": "bg-finger-middle/30 border-finger-middle/60 text-foreground",
  "left-index": "bg-finger-index/30 border-finger-index/60 text-foreground",
  "left-thumb": "bg-finger-thumb/30 border-finger-thumb/60 text-foreground",
  "left-palm": "bg-finger-palm/30 border-finger-palm/60 text-foreground",
  "right-palm": "bg-finger-palm/30 border-finger-palm/60 text-foreground",
  "right-thumb": "bg-finger-thumb/30 border-finger-thumb/60 text-foreground",
  "right-index": "bg-finger-index/30 border-finger-index/60 text-foreground",
  "right-middle": "bg-finger-middle/30 border-finger-middle/60 text-foreground",
  "right-ring": "bg-finger-ring/30 border-finger-ring/60 text-foreground",
  "right-pinky": "bg-finger-pinky/30 border-finger-pinky/60 text-foreground",
};

// 複数の指（色が2種類以上）を等幅バンドで分割表示するときの枠線・文字色（背景は inline style で描画）
const FINGER_SPLIT_KEY_COLORS: Record<FingerColorName, string> = {
  "pinky": "border-finger-pinky/60 text-foreground",
  "ring": "border-finger-ring/60 text-foreground",
  "middle": "border-finger-middle/60 text-foreground",
  "index": "border-finger-index/60 text-foreground",
  "thumb": "border-finger-thumb/60 text-foreground",
  "palm": "border-finger-palm/60 text-foreground",
};

// 指の基本色名 → CSS 変数（inline style 用。oklch 定義なので hsl() で包まない）
const FINGER_CSS_VARS: Record<FingerColorName, string> = {
  "pinky": "var(--finger-pinky)",
  "ring": "var(--finger-ring)",
  "middle": "var(--finger-middle)",
  "index": "var(--finger-index)",
  "thumb": "var(--finger-thumb)",
  "palm": "var(--finger-palm)",
};

/**
 * キーに割り当てられた指（複数可）から、キー面の className / style を求める。
 *
 * - 指が無い: 空の className
 * - 指が1本、または複数でも色が全部同じ（例: left-index と right-index）:
 *   従来どおり `FINGER_KEY_COLORS[先頭の指]`（見た目は単一指と同一）
 * - 色が2種類以上: 先頭の指の枠線色 + 色ごとの等幅バンド（ハードストップのグラデーション）を
 *   inline style の background-image で描画する。不透明度は 既存の bg-finger の /30 と同じ 30%
 *   （Tailwind 4 と同じ oklab での color-mix）。
 *   `backgroundOrigin: border-box` により枠線の下までバンドが届く（既定の padding-box だと
 *   半透明の枠線の下に反対側のバンドが繰り返されて見えるため）。
 */
export function getFingerKeyStyle(
  fingers: readonly FingerType[] | undefined,
): { className: string; style?: CSSProperties } {
  if (!fingers || fingers.length === 0) return { className: "" };
  const colors: FingerColorName[] = [];
  for (const f of fingers) {
    const c = FINGER_TO_COLOR[f];
    if (!colors.includes(c)) colors.push(c);
  }
  if (colors.length <= 1) return { className: FINGER_KEY_COLORS[fingers[0]] };
  const n = colors.length;
  const stops = colors.map((c, i) => {
    const tint = `color-mix(in oklab, ${FINGER_CSS_VARS[c]} 30%, transparent)`;
    return `${tint} ${(i * 100) / n}% ${((i + 1) * 100) / n}%`;
  });
  return {
    className: FINGER_SPLIT_KEY_COLORS[colors[0]],
    style: {
      backgroundImage: `linear-gradient(90deg, ${stops.join(", ")})`,
      backgroundOrigin: "border-box",
    },
  };
}

/**
 * 指色の付かないキーの状態ごとの面・枠・ラベル色。
 * - data: キーに情報（操作・リマップ・カスタムアクション・指）がある
 * - empty: 情報が無く、押せない（読み取り専用）。後ろへ引かせる
 * - emptyEditable: 情報が無いが、押せる（編集）。操作部品なのでフォーム部品と同じ枠（3:1 以上）
 */
const KEY_STATE_CLASS = {
  data: "bg-secondary border-muted-foreground/70 text-foreground",
  empty: "bg-secondary/50 border-border text-muted-foreground",
  emptyEditable: "bg-secondary/50 border-muted-foreground/70 text-muted-foreground",
} as const;

/**
 * キーの面・枠・ラベル色を決める（VirtualKeyboard のキー・JIS Enter・カスタムキー・
 * VirtualMouse・VirtualNumpad で共有）。
 *
 * - `fingerKeyClass` があれば（指色表示で指あり）それを使う
 * - そうでなければ情報の有無（`hasKeyInfo`）と押せるか（`editable`）で状態を選ぶ
 * - `remapped` なら枠を `border-primary` に上書き（指色のキーにも適用）
 *
 * `labelMuted` は、キー内のラベル（span）を muted にするか（空きの状態のときだけ true）。
 */
function getKeySurface(opts: {
  fingerKeyClass?: string;
  hasInfo: boolean;
  editable: boolean;
  remapped: boolean;
}): { className: string; labelMuted: boolean } {
  if (opts.fingerKeyClass) {
    return {
      className: cn(opts.fingerKeyClass, opts.remapped && "border-primary"),
      labelMuted: false,
    };
  }
  const state = opts.hasInfo ? "data" : opts.editable ? "emptyEditable" : "empty";
  return {
    className: cn(KEY_STATE_CLASS[state], opts.remapped && "border-primary"),
    labelMuted: state !== "data",
  };
}

// チップ用の色（操作名表示用）- CSS変数を使用。
// 文字色は --finger-chip-fg（ライト=暗色 / ダーク・ウルトラダーク=白。全指で 4.5:1 以上）を参照。
// dark: 変種ではなく変数で切り替えることで、画像出力プレビューなど
// グローバルとは別テーマを局所適用するコンテナ内でも正しく描画できる。
export const FINGER_CHIP_COLORS: Record<FingerType, string> = {
  "left-pinky": "bg-finger-pinky text-finger-chip-foreground",
  "left-ring": "bg-finger-ring text-finger-chip-foreground",
  "left-middle": "bg-finger-middle text-finger-chip-foreground",
  "left-index": "bg-finger-index text-finger-chip-foreground",
  "left-thumb": "bg-finger-thumb text-finger-chip-foreground",
  "left-palm": "bg-finger-palm text-finger-chip-foreground",
  "right-palm": "bg-finger-palm text-finger-chip-foreground",
  "right-thumb": "bg-finger-thumb text-finger-chip-foreground",
  "right-index": "bg-finger-index text-finger-chip-foreground",
  "right-middle": "bg-finger-middle text-finger-chip-foreground",
  "right-ring": "bg-finger-ring text-finger-chip-foreground",
  "right-pinky": "bg-finger-pinky text-finger-chip-foreground",
};

// 指の色（背景用 - 凡例用）- CSS変数を使用
const FINGER_BG_COLORS: Record<FingerColorName, string> = {
  "pinky": "bg-finger-pinky",
  "ring": "bg-finger-ring",
  "middle": "bg-finger-middle",
  "index": "bg-finger-index",
  "thumb": "bg-finger-thumb",
  "palm": "bg-finger-palm",
};

type KeybindingInfo = {
  action: string;
  category: string;
};

// 複数操作対応の型
type KeybindingInfoList = KeybindingInfo[];

export type FingerAssignment = Record<string, FingerType[]>;

// カスタムキーボタン定義型
type CustomKeyboardButton = {
  code: string;
  label: string;
};


interface VirtualKeyboardProps {
  layout?: KeyboardLayout;
  keybindings?: Record<string, KeybindingInfoList>;
  fingerAssignments?: FingerAssignment;
  remaps?: RemapInfo[]; // リマップ情報
  customActions?: KeyInfoCustomAction[]; // カスタムアクション（トリガーキーごとにツールチップ/モーダルへ表示）
  customKeys?: CustomKeyboardButton[]; // カスタムキーボードキー
  highlightedKeys?: string[];
  /**
   * 持続的に（warning トーンで）ハイライトするキー。`highlightedKeys`（primary リング、
   * 一時的な強調に使う）とは別トーンで、「押しっぱなし」状態を表現する
   * （サーチクラフトのキー押下シーケンス可視化 `search-craft-key-sequence-dialog.tsx` で使用）。
   */
  heldKeys?: string[];
  /**
   * キーごとの注釈（例: 押す順番「1」「1,4」）。該当キー右上に小さなバッジとして重ねて表示する。
   * `highlightedKeys`/`showRemaps` 等の既存描画とは独立に描画される
   * （サーチクラフトのキー押下シーケンス可視化 `search-craft-key-sequence-dialog.tsx` で使用）。
   */
  keyAnnotations?: Record<string, string>;
  /**
   * 指定すると、このリストに含まれないキー（`heldKeys`・`highlightedKeys` 該当キーを除く）を
   * グレー（opacity + grayscale）で減光する。「押すキーだけを目立たせる」用途
   * （キー押下シーケンス可視化で使用）。undefined なら減光しない（既存動作）。
   */
  emphasizedKeys?: string[];
  onKeyClick?: (keyCode: string) => void;
  className?: string;
  showActionLabels?: boolean; // キーに操作名を表示
  showFingerAssignments?: boolean; // 指割り当てを表示
  showRemaps?: boolean; // リマップを表示
  useDefaultFingerAssignments?: boolean; // デフォルトの指割り当てを使用
  hideNumpad?: boolean; // テンキーを非表示にする
  alwaysShowActions?: string[]; // showActionLabels=false でも常に表示する操作名
  /**
   * 描画する範囲。"all"（既定）は従来どおり全体、"main" はメイン部（＋カスタムキー・テンキー）のみ、
   * "nav" はナビクラスタ（Insert〜PgDn の島＋矢印）のみ（F行の空き段なしの5段。テンキーと上端・下端がそろう）
   */
  section?: "all" | "main" | "nav";
}

// JIS の L 字 Enter（リターン）専用キー。
// 2段分の高さを持つ「1つのボタン」。内部を上段（広い）+ 下段（狭い・右寄せ）の
// 角丸・枠線つき矩形2枚で構成し、継ぎ目を重ねて1キーの L 字に見せる。
// 上方向へネガティブマージンで伸ばして上段に重ね、左方向へずらして [ ] の段差に合わせる。
const JIS_ENTER_TOP_UNITS = 1.5; // 上段（広い側）の幅
const JIS_ENTER_BOTTOM_UNITS = 1.25; // 下段（狭い側）の幅
const JIS_ENTER_HEIGHT_UNITS = 2; // 2段分の高さ

function JisEnterKey({
  baseSize,
  gap,
  label,
  ariaLabel,
  chips,
  keyClass,
  keyStyle,
  isHighlighted,
  clickable,
  onClick,
  itemProps,
}: {
  baseSize: number;
  gap: number;
  label: string;
  ariaLabel: string;
  chips: React.ReactNode;
  keyClass: string;
  /** 複数指の色分割背景（getFingerKeyStyle の style）。上段・下段で同じ帯が揃うよう配置を調整する */
  keyStyle?: CSSProperties;
  isHighlighted: boolean;
  clickable: boolean;
  onClick: () => void;
  /** roving tabindex の props。undefined ならフォーカスできないキーとして div（aria-hidden）で描く */
  itemProps?: RovingItemProps;
}) {
  const unit = (u: number) => u * baseSize + (u - 1) * gap;
  const topPx = unit(JIS_ENTER_TOP_UNITS);
  const bottomPx = unit(JIS_ENTER_BOTTOM_UNITS);
  const rowPx = baseSize;
  const totalHeightPx = JIS_ENTER_HEIGHT_UNITS * baseSize + (JIS_ENTER_HEIGHT_UNITS - 1) * gap;
  // 上段へ伸ばす量（1段 + gap）
  const marginTopPx = -((baseSize + gap) * (JIS_ENTER_HEIGHT_UNITS - 1));
  // 左へずらして段差を作る。隣キーとの隙間（gap）は他キー同様に残す
  const marginLeftPx = -(topPx - bottomPx);

  // group-hover で、上下どちらにホバーしても両方が同じホバー表示になる。
  // 押せないときはホバーの見た目を付けない
  const rectBase = cn(
    "absolute border-2 transition-colors",
    keyClass,
    isHighlighted && "border-primary",
    clickable && "group-hover:bg-secondary/80 group-hover:border-primary/50",
  );

  const wrapperClassName = cn(
    "group relative shrink-0 select-none",
    clickable && "cursor-pointer",
    isHighlighted && "ring-2 ring-primary ring-offset-1 ring-offset-background rounded-md",
  );
  const wrapperStyle: CSSProperties = {
    width: topPx,
    height: totalHeightPx,
    marginTop: marginTopPx,
    marginLeft: marginLeftPx,
  };

  const content = (
    <>
      {/* 上段（広い側）。下辺は角丸・枠線なしにして下段と継ぎ目なく一体化（中央の横線を出さない） */}
      <div
        aria-hidden
        className={cn(rectBase, "rounded-md rounded-b-none border-b-0 left-0")}
        style={{ ...keyStyle, top: 0, width: topPx, height: rowPx }}
      />
      {/* 下段（狭い側・右寄せ）。上辺は角丸・枠線なしにして上段とちょうど接する */}
      <div
        className={cn(
          rectBase,
          "rounded-md rounded-t-none border-t-0 right-0 flex flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-medium",
        )}
        style={{
          ...keyStyle,
          // 下段は上段と同じ帯幅になるよう、上段幅のグラデーションを右端基準で切り出す
          ...(keyStyle?.backgroundImage
            ? { backgroundSize: `${topPx}px 100%`, backgroundPosition: "right top", backgroundRepeat: "no-repeat" }
            : undefined),
          top: rowPx,
          width: bottomPx,
          height: totalHeightPx - rowPx,
        }}
      >
        <span className="font-semibold leading-none">{label}</span>
        {chips}
      </div>
    </>
  );

  if (!itemProps) {
    return (
      <div aria-hidden="true" className={wrapperClassName} style={wrapperStyle}>
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      // L 字の外接矩形に、内側 2px のフォーカスリングを描く
      className={cn(wrapperClassName, "rounded-md", KEY_FOCUS_RING)}
      style={wrapperStyle}
      {...itemProps}
    >
      {content}
    </button>
  );
}

// メインキーボードの行の合計幅を計算（USレイアウト Row2基準: 15ユニット）
const MAIN_KEYBOARD_UNITS = 15;

// ナビゲーションクラスタ（Insert 等6キーの島 + 矢印キー）の幅: 3ユニット
const NAV_CLUSTER_UNITS = 3;

function VirtualKeyboardComponent({
  layout = "US",
  keybindings = {},
  fingerAssignments = {},
  remaps = [],
  customActions = [],
  customKeys = [],
  highlightedKeys = [],
  heldKeys = [],
  keyAnnotations = {},
  emphasizedKeys,
  onKeyClick,
  className,
  showActionLabels = false,
  showFingerAssignments = false,
  showRemaps = false,
  useDefaultFingerAssignments = false,
  hideNumpad = false,
  alwaysShowActions,
  section = "all",
}: VirtualKeyboardProps) {
  const t = useT();
  // 1インスタンスにつき Tab 停止点は1つ（roving tabindex）。矢印キーでキー間を移動する
  const { rootRef, getItemProps, onKeyDown, focusableCount } = useRovingKeyFocus<HTMLDivElement>();
  const hintId = useId();
  const isJIS = isJisLayout(layout);
  const isTKL = isTklLayout(layout);
  const mainLayout = isJIS ? JIS_MAIN_LAYOUT : US_MAIN_LAYOUT;
  const showNumpad = !isTKL && !hideNumpad && section !== "nav";
  const showMain = section !== "nav";
  const showNav = section !== "main";

  // 有効な指割り当て（ユーザー設定がなければデフォルトを使用）
  const effectiveFingerAssignments: FingerAssignment = useDefaultFingerAssignments
    ? { ...DEFAULT_FINGER_ASSIGNMENTS, ...fingerAssignments }
    : fingerAssignments;

  // キーコードからバインディング情報を検索（正規化して検索、複数操作対応）
  const getBindingsForKey = (keyCode: string): KeybindingInfoList => {
    // 別名のキーコード（JIS の半角 IntlYen ← Backquote）の割り当ても合わせる（同じ操作は1つに）
    const merged: KeybindingInfoList = [];
    for (const code of getKeyCodeAliases(keyCode, layout)) {
      // 直接 → 正規化 → 小文字 の順に検索
      const normalized = normalizeKeyCode(code);
      const list =
        keybindings[code] ||
        keybindings[normalized] ||
        keybindings[code.toLowerCase()] ||
        [];
      for (const b of list) {
        if (!merged.some((m) => m.action === b.action && m.category === b.category)) merged.push(b);
      }
    }
    // toggleHud はバーチャルキーボード上には表示しない
    return merged.filter((b) => b.action !== "toggleHud");
  };

  // キーコードから指割り当てを取得（正規化して検索）
  const getFingersForKey = (keyCode: string): FingerType[] => {
    // 別名のキーコード（JIS の半角 IntlYen ← Backquote）の指割り当ても合わせる（重複は除く）
    const merged: FingerType[] = [];
    for (const code of getKeyCodeAliases(keyCode, layout)) {
      const normalized = normalizeKeyCode(code);
      const found: unknown =
        effectiveFingerAssignments[normalized] ||
        effectiveFingerAssignments[code] ||
        effectiveFingerAssignments[code.toLowerCase()];
      // 壊れたデータ（配列でない値）で描画を落とさない
      const list: FingerType[] = Array.isArray(found) ? found : [];
      for (const f of list) if (!merged.includes(f)) merged.push(f);
    }
    return merged;
  };

  // キーコードからリマップ情報を取得
  // 修飾キー組み合わせの場合はベースキーが一致するものを返す
  const getRemapForKey = (keyCode: string): RemapInfo | undefined => getRemapsForKey(keyCode)[0];

  // 特定キーに関連する全リマップを取得（修飾キー組み合わせを含む）
  const getRemapsForKey = (keyCode: string): RemapInfo[] => {
    const codes = getKeyCodeAliases(keyCode, layout);
    return remaps.filter((r) => {
      const source = r.sourceKey.includes("+") ? parseKeyCombination(r.sourceKey).keyCode : r.sourceKey;
      return codes.some((c) => keysEqual(source, c));
    });
  };

  // 単一キーのレンダリング
  const renderKey = (key: KeyDefinition, rowIndex: number, keyIndex: number, baseSize: number, gap: number) => {
    // スペーサーの場合
    if (key.code.startsWith("_spacer")) {
      return (
        <div
          key={`spacer-${rowIndex}-${keyIndex}`}
          style={{ width: `${(key.width || 1) * baseSize}px` }}
        />
      );
    }

    const width = (key.width || 1) * baseSize + ((key.width || 1) - 1) * gap;
    const height = (key.height || 1) * baseSize + ((key.height || 1) - 1) * gap;
    const bindings = getBindingsForKey(key.code);
    const fingers = getFingersForKey(key.code);
    // 先頭の指（チップ色・枠線色・有無判定に使う）。複数指の背景は fingerStyle のバンド分割で描画
    const finger: FingerType | undefined = fingers[0];
    // 複数リマップ対応: このキーに関連する全リマップを取得
    const keyRemaps = showRemaps ? getRemapsForKey(key.code) : [];
    const keyCodes = getKeyCodeAliases(key.code, layout);
    const isHighlighted = keyCodes.some((c) => highlightedKeys.includes(c));
    const isHeld = keyCodes.some((c) => heldKeys.includes(c));
    const annotation = keyCodes.map((c) => keyAnnotations[c]).find((a) => a !== undefined);
    const isDimmed =
      emphasizedKeys !== undefined &&
      !keyCodes.some((c) => emphasizedKeys.includes(c)) &&
      !isHeld &&
      !isHighlighted;
    const displayLabel =
    (key.labelKey ? t(key.labelKey) : key.label) || getKeyLabel(t, key.code);

    // 指割り当てが有効な場合は指の色を使用、そうでなければデフォルト
    const fingerKeyStyle = showFingerAssignments
      ? getFingerKeyStyle(fingers)
      : { className: "" as string, style: undefined };
    const fingerKeyClass = fingerKeyStyle.className;
    const chipClass = showFingerAssignments && finger
      ? FINGER_CHIP_COLORS[finger]
      : "bg-foreground/80 text-background";

    // 操作名を表示するかどうか
    // showActionLabels が true なら全バインディング、そうでなければ alwaysShowActions に含まれるアクションのみ表示
    const filteredBindings = showActionLabels
      ? bindings
      : alwaysShowActions && alwaysShowActions.length > 0
        ? bindings.filter((b) => alwaysShowActions.includes(b.action))
        : [];
    const showAction = filteredBindings.length > 0;

    const ariaLabel = buildKeyAriaLabel(t, {
      displayLabel,
      bindings: filteredBindings,
      remaps: keyRemaps,
      layout,
    });

    // リマップのソースキーの修飾キーマーク（シンボルで表示）
    const getModifierIcons = (r: RemapInfo): LucideIcon[] => {
      if (!r.sourceKey.includes("+")) return [];
      const parsed = parseKeyCombination(r.sourceKey);
      if (parsed.modifiers.length === 0) return [];
      return parsed.modifiers
        .map((m) => MODIFIER_ICON_MAP[m])
        .filter((Icon): Icon is LucideIcon => !!Icon);
    };

    // 修飾キー（Shift/Ctrl/Alt 等）付きでのみ発動するリマップか
    const remapHasModifier = (r: RemapInfo): boolean =>
      r.sourceKey.includes("+") && parseKeyCombination(r.sourceKey).modifiers.length > 0;
    // 全リマップが修飾キー条件付き = 単独押しでは元のキーがそのまま入力される
    // → 元キーのラベルも表示する
    const remapsOnlyWithModifier =
      keyRemaps.length > 0 && keyRemaps.every(remapHasModifier);

    // ツールチップでバインディング情報を表示
    const info: KeyInfoData = {
      title: getKeyLabel(t, key.code, layout),
      bindings: bindings.map((b) => ({ action: b.action, category: b.category })),
      remaps: keyRemaps,
      customActions: getCustomActionsForKeyCode(customActions, key.code, layout),
      fingers: showFingerAssignments ? fingers : undefined,
      layout,
    };
    const surface = getKeySurface({
      fingerKeyClass: showFingerAssignments && finger ? fingerKeyClass : undefined,
      hasInfo: hasKeyInfo(info),
      editable: !!onKeyClick,
      remapped: keyRemaps.length > 0,
    });
    // フォーカスできるキー: 編集では全キー、読み取り専用では情報のあるキーだけ（ツールチップ／情報ダイアログを持つ）。
    // KeyInfoTrigger が包むかどうかと同じ式（hasKeyInfo）から決める。フォーカスできないキーは div で描く
    const focusable = !!onKeyClick || hasKeyInfo(info);
    const itemProps = focusable ? getItemProps(`key:${key.code}`) : undefined;

    const keyClassName = cn(
      "relative flex flex-col items-center justify-center rounded-md border-2 transition-colors",
      "font-medium select-none gap-0.5 px-1",
      surface.className,
      isHighlighted && "ring-2 ring-primary ring-offset-1 ring-offset-background",
      isHeld && "border-warning bg-warning/10 text-warning",
      isDimmed && "opacity-40 grayscale",
      onKeyClick && "cursor-pointer hover:border-primary/50 hover:bg-secondary/80 active:bg-secondary",
      key.className
    );
    const keyStyle: CSSProperties = {
      // 保持中（isHeld）は warning 背景を優先するため、指のバンド背景は載せない
      ...(isHeld ? undefined : fingerKeyStyle.style),
      width: `${width}px`,
      height: `${height}px`,
    };

    const keyContent = (
      <>
        {/* キー押下シーケンス可視化の順番注釈（例: "1", "1,4"）。キー面（40px超）に載せる数字の
            ため、h-7 バッジ肩の text-[10px] 規格より1段大きい text-[11px] で視認性を優先する */}
        {annotation && (
          <span
            aria-hidden="true"
            className="absolute -top-2 -right-2 z-10 min-w-[18px] rounded-full bg-primary px-1.5 py-0.5 text-center text-[11px] font-semibold leading-none text-primary-foreground"
          >
            {annotation}
          </span>
        )}
        {/* リマップがある場合 */}
        {keyRemaps.length > 0 ? (
          <div className="flex flex-col items-center justify-center gap-0 max-w-full overflow-visible">
            {/* 全リマップが修飾キー条件付きなら、単独押しの元キーラベルを通常表示 */}
            {remapsOnlyWithModifier && (
              <span className={cn(
                "font-semibold leading-none text-[11px]",
                surface.labelMuted && "text-muted-foreground"
              )}>
                {displayLabel}
              </span>
            )}
            {keyRemaps.slice(0, 2).map((r, i) => {
              const isDisabled = r.targetKey === null;
              const targetLabel = getRemapOutputLabel(t, r, layout);
              const modifierIcons = getModifierIcons(r);
              return (
                <div key={i} className="flex items-center gap-0.5">
                  {modifierIcons.length > 0 && (
                    <span className="flex items-center gap-0 text-primary/70">
                      {modifierIcons.map((Icon, mi) => (
                        <Icon key={mi} className="h-2.5 w-2.5" strokeWidth={2.5} />
                      ))}
                    </span>
                  )}
                  <span className="font-medium text-[10px] text-muted-foreground">
                    {displayLabel}
                  </span>
                  <span className="text-[10px] text-muted-foreground">→</span>
                  <span className={cn(
                    "font-bold text-[10px]",
                    isDisabled ? "text-[color-mix(in_oklab,var(--destructive),var(--foreground)_30%)]" : "text-foreground"
                  )}>
                    {targetLabel}
                  </span>
                </div>
              );
            })}
            {keyRemaps.length > 2 && (
              <span className="text-[10px] text-muted-foreground">+{keyRemaps.length - 2}</span>
            )}
          </div>
        ) : (
          /* 通常のキーラベル */
          <span className={cn(
            "font-semibold leading-none text-[11px]",
            surface.labelMuted && "text-muted-foreground"
          )}>
            {displayLabel}
          </span>
        )}
        {/* 操作名チップ（下部）- リマップがあっても表示。
            複数操作を持つキーで全件読めるよう折り返しを許容（truncate しない）。 */}
        {showAction && (
          <div className="flex flex-wrap justify-center gap-0.5 max-w-full">
            {filteredBindings.map((binding, i) => (
              <span key={i} className={cn(
                "min-w-0 max-w-full truncate rounded px-0.5 py-0 -my-[1.875px] text-[10px] leading-snug",
                chipClass
              )}>
                {getShortActionLabel(t, binding.action)}
              </span>
            ))}
          </div>
        )}
      </>
    );

    // JIS の L 字 Enter は専用コンポーネントで描画（2段分の単一ボタン）。
    // 通常のキーは、フォーカスできるときだけ button、それ以外は支援技術から隠した div
    const renderedKey = key.jisEnter ? (
      <JisEnterKey
        baseSize={baseSize}
        gap={gap}
        label={displayLabel}
        ariaLabel={ariaLabel}
        chips={
          showAction ? (
            <div className="flex flex-wrap justify-center gap-0.5 max-w-full">
              {filteredBindings.map((binding, i) => (
                <span
                  key={i}
                  className={cn("min-w-0 max-w-full truncate rounded px-0.5 py-0 -my-[1.875px] text-[10px] leading-snug", chipClass)}
                >
                  {getShortActionLabel(t, binding.action)}
                </span>
              ))}
            </div>
          ) : null
        }
        keyClass={cn(
          surface.className,
          isDimmed && "opacity-40 grayscale",
        )}
        keyStyle={fingerKeyStyle.style}
        isHighlighted={isHighlighted}
        clickable={!!onKeyClick}
        onClick={() => onKeyClick?.(key.code)}
        itemProps={itemProps}
      />
    ) : itemProps ? (
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={() => onKeyClick?.(key.code)}
        className={cn(keyClassName, KEY_FOCUS_RING)}
        style={keyStyle}
        {...itemProps}
      >
        {keyContent}
      </button>
    ) : (
      <div aria-hidden="true" className={keyClassName} style={keyStyle}>
        {keyContent}
      </div>
    );

    return (
      <KeyInfoTrigger key={`${rowIndex}-${keyIndex}`} info={info} interactive={!!onKeyClick}>
        {renderedKey}
      </KeyInfoTrigger>
    );
  };

  // キーボードセクションのレンダリング
  const renderKeyboardSection = (rows: KeyboardRow[], baseSize: number, gap: number) => (
    <div className="flex flex-col" style={{ gap: `${gap}px` }}>
      {rows.map((row, rowIndex) => (
        <div key={rowIndex} className="flex" style={{ gap: `${gap}px` }}>
          {row.map((key, keyIndex) => renderKey(key, rowIndex, keyIndex, baseSize, gap))}
        </div>
      ))}
    </div>
  );

  // テンキーのレンダリング（高さの異なるキーを含む特殊レイアウト）
  const renderNumpad = (baseSize: number, gap: number) => {
    // Row 1: NumLock, /, *, -
    // Row 2: 7, 8, 9, + (2行分)
    // Row 3: 4, 5, 6, (+ continues)
    // Row 4: 1, 2, 3, Enter (2行分)
    // Row 5: 0 (2キー分), ., (Enter continues)

    return (
      <div className="flex flex-col" style={{ gap: `${gap}px` }}>
        {/* Row 1 */}
        <div className="flex" style={{ gap: `${gap}px` }}>
          {renderKey({ code: "NumLock", label: "Num" }, 0, 0, baseSize, gap)}
          {renderKey({ code: "NumpadDivide", label: "/" }, 0, 1, baseSize, gap)}
          {renderKey({ code: "NumpadMultiply", label: "*" }, 0, 2, baseSize, gap)}
          {renderKey({ code: "NumpadSubtract", label: "-" }, 0, 3, baseSize, gap)}
        </div>
        {/* Row 2-3 with + spanning */}
        <div className="flex" style={{ gap: `${gap}px` }}>
          <div className="flex flex-col" style={{ gap: `${gap}px` }}>
            <div className="flex" style={{ gap: `${gap}px` }}>
              {renderKey({ code: "Numpad7", label: "7" }, 1, 0, baseSize, gap)}
              {renderKey({ code: "Numpad8", label: "8" }, 1, 1, baseSize, gap)}
              {renderKey({ code: "Numpad9", label: "9" }, 1, 2, baseSize, gap)}
            </div>
            <div className="flex" style={{ gap: `${gap}px` }}>
              {renderKey({ code: "Numpad4", label: "4" }, 2, 0, baseSize, gap)}
              {renderKey({ code: "Numpad5", label: "5" }, 2, 1, baseSize, gap)}
              {renderKey({ code: "Numpad6", label: "6" }, 2, 2, baseSize, gap)}
            </div>
          </div>
          {renderKey({ code: "NumpadAdd", label: "+", height: 2 }, 1, 3, baseSize, gap)}
        </div>
        {/* Row 4-5 with Enter spanning */}
        <div className="flex" style={{ gap: `${gap}px` }}>
          <div className="flex flex-col" style={{ gap: `${gap}px` }}>
            <div className="flex" style={{ gap: `${gap}px` }}>
              {renderKey({ code: "Numpad1", label: "1" }, 3, 0, baseSize, gap)}
              {renderKey({ code: "Numpad2", label: "2" }, 3, 1, baseSize, gap)}
              {renderKey({ code: "Numpad3", label: "3" }, 3, 2, baseSize, gap)}
            </div>
            <div className="flex" style={{ gap: `${gap}px` }}>
              {renderKey({ code: "Numpad0", label: "0", width: 2 }, 4, 0, baseSize, gap)}
              {renderKey({ code: "NumpadDecimal", label: "." }, 4, 1, baseSize, gap)}
            </div>
          </div>
          {renderKey({ code: "NumpadEnter", label: "Enter", height: 2 }, 3, 3, baseSize, gap)}
        </div>
      </div>
    );
  };

  // キーサイズを計算（横幅100%を使用するため、親コンテナの幅から逆算）
  // メインキーボードは15ユニット幅
  const gap = 2;
  const baseSize = 60; // キーサイズ

  // カスタムキーボードキーのレンダリング
  const renderCustomKeys = (baseSize: number, gap: number) => {
    if (customKeys.length === 0) return null;

    return (
      <div className="flex flex-wrap" style={{ gap: `${gap}px` }}>
        {customKeys.map((ck) => {
          const bindings = getBindingsForKey(ck.code);
          const fingers = getFingersForKey(ck.code);
          const finger: FingerType | undefined = fingers[0];
          const remap = showRemaps ? getRemapForKey(ck.code) : undefined;
          const isHighlighted = highlightedKeys.includes(ck.code);

          const fingerKeyStyle = showFingerAssignments
            ? getFingerKeyStyle(fingers)
            : { className: "" as string, style: undefined };
          const fingerKeyClass = fingerKeyStyle.className;
          const chipClass = showFingerAssignments && finger
            ? FINGER_CHIP_COLORS[finger]
            : "bg-foreground/80 text-background";

          const showAction = showActionLabels && bindings.length > 0;
          // リマップ先の表示ラベル
          const remapTargetLabel = remap ? getRemapOutputLabel(t, remap, layout) : null;
          const isRemapDisabled = remap?.targetKey === null;

          // カスタムキーのラベル長に応じてフォントサイズを段階的に切替。
          // baseSize×2.5 の最大幅を超えるものは truncate で省略し、Tooltip でフル表示。
          const labelFontClass = (text: string) =>
            text.length <= 4
              ? "text-[11px]"
              : text.length <= 7
              ? "text-[10px]"
              : "text-[10px]";

          // リマップ表示時、ラベル + → + ターゲット の合計が長く 1 行に収まりにくい場合は
          // 矢印以降を改行して下段に表示する（ラベル単体が truncate されるケース対策）。
          // 単一リマップのみで操作名チップ等を併置しない場合、収まらない長さなら矢印の前で改行する
          const remapInlineBudget = 5;
          const isRemapStacked =
            !!remap &&
            !showAction &&
            ck.label.length + 1 + (remapTargetLabel?.length ?? 0) > remapInlineBudget;

          const ariaLabel = buildKeyAriaLabel(t, {
            displayLabel: ck.label,
            bindings,
            remaps: remap ? [remap] : [],
            layout,
          });
          // カスタムキーは情報の有無に関わらず常に Tooltip/Dialog を表示する（alwaysShow）。
          // キーの見た目（データあり／空き）は情報の有無だけで決める。
          const info: KeyInfoData = {
            title: ck.label,
            bindings: bindings.map((b) => ({ action: b.action, category: b.category })),
            remaps: remap ? [remap] : [],
            customActions: getCustomActionsForKeyCode(customActions, ck.code),
            fingers: showFingerAssignments ? fingers : undefined,
            layout,
          };
          const surface = getKeySurface({
            fingerKeyClass: showFingerAssignments && finger ? fingerKeyClass : undefined,
            hasInfo: hasKeyInfo(info),
            editable: !!onKeyClick,
            remapped: !!remap,
          });
          // カスタムキーは常に情報（Tooltip/Dialog）を持つので、読み取り専用でもフォーカスできる
          const keyElement = (
            <button
              type="button"
              aria-label={ariaLabel}
              onClick={() => onKeyClick?.(ck.code)}
              className={cn(
                "relative flex flex-col items-center justify-center rounded-md border-2 transition-colors",
                "font-medium select-none gap-0.5 px-2",
                surface.className,
                isHighlighted && "ring-2 ring-primary ring-offset-1 ring-offset-background",
                onKeyClick && "cursor-pointer hover:border-primary/50 hover:bg-secondary/80 active:bg-secondary",
                KEY_FOCUS_RING,
              )}
              style={{
                ...fingerKeyStyle.style,
                minWidth: `${baseSize}px`,
                maxWidth: `${baseSize * 2.5}px`,
                height: `${baseSize}px`,
              }}
              {...getItemProps(`custom:${ck.code}`)}
            >
              {remap ? (
                isRemapStacked ? (
                  <div className="flex flex-col items-center justify-center min-w-0 max-w-full leading-snug">
                    <span
                      className={cn(
                        "font-medium leading-snug truncate min-w-0 max-w-full text-center text-muted-foreground",
                        labelFontClass(ck.label),
                      )}
                    >
                      {ck.label}
                    </span>
                    <div className="flex flex-nowrap items-center justify-center gap-0.5 min-w-0 max-w-full">
                      <span className="leading-none text-[10px] text-muted-foreground shrink-0">→</span>
                      <span
                        className={cn(
                          "font-bold leading-snug truncate min-w-0",
                          labelFontClass(remapTargetLabel ?? ""),
                          isRemapDisabled ? "text-[color-mix(in_oklab,var(--destructive),var(--foreground)_30%)]" : "text-foreground",
                        )}
                      >
                        {remapTargetLabel}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-nowrap items-center justify-center gap-0.5 min-w-0 max-w-full">
                    <span
                      className={cn(
                        "font-medium -my-[2px] leading-snug truncate min-w-0 text-muted-foreground",
                        labelFontClass(ck.label),
                      )}
                    >
                      {ck.label}
                    </span>
                    <span className="leading-none text-[10px] text-muted-foreground shrink-0">→</span>
                    <span
                      className={cn(
                        "font-bold leading-snug truncate min-w-0",
                        labelFontClass(remapTargetLabel ?? ""),
                        isRemapDisabled ? "text-[color-mix(in_oklab,var(--destructive),var(--foreground)_30%)]" : "text-foreground",
                      )}
                    >
                      {remapTargetLabel}
                    </span>
                  </div>
                )
              ) : (
                <span
                  className={cn(
                    "font-semibold -my-[2px] leading-snug truncate max-w-full",
                    labelFontClass(ck.label),
                    surface.labelMuted && "text-muted-foreground",
                  )}
                >
                  {ck.label}
                </span>
              )}
              {showAction && (
                <div className="flex flex-wrap justify-center gap-0.5 max-w-full">
                  {bindings.map((binding, i) => (
                    <span
                      key={i}
                      className={cn(
                        "min-w-0 max-w-full truncate rounded px-0.5 py-0 -my-[1.875px] text-[10px] leading-snug",
                        chipClass,
                      )}
                    >
                      {getShortActionLabel(t, binding.action)}
                    </span>
                  ))}
                </div>
              )}
            </button>
          );

          return (
            <KeyInfoTrigger key={ck.code} info={info} alwaysShow interactive={!!onKeyClick}>
              {keyElement}
            </KeyInfoTrigger>
          );
        })}
      </div>
    );
  };

  // ナビゲーションクラスタ（Insert/Delete/Home/End/PageUp/PageDown の6キーの島）+ 矢印キー。
  // 実機の配列に合わせてメインキーボード右側に縦位置を揃えて描画する:
  // 行1(F行)は空き、行2-3にナビ6キー、行4は空き、行5-6に逆T字の矢印キー。
  // renderKey を使うため、クリック・ツールチップ・指色・リマップ表示は他のキーと同様に機能する
  const renderNavCluster = (baseSize: number, gap: number) => (
    <div className="flex flex-col" style={{ gap: `${gap}px` }}>
      {/* section="nav" ではF行用の空き段を外し、テンキー（5段）と上端・下端をそろえる */}
      {section !== "nav" && <div style={{ height: `${baseSize}px` }} />}
      <div className="flex" style={{ gap: `${gap}px` }}>
        {renderKey({ code: "Insert" }, 100, 0, baseSize, gap)}
        {renderKey({ code: "Home" }, 100, 1, baseSize, gap)}
        {renderKey({ code: "PageUp" }, 100, 2, baseSize, gap)}
      </div>
      <div className="flex" style={{ gap: `${gap}px` }}>
        {renderKey({ code: "Delete" }, 101, 0, baseSize, gap)}
        {renderKey({ code: "End" }, 101, 1, baseSize, gap)}
        {renderKey({ code: "PageDown" }, 101, 2, baseSize, gap)}
      </div>
      <div style={{ height: `${baseSize}px` }} />
      <div className="flex" style={{ gap: `${gap}px` }}>
        {renderKey({ code: "_spacer_arrow_l" }, 102, 0, baseSize, gap)}
        {renderKey({ code: "ArrowUp" }, 102, 1, baseSize, gap)}
        {renderKey({ code: "_spacer_arrow_r" }, 102, 2, baseSize, gap)}
      </div>
      <div className="flex" style={{ gap: `${gap}px` }}>
        {renderKey({ code: "ArrowLeft" }, 103, 0, baseSize, gap)}
        {renderKey({ code: "ArrowDown" }, 103, 1, baseSize, gap)}
        {renderKey({ code: "ArrowRight" }, 103, 2, baseSize, gap)}
      </div>
    </div>
  );

  // メインキーボードの最小幅を計算（15ユニット + ギャップ）
  const mainKeyboardMinWidth = MAIN_KEYBOARD_UNITS * baseSize + (MAIN_KEYBOARD_UNITS - 1) * gap;
  // ナビクラスタ（3ユニット）と島間の余白を含めた全体最小幅
  const navClusterWidth = NAV_CLUSTER_UNITS * baseSize + (NAV_CLUSTER_UNITS - 1) * gap;
  const totalMinWidth =
    section === "main"
      ? mainKeyboardMinWidth
      : section === "nav"
        ? navClusterWidth
        : mainKeyboardMinWidth + gap * 4 + navClusterWidth;

  // キーを DOM 順で先に組み立てる（getItemProps の登録順＝DOM 順。フォーカスできるキーの数をルートの属性に使う）
  const body = (
    <>
        {/* メインキーボード + ナビゲーションクラスタ・矢印キー */}
        <div className="flex shrink-0 items-start" style={{ gap: `${gap * 4}px` }}>
          {showMain && (
            <div className="shrink-0">
              {renderKeyboardSection(mainLayout, baseSize, gap)}
            </div>
          )}
          {showNav && (
            <div className="shrink-0">
              {renderNavCluster(baseSize, gap)}
            </div>
          )}
        </div>

        {/* カスタムキーボードキー */}
        {showMain && customKeys.length > 0 && (
          <div className="mt-4">
            <p className="text-xs text-muted-foreground mb-2">{t("keyboardView.customKeys")}</p>
            {renderCustomKeys(baseSize, gap)}
          </div>
        )}

        {/* テンキー（メインキーボードの下） */}
        {showNumpad && (
          <div className="mt-4">
            {renderNumpad(baseSize, gap)}
          </div>
        )}
    </>
  );
  const hasFocusableKeys = focusableCount() > 0;

  return (
    <TooltipProvider delayDuration={200}>
      <div
        ref={rootRef}
        role="group"
        data-slot="virtual-keyboard"
        aria-label={
          section === "nav"
            ? t("keyboardView.groupLabelNav")
            : t("keyboardView.groupLabel", { layout: isJIS ? "JIS" : "US" })
        }
        aria-describedby={hasFocusableKeys ? hintId : undefined}
        onKeyDown={onKeyDown}
        className={cn("shrink-0", className)}
        style={{ minWidth: totalMinWidth }}
      >
        {hasFocusableKeys && (
          <p id={hintId} className="sr-only">{t("keyboardView.arrowKeyHint")}</p>
        )}
        {body}
      </div>
    </TooltipProvider>
  );
}

// カスタムボタン定義型
type CustomButton = {
  code: string;
  label: string;
  category: "mouse" | "keyboard";
};

// マウスボタン表示コンポーネント
interface VirtualMouseProps {
  keybindings?: Record<string, KeybindingInfoList>;
  fingerAssignments?: FingerAssignment;
  remaps?: RemapInfo[];
  customActions?: KeyInfoCustomAction[]; // カスタムアクション（トリガーキーごとにツールチップ/モーダルへ表示）
  customButtons?: CustomButton[]; // カスタムマウスボタン
  onButtonClick?: (buttonCode: string) => void;
  className?: string;
  showActionLabels?: boolean;
  showFingerAssignments?: boolean;
  showRemaps?: boolean;
}

export function VirtualMouse({
  keybindings = {},
  fingerAssignments = {},
  remaps = [],
  customActions = [],
  customButtons = [],
  onButtonClick,
  className,
  showActionLabels = false,
  showFingerAssignments = false,
  showRemaps = false,
}: VirtualMouseProps) {
  const t = useT();
  const { rootRef, getItemProps, onKeyDown, focusableCount } = useRovingKeyFocus<HTMLDivElement>();
  const hintId = useId();
  const getBindingsForButton = (code: string): KeybindingInfoList => {
    return keybindings[code] || keybindings[code.toLowerCase()] || [];
  };

  // 指割り当てを取得（ユーザー設定のみ、デフォルトは使用しない）
  const getFingersForButton = (code: string): FingerType[] => {
    const found: unknown = fingerAssignments[code] || fingerAssignments[code.toLowerCase()];
    return Array.isArray(found) ? found : [];
  };

  // リマップ情報を取得
  const getRemapForButton = (code: string): RemapInfo | undefined => {
    return remaps.find((r) =>
      r.sourceKey === code ||
      r.sourceKey.toUpperCase() === code.toUpperCase()
    );
  };

  const baseSize = 60;
  const gap = 2;

  // ボタン定義
  const buttons: Array<{ code: string; label: string; width?: number; height?: number }> = [
    { code: "Mouse0", label: t("keyLabels.mouseLeftShort"), height: 2 },
    { code: "Mouse1", label: t("keyLabels.mouseRightShort"), height: 2 },
    { code: "Mouse2", label: t("keyLabels.mouseMiddleShort"), height: 2 },
    { code: "Mouse3", label: t("keyLabels.mouseSide1Short") },
    { code: "Mouse4", label: t("keyLabels.mouseSide2Short") },
  ];

  const renderButton = (button: typeof buttons[0], isCustom = false) => {
    const bindings = getBindingsForButton(button.code);
    const fingers = showFingerAssignments ? getFingersForButton(button.code) : [];
    const finger: FingerType | undefined = fingers[0];
    const remap = showRemaps ? getRemapForButton(button.code) : undefined;
    const fingerKeyStyle = getFingerKeyStyle(fingers);
    const chipClass = finger ? FINGER_CHIP_COLORS[finger] : "bg-foreground/80 text-background";

    const width = (button.width || 1) * baseSize + ((button.width || 1) - 1) * gap;
    const height = (button.height || 1) * baseSize + ((button.height || 1) - 1) * gap;

    // リマップ先の表示ラベル
    const remapTargetLabel = remap ? getRemapOutputLabel(t, remap) : null;
    const isRemapDisabled = remap?.targetKey === null;

    // カスタムボタンのラベル長に応じたフォント縮小 + リマップ 2 段化判定
    const labelFontClass = (text: string) =>
      text.length <= 4
        ? "text-[11px]"
        : text.length <= 7
        ? "text-[10px]"
        : "text-[10px]";
    // 単一リマップ（ラベル → ターゲット）で、操作名チップなど他の要素を併置しない場合は、
    // 収まらない長さのとき矢印の前で改行（縦積み）する。デフォルト/カスタム両方に適用。
    const hasChips = showActionLabels && bindings.length > 0;
    const isRemapStacked =
      !!remap &&
      !hasChips &&
      button.label.length + 1 + (remapTargetLabel?.length ?? 0) > 5;

    const ariaLabel = buildKeyAriaLabel(t, {
      displayLabel: isCustom ? button.label : getKeyLabel(t, button.code),
      noun: t("keyboardView.ariaButtonNoun"),
      bindings,
      remaps: remap ? [remap] : [],
    });
    // カスタムボタンは常に表示、通常ボタンは情報があるときのみ（alwaysShow）。
    // ボタンの見た目（データあり／空き）は情報の有無だけで決める。
    const info: KeyInfoData = {
      title: isCustom ? button.label : getKeyLabel(t, button.code),
      bindings: bindings.map((b) => ({ action: b.action, category: b.category })),
      remaps: remap ? [remap] : [],
      customActions: getCustomActionsForKeyCode(customActions, button.code),
      fingers: showFingerAssignments ? fingers : undefined,
    };
    const surface = getKeySurface({
      fingerKeyClass: finger ? fingerKeyStyle.className : undefined,
      hasInfo: hasKeyInfo(info),
      editable: !!onButtonClick,
      remapped: !!remap,
    });
    // フォーカスできるボタン: 編集では全ボタン、読み取り専用では情報のあるボタンとカスタムボタン
    // （KeyInfoTrigger が包むかどうかと同じ式）。フォーカスできないボタンは div で描く
    const focusable = !!onButtonClick || isCustom || hasKeyInfo(info);
    const itemProps = focusable ? getItemProps(`${isCustom ? "custom" : "key"}:${button.code}`) : undefined;
    const buttonClassName = cn(
      "flex flex-col items-center justify-center rounded-md border-2 transition-colors",
      "font-medium select-none gap-0.5 px-1",
      surface.className,
      onButtonClick && "cursor-pointer hover:border-primary/50 hover:bg-secondary/80 active:bg-secondary"
    );
    const buttonStyle: CSSProperties = { ...fingerKeyStyle.style, width: `${width}px`, height: `${height}px` };
    const buttonContent = (
      <>
        {remap ? (
          isRemapStacked ? (
            <div className="flex flex-col items-center justify-center min-w-0 max-w-full leading-snug">
              <span
                className={cn(
                  "font-medium leading-snug truncate min-w-0 max-w-full text-center text-muted-foreground",
                  labelFontClass(button.label),
                )}
              >
                {button.label}
              </span>
              <div className="flex flex-nowrap items-center justify-center gap-0.5 min-w-0 max-w-full">
                <span className="leading-none text-[10px] text-muted-foreground shrink-0">→</span>
                <span
                  className={cn(
                    "font-bold leading-snug truncate min-w-0",
                    labelFontClass(remapTargetLabel ?? ""),
                    isRemapDisabled ? "text-[color-mix(in_oklab,var(--destructive),var(--foreground)_30%)]" : "text-foreground",
                  )}
                >
                  {remapTargetLabel}
                </span>
              </div>
            </div>
          ) : (
            <div className="flex flex-nowrap items-center gap-0.5 min-w-0 max-w-full">
              <span className="font-medium -my-[2px] leading-snug truncate min-w-0 text-[10px] text-muted-foreground">
                {button.label}
              </span>
              <span className="leading-none text-[10px] text-muted-foreground shrink-0">→</span>
              <span className={cn(
                "font-bold leading-snug truncate min-w-0 text-[11px]",
                isRemapDisabled ? "text-[color-mix(in_oklab,var(--destructive),var(--foreground)_30%)]" : "text-foreground"
              )}>
                {remapTargetLabel}
              </span>
            </div>
          )
        ) : (
          <span className={cn(
            "font-semibold -my-[2px] leading-snug truncate max-w-full text-[11px]",
            surface.labelMuted && "text-muted-foreground"
          )}>
            {button.label}
          </span>
        )}
        {showActionLabels && bindings.length > 0 && (
          <div className="flex flex-wrap justify-center gap-0.5 max-w-full">
            {bindings.map((binding, i) => (
              <span
                key={i}
                className={cn(
                  "min-w-0 max-w-full truncate rounded px-0.5 py-0 -my-[1.875px] text-[10px] leading-snug",
                  chipClass
                )}
              >
                {getShortActionLabel(t, binding.action)}
              </span>
            ))}
          </div>
        )}
      </>
    );
    const buttonElement = itemProps ? (
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={() => onButtonClick?.(button.code)}
        className={cn(buttonClassName, KEY_FOCUS_RING)}
        style={buttonStyle}
        {...itemProps}
      >
        {buttonContent}
      </button>
    ) : (
      <div aria-hidden="true" className={buttonClassName} style={buttonStyle}>
        {buttonContent}
      </div>
    );

    return (
      <KeyInfoTrigger key={button.code} info={info} alwaysShow={isCustom} interactive={!!onButtonClick}>
        {buttonElement}
      </KeyInfoTrigger>
    );
  };

  // カスタムマウスボタンをフィルタ
  const customMouseButtons = customButtons.filter((cb) => cb.category === "mouse");

  // ボタンを DOM 順で先に組み立てる（getItemProps の登録順＝DOM 順）
  const body = (
        <div className="flex flex-col" style={{ gap: `${gap * 2}px` }}>
          <div className="flex items-start" style={{ gap: `${gap}px` }}>
            {/* 左側: サイドボタン縦並び */}
            <div className="flex flex-col" style={{ gap: `${gap}px` }}>
              {renderButton(buttons[3])}
              {renderButton(buttons[4])}
            </div>
            {/* 右側: 左・中・右クリック横並び */}
            <div className="flex" style={{ gap: `${gap}px` }}>
              {renderButton(buttons[0])}
              {renderButton(buttons[2])}
              {renderButton(buttons[1])}
            </div>
          </div>
          {/* カスタムマウスボタン */}
          {customMouseButtons.length > 0 && (
            <div className="flex flex-wrap" style={{ gap: `${gap}px` }}>
              {customMouseButtons.map((cb) =>
                renderButton({ code: cb.code, label: cb.label }, true)
              )}
            </div>
          )}
        </div>
  );
  const hasFocusableKeys = focusableCount() > 0;

  return (
    <TooltipProvider delayDuration={200}>
      <div
        ref={rootRef}
        role="group"
        data-slot="virtual-keyboard"
        aria-label={t("keyboardView.groupLabelMouse")}
        aria-describedby={hasFocusableKeys ? hintId : undefined}
        onKeyDown={onKeyDown}
        className={cn("inline-block", className)}
      >
        {/* 同じ説明がキーボード・テンキー・マウスで3回続けて読まれないよう、本文の流れに置くのはキーボードの分だけ。
            テンキー・マウスは hidden（aria-describedby からは hidden の要素も読まれるので、グループの説明は残る） */}
        {hasFocusableKeys && (
          <p id={hintId} hidden>
            {t("keyboardView.arrowKeyHint")}
          </p>
        )}
        {body}
      </div>
    </TooltipProvider>
  );
}

// キーバインド配列をマッピング用オブジェクトに変換するヘルパー
// キーコードを正規化してマッピング（複数操作対応）
export function keybindingsToMap(
  keybindings: Array<{ action: string; keyCode: string; category: string }>
): Record<string, KeybindingInfoList> {
  const map: Record<string, KeybindingInfoList> = {};
  for (const kb of keybindings) {
    // 正規化したキーコードでマッピング
    const normalizedKeyCode = normalizeKeyCode(kb.keyCode);
    if (!map[normalizedKeyCode]) {
      map[normalizedKeyCode] = [];
    }
    map[normalizedKeyCode].push({ action: kb.action, category: kb.category });
  }
  return map;
}

// テンキー単体コンポーネント
interface VirtualNumpadProps {
  keybindings?: Record<string, KeybindingInfoList>;
  fingerAssignments?: FingerAssignment;
  remaps?: RemapInfo[];
  customActions?: KeyInfoCustomAction[]; // カスタムアクション（トリガーキーごとにツールチップ/モーダルへ表示）
  highlightedKeys?: string[];
  onKeyClick?: (keyCode: string) => void;
  className?: string;
  showActionLabels?: boolean;
  showFingerAssignments?: boolean;
  showRemaps?: boolean;
  useDefaultFingerAssignments?: boolean;
}

export function VirtualNumpad({
  keybindings = {},
  fingerAssignments = {},
  remaps = [],
  customActions = [],
  highlightedKeys = [],
  onKeyClick,
  className,
  showActionLabels = false,
  showFingerAssignments = false,
  showRemaps = false,
  useDefaultFingerAssignments = false,
}: VirtualNumpadProps) {
  const t = useT();
  const { rootRef, getItemProps, onKeyDown, focusableCount } = useRovingKeyFocus<HTMLDivElement>();
  const hintId = useId();
  // 有効な指割り当て（ユーザー設定がなければデフォルトを使用）
  const effectiveFingerAssignments: FingerAssignment = useDefaultFingerAssignments
    ? { ...DEFAULT_FINGER_ASSIGNMENTS, ...fingerAssignments }
    : fingerAssignments;

  // キーコードからバインディング情報を検索（正規化して検索、複数操作対応）
  const getBindingsForKey = (keyCode: string): KeybindingInfoList => {
    if (keybindings[keyCode]) return keybindings[keyCode];
    const normalized = normalizeKeyCode(keyCode);
    if (keybindings[normalized]) return keybindings[normalized];
    return keybindings[keyCode.toLowerCase()] || [];
  };

  // キーコードから指割り当てを取得（正規化して検索）
  const getFingersForKey = (keyCode: string): FingerType[] => {
    const normalized = normalizeKeyCode(keyCode);
    return effectiveFingerAssignments[normalized] ||
           effectiveFingerAssignments[keyCode] ||
           effectiveFingerAssignments[keyCode.toLowerCase()] ||
           [];
  };

  // キーコードからリマップ情報を取得
  // 修飾キー組み合わせの場合はベースキーが一致するものを返す
  const getRemapForKey = (keyCode: string): RemapInfo | undefined => {
    return remaps.find((r) => {
      if (r.sourceKey.includes("+")) {
        const parsed = parseKeyCombination(r.sourceKey);
        return keysEqual(parsed.keyCode, keyCode);
      }
      return keysEqual(r.sourceKey, keyCode);
    });
  };

  const gap = 2;
  const baseSize = 60;

  // 単一キーのレンダリング
  const renderKey = (key: KeyDefinition, rowIndex: number, keyIndex: number) => {
    if (key.code.startsWith("_spacer")) {
      return (
        <div
          key={`spacer-${rowIndex}-${keyIndex}`}
          style={{ width: `${(key.width || 1) * baseSize}px` }}
        />
      );
    }

    const width = (key.width || 1) * baseSize + ((key.width || 1) - 1) * gap;
    const height = (key.height || 1) * baseSize + ((key.height || 1) - 1) * gap;
    const bindings = getBindingsForKey(key.code);
    const fingers = getFingersForKey(key.code);
    const finger: FingerType | undefined = fingers[0];
    const remap = showRemaps ? getRemapForKey(key.code) : undefined;
    const isHighlighted = highlightedKeys.includes(key.code);
    const displayLabel =
    (key.labelKey ? t(key.labelKey) : key.label) || getKeyLabel(t, key.code);

    const fingerKeyStyle = showFingerAssignments
      ? getFingerKeyStyle(fingers)
      : { className: "" as string, style: undefined };
    const fingerKeyClass = fingerKeyStyle.className;
    const chipClass = showFingerAssignments && finger
      ? FINGER_CHIP_COLORS[finger]
      : "bg-foreground/80 text-background";

    const showAction = showActionLabels && bindings.length > 0;
    // リマップ先の表示ラベル
    const remapTargetLabel = remap ? getRemapOutputLabel(t, remap) : null;
    const isRemapDisabled = remap?.targetKey === null;
    // 単一リマップのみで操作名チップ等を併置しない場合、収まらない長さなら矢印の前で改行する
    const isRemapStacked =
      !!remap &&
      !showAction &&
      displayLabel.length + 1 + (remapTargetLabel?.length ?? 0) > 5;

    const ariaLabel = buildKeyAriaLabel(t, {
      displayLabel,
      bindings,
      remaps: remap ? [remap] : [],
    });

    const info: KeyInfoData = {
      title: getKeyLabel(t, key.code),
      bindings: bindings.map((b) => ({ action: b.action, category: b.category })),
      remaps: remap ? [remap] : [],
      customActions: getCustomActionsForKeyCode(customActions, key.code),
      fingers: showFingerAssignments ? fingers : undefined,
    };
    const surface = getKeySurface({
      fingerKeyClass: showFingerAssignments && finger ? fingerKeyClass : undefined,
      hasInfo: hasKeyInfo(info),
      editable: !!onKeyClick,
      remapped: !!remap,
    });

    // フォーカスできるキー: 編集では全キー、読み取り専用では情報のあるキーだけ
    // （KeyInfoTrigger が包むかどうかと同じ式）。フォーカスできないキーは div で描く
    const focusable = !!onKeyClick || hasKeyInfo(info);
    const itemProps = focusable ? getItemProps(`key:${key.code}`) : undefined;
    const keyClassName = cn(
      "relative flex flex-col items-center justify-center rounded-md border-2 transition-colors",
      "font-medium select-none gap-0.5 px-1",
      surface.className,
      isHighlighted && "ring-2 ring-primary ring-offset-1 ring-offset-background",
      onKeyClick && "cursor-pointer hover:border-primary/50 hover:bg-secondary/80 active:bg-secondary",
      key.className
    );
    const keyStyle: CSSProperties = {
      ...fingerKeyStyle.style,
      width: `${width}px`,
      height: `${height}px`,
    };

    const keyContent = (
      <>
        {remap ? (
          isRemapStacked ? (
            <div className="flex flex-col items-center justify-center min-w-0 max-w-full leading-snug">
              <span className="font-medium leading-snug truncate min-w-0 max-w-full text-center text-[10px] text-muted-foreground">
                {displayLabel}
              </span>
              <div className="flex flex-nowrap items-center justify-center gap-0.5 min-w-0 max-w-full">
                <span className="leading-none text-[10px] text-muted-foreground shrink-0">→</span>
                <span className={cn(
                  "font-bold leading-snug truncate min-w-0 text-[11px]",
                  isRemapDisabled ? "text-[color-mix(in_oklab,var(--destructive),var(--foreground)_30%)]" : "text-foreground"
                )}>
                  {remapTargetLabel}
                </span>
              </div>
            </div>
          ) : (
            <div className="flex flex-nowrap items-center justify-center gap-0.5 min-w-0 max-w-full">
              <span className="font-medium -my-[2px] leading-snug truncate min-w-0 text-[10px] text-muted-foreground">
                {displayLabel}
              </span>
              <span className="leading-none text-[10px] text-muted-foreground shrink-0">→</span>
              <span className={cn(
                "font-bold leading-snug truncate min-w-0 text-[11px]",
                isRemapDisabled ? "text-[color-mix(in_oklab,var(--destructive),var(--foreground)_30%)]" : "text-foreground"
              )}>
                {remapTargetLabel}
              </span>
            </div>
          )
        ) : (
          <span className={cn(
            "font-semibold -my-[2px] leading-snug truncate max-w-full text-[11px]",
            surface.labelMuted && "text-muted-foreground"
          )}>
            {displayLabel}
          </span>
        )}
        {showAction && (
          <div className="flex flex-wrap justify-center gap-0.5 max-w-full">
            {bindings.map((binding, i) => (
              <span key={i} className={cn(
                "min-w-0 max-w-full truncate rounded px-0.5 py-0 -my-[1.875px] text-[10px] leading-snug",
                chipClass
              )}>
                {getShortActionLabel(t, binding.action)}
              </span>
            ))}
          </div>
        )}
      </>
    );
    const keyElement = itemProps ? (
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={() => onKeyClick?.(key.code)}
        className={cn(keyClassName, KEY_FOCUS_RING)}
        style={keyStyle}
        {...itemProps}
      >
        {keyContent}
      </button>
    ) : (
      <div aria-hidden="true" className={keyClassName} style={keyStyle}>
        {keyContent}
      </div>
    );

    return (
      <KeyInfoTrigger key={`${rowIndex}-${keyIndex}`} info={info} interactive={!!onKeyClick}>
        {keyElement}
      </KeyInfoTrigger>
    );
  };

  // キーを DOM 順で先に組み立てる（getItemProps の登録順＝DOM 順）
  const body = (
        <div className="flex flex-col" style={{ gap: `${gap}px` }}>
          {/* Row 1 */}
          <div className="flex" style={{ gap: `${gap}px` }}>
            {renderKey({ code: "NumLock", label: "Num" }, 0, 0)}
            {renderKey({ code: "NumpadDivide", label: "/" }, 0, 1)}
            {renderKey({ code: "NumpadMultiply", label: "*" }, 0, 2)}
            {renderKey({ code: "NumpadSubtract", label: "-" }, 0, 3)}
          </div>
          {/* Row 2-3 with + spanning */}
          <div className="flex" style={{ gap: `${gap}px` }}>
            <div className="flex flex-col" style={{ gap: `${gap}px` }}>
              <div className="flex" style={{ gap: `${gap}px` }}>
                {renderKey({ code: "Numpad7", label: "7" }, 1, 0)}
                {renderKey({ code: "Numpad8", label: "8" }, 1, 1)}
                {renderKey({ code: "Numpad9", label: "9" }, 1, 2)}
              </div>
              <div className="flex" style={{ gap: `${gap}px` }}>
                {renderKey({ code: "Numpad4", label: "4" }, 2, 0)}
                {renderKey({ code: "Numpad5", label: "5" }, 2, 1)}
                {renderKey({ code: "Numpad6", label: "6" }, 2, 2)}
              </div>
            </div>
            {renderKey({ code: "NumpadAdd", label: "+", height: 2 }, 1, 3)}
          </div>
          {/* Row 4-5 with Enter spanning */}
          <div className="flex" style={{ gap: `${gap}px` }}>
            <div className="flex flex-col" style={{ gap: `${gap}px` }}>
              <div className="flex" style={{ gap: `${gap}px` }}>
                {renderKey({ code: "Numpad1", label: "1" }, 3, 0)}
                {renderKey({ code: "Numpad2", label: "2" }, 3, 1)}
                {renderKey({ code: "Numpad3", label: "3" }, 3, 2)}
              </div>
              <div className="flex" style={{ gap: `${gap}px` }}>
                {renderKey({ code: "Numpad0", label: "0", width: 2 }, 4, 0)}
                {renderKey({ code: "NumpadDecimal", label: "." }, 4, 1)}
              </div>
            </div>
            {renderKey({ code: "NumpadEnter", label: "Enter", height: 2 }, 3, 3)}
          </div>
        </div>
  );
  const hasFocusableKeys = focusableCount() > 0;

  return (
    <TooltipProvider delayDuration={200}>
      <div
        ref={rootRef}
        role="group"
        data-slot="virtual-keyboard"
        aria-label={t("keyboardView.groupLabelNumpad")}
        aria-describedby={hasFocusableKeys ? hintId : undefined}
        onKeyDown={onKeyDown}
        className={cn("inline-block", className)}
      >
        {/* 同じ説明がキーボード・テンキー・マウスで3回続けて読まれないよう、本文の流れに置くのはキーボードの分だけ。
            テンキー・マウスは hidden（aria-describedby からは hidden の要素も読まれるので、グループの説明は残る） */}
        {hasFocusableKeys && (
          <p id={hintId} hidden>
            {t("keyboardView.arrowKeyHint")}
          </p>
        )}
        {body}
      </div>
    </TooltipProvider>
  );
}

// 指割り当て凡例コンポーネント
export function FingerLegend({ className }: { className?: string }) {
  const t = useT();
  // 凡例は左右を区別しないので、fingerLabels の短縮形を使う
  const fingers: { key: FingerColorName; labelKey: MessageKey }[] = [
    { key: "pinky", labelKey: "fingerLabels.pinky" },
    { key: "ring", labelKey: "fingerLabels.ring" },
    { key: "middle", labelKey: "fingerLabels.middle" },
    { key: "index", labelKey: "fingerLabels.index" },
    { key: "thumb", labelKey: "fingerLabels.thumb" },
    { key: "palm", labelKey: "fingerLabels.palm" },
  ];

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {fingers.map(({ key, labelKey }) => (
        <div key={key} className="flex items-center gap-1">
          <div
            className={cn(
              "w-3 h-3 rounded-full",
              FINGER_BG_COLORS[key]
            )}
          />
          <span className="text-[11px] text-muted-foreground">{t(labelKey)}</span>
        </div>
      ))}
    </div>
  );
}

export const VirtualKeyboard = memo(VirtualKeyboardComponent);
