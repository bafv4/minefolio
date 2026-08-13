import type { Translator } from "@/lib/messages";
import {
  getKeyLabel,
  normalizeKeyCode,
  normalizeKeyCombination,
  parseKeyCombination,
  MODIFIER_LABELS,
} from "./keybindings";

// リマップ種別: unset(未設定)/all/trigger(ゲーム入力)/chat(チャット・サーチクラフト)。
// unset と all は全用途で有効（all はユーザーが明示的に選ぶ値）
export const KEY_REMAP_TYPES = ["unset", "all", "trigger", "chat"] as const;
export type KeyRemapType = (typeof KEY_REMAP_TYPES)[number];

/** 不明・欠落値（旧スナップショット等）は "unset" に正規化する */
export function normalizeKeyRemapType(value: unknown): KeyRemapType {
  return KEY_REMAP_TYPES.includes(value as KeyRemapType) ? (value as KeyRemapType) : "unset";
}

export type RemapInfo = {
  sourceKey: string;
  targetKey: string | null;
  software?: string | null;
  notes?: string | null;
  remapType?: KeyRemapType | null;
};

export type UiRemapInfo = {
  sourceKey: string;
  targetKey: string | null;
  software: string | null;
  notes: string | null;
  remapType: KeyRemapType;
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
    remapType: normalizeKeyRemapType(remap.remapType),
  };
}

export function toUiRemaps(remaps: RemapInfo[]): UiRemapInfo[] {
  return remaps.map(toUiRemap);
}

export type RemapContext = "chat" | "trigger";

/**
 * sourceKey の照合キー。大文字レガシー表記（旧データ）を同一視する。
 * 「同じ変更元キーか」の判定はすべてこの関数を通すこと（フィルタ・保存時検証・適用時マージで共通）。
 */
export function remapSourceMatchKey(sourceKey: string): string {
  return normalizeKeyCombination(sourceKey).toUpperCase();
}

/** 文脈内の優先度: 文脈一致=2 > all=1 > unset=0。文脈外は null（除外） */
function remapTypePriority(type: KeyRemapType, context: RemapContext): number | null {
  if (type === context) return 2;
  if (type === "all") return 1;
  if (type === "unset") return 0;
  return null;
}

/**
 * 文脈（chat/trigger）に該当するリマップのみに絞り、同一 sourceKey は
 * 優先度（文脈一致 > all > unset、同順位は先勝ち）で1行に解決する。
 * 出力順は入力の初出順を維持し、冪等。
 */
export function filterRemapsForContext<T extends { sourceKey: string; remapType?: string | null }>(
  remaps: readonly T[],
  context: RemapContext,
): T[] {
  const bySource = new Map<string, { remap: T; priority: number }>();
  const order: string[] = [];
  for (const remap of remaps) {
    const priority = remapTypePriority(normalizeKeyRemapType(remap.remapType), context);
    if (priority === null) continue;
    const key = remapSourceMatchKey(remap.sourceKey);
    const existing = bySource.get(key);
    if (!existing) {
      bySource.set(key, { remap, priority });
      order.push(key);
    } else if (priority > existing.priority) {
      bySource.set(key, { remap, priority });
    }
  }
  return order.map((key) => bySource.get(key)!.remap);
}

export function filterRemapsForChat<T extends { sourceKey: string; remapType?: string | null }>(
  remaps: readonly T[],
): T[] {
  return filterRemapsForContext(remaps, "chat");
}

export function filterRemapsForTrigger<T extends { sourceKey: string; remapType?: string | null }>(
  remaps: readonly T[],
): T[] {
  return filterRemapsForContext(remaps, "trigger");
}

export type RemapConflict = {
  kind: "duplicate" | "allConflict";
  sourceKey: string;
  remapType: KeyRemapType;
};

/**
 * 保存前バリデーション（サーバー/クライアント共用）。最初の違反を返す:
 * - "duplicate": 同一 (sourceKey, remapType) の完全重複
 * - "allConflict": 同一 sourceKey で all 行と他の行（種別問わず）の共存
 * sourceKey は正規化＋大文字化で照合（修飾キーの有無は別キー扱い）。
 */
