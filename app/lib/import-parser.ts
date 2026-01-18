import { normalizeKeyCode } from "./keybindings";

// ============================================
// AutoHotkey リマップ解析
// ============================================

export interface ParsedRemap {
  sourceKey: string;
  targetKey: string;
  software: string;
  notes?: string;
}

// AutoHotkey キー名 → JavaScript KeyboardEvent.code形式 マッピング
const AHK_KEY_MAP: Record<string, string> = {
  // アルファベット
  a: "KeyA", b: "KeyB", c: "KeyC", d: "KeyD", e: "KeyE",
  f: "KeyF", g: "KeyG", h: "KeyH", i: "KeyI", j: "KeyJ",
  k: "KeyK", l: "KeyL", m: "KeyM", n: "KeyN", o: "KeyO",
  p: "KeyP", q: "KeyQ", r: "KeyR", s: "KeyS", t: "KeyT",
  u: "KeyU", v: "KeyV", w: "KeyW", x: "KeyX", y: "KeyY",
  z: "KeyZ",

  // 数字
  "0": "Digit0", "1": "Digit1", "2": "Digit2", "3": "Digit3", "4": "Digit4",
  "5": "Digit5", "6": "Digit6", "7": "Digit7", "8": "Digit8", "9": "Digit9",

  // ファンクションキー
  f1: "F1", f2: "F2", f3: "F3", f4: "F4", f5: "F5", f6: "F6",
  f7: "F7", f8: "F8", f9: "F9", f10: "F10", f11: "F11", f12: "F12",

  // 修飾キー
  lctrl: "ControlLeft", rctrl: "ControlRight", ctrl: "ControlLeft",
  lshift: "ShiftLeft", rshift: "ShiftRight", shift: "ShiftLeft",
  lalt: "AltLeft", ralt: "AltRight", alt: "AltLeft",
  lwin: "MetaLeft", rwin: "MetaRight",

  // 特殊キー
  space: "Space",
  tab: "Tab",
  enter: "Enter", return: "Enter",
  escape: "Escape", esc: "Escape",
  backspace: "Backspace", bs: "Backspace",
  delete: "Delete", del: "Delete",
  insert: "Insert", ins: "Insert",
  home: "Home",
  end: "End",
  pgup: "PageUp", pageup: "PageUp",
  pgdn: "PageDown", pagedown: "PageDown",
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  capslock: "CapsLock",
  numlock: "NumLock",
  scrolllock: "ScrollLock",
  printscreen: "PrintScreen",
  pause: "Pause",

  // 記号
  ";": "Semicolon", "::": "Semicolon",
  "'": "Quote",
  ",": "Comma",
  ".": "Period",
  "/": "Slash",
  "\\": "Backslash",
  "[": "BracketLeft",
  "]": "BracketRight",
  "-": "Minus",
  "=": "Equal",
  "`": "Backquote",

  // テンキー
  numpad0: "Numpad0", numpad1: "Numpad1", numpad2: "Numpad2",
  numpad3: "Numpad3", numpad4: "Numpad4", numpad5: "Numpad5",
  numpad6: "Numpad6", numpad7: "Numpad7", numpad8: "Numpad8",
  numpad9: "Numpad9",
  numpadadd: "NumpadAdd", numpadmult: "NumpadMultiply",
  numpadsub: "NumpadSubtract", numpaddiv: "NumpadDivide",
  numpaddot: "NumpadDecimal", numpadenter: "NumpadEnter",

  // マウスボタン
  lbutton: "Mouse0",
  rbutton: "Mouse1",
  mbutton: "Mouse2",
  xbutton1: "Mouse3",
  xbutton2: "Mouse4",
};

/**
 * AutoHotkeyのキー名をJavaScript KeyboardEvent.code形式に変換
 */
function ahkKeyToJsKey(ahkKey: string): string {
  const normalized = ahkKey.toLowerCase().trim();
  return AHK_KEY_MAP[normalized] || ahkKey;
}

/**
 * AutoHotkeyスクリプトを解析してリマップ情報を抽出
 */
