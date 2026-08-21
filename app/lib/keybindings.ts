import type { MessageKey, Translator } from "@/lib/messages";
// =====================================
// 定数
// =====================================

/** 不使用・割り当てなしを表す特殊キーコード */
export const UNBOUND_KEY = "_UNBOUND";

/** キーコードが不使用かどうかを判定 */
export function isUnbound(keyCode: string | null | undefined): boolean {
  return keyCode === UNBOUND_KEY;
}

// =====================================
// アクションラベル
// =====================================

// アクション名 → 翻訳キー。文言は pages-ja.ts / pages-en.ts の actionLabels / shortActionLabels
// （モジュール評価時はロケールが未確定なので、ここでは文言そのものを持たない）
const ACTION_LABEL_KEYS = {
  forward: "actionLabels.forward",
  back: "actionLabels.back",
  left: "actionLabels.left",
  right: "actionLabels.right",
  jump: "actionLabels.jump",
  sneak: "actionLabels.sneak",
  sprint: "actionLabels.sprint",
  attack: "actionLabels.attack",
  use: "actionLabels.use",
  pickBlock: "actionLabels.pickBlock",
  drop: "actionLabels.drop",
  inventory: "actionLabels.inventory",
  swapHands: "actionLabels.swapHands",
  hotbar1: "actionLabels.hotbar1",
  hotbar2: "actionLabels.hotbar2",
  hotbar3: "actionLabels.hotbar3",
  hotbar4: "actionLabels.hotbar4",
  hotbar5: "actionLabels.hotbar5",
  hotbar6: "actionLabels.hotbar6",
  hotbar7: "actionLabels.hotbar7",
  hotbar8: "actionLabels.hotbar8",
  hotbar9: "actionLabels.hotbar9",
  hotbarLeft: "actionLabels.hotbarLeft",
  hotbarRight: "actionLabels.hotbarRight",
  togglePerspective: "actionLabels.togglePerspective",
  fullscreen: "actionLabels.fullscreen",
  chat: "actionLabels.chat",
  command: "actionLabels.command",
} as const satisfies Record<string, MessageKey>;

/** チップ表示用の短縮ラベル（幅が限られる箇所で使う） */
const SHORT_ACTION_LABEL_KEYS = {
  forward: "shortActionLabels.forward",
  back: "shortActionLabels.back",
  left: "shortActionLabels.left",
  right: "shortActionLabels.right",
  jump: "shortActionLabels.jump",
  sneak: "shortActionLabels.sneak",
  sprint: "shortActionLabels.sprint",
  attack: "shortActionLabels.attack",
  use: "shortActionLabels.use",
  pickBlock: "shortActionLabels.pickBlock",
  drop: "shortActionLabels.drop",
  inventory: "shortActionLabels.inventory",
  swapHands: "shortActionLabels.swapHands",
  hotbar1: "shortActionLabels.hotbar1",
  hotbar2: "shortActionLabels.hotbar2",
  hotbar3: "shortActionLabels.hotbar3",
  hotbar4: "shortActionLabels.hotbar4",
  hotbar5: "shortActionLabels.hotbar5",
  hotbar6: "shortActionLabels.hotbar6",
  hotbar7: "shortActionLabels.hotbar7",
  hotbar8: "shortActionLabels.hotbar8",
  hotbar9: "shortActionLabels.hotbar9",
  hotbarLeft: "shortActionLabels.hotbarLeft",
  hotbarRight: "shortActionLabels.hotbarRight",
  togglePerspective: "shortActionLabels.togglePerspective",
  fullscreen: "shortActionLabels.fullscreen",
  chat: "shortActionLabels.chat",
  command: "shortActionLabels.command",
} as const satisfies Record<string, MessageKey>;

// =====================================
// キーコード正規化・表示ラベル
// =====================================

