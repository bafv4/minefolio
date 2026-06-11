import { memo } from "react";
import { ArrowBigUp, ChevronUp, Command, Option, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { getKeyLabel, getActionLabel, getShortActionLabel, normalizeKeyCode, keysEqual, DEFAULT_FINGER_ASSIGNMENTS, FINGER_LABELS, parseKeyCombination, type FingerType } from "@/lib/keybindings";
import { getRemapOutputLabel, getRemapSourceLabel, isSpecialRemapTarget, type RemapInfo } from "@/lib/remap-utils";
import { TooltipProvider } from "@/components/ui/tooltip";
import { KeyInfoTrigger, type KeyInfoData } from "@/components/key-info-trigger";

// 修飾キーの lucide アイコンマップ（リマップ表示用）。
// Shift = ArrowBigUp、Ctrl = ChevronUp、Alt = Option、Meta = Command。
const MODIFIER_ICON_MAP: Record<string, LucideIcon> = {
  Ctrl: ChevronUp,
  Shift: ArrowBigUp,
  Alt: Option,
  Meta: Command,
};

/** 共通: キー/ボタンの aria-label を組み立てる */
function buildKeyAriaLabel(opts: {
  displayLabel: string;
  noun?: string; // 「キー」 or 「ボタン」
  bindings: Array<{ action: string }>;
  remaps: RemapInfo[];
  layout?: string | null;
}): string {
  const noun = opts.noun ?? "キー";
  return [
    `${opts.displayLabel} ${noun}`,
    ...opts.bindings.map((b) => getActionLabel(b.action)),
    ...opts.remaps.map(
      (r) =>
        `リマップ ${getRemapSourceLabel(r.sourceKey, opts.layout)} → ${getRemapOutputLabel(r, opts.layout)}`,
    ),
  ].join("、");
}

// キーボードレイアウト定義
type KeyDefinition = {
  code: string;
  label?: string;
  width?: number; // 1 = 1unit (40px base)
  height?: number;
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
    { code: "IntlYen", label: "半角" },
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
    { code: "_spacer_jis", width: 0.25 },
  ],
  // Row 4: ASDF row (Enterが2段)
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
    { code: "Enter", width: 1.5 },
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
  // Row 6: Bottom row (変換、無変換追加)
  [
    { code: "ControlLeft", label: "Ctrl", width: 1.25 },
    { code: "MetaLeft", label: "Win", width: 1.25 },
    { code: "AltLeft", label: "Alt", width: 1.25 },
    { code: "NonConvert", label: "無変換", width: 1.25 },
    { code: "Space", label: "Space", width: 3.5 },
    { code: "Convert", label: "変換", width: 1.25 },
    { code: "KanaMode", label: "かな", width: 1.25 },
    { code: "AltRight", label: "Alt", width: 1.25 },
    { code: "ControlRight", label: "Ctrl", width: 1.25 },
  ],
];

// テンキー定義
const NUMPAD_LAYOUT: KeyboardRow[] = [
  [
    { code: "NumLock", label: "Num" },
    { code: "NumpadDivide", label: "/" },
    { code: "NumpadMultiply", label: "*" },
    { code: "NumpadSubtract", label: "-" },
  ],
  [
    { code: "Numpad7", label: "7" },
    { code: "Numpad8", label: "8" },
    { code: "Numpad9", label: "9" },
    { code: "NumpadAdd", label: "+", height: 2 },
  ],
  [
    { code: "Numpad4", label: "4" },
    { code: "Numpad5", label: "5" },
    { code: "Numpad6", label: "6" },
  ],
  [
    { code: "Numpad1", label: "1" },
    { code: "Numpad2", label: "2" },
    { code: "Numpad3", label: "3" },
    { code: "NumpadEnter", label: "Enter", height: 2 },
  ],
  [
    { code: "Numpad0", label: "0", width: 2 },
    { code: "NumpadDecimal", label: "." },
  ],
];

// 指の種類から基本色名へのマッピング
type FingerColorName = "pinky" | "ring" | "middle" | "index" | "thumb";