export function parseAutoHotkeyScript(script: string): ParsedRemap[] {
  const remaps: ParsedRemap[] = [];
  const lines = script.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();

    // コメント行をスキップ
    if (trimmed.startsWith(";") || trimmed === "") {
      continue;
    }

    // #ディレクティブをスキップ
    if (trimmed.startsWith("#")) {
      continue;
    }

    // リマップパターン: key1::key2
    // 例: CapsLock::Ctrl, a::b
    const remapMatch = trimmed.match(/^([^:]+)::([^;\s]+)/);
    if (remapMatch) {
      const [, sourceRaw, targetRaw] = remapMatch;
      const sourceKey = ahkKeyToJsKey(sourceRaw.trim());
      const targetKey = ahkKeyToJsKey(targetRaw.trim());

      // 行末コメントをノートとして取得
      const commentMatch = trimmed.match(/;\s*(.+)$/);
      const notes = commentMatch ? commentMatch[1].trim() : undefined;

      remaps.push({
        sourceKey,
        targetKey,
        software: "AutoHotkey",
        notes,
      });
    }
  }

  return remaps;
}

// ============================================
// Minecraft 設定ファイル解析
// ============================================

export interface ParsedMinecraftSettings {
  keybindings: Array<{
    action: string;
    keyCode: string;
    category: "movement" | "combat" | "inventory" | "ui";
  }>;
  gameSettings: {
    toggleSprint?: boolean;
    toggleSneak?: boolean;
    autoJump?: boolean;
    fov?: number;
    guiScale?: number;
    rawInput?: boolean;
    mouseSensitivity?: number;
    gameLanguage?: string;
  };
}

// Minecraft キーバインドアクション → Minefolio アクション名 マッピング
const MC_ACTION_MAP: Record<string, { action: string; category: "movement" | "combat" | "inventory" | "ui" }> = {
  // 移動
  "key_key.forward": { action: "forward", category: "movement" },
  "key_key.back": { action: "back", category: "movement" },
  "key_key.left": { action: "left", category: "movement" },
  "key_key.right": { action: "right", category: "movement" },
  "key_key.jump": { action: "jump", category: "movement" },
  "key_key.sneak": { action: "sneak", category: "movement" },
  "key_key.sprint": { action: "sprint", category: "movement" },

  // 戦闘
  "key_key.attack": { action: "attack", category: "combat" },
  "key_key.use": { action: "use", category: "combat" },
  "key_key.pickItem": { action: "pickBlock", category: "combat" },
  "key_key.drop": { action: "drop", category: "combat" },

  // インベントリ
  "key_key.inventory": { action: "inventory", category: "inventory" },
  "key_key.swapOffhand": { action: "swapHands", category: "inventory" },
  "key_key.hotbar.1": { action: "hotbar1", category: "inventory" },
  "key_key.hotbar.2": { action: "hotbar2", category: "inventory" },
  "key_key.hotbar.3": { action: "hotbar3", category: "inventory" },
  "key_key.hotbar.4": { action: "hotbar4", category: "inventory" },
  "key_key.hotbar.5": { action: "hotbar5", category: "inventory" },
  "key_key.hotbar.6": { action: "hotbar6", category: "inventory" },
  "key_key.hotbar.7": { action: "hotbar7", category: "inventory" },
  "key_key.hotbar.8": { action: "hotbar8", category: "inventory" },
  "key_key.hotbar.9": { action: "hotbar9", category: "inventory" },

  // UI
  "key_key.togglePerspective": { action: "togglePerspective", category: "ui" },
  "key_key.fullscreen": { action: "fullscreen", category: "ui" },
  "key_key.chat": { action: "chat", category: "ui" },
  "key_key.command": { action: "command", category: "ui" },
};

/**
 * options.txt形式の設定ファイルを解析
 */
