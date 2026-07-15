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
  if (char === " ") return "Space";
  const upper = char.toUpperCase();
  if (/^[A-Z]$/.test(upper)) return `Key${upper}`;
  if (/^[0-9]$/.test(char)) return `Digit${char}`;
  return char;
}

/** キーコードのバッジ表示ラベル: 可視1文字はその文字（大文字）、それ以外（Space 等）は getKeyLabel() のラベル */
function keyCodeToBadgeLabel(keyCode: string): string {
  const char = keyCodeToChar(keyCode);
  return char.trim().length === 1 ? char.toUpperCase() : getKeyLabel(keyCode);
}

export type ActualKeyInfo = {
  char: string;
  keyCode: string;
  isRemapped: boolean;
  needsShift: boolean;
  displayLabel: string;
};

export type ActualKeyOptions = {
  /**
   * Shift を押しながらクラフトする前提で逆引きする。
   * Shift 押下中の各キーの出力文字（リマップ target のシフト後文字、
   * "Shift+X" 完全一致リマップの出力、非リマップキーのシフト後文字）を優先して解決し、
   * 個々のバッジには ⇧ を付けない（Shift は行全体で押しっぱなしのため）。
   */
  shiftHeld?: boolean;
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

// SHIFT_CHAR_MAP の逆引き（シフト後文字 → 物理キー）
const REVERSE_SHIFT_CHAR_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(SHIFT_CHAR_MAP)
    // IntlRo("_") など重複する文字は先勝ち（US配列基準の Minus を優先）
    .filter(([, char], index, entries) => entries.findIndex(([, c]) => c === char) === index)
    .map(([keyCode, char]) => [char, keyCode]),
);

/** ソースキーが「Shift のみを修飾キーに持つ組み合わせ」かどうか */
function isShiftOnlyCombo(sourceKey: string): boolean {
  if (!sourceKey.includes("+")) return false;
  const parsed = parseKeyCombination(sourceKey);
  return parsed.modifiers.length > 0 && parsed.modifiers.every((m) => m === "Shift");
}

/**
 * Shift 押下中の「出力文字 → 押すキー」の逆引きマップを構築する。
 * simulateRemapOutput() の Shift 押下時の解決順序（完全一致 → 基底キー+シフト文字化）と対になる:
 * - "Shift+X" ソースのリマップ: Shift 押下中に X を押すと完全一致で発動し、target の文字を出力
 * - 単一キーソースのリマップ: target キーのシフト後文字を出力
 *   （同じ基底キーに "Shift+X" リマップがある場合はそちらが優先されるため除外）
 */
function buildShiftHeldReverseMap(remaps: RemapInfo[]): Map<string, { sourceKey: string }> {
  const map = new Map<string, { sourceKey: string }>();

  const shiftComboBases = new Set(
    remaps
      .filter((r) => isShiftOnlyCombo(r.sourceKey))
      .map((r) => normalizeKeyCode(parseKeyCombination(r.sourceKey).keyCode)),
  );

  // 完全一致（Shift+X ソース）を先に登録し、同じ文字では基底キーより優先させる。
  // 同じ文字を出せる Shift+X ソースが複数ある場合は先勝ち（dedupeRemaps 等と同じ規則）
  for (const remap of remaps) {
    if (remap.targetKey === null || !isShiftOnlyCombo(remap.sourceKey)) continue;
    const pressKey = normalizeKeyCode(parseKeyCombination(remap.sourceKey).keyCode);
    const key = isSpecialRemapTarget(remap.targetKey)
      ? remap.targetKey
      : keyCodeToChar(normalizeKeyCode(remap.targetKey)).toLowerCase();
    if (!map.has(key)) {
      map.set(key, { sourceKey: pressKey });
    }
  }

  for (const remap of remaps) {
    if (remap.targetKey === null || remap.sourceKey.includes("+")) continue;
    // Shift+同キーの完全一致リマップがある場合、Shift 押下中はそちらが発動する
    if (shiftComboBases.has(normalizeKeyCode(remap.sourceKey))) continue;

    if (isSpecialRemapTarget(remap.targetKey)) {
      // 文字出力ターゲットは Shift の影響を受けずそのまま出力される
      if (!map.has(remap.targetKey)) {
        map.set(remap.targetKey, { sourceKey: remap.sourceKey });
      }
      continue;
    }

    const target = normalizeKeyCode(remap.targetKey);
    const char = shiftedChar(target, keyCodeToChar(target));
    const key = SHIFT_CHAR_MAP[target] ? char : char.toLowerCase();
    if (!map.has(key)) {
      map.set(key, { sourceKey: remap.sourceKey });
    }
  }

  return map;
}

