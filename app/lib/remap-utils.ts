import {
  getKeyLabel,
  normalizeKeyCode,
  normalizeKeyCombination,
  parseKeyCombination,
  MODIFIER_LABELS,
} from "./keybindings";

export type RemapInfo = {
  sourceKey: string;
  targetKey: string | null;
  software?: string | null;
  notes?: string | null;
};

export type UiRemapInfo = {
  sourceKey: string;
  targetKey: string | null;
  software: string | null;
  notes: string | null;
};

export type PersistedRemapPayload = {
  sourceKey: string;
  targetKey: string | null;
  software: string | null;
  notes: string | null;
};

export function sanitizeRemapTargetKey(targetKey: string | null | undefined): string | null {
  if (targetKey == null) return null;
  if (targetKey === "" || /^__.*__$/.test(targetKey)) return null;
  return targetKey;
}

const WEB_KEYBOARD_CODE_PATTERN = /^(Key[A-Z]|Digit[0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Backspace|Tab|Enter|Space|Escape|CapsLock|Shift(?:Left|Right)|Control(?:Left|Right)|Alt(?:Left|Right)|Meta(?:Left|Right)|ContextMenu|Insert|Delete|Home|End|Page(?:Up|Down)|Arrow(?:Up|Down|Left|Right)|PrintScreen|ScrollLock|Pause|NumLock|Backquote|Minus|Equal|Bracket(?:Left|Right)|Backslash|Semicolon|Quote|Comma|Period|Slash|Intl(?:Backslash|Ro|Yen)|Numpad(?:[0-9]|Add|Subtract|Multiply|Divide|Decimal|Enter|Equal|Comma|ParenLeft|ParenRight|Backspace|Clear|ClearEntry|Hash|MemoryAdd|MemoryClear|MemoryRecall|MemoryStore|MemorySubtract|Star))$/;

export function isKeyRemapTarget(targetKey: string | null): boolean {
  if (!targetKey) return false;
  const normalized = normalizeKeyCode(targetKey);
  return WEB_KEYBOARD_CODE_PATTERN.test(normalized);
}

export function isSpecialRemapTarget(targetKey: string | null): boolean {
  if (targetKey == null || targetKey === "") return false;
  return !isKeyRemapTarget(targetKey);
}

export function toUiRemap(remap: RemapInfo): UiRemapInfo {
  const targetKey = sanitizeRemapTargetKey(remap.targetKey);
  return {
    sourceKey: remap.sourceKey,
    targetKey,
    software: remap.software ?? null,
    notes: remap.notes ?? null,
  };
}

export function toUiRemaps(remaps: RemapInfo[]): UiRemapInfo[] {
  return remaps.map(toUiRemap);
}

export function toPersistedRemapPayload(remap: RemapInfo): PersistedRemapPayload {
  const targetKey = sanitizeRemapTargetKey(remap.targetKey);
  return {
    sourceKey: normalizeKeyCombination(remap.sourceKey),
    targetKey: targetKey == null
      ? null
      : (isKeyRemapTarget(targetKey) ? normalizeKeyCode(targetKey) : targetKey),
    software: remap.software ?? null,
    notes: remap.notes ?? null,
  };
}

/** 単一キーの表示ラベル。customKeyNames があれば標準ラベルより優先する。 */
function resolveKeyLabel(
  keyCode: string,
  layout?: string | null,
  customKeyNames?: Record<string, string>,
): string {
  const custom =
    customKeyNames?.[keyCode] ?? customKeyNames?.[normalizeKeyCode(keyCode)];
  return custom ?? getKeyLabel(keyCode, layout);
}

export function getRemapOutputLabel(
  remap: RemapInfo,
  layout?: string | null,
  customKeyNames?: Record<string, string>,
): string {
  if (remap.targetKey === null) return "×";
  if (isSpecialRemapTarget(remap.targetKey)) return remap.targetKey;
  return resolveKeyLabel(remap.targetKey, layout, customKeyNames);
}

export function getRemapSourceLabel(
  sourceKey: string,
  layout?: string | null,
  customKeyNames?: Record<string, string>,
): string {
  if (sourceKey.includes("+")) {
    const parsed = parseKeyCombination(sourceKey);
    const keyLabel = resolveKeyLabel(parsed.keyCode, layout, customKeyNames);
    if (parsed.modifiers.length === 0) return keyLabel;
    const modifierLabels = parsed.modifiers.map((m) => MODIFIER_LABELS[m]);
    return [...modifierLabels, keyLabel].join("+");
  }
  return resolveKeyLabel(sourceKey, layout, customKeyNames);
}

// 記号キーの keyCode → 文字（US配列基準の簡易マッピング。IntlRo/IntlYen はJIS用）
const CODE_CHAR_MAP: Record<string, string> = {
  Space: " ",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backquote: "`",
  IntlRo: "\\",
  IntlYen: "¥",
};

// Shift 押下時に別の文字になるキー（US配列基準 + JIS の IntlRo = "_"）
const SHIFT_CHAR_MAP: Record<string, string> = {
  Digit1: "!",
  Digit2: "@",
  Digit3: "#",
  Digit4: "$",
  Digit5: "%",
  Digit6: "^",
  Digit7: "&",
  Digit8: "*",
  Digit9: "(",
  Digit0: ")",
  Minus: "_",
  Equal: "+",
  BracketLeft: "{",
  BracketRight: "}",
  Backslash: "|",
  Semicolon: ":",
  Quote: '"',
  Comma: "<",
  Period: ">",
  Slash: "?",
  Backquote: "~",
  IntlRo: "_",
};

export function keyCodeToChar(keyCode: string): string {
  if (keyCode.startsWith("Key")) return keyCode.slice(3).toLowerCase();
  if (keyCode.startsWith("Digit")) return keyCode.slice(5);
  if (CODE_CHAR_MAP[keyCode]) return CODE_CHAR_MAP[keyCode];
  if (keyCode.length === 1) return keyCode.toLowerCase();
  return keyCode.toLowerCase();
}

/** Shift 押下時の出力文字（記号・数字は別文字、それ以外は大文字化） */
function shiftedChar(keyCode: string, baseChar: string): string {
  return SHIFT_CHAR_MAP[keyCode] ?? baseChar.toUpperCase();
}

function charToKeyCode(char: string): string {
  const upper = char.toUpperCase();
  if (/^[A-Z]$/.test(upper)) return `Key${upper}`;
  if (/^[0-9]$/.test(char)) return `Digit${char}`;
  return char;
}

export type ActualKeyInfo = {
  char: string;
  keyCode: string;
  isRemapped: boolean;
  needsShift: boolean;
  displayLabel: string;
};

function modifierToMark(modifier: string): string {
  switch (modifier) {
    case "Ctrl":
      return "◆";
    case "Shift":
      return "⇧";
    case "Alt":
      return "⌥";
    case "Meta":
      return "◇";
    default:
      return modifier[0] || "";
  }
}

export function getActualKeyInfos(searchStr: string, remaps: RemapInfo[]): ActualKeyInfo[] {
  const reverseRemapMap = new Map<string, { sourceKey: string }>();

  for (const remap of remaps) {
    if (remap.targetKey === null) continue;

    if (isSpecialRemapTarget(remap.targetKey)) {
      reverseRemapMap.set(remap.targetKey, { sourceKey: remap.sourceKey });
      continue;
    }

    const targetChar = keyCodeToChar(remap.targetKey);
    reverseRemapMap.set(targetChar.toLowerCase(), { sourceKey: remap.sourceKey });
  }

  const result: ActualKeyInfo[] = [];

  for (const char of searchStr) {
    const isUpperCase = char === char.toUpperCase() && char !== char.toLowerCase();
    let remapInfo = reverseRemapMap.get(char);
    if (!remapInfo && isUpperCase) {
      remapInfo = reverseRemapMap.get(char.toLowerCase());
    }

    if (remapInfo) {
      const sourceKey = remapInfo.sourceKey;
      const hasModifiers = sourceKey.includes("+");
      let displayLabel: string;

      if (hasModifiers) {
        const parts = sourceKey.split("+");
        const mods = parts
          .slice(0, -1)
          .map(modifierToMark)
          .join("");
        const baseKey = keyCodeToChar(parts[parts.length - 1]);
        displayLabel = `${mods}+${baseKey}`;
      } else {
        displayLabel = keyCodeToChar(sourceKey);
      }

      result.push({
        char: displayLabel.toLowerCase(),
        keyCode: sourceKey,
        isRemapped: true,
        needsShift: hasModifiers && sourceKey.includes("Shift"),
        displayLabel: displayLabel.toUpperCase(),
      });
      continue;
    }

    const baseKeyCode = charToKeyCode(char.toLowerCase());
    const displayLabel = isUpperCase ? `⇧+${char.toUpperCase()}` : char.toUpperCase();
    result.push({
      char: char.toLowerCase(),
      keyCode: isUpperCase ? `Shift+${baseKeyCode}` : baseKeyCode,
      isRemapped: false,
      needsShift: isUpperCase,
      displayLabel,
    });
  }

  return result;
}

export type SimulatedKeyOutput = {
  /** 押した物理キーの表示ラベル（例: "⇧+W"） */
  pressedLabel: string;
  /** リマップ適用後の出力文字。null は出力なし（無効化 or 文字を持たないキー） */
  output: string | null;
  isRemapped: boolean;
};

/**
 * 物理キー入力（修飾キー組み合わせ）にリマップを順方向に適用し、出力文字を求める。
 * getActualKeyInfos()（文字→押すキーの逆引き）の対になる簡易シミュレーション。
 * 完全一致（修飾キー込み）→ 基底キー一致（Shift は大文字化として扱う）の順で解決する。
 */
export function simulateRemapOutput(combo: string, remaps: RemapInfo[]): SimulatedKeyOutput {
  const normalized = normalizeKeyCombination(combo);
  const parsed = parseKeyCombination(normalized);
  const modifierMarks = parsed.modifiers.map(modifierToMark).join("");
  const baseChar = keyCodeToChar(parsed.keyCode);
  // 可視の1文字はその文字、それ以外（Space, F3, ShiftLeft 等）はキーラベルを表示
  const baseLabel = baseChar.trim().length === 1
    ? baseChar.toUpperCase()
    : getKeyLabel(parsed.keyCode);
  const pressedLabel = parsed.modifiers.length > 0
    ? `${modifierMarks}+${baseLabel}`
    : baseLabel;

  const resolveTarget = (targetKey: string | null, shiftApplies: boolean): string | null => {
    if (targetKey === null) return null;
    if (isSpecialRemapTarget(targetKey)) return targetKey;
    const normalizedTarget = normalizeKeyCode(targetKey);
    const char = keyCodeToChar(normalizedTarget);
    return shiftApplies ? shiftedChar(normalizedTarget, char) : char;
  };

  // 完全一致（修飾キー込み・修飾キー単独も含む）
  const exact = remaps.find((r) => normalizeKeyCombination(r.sourceKey) === normalized);
  if (exact) {
    return { pressedLabel, output: resolveTarget(exact.targetKey, false), isRemapped: true };
  }

  // 基底キーのみ一致（Shift のみの組み合わせはシフト後の文字として扱う）
  const onlyShift = parsed.modifiers.length > 0 && parsed.modifiers.every((m) => m === "Shift");
  if (parsed.modifiers.length === 0 || onlyShift) {
    const base = remaps.find((r) => normalizeKeyCombination(r.sourceKey) === normalizeKeyCode(parsed.keyCode));
    if (base) {
      return { pressedLabel, output: resolveTarget(base.targetKey, onlyShift), isRemapped: true };
    }
    // リマップなし: 印字可能キーのみ文字を出力
    // 印字可能キー: 英字/数字、または記号マップに載っているキー（CODE_CHAR_MAP と二重管理しない）
    const isPrintable =
      /^(Key[A-Z]|Digit[0-9])$/.test(parsed.keyCode) || parsed.keyCode in CODE_CHAR_MAP;
    if (!isPrintable) return { pressedLabel, output: null, isRemapped: false };
    return {
      pressedLabel,
      output: onlyShift ? shiftedChar(parsed.keyCode, baseChar) : baseChar,
      isRemapped: false,
    };
  }

  // Ctrl/Alt/Meta を含む未定義の組み合わせは文字出力なし
  return { pressedLabel, output: null, isRemapped: false };
}

export function matchesRemapSourceKey(remapSourceKey: string, keyCode: string): boolean {
  if (remapSourceKey.includes("+")) {
    const parsed = parseKeyCombination(remapSourceKey);
    return parsed.keyCode === keyCode;
  }
  return normalizeKeyCode(remapSourceKey) === normalizeKeyCode(keyCode);
}