// JavaScript KeyboardEvent.code形式のキーコード → 表示名
// 正規化後の形式（PascalCase）で定義
export const KEY_CODE_LABELS: Record<string, string> = {
  // マウス
  Mouse0: "",  // → keyLabels.mouseLeft
  Mouse1: "",  // → keyLabels.mouseRight
  Mouse2: "",  // → keyLabels.mouseMiddle
  Mouse3: "",  // → keyLabels.mouseSide1
  Mouse4: "",  // → keyLabels.mouseSide2
  // コントローラー
  GamepadA: "A",
  GamepadB: "B",
  GamepadX: "X",
  GamepadY: "Y",
  GamepadLB: "LB",
  GamepadRB: "RB",
  GamepadLT: "LT",
  GamepadRT: "RT",
  GamepadL3: "L3",
  GamepadR3: "R3",
  GamepadDpadUp: "D-Pad↑",
  GamepadDpadDown: "D-Pad↓",
  GamepadDpadLeft: "D-Pad←",
  GamepadDpadRight: "D-Pad→",
  GamepadStart: "Start",
  GamepadSelect: "Select",
  // 特殊キー
  Space: "Space",
  ControlLeft: "",  // → keyLabels.ctrlLeft
  ControlRight: "",  // → keyLabels.ctrlRight
  ShiftLeft: "",  // → keyLabels.shiftLeft
  ShiftRight: "",  // → keyLabels.shiftRight
  AltLeft: "",  // → keyLabels.altLeft
  AltRight: "",  // → keyLabels.altRight
  MetaLeft: "",  // → keyLabels.winLeft
  MetaRight: "",  // → keyLabels.winRight
  Tab: "Tab",
  CapsLock: "CapsLock",
  Escape: "Esc",
  Enter: "Enter",
  Backspace: "BS",
  Delete: "Delete",
  Insert: "Insert",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  // ファンクションキー
  F1: "F1",
  F2: "F2",
  F3: "F3",
  F4: "F4",
  F5: "F5",
  F6: "F6",
  F7: "F7",
  F8: "F8",
  F9: "F9",
  F10: "F10",
  F11: "F11",
  F12: "F12",
  // 記号（US配列デフォルト）
  Slash: "/",
  Backslash: "\\",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Backquote: "`",
  // テンキー
  NumpadEnter: "Num Enter",
  NumpadAdd: "Num +",
  NumpadSubtract: "Num -",
  NumpadMultiply: "Num *",
  NumpadDivide: "Num /",
  NumpadDecimal: "Num .",
  NumLock: "NumLock",
};

/** KEY_CODE_LABELS のうち翻訳が必要なものの上書き（英数キーは翻訳不要なので持たない） */
const KEY_LABEL_KEY_OVERRIDES: Record<string, MessageKey> = {
  Mouse0: "keyLabels.mouseLeft",
  Mouse1: "keyLabels.mouseRight",
  Mouse2: "keyLabels.mouseMiddle",
  Mouse3: "keyLabels.mouseSide1",
  Mouse4: "keyLabels.mouseSide2",
  ControlLeft: "keyLabels.ctrlLeft",
  ControlRight: "keyLabels.ctrlRight",
  ShiftLeft: "keyLabels.shiftLeft",
  ShiftRight: "keyLabels.shiftRight",
  AltLeft: "keyLabels.altLeft",
  AltRight: "keyLabels.altRight",
  MetaLeft: "keyLabels.winLeft",
  MetaRight: "keyLabels.winRight",
};

/** JIS 配列だけ翻訳が要るキー */
const JIS_KEY_LABEL_KEY_OVERRIDES: Record<string, MessageKey> = {
  Backquote: "keyLabels.hankaku",
};

/**
 * アクション名を表示用ラベルに変換
 */
export function getActionLabel(t: Translator, action: string): string {
  const key = ACTION_LABEL_KEYS[action as keyof typeof ACTION_LABEL_KEYS];
  return key ? t(key) : action;
}

/**
 * アクション名を短縮ラベルに変換（チップ用）
 */