export function getActualKeyInfos(
  searchStr: string,
  remaps: RemapInfo[],
  options?: ActualKeyOptions,
): ActualKeyInfo[] {
  const shiftHeld = options?.shiftHeld ?? false;
  const reverseRemapMap = new Map<string, { sourceKey: string }>();

  const registerReverse = (remap: RemapInfo) => {
    if (remap.targetKey === null) return;

    if (isSpecialRemapTarget(remap.targetKey)) {
      reverseRemapMap.set(remap.targetKey, { sourceKey: remap.sourceKey });
      return;
    }

    const targetChar = keyCodeToChar(remap.targetKey);
    reverseRemapMap.set(targetChar.toLowerCase(), { sourceKey: remap.sourceKey });
  };

  // 同じ文字を複数のリマップが出力できる場合は修飾キーなしのソースを優先する
  // （例: "E→h" と "Shift+S→h" があるとき、Shift 不要の E を入力キーとして表示する）。
  // 修飾キー付きを先に登録し、修飾キーなしで上書きする。
  // shiftHeld 時は通常マップを使わない: Shift 押下中、通常マップのソースキーは
  // 別の文字を出力する（完全一致リマップの発動・シフト文字化）ため、参照すると必ず誤る
  if (!shiftHeld) {
    for (const remap of remaps) {
      if (remap.sourceKey.includes("+")) registerReverse(remap);
    }
    for (const remap of remaps) {
      if (!remap.sourceKey.includes("+")) registerReverse(remap);
    }
  }

  const shiftHeldMap = shiftHeld ? buildShiftHeldReverseMap(remaps) : null;

  // Shift 押下中の出力がリマップに奪われている基底キー（単一キーソース or Shift+同キーソース）。
  // これらのキーはシフト後文字の逆引き先（REVERSE_SHIFT_CHAR_MAP）として使えない
  const shiftOverriddenBases = new Set<string>();
  if (shiftHeld) {
    for (const remap of remaps) {
      if (!remap.sourceKey.includes("+")) {
        shiftOverriddenBases.add(normalizeKeyCode(remap.sourceKey));
      } else if (isShiftOnlyCombo(remap.sourceKey)) {
        shiftOverriddenBases.add(normalizeKeyCode(parseKeyCombination(remap.sourceKey).keyCode));
      }
    }
  }

  const result: ActualKeyInfo[] = [];

  for (const char of searchStr) {
    const isUpperCase = char === char.toUpperCase() && char !== char.toLowerCase();

    // Shift 押下中の出力文字での逆引き（⇧ は行全体で押しっぱなしのため付けない）。
    // shiftHeldMap にない文字は非リマップキーのフォールバックへ直行する
    // （通常マップは参照しない — Shift 押下中はそのキーが別の文字を出すため）
    if (shiftHeldMap) {
      const shiftInfo = shiftHeldMap.get(char) ?? shiftHeldMap.get(char.toLowerCase());
      if (shiftInfo) {
        result.push({
          char: char.toLowerCase(),
          keyCode: shiftInfo.sourceKey,
          isRemapped: true,
          needsShift: false,
          displayLabel: keyCodeToBadgeLabel(shiftInfo.sourceKey),
        });
        continue;
      }

      // 非リマップキーの解決: シフト後文字（記号）から物理キーを逆引きする。
      // ただしそのキー自体がリマップで奪われている場合は使えない（別の文字が出る）。
      // 英字は大文字が出力される前提（Minecraft の検索は大文字小文字を区別しない）で
      // 基底キーをそのまま押す
      const reverseShiftKey = REVERSE_SHIFT_CHAR_MAP[char];
      const keyCode =
        reverseShiftKey && !shiftOverriddenBases.has(reverseShiftKey)
          ? reverseShiftKey
          : charToKeyCode(char.toLowerCase());
      result.push({
        char: char.toLowerCase(),
        keyCode,
        isRemapped: false,
        needsShift: false,
        displayLabel: keyCodeToBadgeLabel(keyCode),
      });
      continue;
    }

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
        displayLabel = `${mods}+${keyCodeToBadgeLabel(parts[parts.length - 1])}`;
      } else {
        displayLabel = keyCodeToBadgeLabel(sourceKey);
      }

      result.push({
        char: displayLabel.toLowerCase(),
        keyCode: sourceKey,
        isRemapped: true,
        needsShift: hasModifiers && sourceKey.includes("Shift"),
        displayLabel,
      });
      continue;
    }

    const baseKeyCode = charToKeyCode(char.toLowerCase());
    // スペースなど不可視文字はバッジが空になるためキーラベル（Space 等）を表示する
    const baseLabel = char.trim().length === 1 ? char.toUpperCase() : getKeyLabel(baseKeyCode);
    const displayLabel = isUpperCase ? `⇧+${baseLabel}` : baseLabel;
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
  /**
   * 入力/リマップが解決した先のキーコード。
   * - リマップのキー出力ターゲット → そのキーコード（例: "Backspace"）
   * - リマップなしの物理キー → 押したキー自体
   * - 文字出力ターゲット・無効化・修飾キー込みの未定義組み合わせ → null
   * Backspace 等の制御キーへのリマップを呼び出し側が検知するために使う。
   */
  outputKeyCode: string | null;
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

  // キー出力ターゲットのキーコード（文字出力・無効化は null）
  const resolveTargetKeyCode = (targetKey: string | null): string | null =>
    targetKey === null || isSpecialRemapTarget(targetKey) ? null : normalizeKeyCode(targetKey);

  // 完全一致（修飾キー込み・修飾キー単独も含む）
  const exact = remaps.find((r) => normalizeKeyCombination(r.sourceKey) === normalized);
  if (exact) {
    return {
      pressedLabel,
      output: resolveTarget(exact.targetKey, false),
      isRemapped: true,
      outputKeyCode: resolveTargetKeyCode(exact.targetKey),
    };
  }

  // 基底キーのみ一致（Shift のみの組み合わせはシフト後の文字として扱う）
  const onlyShift = parsed.modifiers.length > 0 && parsed.modifiers.every((m) => m === "Shift");
  if (parsed.modifiers.length === 0 || onlyShift) {
    const base = remaps.find((r) => normalizeKeyCombination(r.sourceKey) === normalizeKeyCode(parsed.keyCode));
    if (base) {
      return {
        pressedLabel,
        output: resolveTarget(base.targetKey, onlyShift),
        isRemapped: true,
        outputKeyCode: resolveTargetKeyCode(base.targetKey),
      };
    }
    // リマップなし: 印字可能キーのみ文字を出力（キーコード自体は返して制御キー検知に使う）
    // 印字可能キー: 英字/数字、または記号マップに載っているキー（CODE_CHAR_MAP と二重管理しない）
    const isPrintable =
      /^(Key[A-Z]|Digit[0-9])$/.test(parsed.keyCode) || parsed.keyCode in CODE_CHAR_MAP;
    if (!isPrintable) {
      return { pressedLabel, output: null, isRemapped: false, outputKeyCode: parsed.keyCode };
    }
    return {
      pressedLabel,
      output: onlyShift ? shiftedChar(parsed.keyCode, baseChar) : baseChar,
      isRemapped: false,
      outputKeyCode: parsed.keyCode,
    };
  }

  // Ctrl/Alt/Meta を含む未定義の組み合わせは文字出力なし
  return { pressedLabel, output: null, isRemapped: false, outputKeyCode: null };
}

export function matchesRemapSourceKey(remapSourceKey: string, keyCode: string): boolean {
  if (remapSourceKey.includes("+")) {
    const parsed = parseKeyCombination(remapSourceKey);
    return parsed.keyCode === keyCode;
  }
  return normalizeKeyCode(remapSourceKey) === normalizeKeyCode(keyCode);
}