const FINGER_TO_COLOR: Record<FingerType, FingerColorName> = {
  "left-pinky": "pinky",
  "left-ring": "ring",
  "left-middle": "middle",
  "left-index": "index",
  "left-thumb": "thumb",
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
  "right-thumb": "bg-finger-thumb/30 border-finger-thumb/60 text-foreground",
  "right-index": "bg-finger-index/30 border-finger-index/60 text-foreground",
  "right-middle": "bg-finger-middle/30 border-finger-middle/60 text-foreground",
  "right-ring": "bg-finger-ring/30 border-finger-ring/60 text-foreground",
  "right-pinky": "bg-finger-pinky/30 border-finger-pinky/60 text-foreground",
};

// チップ用の色（操作名表示用）- CSS変数を使用
export const FINGER_CHIP_COLORS: Record<FingerType, string> = {
  "left-pinky": "bg-finger-pinky text-white dark:text-black",
  "left-ring": "bg-finger-ring text-white dark:text-black",
  "left-middle": "bg-finger-middle text-white dark:text-black",
  "left-index": "bg-finger-index text-white dark:text-black",
  "left-thumb": "bg-finger-thumb text-white dark:text-black",
  "right-thumb": "bg-finger-thumb text-white dark:text-black",
  "right-index": "bg-finger-index text-white dark:text-black",
  "right-middle": "bg-finger-middle text-white dark:text-black",
  "right-ring": "bg-finger-ring text-white dark:text-black",
  "right-pinky": "bg-finger-pinky text-white dark:text-black",
};