export function getShortActionLabel(t: Translator, action: string): string {
  const key = SHORT_ACTION_LABEL_KEYS[action as keyof typeof SHORT_ACTION_LABEL_KEYS];
  return key ? t(key) : action;
}

// =====================================
// キーコード正規化
// =====================================

// Minecraft形式 → JavaScript KeyboardEvent.code形式 変換マッピング
// 特殊キー・記号など正規表現でカバーできないものを定義
const MINECRAFT_SPECIAL_KEYS: Record<string, string> = {
  // マウス
  "key.mouse.left": "Mouse0",
  "key.mouse.right": "Mouse1",
  "key.mouse.middle": "Mouse2",
  "key.mouse.4": "Mouse3",
  "key.mouse.5": "Mouse4",
  // 特殊キー
  "key.keyboard.space": "Space",
  "key.keyboard.left.control": "ControlLeft",
  "key.keyboard.right.control": "ControlRight",
  "key.keyboard.left.shift": "ShiftLeft",
  "key.keyboard.right.shift": "ShiftRight",
  "key.keyboard.left.alt": "AltLeft",
  "key.keyboard.right.alt": "AltRight",
  "key.keyboard.left.win": "MetaLeft",
  "key.keyboard.right.win": "MetaRight",
  "key.keyboard.tab": "Tab",
  "key.keyboard.caps.lock": "CapsLock",
  "key.keyboard.escape": "Escape",
  "key.keyboard.enter": "Enter",
  "key.keyboard.backspace": "Backspace",
  "key.keyboard.delete": "Delete",
  "key.keyboard.insert": "Insert",
  "key.keyboard.home": "Home",
  "key.keyboard.end": "End",
  "key.keyboard.page.up": "PageUp",
  "key.keyboard.page.down": "PageDown",
  "key.keyboard.up": "ArrowUp",
  "key.keyboard.down": "ArrowDown",
  "key.keyboard.left": "ArrowLeft",
  "key.keyboard.right": "ArrowRight",
  // 記号
  "key.keyboard.slash": "Slash",
  "key.keyboard.backslash": "Backslash",
  "key.keyboard.minus": "Minus",
  "key.keyboard.equal": "Equal",
  "key.keyboard.left.bracket": "BracketLeft",
  "key.keyboard.right.bracket": "BracketRight",
  "key.keyboard.semicolon": "Semicolon",
  "key.keyboard.apostrophe": "Quote",
  "key.keyboard.comma": "Comma",
  "key.keyboard.period": "Period",
  "key.keyboard.grave.accent": "Backquote",
  // テンキー記号
  "key.keyboard.keypad.enter": "NumpadEnter",
  "key.keyboard.keypad.add": "NumpadAdd",
  "key.keyboard.keypad.subtract": "NumpadSubtract",
  "key.keyboard.keypad.multiply": "NumpadMultiply",
  "key.keyboard.keypad.divide": "NumpadDivide",
  "key.keyboard.keypad.decimal": "NumpadDecimal",
  "key.keyboard.num.lock": "NumLock",
};

// 大文字/小文字混在のキーコードを正規化（PascalCase）するためのマッピング
// 正規表現で対応できない特殊ケースのみ
const NORMALIZE_SPECIAL_KEYS: Record<string, string> = {
  // 単一ワード
  space: "Space",
  tab: "Tab",
  enter: "Enter",
  escape: "Escape",
  backspace: "Backspace",
  delete: "Delete",
  insert: "Insert",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
  capslock: "CapsLock",
  numlock: "NumLock",
  // 矢印
  arrowup: "ArrowUp",
  arrowdown: "ArrowDown",
  arrowleft: "ArrowLeft",
  arrowright: "ArrowRight",
  // 記号
  slash: "Slash",
  backslash: "Backslash",
  minus: "Minus",
  equal: "Equal",
  bracketleft: "BracketLeft",
  bracketright: "BracketRight",
  semicolon: "Semicolon",
  quote: "Quote",
  comma: "Comma",
  period: "Period",
  backquote: "Backquote",
  // テンキー記号
  numpadenter: "NumpadEnter",
  numpadadd: "NumpadAdd",
  numpadsubtract: "NumpadSubtract",
  numpadmultiply: "NumpadMultiply",
  numpaddivide: "NumpadDivide",
  numpaddecimal: "NumpadDecimal",
};