export function findRemapConflict(
  remaps: readonly { sourceKey: string; remapType?: string | null }[],
): RemapConflict | null {
  const seen = new Map<string, Set<KeyRemapType>>();
  for (const remap of remaps) {
    const key = remapSourceMatchKey(remap.sourceKey);
    const type = normalizeKeyRemapType(remap.remapType);
    const types = seen.get(key);
    if (!types) {
      seen.set(key, new Set([type]));
      continue;
    }
    if (types.has(type)) {
      return { kind: "duplicate", sourceKey: remap.sourceKey, remapType: type };
    }
    if (type === "all" || types.has("all")) {
      return { kind: "allConflict", sourceKey: remap.sourceKey, remapType: type };
    }
    types.add(type);
  }
  return null;
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
  t: Translator,
  keyCode: string,
  layout?: string | null,
  customKeyNames?: Record<string, string>,
): string {
  const custom =
    customKeyNames?.[keyCode] ?? customKeyNames?.[normalizeKeyCode(keyCode)];
  return custom ?? getKeyLabel(t, keyCode, layout);
}

export function getRemapOutputLabel(
  t: Translator,
  remap: RemapInfo,
  layout?: string | null,
  customKeyNames?: Record<string, string>,
): string {
  if (remap.targetKey === null) return "×";
  if (isSpecialRemapTarget(remap.targetKey)) return remap.targetKey;
  return resolveKeyLabel(t, remap.targetKey, layout, customKeyNames);
}

