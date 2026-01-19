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
  // UI
  togglePerspective: "視点",
  fullscreen: "全画面",
  chat: "チャット",
  command: "コマンド",
};

// キーコードを表示名に変換
export const KEY_CODE_LABELS: Record<string, string> = {
  // マウス
  Mouse0: "左クリック",
  Mouse1: "右クリック",
  Mouse2: "中クリック",
  Mouse3: "サイド1",
  Mouse4: "サイド2",
  // 特殊キー
  Space: "スペース",
  ControlLeft: "左Ctrl",
  ControlRight: "右Ctrl",
  ShiftLeft: "左Shift",
  ShiftRight: "右Shift",
  AltLeft: "左Alt",
  AltRight: "右Alt",
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
  // 記号
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

// Minecraft形式 → JavaScript KeyboardEvent.code形式 変換マッピング
const MINECRAFT_TO_JS_KEYCODE: Record<string, string> = {
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
  // ファンクションキー
  "key.keyboard.f1": "F1",
  "key.keyboard.f2": "F2",
  "key.keyboard.f3": "F3",
  "key.keyboard.f4": "F4",
  "key.keyboard.f5": "F5",
  "key.keyboard.f6": "F6",
  "key.keyboard.f7": "F7",
  "key.keyboard.f8": "F8",
  "key.keyboard.f9": "F9",
  "key.keyboard.f10": "F10",
  "key.keyboard.f11": "F11",
  "key.keyboard.f12": "F12",
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
};

/**
 * Minecraft形式のキーコードをJavaScript KeyboardEvent.code形式に正規化
 * 例: "key.keyboard.w" → "KeyW", "key.mouse.left" → "Mouse0"
 */
export function normalizeKeyCode(keyCode: string): string {
  const lowerKeyCode = keyCode.toLowerCase();

  // Minecraft形式のマッピングをチェック
  if (MINECRAFT_TO_JS_KEYCODE[lowerKeyCode]) {
    return MINECRAFT_TO_JS_KEYCODE[lowerKeyCode];
  }

  // key.keyboard.X 形式で単一文字キーの場合（例: key.keyboard.w → KeyW）
  const keyboardMatch = lowerKeyCode.match(/^key\.keyboard\.([a-z])$/);
  if (keyboardMatch) {
    return `Key${keyboardMatch[1].toUpperCase()}`;
  }

  // key.keyboard.X 形式で数字キーの場合（例: key.keyboard.1 → Digit1）
  const digitMatch = lowerKeyCode.match(/^key\.keyboard\.(\d)$/);
  if (digitMatch) {
    return `Digit${digitMatch[1]}`;
  }

  // key.keyboard.keypad.X 形式（例: key.keyboard.keypad.1 → Numpad1）
  const numpadMatch = lowerKeyCode.match(/^key\.keyboard\.keypad\.(\d)$/);
  if (numpadMatch) {
    return `Numpad${numpadMatch[1]}`;
  }

  // すでにJavaScript形式の場合はそのまま返す
  return keyCode;
}

// KEY.KEYBOARD.X / KEY.MOUSE.X 形式のキーコードマッピング
const MINECRAFT_KEY_LABELS: Record<string, string> = {
  // マウス
  "key.mouse.left": "左クリック",
  "key.mouse.right": "右クリック",
  "key.mouse.middle": "中クリック",
  "key.mouse.4": "サイド1",
  "key.mouse.5": "サイド2",
  // 特殊キー
  "key.keyboard.space": "スペース",
  "key.keyboard.left.control": "左Ctrl",
  "key.keyboard.right.control": "右Ctrl",
  "key.keyboard.left.shift": "左Shift",
  "key.keyboard.right.shift": "右Shift",
  "key.keyboard.left.alt": "左Alt",
  "key.keyboard.right.alt": "右Alt",
  "key.keyboard.tab": "Tab",
  "key.keyboard.caps.lock": "CapsLock",
  "key.keyboard.escape": "Esc",
  "key.keyboard.enter": "Enter",
  "key.keyboard.backspace": "Backspace",
  "key.keyboard.delete": "Delete",
  "key.keyboard.insert": "Insert",
  "key.keyboard.home": "Home",
  "key.keyboard.end": "End",
  "key.keyboard.page.up": "PageUp",
  "key.keyboard.page.down": "PageDown",
  "key.keyboard.up": "↑",
  "key.keyboard.down": "↓",
  "key.keyboard.left": "←",
  "key.keyboard.right": "→",
  // ファンクションキー
  "key.keyboard.f1": "F1",
  "key.keyboard.f2": "F2",
  "key.keyboard.f3": "F3",
  "key.keyboard.f4": "F4",
  "key.keyboard.f5": "F5",
  "key.keyboard.f6": "F6",
  "key.keyboard.f7": "F7",
  "key.keyboard.f8": "F8",
  "key.keyboard.f9": "F9",
  "key.keyboard.f10": "F10",
  "key.keyboard.f11": "F11",
  "key.keyboard.f12": "F12",
  // 記号
  "key.keyboard.slash": "/",
  "key.keyboard.backslash": "\\",
  "key.keyboard.minus": "-",
  "key.keyboard.equal": "=",
  "key.keyboard.left.bracket": "[",
  "key.keyboard.right.bracket": "]",
  "key.keyboard.semicolon": ";",
  "key.keyboard.apostrophe": "'",
  "key.keyboard.comma": ",",
  "key.keyboard.period": ".",
  "key.keyboard.grave.accent": "`",
};

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
 * @param keyCode キーコード
 * @param keyboardLayout キーボード配列 ("jis" | "us" | null)、nullの場合はUSとして扱う
 */
export function getKeyLabel(keyCode: string, keyboardLayout: string | null = null): string {
  // 小文字に統一して検索
  const lowerKeyCode = keyCode.toLowerCase();

  // KEY.KEYBOARD.X / KEY.MOUSE.X 形式（Minecraftの形式）
  if (MINECRAFT_KEY_LABELS[lowerKeyCode]) {
    return MINECRAFT_KEY_LABELS[lowerKeyCode];
  }

  // key.keyboard.X 形式で単一文字キーの場合（例: key.keyboard.w → W）
  const keyboardMatch = lowerKeyCode.match(/^key\.keyboard\.([a-z0-9])$/);
  if (keyboardMatch) {
    return keyboardMatch[1].toUpperCase();
  }

  // キーボード配列による違いを適用（正規化されたキーコードで判定）
  const normalizedKeyCode = normalizeKeyCode(keyCode);
  const layoutLabels = keyboardLayout === "jis" ? JIS_KEY_LABELS : US_KEY_LABELS;
  if (layoutLabels[normalizedKeyCode]) {
    return layoutLabels[normalizedKeyCode];
  }

  // 既知のキーコードの場合（旧形式）
  if (KEY_CODE_LABELS[keyCode]) {
    return KEY_CODE_LABELS[keyCode];
  }

  // KeyX形式の場合（例: KeyW → W）
  if (keyCode.startsWith("Key")) {
    return keyCode.slice(3);
  }

  // DigitX形式の場合（例: Digit1 → 1）
  if (keyCode.startsWith("Digit")) {
    return keyCode.slice(5);
  }

  // NumpadX形式の場合（例: Numpad1 → Num1）
  if (keyCode.startsWith("Numpad")) {
    return "Num" + keyCode.slice(6);
  }

  // Mouse0/Mouse1形式
  if (keyCode.startsWith("Mouse")) {
    const num = keyCode.slice(5);
    if (num === "0") return "左クリック";
    if (num === "1") return "右クリック";
    if (num === "2") return "中クリック";
    return `マウス${num}`;
  }

  // その他はそのまま返す
  return keyCode;
}

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