export function parseOptionsText(content: string): ParsedMinecraftSettings {
  const result: ParsedMinecraftSettings = {
    keybindings: [],
    gameSettings: {},
  };

  const lines = content.split("\n");

  for (const line of lines) {
    const [key, value] = line.split(":");
    if (!key || value === undefined) continue;

    const trimmedKey = key.trim();
    const trimmedValue = value.trim();

    // キーバインド
    if (MC_ACTION_MAP[trimmedKey]) {
      const { action, category } = MC_ACTION_MAP[trimmedKey];
      const keyCode = normalizeKeyCode(trimmedValue);
      result.keybindings.push({ action, keyCode, category });
    }

    // ゲーム設定
    switch (trimmedKey) {
      case "toggleSprint":
        result.gameSettings.toggleSprint = trimmedValue === "true";
        break;
      case "toggleCrouch":
        result.gameSettings.toggleSneak = trimmedValue === "true";
        break;
      case "autoJump":
        result.gameSettings.autoJump = trimmedValue === "true";
        break;
      case "fov":
        result.gameSettings.fov = Math.round(parseFloat(trimmedValue) * 40 + 70);
        break;
      case "guiScale":
        result.gameSettings.guiScale = parseInt(trimmedValue, 10);
        break;
      case "rawMouseInput":
        result.gameSettings.rawInput = trimmedValue === "true";
        break;
      case "mouseSensitivity":
        result.gameSettings.mouseSensitivity = parseFloat(trimmedValue);
        break;
      case "lang":
        result.gameSettings.gameLanguage = trimmedValue;
        break;
    }
  }

  return result;
}

/**
 * standardsettings.json形式の設定ファイルを解析
 */
export function parseStandardSettings(content: string): ParsedMinecraftSettings {
  const result: ParsedMinecraftSettings = {
    keybindings: [],
    gameSettings: {},
  };

  try {
    const json = JSON.parse(content);
    const options = json.options || json;

    // キーバインド
    for (const [key, value] of Object.entries(options)) {
      if (MC_ACTION_MAP[key] && typeof value === "string") {
        const { action, category } = MC_ACTION_MAP[key];
        const keyCode = normalizeKeyCode(value);
        result.keybindings.push({ action, keyCode, category });
      }
    }

    // ゲーム設定
    if (options.toggleSprint !== undefined) {
      result.gameSettings.toggleSprint = options.toggleSprint === "true" || options.toggleSprint === true;
    }
    if (options.toggleCrouch !== undefined) {
      result.gameSettings.toggleSneak = options.toggleCrouch === "true" || options.toggleCrouch === true;
    }
    if (options.autoJump !== undefined) {
      result.gameSettings.autoJump = options.autoJump === "true" || options.autoJump === true;
    }
    if (options.fov !== undefined) {
      const fovValue = typeof options.fov === "string" ? parseFloat(options.fov) : options.fov;
      result.gameSettings.fov = Math.round(fovValue * 40 + 70);
    }
    if (options.guiScale !== undefined) {
      result.gameSettings.guiScale = typeof options.guiScale === "string"
        ? parseInt(options.guiScale, 10)
        : options.guiScale;
    }
    if (options.rawMouseInput !== undefined) {
      result.gameSettings.rawInput = options.rawMouseInput === "true" || options.rawMouseInput === true;
    }
    if (options.mouseSensitivity !== undefined) {
      result.gameSettings.mouseSensitivity = typeof options.mouseSensitivity === "string"
        ? parseFloat(options.mouseSensitivity)
        : options.mouseSensitivity;
    }
    if (options.lang !== undefined) {
      result.gameSettings.gameLanguage = options.lang;
    }
  } catch {
    // JSON解析エラー - 空の結果を返す
  }

  return result;
}

/**
 * ファイル内容から自動的に形式を判定して解析
 */
export function parseMinecraftSettings(content: string, filename?: string): ParsedMinecraftSettings {
  // ファイル名で判定
  if (filename) {
    if (filename.endsWith(".json") || filename.includes("standardsettings")) {
      return parseStandardSettings(content);
    }
    if (filename === "options.txt" || filename.endsWith(".txt")) {
      return parseOptionsText(content);
    }
  }

  // 内容で判定
  const trimmed = content.trim();
  if (trimmed.startsWith("{")) {
    return parseStandardSettings(content);
  }

  return parseOptionsText(content);
}