/**
 * 様々な形式のキーコードをJavaScript KeyboardEvent.code形式（PascalCase）に正規化
 *
 * 対応形式:
 * - Minecraft形式: "key.keyboard.w", "key.mouse.left"
 * - 大文字形式: "KEYW", "CONTROLLEFT", "SPACE"
 * - PascalCase形式: "KeyW", "ControlLeft" (そのまま)
 *
 * @example
 * normalizeKeyCode("key.keyboard.w") // => "KeyW"
 * normalizeKeyCode("KEYW") // => "KeyW"
 * normalizeKeyCode("KeyW") // => "KeyW"
 * normalizeKeyCode("CONTROLLEFT") // => "ControlLeft"
 */
export function normalizeKeyCode(keyCode: string): string {
  const lowerKeyCode = keyCode.toLowerCase();

  // 1. Minecraft形式の特殊キーマッピング
  if (MINECRAFT_SPECIAL_KEYS[lowerKeyCode]) {
    return MINECRAFT_SPECIAL_KEYS[lowerKeyCode];
  }

  // 2. Minecraft形式のパターンマッチング
  // key.keyboard.X（単一文字）→ KeyX
  const mcKeyMatch = lowerKeyCode.match(/^key\.keyboard\.([a-z])$/);
  if (mcKeyMatch) {
    return `Key${mcKeyMatch[1].toUpperCase()}`;
  }

  // key.keyboard.X（数字）→ DigitX
  const mcDigitMatch = lowerKeyCode.match(/^key\.keyboard\.(\d)$/);
  if (mcDigitMatch) {
    return `Digit${mcDigitMatch[1]}`;
  }

  // key.keyboard.fX → FX
  const mcFKeyMatch = lowerKeyCode.match(/^key\.keyboard\.f(\d+)$/);
  if (mcFKeyMatch) {
    return `F${mcFKeyMatch[1]}`;
  }

  // key.keyboard.keypad.X（数字）→ NumpadX
  const mcNumpadMatch = lowerKeyCode.match(/^key\.keyboard\.keypad\.(\d)$/);
  if (mcNumpadMatch) {
    return `Numpad${mcNumpadMatch[1]}`;
  }

  // 3. 特殊キーの正規化（大文字/小文字混在対応）
  if (NORMALIZE_SPECIAL_KEYS[lowerKeyCode]) {
    return NORMALIZE_SPECIAL_KEYS[lowerKeyCode];
  }

  // 4. パターンによる正規化
  // keyX → KeyX (例: keyw, KEYW → KeyW)
  const keyMatch = lowerKeyCode.match(/^key([a-z])$/);
  if (keyMatch) {
    return `Key${keyMatch[1].toUpperCase()}`;
  }

  // digitX → DigitX (例: digit1, DIGIT1 → Digit1)
  const digitMatch = lowerKeyCode.match(/^digit(\d)$/);
  if (digitMatch) {
    return `Digit${digitMatch[1]}`;
  }

  // numpadX → NumpadX (例: numpad1, NUMPAD1 → Numpad1)
  const numpadMatch = lowerKeyCode.match(/^numpad(\d)$/);
  if (numpadMatch) {
    return `Numpad${numpadMatch[1]}`;
  }

  // modifierLeft/Right (例: controlleft, SHIFTRIGHT → ControlLeft, ShiftRight)
  const modifierMatch = lowerKeyCode.match(/^(control|shift|alt|meta)(left|right)$/);
  if (modifierMatch) {
    const [, modifier, side] = modifierMatch;
    return modifier.charAt(0).toUpperCase() + modifier.slice(1) +
      side.charAt(0).toUpperCase() + side.slice(1);
  }

  // mouseX → MouseX
  const mouseMatch = lowerKeyCode.match(/^mouse(\d)$/);
  if (mouseMatch) {
    return `Mouse${mouseMatch[1]}`;
  }

  // gamepadX → GamepadX (コントローラーボタン)
  const gamepadMatch = lowerKeyCode.match(/^gamepad(.+)$/);
  if (gamepadMatch) {
    const button = gamepadMatch[1];
    // 既知のボタン名を正規化
    const buttonMap: Record<string, string> = {
      a: "A", b: "B", x: "X", y: "Y",
      lb: "LB", rb: "RB", lt: "LT", rt: "RT",
      l3: "L3", r3: "R3",
      dpadup: "DpadUp", dpaddown: "DpadDown",
      dpadleft: "DpadLeft", dpadright: "DpadRight",
      start: "Start", select: "Select",
    };
    const normalizedButton = buttonMap[button.toLowerCase()] || button;
    return `Gamepad${normalizedButton}`;
  }

  // fX → FX (例: f1, F12 → F1, F12)
  const fKeyMatch = lowerKeyCode.match(/^f(\d+)$/);
  if (fKeyMatch) {
    return `F${fKeyMatch[1]}`;
  }

  // 5. すでにPascalCase形式の場合はそのまま返す
  return keyCode;
}

