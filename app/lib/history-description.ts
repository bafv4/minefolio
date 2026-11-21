// 設定の変更履歴（config_history.change_description）の文言を「種類のトークン」で保存し、表示時に翻訳する。
//
// 背景: 以前は保存時の言語で組んだ文言をそのまま保存していたため、言語を切り替えても履歴は保存時の言語のままで、
// 文言を直すと同じ操作が新旧の文言に割れて「×N」のまとめも効かなかった。
//
// 記録規約（スキーマ変更なし。既存の change_description 列に入れる）:
//   `@h:<kind>` または `@h:<kind>|<JSON のパラメータ>`。パラメータは文字列だけ（プリセット名など）。
//   書き込み側は encodeHistoryDescription()、読み取り側は parseHistoryDescription() → describeHistory()。
//
// 既存の行（トークン導入前に保存された日本語・英語の文言、旧文言）は、parseHistoryDescription() が
// 現行の文言テンプレートと旧文言から種類とパラメータへ読み替えるので、新旧が同じ操作として扱われる。
// 読み替えできない行は文言のまま表示する。
import { SUPPORTED_LOCALES } from "./locale";
import { t as translate, type MessageKey, type Translator } from "./messages";

const TOKEN_PREFIX = "@h:";

type HistoryKindDef = {
  /** 表示に使う翻訳キー（パラメータ名は文言中の `{name}` と同じ） */
  key: MessageKey;
  /** トークン導入前に保存された旧文言（`{param}` 付きのテンプレート。ロケール問わず照合する） */
  legacy?: readonly string[];
};

const HISTORY_KINDS = {
  "devices.update": {
    key: "meDevices.deviceChangeHistory",
    legacy: ["デバイス・設定を更新", "Update devices & settings"],
  },
  "items.update": { key: "meItems.itemLayoutChangeHistory" },
  "searchCraft.update": { key: "meSearchCraft.searchCraftChangeHistory" },
  // changes は変更した欄の id（KEYBINDING_CHANGE_LABEL_KEYS）をカンマ区切りで並べたもの
  "keybindings.update": { key: "meKeybindings.updatedChanges" },
  "preset.rename": { key: "mePresets.renameHistoryDescription" },
  "preset.describe": { key: "mePresets.descriptionHistoryDescription" },
  "preset.setMain": { key: "mePresets.setMainHistoryDescription" },
  "preset.delete": { key: "mePresets.deleteHistoryDescription" },
  "preset.copy": {
    key: "mePresets.copiedAndApplied",
    legacy: [
      "プリセット「{source}」をコピーして「{name}」を作成・適用",
      // 4f31a28（2026-11-17）より前の英語
      'Copied preset "{source}" to create and apply "{name}"',
    ],
  },
  "preset.createFromCurrent": {
    key: "mePresets.createdFromCurrentAndApplied",
    legacy: [
      "現在の設定からプリセット「{name}」を作成・適用",
      // 4f31a28（2026-11-17）より前の英語
      'Created and applied preset "{name}" from current settings',
    ],
  },
  "preset.createManual": { key: "mePresets.autoCreatedManualHistory" },
  "preset.createFromImport": { key: "mePresets.autoCreatedFromImportHistory" },
  "preset.createOnboarding": { key: "mePresets.autoCreatedOnboardingHistory" },
  "playground.saveNew": { key: "playground.saveNewPresetHistory" },
  "playground.saveTo": { key: "playground.saveToPresetHistory" },
  "template.apply": { key: "templates.applyChangeHistoryToPreset" },
} as const satisfies Record<string, HistoryKindDef>;

export type HistoryKind = keyof typeof HISTORY_KINDS;
export type HistoryParams = Record<string, string>;
export type ParsedHistory = { kind: HistoryKind; params: HistoryParams };

/** keybindings.update の changes に入れる欄の id と、その表示名の翻訳キー */
export const KEYBINDING_CHANGE_LABEL_KEYS = {
  actions: "meKeybindings.tabActions",
  remaps: "meKeybindings.tabRemaps",
  fingers: "meKeybindings.tabFingers",
  customActions: "meKeybindings.tabCustomActions",
  customKeys: "meKeybindings.tabCustomKeys",
} as const satisfies Record<string, MessageKey>;

export type KeybindingChangeId = keyof typeof KEYBINDING_CHANGE_LABEL_KEYS;

/** 履歴に保存する文字列を作る（change_description 列へそのまま入れる） */
export function encodeHistoryDescription(kind: HistoryKind, params?: HistoryParams): string {
  return params && Object.keys(params).length > 0
    ? `${TOKEN_PREFIX}${kind}|${JSON.stringify(params)}`
    : `${TOKEN_PREFIX}${kind}`;
}