export function getRemapSourceLabel(
  t: Translator,
  sourceKey: string,
  layout?: string | null,
  customKeyNames?: Record<string, string>,
): string {
  if (sourceKey.includes("+")) {
    const parsed = parseKeyCombination(sourceKey);
    const keyLabel = resolveKeyLabel(t, parsed.keyCode, layout, customKeyNames);
    if (parsed.modifiers.length === 0) return keyLabel;
    const modifierLabels = parsed.modifiers.map((m) => MODIFIER_LABELS[m]);
    return [...modifierLabels, keyLabel].join("+");
  }
  return resolveKeyLabel(t, sourceKey, layout, customKeyNames);
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
function keyCodeToBadgeLabel(t: Translator, keyCode: string): string {
  const char = keyCodeToChar(keyCode);
  return char.trim().length === 1 ? char.toUpperCase() : getKeyLabel(t, keyCode);
}

/**
 * ツールチップの「リマップ: 物理キー名称 → リマップ先」表示用の詳細。
 * 物理キーボードのキー情報ツールチップ（`key-info-trigger.tsx` の `RemapRow`）と概念を揃えた、
 * テキスト版の簡易表現。フル名称（`getRemapSourceLabel` 等）を使い、バッジ表示用の短縮記号
 * （`⇧` 等）は含めない。
 */
export type RemapDetail = {
  /** 物理キー名称（リマップ元、フル表記） */
  sourceLabel: string;
  /** リマップ先の名称（フル表記。文字出力ターゲットは「」で囲む） */
  targetLabel: string;
};

export type ActualKeyInfo = {
  char: string;
  keyCode: string;
  isRemapped: boolean;
  needsShift: boolean;
  displayLabel: string;
  /** リマップされている場合のみ: ツールチップの「リマップ: 物理 → 出力」表示用 */
  remapDetail?: RemapDetail;
};

/** 文字出力ターゲットをツールチップ表記用に「」で囲む（key-info-trigger.tsx の RemapRow と同じ表記） */
function wrapCharTarget(t: Translator, char: string): string {
  return `${t("keybindings.remapCharOpen")}${char}${t("keybindings.remapCharClose")}`;
}

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

/**
 * サーチ文字列の各文字から「実際に押すキー」を逆引きする（chat 文脈専用）。
 * trigger 種別のリマップは内部で除外され、同一 sourceKey の複数行は
 * chat > all > unset の優先度で1行に解決される（filterRemapsForChat）。
 */
export function getActualKeyInfos(
  t: Translator,
  searchStr: string,
  remaps: RemapInfo[],
  options?: ActualKeyOptions,
): ActualKeyInfo[] {
  const chatRemaps = filterRemapsForChat(remaps);
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
    for (const remap of chatRemaps) {
      if (remap.sourceKey.includes("+")) registerReverse(remap);
    }
    for (const remap of chatRemaps) {
      if (!remap.sourceKey.includes("+")) registerReverse(remap);
    }
  }

  const shiftHeldMap = shiftHeld ? buildShiftHeldReverseMap(chatRemaps) : null;

  // Shift 押下中の出力がリマップに奪われている基底キー（単一キーソース or Shift+同キーソース）。
  // これらのキーはシフト後文字の逆引き先（REVERSE_SHIFT_CHAR_MAP）として使えない
  const shiftOverriddenBases = new Set<string>();
  if (shiftHeld) {
    for (const remap of chatRemaps) {
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
          displayLabel: keyCodeToBadgeLabel(t, shiftInfo.sourceKey),
          remapDetail: {
            sourceLabel: getRemapSourceLabel(t, shiftInfo.sourceKey),
            targetLabel: wrapCharTarget(t, char),
          },
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
        displayLabel: keyCodeToBadgeLabel(t, keyCode),
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
        displayLabel = `${mods}+${keyCodeToBadgeLabel(t, parts[parts.length - 1])}`;
      } else {
        displayLabel = keyCodeToBadgeLabel(t, sourceKey);
      }

      result.push({
        char: displayLabel.toLowerCase(),
        keyCode: sourceKey,
        isRemapped: true,
        needsShift: hasModifiers && sourceKey.includes("Shift"),
        displayLabel,
        remapDetail: {
          sourceLabel: getRemapSourceLabel(t, sourceKey),
          targetLabel: wrapCharTarget(t, char),
        },
      });
      continue;
    }

    const baseKeyCode = charToKeyCode(char.toLowerCase());
    // スペースなど不可視文字はバッジが空になるためキーラベル（Space 等）を表示する
    const baseLabel = char.trim().length === 1 ? char.toUpperCase() : getKeyLabel(t, baseKeyCode);
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

export type ActualControlKeyInfo = {
  /** 実際に押すキー（コード、または "Shift+KeyR" のような組み合わせ） */
  keyCode: string;
  /** 実キーの短いバッジ表示ラベル（⇧ 等の短縮記号を含む。バッジ本体の描画専用） */
  displayLabel: string;
  /**
   * ツールチップ用のフル名称（⇧ の短縮記号を使わず「左Shift」「右Shift」等のフル表記にする。
   * ⇧Home 合成時は成分ごとのフル名称を "+" で連結する（例: "左Shift+サイド1"）
   */
  tooltipLabel: string;
  isRemapped: boolean;
  /** リマップの詳細（isRemapped 時のみ1件以上。⇧Home 合成時は成分ごとに複数件になりうる） */
  remapDetails: RemapDetail[];
};

/**
 * targetKeyCode（Backspace / ArrowLeft / Home / ShiftLeft / ShiftRight 等）を出力するリマップを
 * chat 文脈で逆引きする（単一の制御キー成分の解決）。
 * 同じ出力を複数のリマップが持つ場合は getActualKeyInfos() と同じ規則（修飾キーなしの
 * ソースを優先。同クラス内の複数候補は配列の後勝ち）で解決する。
 * **自己リマップ（sourceKey が修飾キーなしで targetKeyCode 自身に正規化される。
 * 例: `Backspace → Backspace`、`ShiftLeft → ShiftLeft`）は「リマップ」として扱わない**
 * （見た目上は無変更のリマップ行であり、押すキーも物理キーと変わらないため。
 * isPhysicalShiftLeftTaken() の「自己リマップは奪われていない扱い」と同じ考え方）。
 * 該当リマップが無ければ物理キーそのまま（`isRemapped: false`）を返す。
 */
function resolveControlKeyComponent(
  t: Translator,
  targetKeyCode: string,
  chatRemaps: RemapInfo[],
): ActualControlKeyInfo {
  const outputsTarget = (r: RemapInfo): boolean => {
    if (r.targetKey === null || isSpecialRemapTarget(r.targetKey)) return false;
    if (normalizeKeyCode(r.targetKey) !== targetKeyCode) return false;
    // 自己リマップ除外（修飾キーなしソースが自分自身を出力するだけの行はリマップ扱いしない）
    if (!r.sourceKey.includes("+") && normalizeKeyCode(r.sourceKey) === targetKeyCode) return false;
    return true;
  };

  // 修飾キー付きソースを先に走査し、修飾キーなしのソースで上書きする
  // （修飾キーなしを優先。同クラス内の複数候補は配列順で後勝ち＝getActualKeyInfos と同じ規則）
  let found: RemapInfo | undefined;
  for (const r of chatRemaps) {
    if (r.sourceKey.includes("+") && outputsTarget(r)) found = r;
  }
  for (const r of chatRemaps) {
    if (!r.sourceKey.includes("+") && outputsTarget(r)) found = r;
  }

  if (found) {
    const sourceLabel = getRemapSourceLabel(t, found.sourceKey);
    return {
      keyCode: found.sourceKey,
      displayLabel: sourceLabel,
      tooltipLabel: sourceLabel,
      isRemapped: true,
      remapDetails: [{ sourceLabel, targetLabel: getKeyLabel(t, targetKeyCode) }],
    };
  }

  const fallbackLabel = getKeyLabel(t, targetKeyCode);
  return {
    keyCode: targetKeyCode,
    displayLabel: fallbackLabel,
    tooltipLabel: fallbackLabel,
    isRemapped: false,
    remapDetails: [],
  };
}

/**
 * chat 文脈のリマップで、物理 ShiftLeft（単独ソース）が「別出力に奪われている」かどうか。
 * sourceKey が修飾キーなしで ShiftLeft に正規化される行が存在し、かつその出力が
 * ShiftLeft 自身でない（無効化・別キー出力・文字出力のいずれか）場合に true。
 * ShiftLeft → ShiftLeft の無意味な自己リマップは「奪われていない」扱いにする
 * （resolveControlKeyComponent() の自己リマップ除外〈outputsTarget〉と同じ考え方。
 * こちらは「奪われている＝isRemapped:true」ではなく「奪われている＝物理キーが機能しない」
 * という別の判定軸だが、自己リマップを無視する結論は一致する）。
 */
function isPhysicalShiftLeftTaken(chatRemaps: RemapInfo[]): boolean {
  return chatRemaps.some((r) => {
    if (r.sourceKey.includes("+") || normalizeKeyCode(r.sourceKey) !== "ShiftLeft") return false;
    const outputsShiftLeft =
      r.targetKey !== null && !isSpecialRemapTarget(r.targetKey) && normalizeKeyCode(r.targetKey) === "ShiftLeft";
    return !outputsShiftLeft;
  });
}

/**
 * Shift 成分の逆引き（⇧Home 用）。優先順は「左Shift → 右Shift」の順で、各々の中では
 * 「リマップ → 物理」の順（4段階）:
 * 1. ShiftLeft を出力する chat 文脈リマップがあれば、そのソースキー（isRemapped: true）
 * 2. 無ければ、物理 ShiftLeft が chat 文脈で奪われていなければ物理 Shift（"⇧"、isRemapped: false）
 * 3. 物理 ShiftLeft が奪われている場合のみ右へ進む: ShiftRight を出力するリマップがあれば
 *    そのソースキー（isRemapped: true）
 * 4. それも無ければ物理 ShiftRight（表示は他の Shift 表記と揃えて "⇧" のまま、isRemapped: false）
 *
 * 「奪われている」の判定は isPhysicalShiftLeftTaken() を参照。ShiftLeft が生きている限り
 * ShiftRight 側は一切見ない（ShiftRight のリマップより物理 ShiftLeft が優先される）点が
 * 素朴な「ShiftLeft リマップ → ShiftRight リマップ → 物理」との差分。
 * 物理キーのフォールバック表示に "⇧" を使うのは、resolveControlKeyComponent の汎用
 * フォールバック（getKeyLabel(t, "ShiftLeft") 等の長いキー名）だと他の Shift 表記と
 * 揃わないため（既存の「物理キーが奪われているケース」の扱いと同じ既知の限界を踏襲）。
 */
function resolveShiftComponent(t: Translator, chatRemaps: RemapInfo[]): ActualControlKeyInfo {
  // 1. ShiftLeft を出力するリマップ
  const shiftLeftRemap = resolveControlKeyComponent(t, "ShiftLeft", chatRemaps);
  if (shiftLeftRemap.isRemapped) return shiftLeftRemap;

  // 2. 物理 ShiftLeft が生きていればそれを使う（ShiftRight 側は見ない）
  if (!isPhysicalShiftLeftTaken(chatRemaps)) {
    return {
      keyCode: "ShiftLeft",
      displayLabel: "⇧",
      tooltipLabel: getKeyLabel(t, "ShiftLeft"),
      isRemapped: false,
      remapDetails: [],
    };
  }

  // 3. 物理 ShiftLeft が奪われている場合のみ ShiftRight を出力するリマップを探す
  const shiftRightRemap = resolveControlKeyComponent(t, "ShiftRight", chatRemaps);
  if (shiftRightRemap.isRemapped) return shiftRightRemap;

  // 4. 物理 ShiftRight（バッジは他の Shift 表記と揃えて "⇧" のまま、ツールチップはフル名称）
  return {
    keyCode: "ShiftRight",
    displayLabel: "⇧",
    tooltipLabel: getKeyLabel(t, "ShiftRight"),
    isRemapped: false,
    remapDetails: [],
  };
}

/**
 * 制御キー（Backspace / ArrowLeft / Home / ⇧Home＝Shift+Home）の出力になっているリマップを
 * 逆引きする（Loop の ControlKeyBadge 用。chat 文脈専用）。
 *
 * - 通常（`options?.shiftHeld` 省略）: `resolveControlKeyComponent()` で `targetKeyCode`
 *   （Backspace / ArrowLeft / Home）を出力するリマップを探す
 * - `options.shiftHeld: true`（⇧Home）: Shift+Home は「1キーの出力」に単一化されることはなく、
 *   実際の入力は **Shift 側のキーと Home 側のキーの同時押し**で、それぞれ独立にリマップされうる
 *   （例: `KeyR → ShiftLeft`、`KeyT → Home` のリマップがあれば実入力は R+T）。
 *   Shift 成分は `resolveShiftComponent()`（ShiftLeft 優先、無ければ ShiftRight、
 *   どちらも無ければ物理 Shift＝⇧ 表記）、Home 成分は `targetKeyCode`（= "Home"）を
 *   `resolveControlKeyComponent()` で解決し、`"${shiftLabel}+${homeLabel}"` の形で合成する。
 *   `isRemapped` はどちらか一方でもリマップされていれば true（例: Shift 側のみリマップなら
 *   表示は "R+Home"、Home 側のみなら "⇧+T"、両方なら "R+T"、両方非リマップなら "⇧+Home" だが
 *   この場合 isRemapped=false のため呼び出し側は複合ピルを使わず、非リマップ時と同一の
 *   "⇧Home" 単一ピル表示のままになる）
 * - 該当リマップが無ければ物理キーそのまま（`isRemapped: false`）を返す。**既知の限界**:
 *   物理キー自体が chat 文脈で別出力にリマップされており、かつ targetKeyCode を出力する
 *   リマップも無い場合（= 押しても意図した制御キーが出ない状態）でも、正解となるキーが
 *   存在しないため物理キーのまま `isRemapped: false` を返す
 *
 * 返り値の `tooltipLabel`（⇧ を使わないフル名称）と `remapDetails`（「リマップ: 物理 → 出力」用の
 * 詳細。⇧Home 合成時は成分ごとに複数件）はツールチップ表示専用。バッジ本体の描画には
 * 引き続き `displayLabel`（短縮記号あり）を使う。
 */
export function getActualControlKeyInfo(
  t: Translator,
  targetKeyCode: string,
  remaps: RemapInfo[],
  options?: { shiftHeld?: boolean },
): ActualControlKeyInfo {
  const chatRemaps = filterRemapsForChat(remaps);

  if (options?.shiftHeld) {
    const shiftPart = resolveShiftComponent(t, chatRemaps);
    const homePart = resolveControlKeyComponent(t, targetKeyCode, chatRemaps);
    return {
      keyCode: `${shiftPart.keyCode}+${homePart.keyCode}`,
      displayLabel: `${shiftPart.displayLabel}+${homePart.displayLabel}`,
      tooltipLabel: `${shiftPart.tooltipLabel}+${homePart.tooltipLabel}`,
      isRemapped: shiftPart.isRemapped || homePart.isRemapped,
      remapDetails: [...shiftPart.remapDetails, ...homePart.remapDetails],
    };
  }

  return resolveControlKeyComponent(t, targetKeyCode, chatRemaps);
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
 * 物理キー入力（修飾キー組み合わせ）にリマップを順方向に適用し、出力文字を求める（chat 文脈専用）。
 * trigger 種別のリマップは内部で除外され、同一 sourceKey の複数行は
 * chat > all > unset の優先度で1行に解決される（filterRemapsForChat）。
 * getActualKeyInfos()（文字→押すキーの逆引き）の対になる簡易シミュレーション。
 * 完全一致（修飾キー込み）→ 基底キー一致（Shift は大文字化として扱う）の順で解決する。
 */
export function simulateRemapOutput(
  t: Translator,
  combo: string,
  remaps: RemapInfo[],
): SimulatedKeyOutput {
  const chatRemaps = filterRemapsForChat(remaps);
  const normalized = normalizeKeyCombination(combo);
  const parsed = parseKeyCombination(normalized);
  const modifierMarks = parsed.modifiers.map(modifierToMark).join("");
  const baseChar = keyCodeToChar(parsed.keyCode);
  // 可視の1文字はその文字、それ以外（Space, F3, ShiftLeft 等）はキーラベルを表示
  const baseLabel = baseChar.trim().length === 1
    ? baseChar.toUpperCase()
    : getKeyLabel(t, parsed.keyCode);
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
  const exact = chatRemaps.find((r) => normalizeKeyCombination(r.sourceKey) === normalized);
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
    const base = chatRemaps.find((r) => normalizeKeyCombination(r.sourceKey) === normalizeKeyCode(parsed.keyCode));
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