/**
 * 2つのキーコードが同じキーを指しているかを比較
 * 大文字/小文字/Minecraft形式の違いを吸収して比較
 *
 * @example
 * keysEqual("KeyW", "KEYW") // => true
 * keysEqual("KeyW", "key.keyboard.w") // => true
 * keysEqual("ControlLeft", "CONTROLLEFT") // => true
 */
export function keysEqual(keyCode1: string, keyCode2: string): boolean {
  return normalizeKeyCode(keyCode1) === normalizeKeyCode(keyCode2);
}

// =====================================
// キーボード配列別ラベル
// =====================================

// JIS配列とUS配列で異なるキーのマッピング
const JIS_KEY_LABELS: Record<string, string> = {
  Semicolon: ":",
  Quote: "^",
  BracketLeft: "@",
  BracketRight: "[",
  Backslash: "]",
  Backquote: "",  // → keyLabels.hankaku
};

const US_KEY_LABELS: Record<string, string> = {
  Semicolon: ";",
  Quote: "'",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Backquote: "`",
};

/**
 * キーコードを表示用ラベルに変換
 *
 * どの形式のキーコードでも適切な表示名に変換する
 * - Minecraft形式: "key.keyboard.w" → "W"
 * - 大文字形式: "KEYW" → "W"
 * - PascalCase形式: "KeyW" → "W"
 *
 * @param keyCode キーコード（任意の形式）
 * @param keyboardLayout キーボード配列 ("jis" | "us" | null)
 */
export function getKeyLabel(
  t: Translator,
  keyCode: string,
  keyboardLayout: string | null = null,
): string {
  // 不使用の場合
  if (keyCode === UNBOUND_KEY) {
    return "-";
  }

  // まず正規化（Minecraft形式、大文字形式などをPascalCaseに統一）
  const normalized = normalizeKeyCode(keyCode);

  // キーボード配列による違いを適用（JIS の半角キーだけ翻訳が要る）
  const isJis = keyboardLayout === "jis";
  if (isJis && JIS_KEY_LABEL_KEY_OVERRIDES[normalized]) {
    return t(JIS_KEY_LABEL_KEY_OVERRIDES[normalized]);
  }
  const layoutLabels = isJis ? JIS_KEY_LABELS : US_KEY_LABELS;
  if (layoutLabels[normalized]) {
    return layoutLabels[normalized];
  }

  // 翻訳が要るキー名（左Ctrl / 左クリック 等）を先に見る
  if (KEY_LABEL_KEY_OVERRIDES[normalized]) {
    return t(KEY_LABEL_KEY_OVERRIDES[normalized]);
  }

  // 既知のキーコードの場合
  if (KEY_CODE_LABELS[normalized]) {
    return KEY_CODE_LABELS[normalized];
  }

  // KeyX形式の場合（例: KeyW → W）
  if (normalized.startsWith("Key")) {
    return normalized.slice(3);
  }

  // DigitX形式の場合（例: Digit1 → 1）
  if (normalized.startsWith("Digit")) {
    return normalized.slice(5);
  }

  // NumpadX形式の場合（例: Numpad1 → Num1）
  if (normalized.startsWith("Numpad")) {
    return "Num" + normalized.slice(6);
  }

  // その他は正規化後の値を返す
  return normalized;
}

