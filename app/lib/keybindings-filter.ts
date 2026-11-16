// /keybindings の「キー名での並べ替え」「操作＝キーの絞り込み」の純粋ロジック。
// 表・ビジュアル・フィルターが同じ判定を使えるよう、コンポーネントから切り離している。
import {
  getActionLabel,
  getKeyCodeAliases,
  getKeyCombinationLabel,
  getKeyLabel,
  isUnbound,
  keysEqual,
  normalizeKeyCode,
} from "@/lib/keybindings";
import type { Locale } from "@/lib/locale";
import type { Translator } from "@/lib/messages";
import type { BindCondition } from "@/lib/keybindings-search-params";

/** 操作＝キーの判定・並べ替えが読む最小の行 */
export type BoundKeyRow = {
  keybindings: ReadonlyArray<{ action: string; keyCode: string }>;
  customKeys?: ReadonlyArray<{ keyCode: string; keyName: string }>;
  playerConfig?: { keyboardLayout?: string | null } | null;
};

/** 行のその操作に割り当てられている keyCode。未割り当て・不使用は undefined */
export function getBoundKeyCode(row: BoundKeyRow, action: string): string | undefined {
  const keyCode = row.keybindings.find((kb) => kb.action === action)?.keyCode;
  return keyCode && !isUnbound(keyCode) ? keyCode : undefined;
}

/**
 * 表のキーバッジ（KeyBadge）と同じ決め方の表示ラベル。
 * カスタムキー名 → 組み合わせ → その走者の配列を考慮した getKeyLabel の順。
 * 未割り当ては undefined（並べ替えで常に末尾に回すため、空文字にしない）。
 */
export function getBoundKeyLabel(
  t: Translator,
  row: BoundKeyRow,
  action: string,
): string | undefined {
  const keyCode = getBoundKeyCode(row, action);
  if (keyCode === undefined) return undefined;
  const normalized = normalizeKeyCode(keyCode);
  const custom = row.customKeys?.find(
    (ck) => ck.keyCode === keyCode || ck.keyCode === normalized,
  )?.keyName;
  if (custom) return custom;
  const layout = row.playerConfig?.keyboardLayout ?? null;
  return keyCode.includes("+")
    ? getKeyCombinationLabel(t, keyCode, layout)
    : getKeyLabel(t, keyCode, layout);
}

/**
 * キー名の比較。F2 < F10 になる数値順で、ロケールは明示する
 * （既定任せだと SSR とブラウザで順がずれてハイドレーションが合わなくなる）。
 */
export function compareKeyLabels(a: string, b: string, locale: Locale): number {
  return a.localeCompare(b, locale, { numeric: true });
}

/**
 * 条件のキーと走者のキーが同じキーか。大文字小文字・Minecraft 形式の違いは keysEqual が吸収し、
 * JIS の半角（IntlYen と Backquote）は、どちらが保存されていても同じキーとして扱う
 * （別名は片方向にしか展開されないので、走者の配列で両側を展開して突き合わせる）。
 */
export function bindKeysMatch(
  boundKeyCode: string,
  conditionKeyCode: string,
  layout: string | null | undefined,
): boolean {
  const left = getKeyCodeAliases(boundKeyCode, layout);
  const right = getKeyCodeAliases(conditionKeyCode, layout);
  return left.some((a) => right.some((b) => keysEqual(a, b)));
}

/** 行が全条件（AND）を満たすか。条件が空なら常に true */
export function rowMatchesBind(
  row: BoundKeyRow,
  conditions: readonly BindCondition[],
): boolean {
  if (conditions.length === 0) return true;
  const layout = row.playerConfig?.keyboardLayout ?? null;
  return conditions.every((cond) => {
    const keyCode = getBoundKeyCode(row, cond.action);
    return keyCode !== undefined && bindKeysMatch(keyCode, cond.keyCode, layout);
  });
}

/**
 * 操作＝キーの条件に出す「操作 = キー」の文言（チップ・ダイアログ共通）。
 * 条件は走者の配列に依らないので、キー名は配列を指定しない既定のラベルで出す。
 */
export function bindConditionLabel(t: Translator, cond: BindCondition): string {
  return t("keybindings.bindFilterChip", {
    action: getActionLabel(t, cond.action),
    key: getKeyLabel(t, cond.keyCode),
  });
}

/**
 * ある操作に、いずれかの走者が実際に割り当てているキー（keyCode と表示名）。
 * 表示名の昇順（並べ替えは中立な名前順のみ。人数の多い順にはしない）。
 * 修飾キーとの組み合わせ（"Ctrl+KeyA"）は URL の `bind` に載せない（"+" の扱いを避ける）ため含めない。
 */
export function collectBoundKeys(
  t: Translator,
  rows: ReadonlyArray<BoundKeyRow>,
  action: string,
  locale: Locale,
): Array<{ keyCode: string; label: string }> {
  const byNormalized = new Map<string, { keyCode: string; label: string }>();
  for (const row of rows) {
    const keyCode = getBoundKeyCode(row, action);
    if (keyCode === undefined || keyCode.includes("+")) continue;
    const normalized = normalizeKeyCode(keyCode);
    if (!byNormalized.has(normalized)) {
      byNormalized.set(normalized, { keyCode: normalized, label: getKeyLabel(t, normalized) });
    }
  }
  return [...byNormalized.values()].sort((a, b) => compareKeyLabels(a.label, b.label, locale));
}

/**
 * キー配置を持つ走者か（不使用以外の割り当てが 1 つでもある）。
 * `actions` を渡すと、その操作の中だけで判定する。キーのタブ（移動・インベントリ・戦闘・UI）は、
 * そのタブの列がすべて「未割り当て」の走者を載せない（マウスタブが「設定のある走者のみ」なのと同じ扱い）。
 */
export function hasKeyBindings(
  row: Pick<BoundKeyRow, "keybindings">,
  actions?: readonly string[],
): boolean {
  return row.keybindings.some(
    (kb) => !isUnbound(kb.keyCode) && (!actions || actions.includes(kb.action)),
  );
}

/**
 * ビジュアルに載せる走者か。キーボード上に何も描くものが無い走者（割り当て・リマップ・
 * カスタムアクションのどれも無い）は、空のキーボードのカードになるので載せない。
 */
export function hasKeyboardContent(
  row: Pick<BoundKeyRow, "keybindings"> & {
    keyRemaps?: ReadonlyArray<unknown>;
    customActions?: ReadonlyArray<unknown>;
  },
): boolean {
  return (
    hasKeyBindings(row) ||
    (row.keyRemaps?.length ?? 0) > 0 ||
    (row.customActions?.length ?? 0) > 0
  );
}

/** マウス設定（DPI・感度・Windows 速度のいずれか）を 1 つでも持つか。マウスタブ・カードの要約が共有する */
export function hasMouseSettings(
  config:
    | {
        mouseDpi: number | null;
        gameSensitivity: number | null;
        windowsSpeed: number | null;
        windowsSpeedMultiplier: number | null;
      }
    | null
    | undefined,
): boolean {
  return (
    config != null &&
    (config.mouseDpi != null ||
      config.gameSensitivity != null ||
      config.windowsSpeed != null ||
      config.windowsSpeedMultiplier != null)
  );
}