// 指の色（背景用 - 凡例用）- CSS変数を使用
const FINGER_BG_COLORS: Record<FingerColorName, string> = {
  "pinky": "bg-finger-pinky",
  "ring": "bg-finger-ring",
  "middle": "bg-finger-middle",
  "index": "bg-finger-index",
  "thumb": "bg-finger-thumb",
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

/**
 * 文字列の視覚的な幅を計算（全角=2、半角=1）
 */
function getVisualWidth(str: string): number {
  let width = 0;
  for (const char of str) {
    const code = char.charCodeAt(0);
    // 全角文字（CJK、全角記号など）
    if (
      (code >= 0x3000 && code <= 0x9FFF) || // CJK記号、ひらがな、カタカナ、漢字
      (code >= 0xFF00 && code <= 0xFFEF) || // 全角英数、半角カタカナ
      (code >= 0xAC00 && code <= 0xD7AF)    // 韓国語
    ) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

/**
 * 視覚的な幅で文字列を省略（全角5文字=半角10文字を超える場合）
 */
function truncateByVisualWidth(str: string, maxWidth: number = 10): string {
  const visualWidth = getVisualWidth(str);
  if (visualWidth <= maxWidth) {
    return str;
  }

  let width = 0;
  let result = '';
  for (const char of str) {
    const code = char.charCodeAt(0);
    const charWidth = (
      (code >= 0x3000 && code <= 0x9FFF) ||
      (code >= 0xFF00 && code <= 0xFFEF) ||
      (code >= 0xAC00 && code <= 0xD7AF)
    ) ? 2 : 1;

    // 省略記号（…）の分を考慮して1文字分余裕を持たせる
    if (width + charWidth > maxWidth - 1) {
      return result + '…';
    }
    result += char;
    width += charWidth;
  }
  return str;
}

interface VirtualKeyboardProps {
  layout?: "US" | "JIS" | "US_TKL" | "JIS_TKL";
  keybindings?: Record<string, KeybindingInfoList>;
  fingerAssignments?: FingerAssignment;
  remaps?: RemapInfo[]; // リマップ情報
  customKeyNames?: Record<string, string>; // カスタムキーコード → 表示名のマップ
  customKeys?: CustomKeyboardButton[]; // カスタムキーボードキー
  highlightedKeys?: string[];
  onKeyClick?: (keyCode: string) => void;
  className?: string;
  showActionLabels?: boolean; // キーに操作名を表示
  showFingerAssignments?: boolean; // 指割り当てを表示
  showRemaps?: boolean; // リマップを表示
  useDefaultFingerAssignments?: boolean; // デフォルトの指割り当てを使用
  hideNumpad?: boolean; // テンキーを非表示にする
  alwaysShowActions?: string[]; // showActionLabels=false でも常に表示する操作名
}

// メインキーボードの行の合計幅を計算（USレイアウト Row2基準: 15ユニット）
const MAIN_KEYBOARD_UNITS = 15;

function VirtualKeyboardComponent({
  layout = "US",
  keybindings = {},
  fingerAssignments = {},
  remaps = [],
  customKeyNames = {},
  customKeys = [],
  highlightedKeys = [],
  onKeyClick,
  className,
  showActionLabels = false,
  showFingerAssignments = false,
  showRemaps = false,
  useDefaultFingerAssignments = false,
  hideNumpad = false,
  alwaysShowActions,
}: VirtualKeyboardProps) {
  const isJIS = layout === "JIS" || layout === "JIS_TKL";
  const isTKL = layout === "US_TKL" || layout === "JIS_TKL";
  const mainLayout = isJIS ? JIS_MAIN_LAYOUT : US_MAIN_LAYOUT;
  const showNumpad = !isTKL && !hideNumpad;

  // 有効な指割り当て（ユーザー設定がなければデフォルトを使用）
  const effectiveFingerAssignments: FingerAssignment = useDefaultFingerAssignments
    ? { ...DEFAULT_FINGER_ASSIGNMENTS, ...fingerAssignments }
    : fingerAssignments;

  // キーコードからバインディング情報を検索（正規化して検索、複数操作対応）
  const getBindingsForKey = (keyCode: string): KeybindingInfoList => {
    // まず直接検索
    if (keybindings[keyCode]) return keybindings[keyCode];
    // 正規化したキーコードで検索
    const normalized = normalizeKeyCode(keyCode);
    if (keybindings[normalized]) return keybindings[normalized];
    // 小文字で検索
    return keybindings[keyCode.toLowerCase()] || [];
  };

  // キーコードから指割り当てを取得（正規化して検索）
  const getFingerForKey = (keyCode: string): FingerType | undefined => {
    const normalized = normalizeKeyCode(keyCode);
    const fingers = effectiveFingerAssignments[normalized] ||
                   effectiveFingerAssignments[keyCode] ||
                   effectiveFingerAssignments[keyCode.toLowerCase()];
    return fingers?.[0];
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

  // 特定キーに関連する全リマップを取得（修飾キー組み合わせを含む）
  const getRemapsForKey = (keyCode: string): RemapInfo[] => {
    return remaps.filter((r) => {
      if (r.sourceKey.includes("+")) {
        const parsed = parseKeyCombination(r.sourceKey);
        return keysEqual(parsed.keyCode, keyCode);
      }
      return keysEqual(r.sourceKey, keyCode);
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
    const finger = getFingerForKey(key.code);
    // 複数リマップ対応: このキーに関連する全リマップを取得
    const keyRemaps = showRemaps ? getRemapsForKey(key.code) : [];
    const isHighlighted = highlightedKeys.includes(key.code);
    const displayLabel = key.label || getKeyLabel(key.code);

    // 指割り当てが有効な場合は指の色を使用、そうでなければデフォルト
    const fingerKeyClass = showFingerAssignments && finger
      ? FINGER_KEY_COLORS[finger]
      : "";
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

    const ariaLabel = buildKeyAriaLabel({
      displayLabel,
      bindings: filteredBindings,
      remaps: keyRemaps,
      layout,
    });

    // リマップのツールチップ説明を生成
    const getRemapTooltipText = (r: RemapInfo): string => {
      if (r.targetKey === null) {
        return "無効化";
      }
      if (isSpecialRemapTarget(r.targetKey)) {
        return `文字「${r.targetKey}」を出力`;
      }
      if (r.targetKey) {
        return getKeyLabel(r.targetKey, layout);
      }
      return "無効化";
    };

    // リマップのソースキーの修飾キーマーク（シンボルで表示）
    const getModifierIcons = (r: RemapInfo): LucideIcon[] => {
      if (!r.sourceKey.includes("+")) return [];
      const parsed = parseKeyCombination(r.sourceKey);
      if (parsed.modifiers.length === 0) return [];
      return parsed.modifiers
        .map((m) => MODIFIER_ICON_MAP[m])
        .filter((Icon): Icon is LucideIcon => !!Icon);
    };

    const keyElement = (
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={() => onKeyClick?.(key.code)}
        className={cn(
          "relative flex flex-col items-center justify-center rounded-md border-2 transition-colors",
          "font-medium select-none gap-0.5 px-1",
          showFingerAssignments && finger
            ? fingerKeyClass
            : "bg-secondary/50 border-border/50 text-muted-foreground hover:bg-secondary",
          isHighlighted && "ring-2 ring-primary ring-offset-1 ring-offset-background",
          onKeyClick && "cursor-pointer hover:border-primary/50 hover:bg-secondary/80 active:bg-secondary"
        )}
        style={{
          width: `${width}px`,
          height: `${height}px`,
        }}
      >
        {/* リマップがある場合 */}
        {keyRemaps.length > 0 ? (
          <div className="flex flex-col items-center justify-center gap-0 max-w-full overflow-visible">
            {keyRemaps.slice(0, 2).map((r, i) => {
              const isDisabled = r.targetKey === null;
              const targetLabel = getRemapOutputLabel(r, layout);
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
                  <span className="font-medium text-[9px] text-muted-foreground/50">
                    {displayLabel}
                  </span>
                  <span className="text-[8px] text-muted-foreground/40">→</span>
                  <span className={cn(
                    "font-bold text-[9px]",
                    isDisabled ? "text-muted-foreground" : "text-foreground"
                  )}>
                    {targetLabel}
                  </span>
                </div>
              );
            })}
            {keyRemaps.length > 2 && (
              <span className="text-[7px] text-muted-foreground/50">+{keyRemaps.length - 2}</span>
            )}
          </div>
        ) : (
          /* 通常のキーラベル */
          <span className={cn(
            "font-semibold leading-none text-[11px]",
            !(showFingerAssignments && finger) && "text-muted-foreground"
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
                "rounded px-1 py-0 leading-none text-[8px]",
                chipClass
              )}>
                {getShortActionLabel(binding.action)}
              </span>
            ))}
          </div>
        )}
      </button>
    );

    // ツールチップでバインディング情報を表示
    const info: KeyInfoData = {
      title: getKeyLabel(key.code, layout),
      bindings: bindings.map((b) => ({ action: b.action, category: b.category })),
      remaps: keyRemaps,
      finger: showFingerAssignments ? finger : undefined,
      layout,
    };
    return (
      <KeyInfoTrigger key={`${rowIndex}-${keyIndex}`} info={info}>
        {keyElement}
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
        {customKeys.map((ck, index) => {
          const bindings = getBindingsForKey(ck.code);
          const finger = getFingerForKey(ck.code);
          const remap = showRemaps ? getRemapForKey(ck.code) : undefined;
          const isHighlighted = highlightedKeys.includes(ck.code);

          const fingerKeyClass = showFingerAssignments && finger
            ? FINGER_KEY_COLORS[finger]
            : "";
          const chipClass = showFingerAssignments && finger
            ? FINGER_CHIP_COLORS[finger]
            : "bg-foreground/80 text-background";

          const showAction = showActionLabels && bindings.length > 0;
          // リマップ先の表示ラベル
          const remapTargetLabel = remap ? getRemapOutputLabel(remap, layout) : null;
          const isRemapDisabled = remap?.targetKey === null;

          // カスタムキーのラベル長に応じてフォントサイズを段階的に切替。
          // baseSize×2.5 の最大幅を超えるものは truncate で省略し、Tooltip でフル表示。
          const labelFontClass = (text: string) =>
            text.length <= 4
              ? "text-[11px]"
              : text.length <= 7
              ? "text-[10px]"
              : "text-[9px]";

          // リマップ表示時、ラベル + → + ターゲット の合計が長く 1 行に収まりにくい場合は
          // 矢印以降を改行して下段に表示する（ラベル単体が truncate されるケース対策）。
          const remapInlineBudget = 5;
          const isRemapStacked =
            !!remap &&
            ck.label.length + 1 + (remapTargetLabel?.length ?? 0) > remapInlineBudget;

          const ariaLabel = buildKeyAriaLabel({
            displayLabel: ck.label,
            bindings,
            remaps: remap ? [remap] : [],
            layout,
          });
          const keyElement = (
            <button
              type="button"
              aria-label={ariaLabel}
              onClick={() => onKeyClick?.(ck.code)}
              className={cn(
                "relative flex flex-col items-center justify-center rounded-md border-2 transition-colors",
                "font-medium select-none gap-0.5 px-2",
                showFingerAssignments && finger
                  ? fingerKeyClass
                  : "bg-secondary/50 border-border/50 text-muted-foreground hover:bg-secondary",
                isHighlighted && "ring-2 ring-primary ring-offset-1 ring-offset-background",
                onKeyClick && "cursor-pointer hover:border-primary/50 hover:bg-secondary/80 active:bg-secondary"
              )}
              style={{
                minWidth: `${baseSize}px`,
                maxWidth: `${baseSize * 2.5}px`,
                height: `${baseSize}px`,
              }}
            >
              {remap ? (
                isRemapStacked ? (
                  <div className="flex flex-col items-center justify-center min-w-0 max-w-full leading-tight">
                    <span
                      className={cn(
                        "font-medium leading-tight truncate min-w-0 max-w-full text-center text-muted-foreground/50",
                        labelFontClass(ck.label),
                      )}
                    >
                      {ck.label}
                    </span>
                    <div className="flex flex-nowrap items-center justify-center gap-0.5 min-w-0 max-w-full">
                      <span className="leading-none text-[9px] text-muted-foreground/40 shrink-0">→</span>
                      <span
                        className={cn(
                          "font-bold leading-tight truncate min-w-0",
                          labelFontClass(remapTargetLabel ?? ""),
                          isRemapDisabled ? "text-muted-foreground" : "text-foreground",
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
                        "font-medium leading-none truncate min-w-0 text-muted-foreground/50",
                        labelFontClass(ck.label),
                      )}
                    >
                      {ck.label}
                    </span>
                    <span className="leading-none text-[9px] text-muted-foreground/40 shrink-0">→</span>
                    <span
                      className={cn(
                        "font-bold leading-tight truncate min-w-0",
                        labelFontClass(remapTargetLabel ?? ""),
                        isRemapDisabled ? "text-muted-foreground" : "text-foreground",
                      )}
                    >
                      {remapTargetLabel}
                    </span>
                  </div>
                )
              ) : (
                <span
                  className={cn(
                    "font-semibold leading-none truncate max-w-full",
                    labelFontClass(ck.label),
                    !(showFingerAssignments && finger) && "text-muted-foreground",
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
                        "rounded px-1 py-0 leading-none text-[8px]",
                        chipClass,
                      )}
                    >
                      {getShortActionLabel(binding.action)}
                    </span>
                  ))}
                </div>
              )}
            </button>
          );

          // カスタムキーは情報の有無に関わらず常に Tooltip/Dialog を表示する。
          const info: KeyInfoData = {
            title: ck.label,
            bindings: bindings.map((b) => ({ action: b.action, category: b.category })),
            remaps: remap ? [remap] : [],
            finger: showFingerAssignments ? finger : undefined,
            layout,
          };
          return (
            <KeyInfoTrigger key={ck.code} info={info} alwaysShow>
              {keyElement}
            </KeyInfoTrigger>
          );
        })}
      </div>
    );
  };

  // メインキーボードの最小幅を計算（15ユニット + ギャップ）
  const mainKeyboardMinWidth = MAIN_KEYBOARD_UNITS * baseSize + (MAIN_KEYBOARD_UNITS - 1) * gap;

  return (
    <TooltipProvider delayDuration={200}>
      <div className={cn("shrink-0", className)} style={{ minWidth: mainKeyboardMinWidth }}>
        {/* メインキーボード */}
        <div className="shrink-0">
          {renderKeyboardSection(mainLayout, baseSize, gap)}
        </div>

        {/* カスタムキーボードキー */}
        {customKeys.length > 0 && (
          <div className="mt-4">
            <p className="text-xs text-muted-foreground mb-2">カスタムキー</p>
            {renderCustomKeys(baseSize, gap)}
          </div>
        )}

        {/* テンキー（メインキーボードの下） */}
        {showNumpad && (
          <div className="mt-4">
            {renderNumpad(baseSize, gap)}
          </div>
        )}
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
  customButtons = [],
  onButtonClick,
  className,
  showActionLabels = false,
  showFingerAssignments = false,
  showRemaps = false,
}: VirtualMouseProps) {
  const getBindingsForButton = (code: string): KeybindingInfoList => {
    return keybindings[code] || keybindings[code.toLowerCase()] || [];
  };

  // 指割り当てを取得（ユーザー設定のみ、デフォルトは使用しない）
  const getFingerForButton = (code: string): FingerType | undefined => {
    const fingers = fingerAssignments[code] || fingerAssignments[code.toLowerCase()];
    return fingers?.[0];
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
    { code: "Mouse0", label: "左", height: 2 },
    { code: "Mouse1", label: "右", height: 2 },
    { code: "Mouse2", label: "中", height: 2 },
    { code: "Mouse3", label: "サイド1" },
    { code: "Mouse4", label: "サイド2" },
  ];

  const renderButton = (button: typeof buttons[0], index: number, isCustom = false) => {
    const bindings = getBindingsForButton(button.code);
    const finger = showFingerAssignments ? getFingerForButton(button.code) : undefined;
    const remap = showRemaps ? getRemapForButton(button.code) : undefined;
    const fingerKeyClass = finger ? FINGER_KEY_COLORS[finger] : "bg-secondary/50 border-border/50 text-muted-foreground";
    const chipClass = finger ? FINGER_CHIP_COLORS[finger] : "bg-foreground/80 text-background";

    const width = (button.width || 1) * baseSize + ((button.width || 1) - 1) * gap;
    const height = (button.height || 1) * baseSize + ((button.height || 1) - 1) * gap;

    // リマップ先の表示ラベル
    const remapTargetLabel = remap ? getRemapOutputLabel(remap) : null;
    const isRemapDisabled = remap?.targetKey === null;

    // カスタムボタンのラベル長に応じたフォント縮小 + リマップ 2 段化判定
    const labelFontClass = (text: string) =>
      text.length <= 4
        ? "text-[11px]"
        : text.length <= 7
        ? "text-[10px]"
        : "text-[9px]";
    const isRemapStacked =
      isCustom &&
      !!remap &&
      button.label.length + 1 + (remapTargetLabel?.length ?? 0) > 5;

    const ariaLabel = buildKeyAriaLabel({
      displayLabel: isCustom ? button.label : getKeyLabel(button.code),
      noun: "ボタン",
      bindings,
      remaps: remap ? [remap] : [],
    });
    const buttonElement = (
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={() => onButtonClick?.(button.code)}
        className={cn(
          "flex flex-col items-center justify-center rounded-md border-2 transition-colors",
          "font-medium select-none gap-0.5 px-1",
          fingerKeyClass,
          onButtonClick && "cursor-pointer hover:border-primary/50 hover:bg-secondary/80 active:bg-secondary"
        )}
        style={{ width: `${width}px`, height: `${height}px` }}
      >
        {remap ? (
          isRemapStacked ? (
            <div className="flex flex-col items-center justify-center min-w-0 max-w-full leading-tight">
              <span
                className={cn(
                  "font-medium leading-tight truncate min-w-0 max-w-full text-center text-muted-foreground/50",
                  labelFontClass(button.label),
                )}
              >
                {button.label}
              </span>
              <div className="flex flex-nowrap items-center justify-center gap-0.5 min-w-0 max-w-full">
                <span className="leading-none text-[9px] text-muted-foreground/40 shrink-0">→</span>
                <span
                  className={cn(
                    "font-bold leading-tight truncate min-w-0",
                    labelFontClass(remapTargetLabel ?? ""),
                    isRemapDisabled ? "text-muted-foreground" : "text-foreground",
                  )}
                >
                  {remapTargetLabel}
                </span>
              </div>
            </div>
          ) : (
            <div className="flex flex-nowrap items-center gap-0.5 min-w-0 max-w-full">
              <span className="font-medium leading-none truncate min-w-0 text-[9px] text-muted-foreground/50">
                {button.label}
              </span>
              <span className="leading-none text-[9px] text-muted-foreground/40 shrink-0">→</span>
              <span className={cn(
                "font-bold leading-tight truncate min-w-0 text-[11px]",
                isRemapDisabled ? "text-muted-foreground" : "text-foreground"
              )}>
                {remapTargetLabel}
              </span>
            </div>
          )
        ) : (
          <span className={cn(
            "font-semibold leading-none truncate max-w-full text-[11px]",
            !finger && "text-muted-foreground"
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
                  "rounded px-1 py-0 leading-none text-[8px]",
                  chipClass
                )}
              >
                {getShortActionLabel(binding.action)}
              </span>
            ))}
          </div>
        )}
      </button>
    );

    // カスタムボタンは常に表示、通常ボタンは情報があるときのみ。
    const info: KeyInfoData = {
      title: isCustom ? button.label : getKeyLabel(button.code),
      bindings: bindings.map((b) => ({ action: b.action, category: b.category })),
      remaps: remap ? [remap] : [],
      finger: showFingerAssignments ? finger : undefined,
    };
    return (
      <KeyInfoTrigger key={button.code} info={info} alwaysShow={isCustom}>
        {buttonElement}
      </KeyInfoTrigger>
    );
  };

  // カスタムマウスボタンをフィルタ
  const customMouseButtons = customButtons.filter((cb) => cb.category === "mouse");

  return (
    <TooltipProvider delayDuration={200}>
      <div className={cn("inline-block", className)}>
        <div className="flex flex-col" style={{ gap: `${gap * 2}px` }}>
          <div className="flex items-start" style={{ gap: `${gap}px` }}>
            {/* 左側: サイドボタン縦並び */}
            <div className="flex flex-col" style={{ gap: `${gap}px` }}>
              {renderButton(buttons[3], 3)}
              {renderButton(buttons[4], 4)}
            </div>
            {/* 右側: 左・中・右クリック横並び */}
            <div className="flex" style={{ gap: `${gap}px` }}>
              {renderButton(buttons[0], 0)}
              {renderButton(buttons[2], 2)}
              {renderButton(buttons[1], 1)}
            </div>
          </div>
          {/* カスタムマウスボタン */}
          {customMouseButtons.length > 0 && (
            <div className="flex flex-wrap" style={{ gap: `${gap}px` }}>
              {customMouseButtons.map((cb, index) =>
                renderButton({ code: cb.code, label: cb.label }, buttons.length + index, true)
              )}
            </div>
          )}
        </div>
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
  highlightedKeys = [],
  onKeyClick,
  className,
  showActionLabels = false,
  showFingerAssignments = false,
  showRemaps = false,
  useDefaultFingerAssignments = false,
}: VirtualNumpadProps) {
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
  const getFingerForKey = (keyCode: string): FingerType | undefined => {
    const normalized = normalizeKeyCode(keyCode);
    const fingers = effectiveFingerAssignments[normalized] ||
                   effectiveFingerAssignments[keyCode] ||
                   effectiveFingerAssignments[keyCode.toLowerCase()];
    return fingers?.[0];
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
    const finger = getFingerForKey(key.code);
    const remap = showRemaps ? getRemapForKey(key.code) : undefined;
    const isHighlighted = highlightedKeys.includes(key.code);
    const displayLabel = key.label || getKeyLabel(key.code);

    const fingerKeyClass = showFingerAssignments && finger
      ? FINGER_KEY_COLORS[finger]
      : "";
    const chipClass = showFingerAssignments && finger
      ? FINGER_CHIP_COLORS[finger]
      : "bg-foreground/80 text-background";

    const showAction = showActionLabels && bindings.length > 0;
    // リマップ先の表示ラベル
    const remapTargetLabel = remap ? getRemapOutputLabel(remap) : null;
    const isRemapDisabled = remap?.targetKey === null;

    const ariaLabel = buildKeyAriaLabel({
      displayLabel,
      bindings,
      remaps: remap ? [remap] : [],
    });

    const keyElement = (
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={() => onKeyClick?.(key.code)}
        className={cn(
          "relative flex flex-col items-center justify-center rounded-md border-2 transition-colors",
          "font-medium select-none gap-0.5 px-1",
          showFingerAssignments && finger
            ? fingerKeyClass
            : "bg-secondary/50 border-border/50 text-muted-foreground hover:bg-secondary",
          isHighlighted && "ring-2 ring-primary ring-offset-1 ring-offset-background",
          onKeyClick && "cursor-pointer hover:border-primary/50 hover:bg-secondary/80 active:bg-secondary"
        )}
        style={{
          width: `${width}px`,
          height: `${height}px`,
        }}
      >
        {remap ? (
          <div className="flex flex-nowrap items-center justify-center gap-0.5 min-w-0 max-w-full">
            <span className="font-medium leading-none truncate min-w-0 text-[9px] text-muted-foreground/50">
              {displayLabel}
            </span>
            <span className="leading-none text-[9px] text-muted-foreground/40 shrink-0">→</span>
            <span className={cn(
              "font-bold leading-tight truncate min-w-0 text-[11px]",
              isRemapDisabled ? "text-muted-foreground" : "text-foreground"
            )}>
              {remapTargetLabel}
            </span>
          </div>
        ) : (
          <span className={cn(
            "font-semibold leading-none truncate max-w-full text-[11px]",
            !(showFingerAssignments && finger) && "text-muted-foreground"
          )}>
            {displayLabel}
          </span>
        )}
        {showAction && (
          <div className="flex flex-wrap justify-center gap-0.5 max-w-full">
            {bindings.map((binding, i) => (
              <span key={i} className={cn(
                "rounded px-1 py-0 leading-none text-[8px]",
                chipClass
              )}>
                {getShortActionLabel(binding.action)}
              </span>
            ))}
          </div>
        )}
      </button>
    );

    const info: KeyInfoData = {
      title: getKeyLabel(key.code),
      bindings: bindings.map((b) => ({ action: b.action, category: b.category })),
      remaps: remap ? [remap] : [],
      finger: showFingerAssignments ? finger : undefined,
    };
    return (
      <KeyInfoTrigger key={`${rowIndex}-${keyIndex}`} info={info}>
        {keyElement}
      </KeyInfoTrigger>
    );
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className={cn("inline-block", className)}>
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
      </div>
    </TooltipProvider>
  );
}

// 指割り当て凡例コンポーネント
export function FingerLegend({ className }: { className?: string }) {
  const fingers: { key: FingerColorName; label: string }[] = [
    { key: "pinky", label: "小指" },
    { key: "ring", label: "薬指" },
    { key: "middle", label: "中指" },
    { key: "index", label: "人差指" },
    { key: "thumb", label: "親指" },
  ];

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {fingers.map(({ key, label }) => (
        <div key={key} className="flex items-center gap-1">
          <div
            className={cn(
              "w-3 h-3 rounded-full",
              FINGER_BG_COLORS[key]
            )}
          />
          <span className="text-[11px] text-muted-foreground">{label}</span>
        </div>
      ))}
    </div>
  );
}

export const VirtualKeyboard = memo(VirtualKeyboardComponent);