// =====================================
// 指の割り当て
// =====================================

// 指の種類定義
export type FingerType =
  | "left-pinky"
  | "left-ring"
  | "left-middle"
  | "left-index"
  | "left-thumb"
  | "right-thumb"
  | "right-index"
  | "right-middle"
  | "right-ring"
  | "right-pinky";

// 指のラベル
const FINGER_LABEL_KEYS: Record<FingerType, MessageKey> = {
  "left-pinky": "fingerLabels.leftPinky",
  "left-ring": "fingerLabels.leftRing",
  "left-middle": "fingerLabels.leftMiddle",
  "left-index": "fingerLabels.leftIndex",
  "left-thumb": "fingerLabels.leftThumb",
  "right-thumb": "fingerLabels.rightThumb",
  "right-index": "fingerLabels.rightIndex",
  "right-middle": "fingerLabels.rightMiddle",
  "right-ring": "fingerLabels.rightRing",
  "right-pinky": "fingerLabels.rightPinky",
};

/** 指割り当ての表示名。描画時に解決する */
export function getFingerLabel(t: Translator, finger: FingerType): string {
  return t(FINGER_LABEL_KEYS[finger]);
}

// デフォルトの指割り当て（一般的なWASD配置）
export const DEFAULT_FINGER_ASSIGNMENTS: Record<string, FingerType[]> = {
  // 左手小指
  Tab: ["left-pinky"],
  CapsLock: ["left-pinky"],
  ShiftLeft: ["left-pinky"],
  ControlLeft: ["left-pinky"],
  Backquote: ["left-pinky"],
  Digit1: ["left-pinky"],
  KeyQ: ["left-pinky"],
  KeyA: ["left-pinky"],
  KeyZ: ["left-pinky"],

  // 左手薬指
  Digit2: ["left-ring"],
  KeyW: ["left-ring"],
  KeyS: ["left-ring"],
  KeyX: ["left-ring"],

  // 左手中指
  Digit3: ["left-middle"],
  KeyE: ["left-middle"],
  KeyD: ["left-middle"],
  KeyC: ["left-middle"],

  // 左手人差指
  Digit4: ["left-index"],
  Digit5: ["left-index"],
  KeyR: ["left-index"],
  KeyT: ["left-index"],
  KeyF: ["left-index"],
  KeyG: ["left-index"],
  KeyV: ["left-index"],
  KeyB: ["left-index"],

  // 左手親指
  Space: ["left-thumb"],
  AltLeft: ["left-thumb"],

  // 右手親指
  AltRight: ["right-thumb"],

  // 右手人差指
  Digit6: ["right-index"],
  Digit7: ["right-index"],
  KeyY: ["right-index"],
  KeyU: ["right-index"],
  KeyH: ["right-index"],
  KeyJ: ["right-index"],
  KeyN: ["right-index"],
  KeyM: ["right-index"],

  // 右手中指
  Digit8: ["right-middle"],
  KeyI: ["right-middle"],
  KeyK: ["right-middle"],
  Comma: ["right-middle"],

  // 右手薬指
  Digit9: ["right-ring"],
  KeyO: ["right-ring"],
  KeyL: ["right-ring"],
  Period: ["right-ring"],

  // 右手小指
  Digit0: ["right-pinky"],
  Minus: ["right-pinky"],
  Equal: ["right-pinky"],
  KeyP: ["right-pinky"],
  BracketLeft: ["right-pinky"],
  BracketRight: ["right-pinky"],
  Semicolon: ["right-pinky"],
  Quote: ["right-pinky"],
  Backslash: ["right-pinky"],
  Slash: ["right-pinky"],
  Enter: ["right-pinky"],
  ShiftRight: ["right-pinky"],
  Backspace: ["right-pinky"],

  // マウス（右手）
  Mouse0: ["right-index"],
  Mouse1: ["right-middle"],
  Mouse2: ["right-middle"],
  Mouse3: ["right-thumb"],
  Mouse4: ["right-thumb"],
};

