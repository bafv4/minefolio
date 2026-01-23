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

// キーバインドアクションの日本語ラベル
export const ACTION_LABELS: Record<string, string> = {
  // 移動
  forward: "前進",
  back: "後退",
  left: "左移動",
  right: "右移動",
  jump: "ジャンプ",
  sneak: "スニーク",
  sprint: "ダッシュ",
  // 戦闘
  attack: "攻撃/破壊",
  use: "使用/設置",
  pickBlock: "ブロック選択",
  drop: "アイテムを捨てる",
  // インベントリ
  inventory: "インベントリ",
  swapHands: "オフハンド",
  hotbar1: "ホットバー1",
  hotbar2: "ホットバー2",
  hotbar3: "ホットバー3",
  hotbar4: "ホットバー4",
  hotbar5: "ホットバー5",
  hotbar6: "ホットバー6",
  hotbar7: "ホットバー7",
  hotbar8: "ホットバー8",
  hotbar9: "ホットバー9",
  // コントローラー用ホットバー操作
  hotbarLeft: "ホットバー左",
  hotbarRight: "ホットバー右",
  // UI
  togglePerspective: "視点切替",
  fullscreen: "全画面",
  chat: "チャット",
  command: "コマンド",
};

// キーバインドアクションの短縮ラベル（チップ用）
export const SHORT_ACTION_LABELS: Record<string, string> = {
  // 移動
  forward: "前",
  back: "後",
  left: "左",
  right: "右",
  jump: "ジャンプ",
  sneak: "スニーク",
  sprint: "ダッシュ",
  // 戦闘
  attack: "攻撃",
  use: "使用",
  pickBlock: "選択",
  drop: "捨てる",
  // インベントリ
  inventory: "ｲﾝﾍﾞﾝﾄﾘ",
  swapHands: "OH",
  hotbar1: "HB1",
  hotbar2: "HB2",
  hotbar3: "HB3",
  hotbar4: "HB4",
  hotbar5: "HB5",
  hotbar6: "HB6",
  hotbar7: "HB7",
  hotbar8: "HB8",
  hotbar9: "HB9",
  // コントローラー用ホットバー操作
  hotbarLeft: "HB←",
  hotbarRight: "HB→",
  // UI
  togglePerspective: "視点",
  fullscreen: "全画面",
  chat: "チャット",
  command: "コマンド",
};

// =====================================
// キーコード正規化・表示ラベル
// =====================================

// JavaScript KeyboardEvent.code形式のキーコード → 表示名
// 正規化後の形式（PascalCase）で定義
export const KEY_CODE_LABELS: Record<string, string> = {
  // マウス
  Mouse0: "左クリック",
  Mouse1: "右クリック",
  Mouse2: "中クリック",
  Mouse3: "サイド1",
  Mouse4: "サイド2",
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
  Space: "スペース",
  ControlLeft: "左Ctrl",
  ControlRight: "右Ctrl",
  ShiftLeft: "左Shift",
  ShiftRight: "右Shift",
  AltLeft: "左Alt",
  AltRight: "右Alt",
  MetaLeft: "左Win",
  MetaRight: "右Win",
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

/**
 * アクション名を表示用ラベルに変換
 */
export function getActionLabel(action: string): string {
  return ACTION_LABELS[action] || action;
}

/**
 * アクション名を短縮ラベルに変換（チップ用）
 */
export function getShortActionLabel(action: string): string {
  return SHORT_ACTION_LABELS[action] || action;
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
  Backquote: "半角",
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
export function getKeyLabel(keyCode: string, keyboardLayout: string | null = null): string {
  // 不使用の場合
  if (keyCode === UNBOUND_KEY) {
    return "-";
  }

  // まず正規化（Minecraft形式、大文字形式などをPascalCaseに統一）
  const normalized = normalizeKeyCode(keyCode);

  // キーボード配列による違いを適用
  const layoutLabels = keyboardLayout === "jis" ? JIS_KEY_LABELS : US_KEY_LABELS;
  if (layoutLabels[normalized]) {
    return layoutLabels[normalized];
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
export const FINGER_LABELS: Record<FingerType, string> = {
  "left-pinky": "左小指",
  "left-ring": "左薬指",
  "left-middle": "左中指",
  "left-index": "左人差指",
  "left-thumb": "左親指",
  "right-thumb": "右親指",
  "right-index": "右人差指",
  "right-middle": "右中指",
  "right-ring": "右薬指",
  "right-pinky": "右小指",
};

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

/** コントローラーアクションのカテゴリ */
export type ControllerActionCategory = "movement" | "combat" | "inventory" | "ui";

/** コントローラーキーバインド定義 */
export type ControllerKeybinding = {
  action: string;
  keyCode: string;
  category: ControllerActionCategory;
};

/** デフォルトコントローラーキー配置（Bedrock準拠） */
export const DEFAULT_CONTROLLER_KEYBINDINGS: ControllerKeybinding[] = [
  // 移動（forward/back/left/rightは左スティックで行うため省略）
  { action: "jump", keyCode: "GamepadA", category: "movement" },
  { action: "sneak", keyCode: "GamepadB", category: "movement" },
  { action: "sprint", keyCode: "GamepadL3", category: "movement" },
  // 戦闘
  { action: "attack", keyCode: "GamepadRT", category: "combat" },
  { action: "use", keyCode: "GamepadLT", category: "combat" },
  { action: "pickBlock", keyCode: "GamepadR3", category: "combat" },
  { action: "drop", keyCode: "GamepadDpadDown", category: "inventory" },
  // インベントリ
  { action: "inventory", keyCode: "GamepadY", category: "inventory" },
  { action: "swapHands", keyCode: "GamepadX", category: "inventory" },
  { action: "hotbarLeft", keyCode: "GamepadLB", category: "inventory" },
  { action: "hotbarRight", keyCode: "GamepadRB", category: "inventory" },
  // UI
  { action: "togglePerspective", keyCode: "GamepadDpadUp", category: "ui" },
  { action: "chat", keyCode: "GamepadDpadRight", category: "ui" },
];

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

/** 入力方法ラベル */
export const INPUT_METHOD_LABELS: Record<string, string> = {
  keyboard_mouse: "キーボード/マウス",
  controller: "コントローラー",
  touch: "タッチ",
};

/** 入力方法の短縮ラベル */
export const INPUT_METHOD_SHORT_LABELS: Record<string, string> = {
  keyboard_mouse: "KBM",
  controller: "Controller",
  touch: "Touch",
};