/** keybindings.update の履歴を作る（変更した欄の id を渡す） */
export function encodeKeybindingUpdate(changes: readonly KeybindingChangeId[]): string {
  return encodeHistoryDescription("keybindings.update", { changes: changes.join(",") });
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `{name}` 付きのテンプレートを、パラメータを取り出す正規表現にする */
function templateToRegExp(template: string): RegExp {
  const pattern = template
    .split(/(\{\w+\})/)
    .map((part) => {
      const m = /^\{(\w+)\}$/.exec(part);
      return m ? `(?<${m[1]}>.+)` : escapeRegExp(part);
    })
    .join("");
  return new RegExp(`^${pattern}$`, "s");
}

type LegacyMatcher = { kind: HistoryKind; regex: RegExp };

let legacyMatchers: LegacyMatcher[] | null = null;

function getLegacyMatchers(): LegacyMatcher[] {
  if (legacyMatchers) return legacyMatchers;
  const list: LegacyMatcher[] = [];
  for (const [kind, def] of Object.entries(HISTORY_KINDS) as [HistoryKind, HistoryKindDef][]) {
    const templates = new Set<string>(def.legacy ?? []);
    for (const locale of SUPPORTED_LOCALES) {
      // 未翻訳のロケールは日本語へフォールバックするだけなので、集合で重複を除く
      templates.add(translate(def.key, undefined, locale));
    }
    for (const template of templates) list.push({ kind, regex: templateToRegExp(template) });
  }
  legacyMatchers = list;
  return list;
}

function isParamRecord(value: unknown): value is HistoryParams {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((v) => typeof v === "string")
  );
}

/** 旧文言の欄の表示名（tabActions は以前「操作の種類」だった） */
const LEGACY_CHANGE_LABELS: Record<string, KeybindingChangeId> = { 操作の種類: "actions" };

/** 旧文言の keybindings.update は「変更した欄の表示名」を区切り文字でつないだ文字列。欄の id へ戻せなければ null */
function legacyChangesToIds(raw: string): string | null {
  const ids: string[] = [];
  // 区切りは日本語「・」と英語「, 」（旧実装は保存時のロケールの listSeparator で連結していた）
  for (const label of raw.split(/・|, /)) {
    const legacyId = LEGACY_CHANGE_LABELS[label];
    if (legacyId) {
      ids.push(legacyId);
      continue;
    }
    const found = (Object.entries(KEYBINDING_CHANGE_LABEL_KEYS) as [KeybindingChangeId, MessageKey][]).find(
      ([, key]) => SUPPORTED_LOCALES.some((locale) => translate(key, undefined, locale) === label),
    );
    if (!found) return null;
    ids.push(found[0]);
  }
  return ids.join(",");
}

/**
 * 保存された change_description を、種類とパラメータへ読み替える。
 * トークン形式・旧文言のどちらも対象。読み替えできなければ null（文言のまま表示する）。
 */
export function parseHistoryDescription(stored: string): ParsedHistory | null {
  if (stored.startsWith(TOKEN_PREFIX)) {
    const body = stored.slice(TOKEN_PREFIX.length);
    const sep = body.indexOf("|");
    const kind = sep === -1 ? body : body.slice(0, sep);
    if (!Object.hasOwn(HISTORY_KINDS, kind)) return null;
    if (sep === -1) return { kind: kind as HistoryKind, params: {} };
    try {
      const params: unknown = JSON.parse(body.slice(sep + 1));
      return isParamRecord(params) ? { kind: kind as HistoryKind, params } : null;
    } catch {
      return null;
    }
  }
  for (const { kind, regex } of getLegacyMatchers()) {
    const m = regex.exec(stored);
    if (!m) continue;
    const params: HistoryParams = { ...(m.groups ?? {}) };
    if (kind === "keybindings.update") {
      const ids = legacyChangesToIds(params.changes ?? "");
      if (ids === null) return null;
      params.changes = ids;
    }
    return { kind, params };
  }
  return null;
}

/** 履歴 1 行の文言。読み替えできた行は表示ロケールで組み、できなければ保存された文言のまま返す */
export function describeHistory(t: Translator, stored: string, parsed: ParsedHistory | null): string {
  if (!parsed) return stored;
  const def: HistoryKindDef = HISTORY_KINDS[parsed.kind];
  if (parsed.kind === "keybindings.update") {
    const labels = (parsed.params.changes ?? "")
      .split(",")
      .filter((id): id is KeybindingChangeId => Object.hasOwn(KEYBINDING_CHANGE_LABEL_KEYS, id))
      .map((id) => t(KEYBINDING_CHANGE_LABEL_KEYS[id]));
    return t(def.key, { changes: labels.join(t("common.listSeparator")) });
  }
  return t(def.key, parsed.params);
}

/** 「同じ操作」の判定キー。新旧の保存形式・言語が違っても、種類とパラメータが同じなら同じキーになる */
export function historyGroupKey(stored: string, parsed: ParsedHistory | null): string {
  if (!parsed) return `raw:${stored}`;
  const params = Object.fromEntries(Object.entries(parsed.params).sort(([a], [b]) => a.localeCompare(b)));
  return `${parsed.kind}|${JSON.stringify(params)}`;
}