// =====================================
// コントローラー設定
// =====================================

/** コントローラー設定の型定義 */
export type ControllerSettings = {
  controllerModel: string | null;
  lookSensitivity: number | null;
  invertYAxis: boolean;
  vibration: boolean;
};

/** デフォルトコントローラー設定 */
export const DEFAULT_CONTROLLER_SETTINGS: ControllerSettings = {
  controllerModel: null,
  lookSensitivity: 50,
  invertYAxis: false,
  vibration: true,
};

/** コントローラー用アクション一覧（ホットバーはLB/RB方式のみ） */
export const CONTROLLER_ACTIONS = [
  // 移動
  "jump", "sneak", "sprint",
  // 戦闘
  "attack", "use", "pickBlock", "drop",
  // インベントリ
  "inventory", "swapHands", "hotbarLeft", "hotbarRight",
  // UI
  "togglePerspective", "chat",
] as const;

/** キーボード/マウス用アクション一覧 */
export const KEYBOARD_MOUSE_ACTIONS = [
  // 移動
  "forward", "back", "left", "right", "jump", "sneak", "sprint",
  // 戦闘
  "attack", "use", "pickBlock", "drop",
  // インベントリ
  "inventory", "swapHands",
  "hotbar1", "hotbar2", "hotbar3", "hotbar4", "hotbar5",
  "hotbar6", "hotbar7", "hotbar8", "hotbar9",
  // UI
  "togglePerspective", "fullscreen", "chat", "command",
] as const;

/** キーコードがコントローラーボタンかどうかを判定 */
export function isControllerKeyCode(keyCode: string): boolean {
  return keyCode.startsWith("Gamepad");
}

// =====================================
// 修飾キー組み合わせ
// =====================================

/** 修飾キーの型 */
export type Modifier = "Ctrl" | "Shift" | "Alt" | "Meta";

/** 修飾キーの正規化順序 */
export const MODIFIER_ORDER: Modifier[] = ["Ctrl", "Shift", "Alt", "Meta"];

/** 修飾キーの表示ラベル */
export const MODIFIER_LABELS: Record<Modifier, string> = {
  Ctrl: "Ctrl",
  Shift: "Shift",
  Alt: "Alt",
  Meta: "Win",
};

/** キー組み合わせを分解した構造 */
export interface KeyCombination {
  modifiers: Modifier[];
  keyCode: string;
}

/**
 * キー組み合わせ文字列をパースして構造化
 *
 * @example
 * parseKeyCombination("Ctrl+Shift+KeyA")
 * // => { modifiers: ["Ctrl", "Shift"], keyCode: "KeyA" }
 *
 * parseKeyCombination("KeyW")
 * // => { modifiers: [], keyCode: "KeyW" }
 */
export function parseKeyCombination(combo: string): KeyCombination {
  if (!combo || combo === UNBOUND_KEY) {
    return { modifiers: [], keyCode: combo };
  }

  const parts = combo.split("+");
  const modifiers: Modifier[] = [];
  let keyCode = "";

  for (const part of parts) {
    const normalizedPart = part.trim();
    // 修飾キーかどうか判定
    if (MODIFIER_ORDER.includes(normalizedPart as Modifier)) {
      modifiers.push(normalizedPart as Modifier);
    } else {
      // 最後の非修飾キー部分がキーコード
      keyCode = normalizeKeyCode(normalizedPart);
    }
  }

  return { modifiers, keyCode };
}

/**
 * KeyCombination構造をフォーマットして文字列に変換
 * 修飾キーは正規化順序でソート
 *
 * @example
 * formatKeyCombination({ modifiers: ["Shift", "Ctrl"], keyCode: "KeyA" })
 * // => "Ctrl+Shift+KeyA"
 */
export function formatKeyCombination(combo: KeyCombination): string {
  if (!combo.keyCode || combo.keyCode === UNBOUND_KEY) {
    return combo.keyCode;
  }

  const sortedMods = [...combo.modifiers].sort(
    (a, b) => MODIFIER_ORDER.indexOf(a) - MODIFIER_ORDER.indexOf(b)
  );

  if (sortedMods.length === 0) {
    return combo.keyCode;
  }

  return [...sortedMods, combo.keyCode].join("+");
}

/**
 * キー組み合わせ文字列を正規化
 * 修飾キーを正しい順序に並べ、キーコードを正規化
 *
 * @example
 * normalizeKeyCombination("shift+ctrl+keya")
 * // => "Ctrl+Shift+KeyA"
 */
export function normalizeKeyCombination(input: string): string {
  const combo = parseKeyCombination(input);
  return formatKeyCombination(combo);
}

/**
 * キー組み合わせを表示用ラベルに変換
 *
 * @example
 * getKeyCombinationLabel("Ctrl+Shift+KeyA", "us")
 * // => "Ctrl+Shift+A"
 */
export function getKeyCombinationLabel(
  t: Translator,
  combo: string,
  keyboardLayout: string | null = null
): string {
  if (!combo || combo === UNBOUND_KEY) {
    return getKeyLabel(t, combo, keyboardLayout);
  }

  const parsed = parseKeyCombination(combo);

  if (parsed.modifiers.length === 0) {
    return getKeyLabel(t, parsed.keyCode, keyboardLayout);
  }

  const modifierLabels = parsed.modifiers.map((m) => MODIFIER_LABELS[m]);
  const keyLabel = getKeyLabel(t, parsed.keyCode, keyboardLayout);

  return [...modifierLabels, keyLabel].join("+");
}

/**
 * 単一キー（修飾キー組み合わせではない）かどうかを判定
 * リマップ先のバリデーションに使用
 *
 * @example
 * isSingleKey("KeyA") // => true
 * isSingleKey("Ctrl+KeyA") // => false
 */
export function isSingleKey(keyCode: string): boolean {
  if (!keyCode || keyCode === UNBOUND_KEY) {
    return true;
  }
  return !keyCode.includes("+");
}

/**
 * 修飾キー組み合わせかどうかを判定
 *
 * @example
 * hasModifiers("Ctrl+KeyA") // => true
 * hasModifiers("KeyA") // => false
 */
export function hasModifiers(keyCode: string): boolean {
  return !isSingleKey(keyCode);
}

// =====================================
// キーボードレイアウト（配列 × フルサイズ/テンキーレス）
// =====================================

/**
 * バーチャルキーボード（`VirtualKeyboard`）の描画・サーチクラフトのキー入力順ダイアログ等が
 * 選択する物理配列。`app/lib/schema.ts` の `playerConfigs.keyboardLayout` enum と同じ値集合
 * （単一ソース。以前は利用側ごとにインラインの union 型で重複定義されていた）。
 */
export type KeyboardLayout = "US" | "JIS" | "US_TKL" | "JIS_TKL";

export const KEYBOARD_LAYOUT_OPTIONS: KeyboardLayout[] = ["US", "JIS", "US_TKL", "JIS_TKL"];

/** 不明・欠落値は既定の "US" に正規化する */
export function normalizeKeyboardLayout(value: string | null | undefined): KeyboardLayout {
  return KEYBOARD_LAYOUT_OPTIONS.includes(value as KeyboardLayout)
    ? (value as KeyboardLayout)
    : "US";
}
