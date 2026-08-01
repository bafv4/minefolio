// プレイスタイル（バージョン/カテゴリ・入力操作・テクニック系の自己申告設定）関連の共有定義。
// `.server` ではない（クライアント/サーバー共用）。DOM/リクエスト依存を持たず、
// 編集フォーム（/me/playstyle）とプロフィール表示の両方から import される想定。
//
// テーブル定義: app/lib/schema.ts の `playstyles`（1 user : 1 行、全項目 nullable）。
// UI 側の実装（/me/playstyle・profile.tsx のプレイスタイルタブ）は別フェーズで追加される。

// ============================================
// ラベルの i18n キー
// ============================================
// `playstyle.*` ネームスペース配下の文字列を想定するが、実体（翻訳文言）は
// app/lib/messages/pages-ja.ts への追加を伴う別フェーズで用意する。
// このモジュールは非 .server の基盤コードとして「キー名の約束」だけを確定させる。
// そのため `@/lib/messages` の `MessageKey`（pages-ja.ts のキーから導出される厳密なユニオン型）
// ではなく素の `string` を使う。翻訳追加後に呼び出し側で `t(labelKey as MessageKey)` のように
// 解決する想定（`MessageKey` への差し替えは翻訳追加時に行う）。
export type PlaystyleLabelKey = string;

// ============================================
// バージョン・エディション
// ============================================
// speedrun.com のバージョン区分に準拠。ラベルはロケール非依存の直書き文字列
// （バージョン名は言語を問わず同じ表記のため翻訳しない）。
export const JAVA_VERSIONS = {
  pre_1_8: "Pre 1.8",
  "1_8": "1.8",
  "1_9_1_12": "1.9-1.12",
  "1_13_1_15": "1.13-1.15",
  "1_16_1_19": "1.16-1.19",
  "1_20_plus": "1.20+",
} as const;

export const BEDROCK_VERSIONS = {
  pre_1_11: "Pre 1.11",
  "1_11_1_14": "1.11-1.14",
  "1_16": "1.16",
  "1_16_100_1_17": "1.16.100-1.17",
  "1_18": "1.18+",
} as const;

export type Edition = "java" | "bedrock";
export type JavaVersionCode = keyof typeof JAVA_VERSIONS;
export type BedrockVersionCode = keyof typeof BEDROCK_VERSIONS;

/** DB 保存形式（"java:1_16_1_19" のようなエディション:バージョンの連結キー） */
export type VersionKey = `java:${JavaVersionCode}` | `bedrock:${BedrockVersionCode}`;

/** 全バージョンキー（Java → Bedrock、それぞれ定義順）。isVersionKey・正規化の基準集合 */
export const ALL_VERSION_KEYS: readonly VersionKey[] = [
  ...(Object.keys(JAVA_VERSIONS) as JavaVersionCode[]).map((code) => `java:${code}` as VersionKey),
  ...(Object.keys(BEDROCK_VERSIONS) as BedrockVersionCode[]).map((code) => `bedrock:${code}` as VersionKey),
];

const VERSION_KEY_SET = new Set<string>(ALL_VERSION_KEYS);

export function isVersionKey(value: unknown): value is VersionKey {
  return typeof value === "string" && VERSION_KEY_SET.has(value);
}

/** バージョンキーのエディション部分を返す（メインバージョン → Java/Bedrock バッジ決定に使用） */
export function editionOfVersion(key: VersionKey): Edition {
  return key.startsWith("java:") ? "java" : "bedrock";
}

/** バージョンキーの表示ラベル（例: "java:1_16_1_19" → "1.16-1.19"。エディション名は含まない） */
export function versionLabel(key: VersionKey): string {
  const separatorIndex = key.indexOf(":");
  const edition = key.slice(0, separatorIndex) as Edition;
  const code = key.slice(separatorIndex + 1);
  return edition === "java"
    ? JAVA_VERSIONS[code as JavaVersionCode]
    : BEDROCK_VERSIONS[code as BedrockVersionCode];
}

/** バージョンキーの配列をエディション別に振り分ける（編集UIのチェックボックス群・プロフィール表示のグルーピング用） */
export function groupVersionsByEdition(
  keys: readonly VersionKey[],
): { java: VersionKey[]; bedrock: VersionKey[] } {
  const java: VersionKey[] = [];
  const bedrock: VersionKey[] = [];
  for (const key of keys) {
    (editionOfVersion(key) === "java" ? java : bedrock).push(key);
  }
  return { java, bedrock };
}

// ============================================
// カテゴリ
// ============================================
export type CategoryKey = "rsg" | "ssg" | "aa" | "ce" | "ranked" | "other";

export interface CategoryOption {
  value: CategoryKey;
  /** ロケール非依存の直書きラベル（speedrun.com 準拠）。"その他" のみ null で labelKey を使う */
  label: string | null;
  labelKey: PlaystyleLabelKey | null;
}

export const CATEGORIES: readonly CategoryOption[] = [
  { value: "rsg", label: "RSG (Any%)", labelKey: null },
  { value: "ssg", label: "SSG (Any%)", labelKey: null },
  { value: "aa", label: "AA", labelKey: null },
  { value: "ce", label: "CE", labelKey: null },
  { value: "ranked", label: "MCSR Ranked", labelKey: null },
  { value: "other", label: null, labelKey: "playstyle.categoryOther" },
];

const CATEGORY_KEYS: readonly CategoryKey[] = CATEGORIES.map((c) => c.value);
const CATEGORY_KEY_SET = new Set<string>(CATEGORY_KEYS);

export function isCategoryKey(value: unknown): value is CategoryKey {
  return typeof value === "string" && CATEGORY_KEY_SET.has(value);
}

// ============================================
// 選択肢セット（labelKey 形式。実体は playstyle.* ネームスペースに別フェーズで追加）
// ============================================

/** ホットバー切替方法。常時表示 */
export type HotbarSwitching =
  | "hotkeys"
  | "hotkeys_sometimes_wheel"
  | "wheel_sometimes_hotkeys"
  | "wheel";

export const HOTBAR_SWITCHING_OPTIONS = [
  { value: "hotkeys", labelKey: "playstyle.hotbarSwitching.hotkeys" },
  { value: "hotkeys_sometimes_wheel", labelKey: "playstyle.hotbarSwitching.hotkeysSometimesWheel" },
  { value: "wheel_sometimes_hotkeys", labelKey: "playstyle.hotbarSwitching.wheelSometimesHotkeys" },
  { value: "wheel", labelKey: "playstyle.hotbarSwitching.wheel" },
] as const satisfies readonly { value: HotbarSwitching; labelKey: PlaystyleLabelKey }[];

/** サーチクラフト度。「しない」の場合プロフィールのSCタブを非表示にする */
export type SearchCraftLevel = "does" | "does_a_little" | "does_not";

export const SEARCH_CRAFT_OPTIONS = [
  { value: "does", labelKey: "playstyle.searchCraft.does" },
  { value: "does_a_little", labelKey: "playstyle.searchCraft.doesALittle" },
  { value: "does_not", labelKey: "playstyle.searchCraft.doesNot" },
] as const satisfies readonly { value: SearchCraftLevel; labelKey: PlaystyleLabelKey }[];

/** 頻度5段階。半シフト（halfShift）・Zero Cycle（zeroCycle）で共用 */
export type FrequencyLevel = "actively" | "does" | "sometimes" | "rarely" | "does_not";

export const FREQUENCY_OPTIONS = [
  { value: "actively", labelKey: "playstyle.frequency.actively" },
  { value: "does", labelKey: "playstyle.frequency.does" },
  { value: "sometimes", labelKey: "playstyle.frequency.sometimes" },
  { value: "rarely", labelKey: "playstyle.frequency.rarely" },
  { value: "does_not", labelKey: "playstyle.frequency.doesNot" },
] as const satisfies readonly { value: FrequencyLevel; labelKey: PlaystyleLabelKey }[];

/** アイテム配置を決めているか。常時表示 */
export type ItemLayoutPolicy = "strict" | "rough" | "mood";

export const ITEM_LAYOUT_POLICY_OPTIONS = [
  { value: "strict", labelKey: "playstyle.itemLayoutPolicy.strict" },
  { value: "rough", labelKey: "playstyle.itemLayoutPolicy.rough" },
  { value: "mood", labelKey: "playstyle.itemLayoutPolicy.mood" },
] as const satisfies readonly { value: ItemLayoutPolicy; labelKey: PlaystyleLabelKey }[];

/** 高CPSクリック方法（複数選択）。KBM限定（isKbmPlaystyle が true の場合のみ表示） */
export type ClickMethod = "normal" | "jitter" | "butterfly" | "drag";

export const CLICK_METHOD_OPTIONS = [
  { value: "normal", labelKey: "playstyle.clickMethod.normal" },
  { value: "jitter", labelKey: "playstyle.clickMethod.jitter" },
  { value: "butterfly", labelKey: "playstyle.clickMethod.butterfly" },
  { value: "drag", labelKey: "playstyle.clickMethod.drag" },
] as const satisfies readonly { value: ClickMethod; labelKey: PlaystyleLabelKey }[];

/** できる/できない。Ground Zero・Oneshot で使用（Java の RSG/Ranked をする場合のみ表示） */
export type CanCannot = "can" | "cannot";

export const CAN_CANNOT_OPTIONS = [
  { value: "can", labelKey: "playstyle.canCannot.can" },
  { value: "cannot", labelKey: "playstyle.canCannot.cannot" },
] as const satisfies readonly { value: CanCannot; labelKey: PlaystyleLabelKey }[];

/** マウスパッドを使うか。KBM限定 */
export type UsesMousepad = "uses" | "does_not_use";

export const USES_MOUSEPAD_OPTIONS = [
  { value: "uses", labelKey: "playstyle.usesMousepad.uses" },
  { value: "does_not_use", labelKey: "playstyle.usesMousepad.doesNot" },
] as const satisfies readonly { value: UsesMousepad; labelKey: PlaystyleLabelKey }[];

/** 好きな廃要塞の種類。1.16+ のバージョン選択時のみ表示（hasBastionVersions） */
export type BastionType = "housing" | "stables" | "bridge" | "treasure";

export const BASTION_OPTIONS = [
  { value: "housing", labelKey: "playstyle.bastion.housing" },
  { value: "stables", labelKey: "playstyle.bastion.stables" },
  { value: "bridge", labelKey: "playstyle.bastion.bridge" },
  { value: "treasure", labelKey: "playstyle.bastion.treasure" },
] as const satisfies readonly { value: BastionType; labelKey: PlaystyleLabelKey }[];

const CLICK_METHOD_KEYS: readonly ClickMethod[] = CLICK_METHOD_OPTIONS.map((o) => o.value);

function isClickMethod(value: unknown): value is ClickMethod {
  return typeof value === "string" && (CLICK_METHOD_KEYS as readonly string[]).includes(value);
}

// ============================================
// 破損JSON耐性パーサ（DB の text 列 → 型付き配列。読み取り専用）
// ============================================
// app/lib/preset-read.ts の safeParseArray と同じ方針: 破損JSON・非配列・未知キーは
// 例外を投げず黙って捨てる（公開ページ/編集フォームを壊れたデータで落とさない）。
function safeParseJsonArray(json: string | null | undefined): unknown[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function parsePlaystyleVersions(json: string | null | undefined): VersionKey[] {
  return safeParseJsonArray(json).filter(isVersionKey);
}

export function parsePlaystyleCategories(json: string | null | undefined): CategoryKey[] {
  return safeParseJsonArray(json).filter(isCategoryKey);
}

export function parsePlaystyleClickMethods(json: string | null | undefined): ClickMethod[] {
  return safeParseJsonArray(json).filter(isClickMethod);
}

// ============================================
// 表示条件ヘルパー（編集UI・プロフィール表示で共用）
// ============================================

/** KBM（キーボード/マウス）操作かどうか。高CPSクリック方法・マウスパッドの表示条件 */
export function isKbmPlaystyle(inputMethod: string | null | undefined): boolean {
  return inputMethod === "keyboard_mouse";
}

/** Java の RSG または Ranked をプレイするか。Zero Cycle・Ground Zero・Oneshot の表示条件 */
export function playsJavaRsgOrRanked(
  versions: readonly VersionKey[],
  categories: readonly CategoryKey[],
): boolean {
  const hasJava = versions.some((v) => editionOfVersion(v) === "java");
  const hasRsgOrRanked = categories.some((c) => c === "rsg" || c === "ranked");
  return hasJava && hasRsgOrRanked;
}

/** 1.16+ のバージョン（廃要塞が存在する版）を1つ以上選んでいるか。好きな廃要塞の表示条件 */
const BASTION_VERSION_KEYS: readonly VersionKey[] = [
  "java:1_16_1_19",
  "java:1_20_plus",
  "bedrock:1_16",
  "bedrock:1_16_100_1_17",
  "bedrock:1_18",
];
const BASTION_VERSION_KEY_SET = new Set<VersionKey>(BASTION_VERSION_KEYS);

export function hasBastionVersions(versions: readonly VersionKey[]): boolean {
  return versions.some((v) => BASTION_VERSION_KEY_SET.has(v));
}

// ============================================
// バリデーション（書き込み経路。/me/playstyle の action から使用）
// ============================================
// 条件付き項目（KBM限定・Java RSG/Ranked限定・1.16+限定）についても、値そのものは
// 条件を満たさない場合でも受理する（データ保持方針。入力方法やバージョンを切り替えて
// 戻しても以前の値が残る）。表示条件は編集UI・プロフィール表示側が上記ヘルパーで判定する。

export interface PlaystyleInput {
  versions?: unknown;
  categories?: unknown;
  mainVersion?: unknown;
  mainCategory?: unknown;
  hotbarSwitching?: unknown;
  searchCraft?: unknown;
  halfShift?: unknown;
  itemLayoutPolicy?: unknown;
  clickMethods?: unknown;
  dragTapeType?: unknown;
  usesMousepad?: unknown;
  mousepadType?: unknown;
  zeroCycle?: unknown;
  groundZero?: unknown;
  oneshot?: unknown;
  favoriteBastion?: unknown;
}

export interface ValidatedPlaystyle {
  versions: VersionKey[];
  categories: CategoryKey[];
  mainVersion: VersionKey | null;
  mainCategory: CategoryKey | null;
  hotbarSwitching: HotbarSwitching | null;
  searchCraft: SearchCraftLevel | null;
  halfShift: FrequencyLevel | null;
  itemLayoutPolicy: ItemLayoutPolicy | null;
  clickMethods: ClickMethod[];
  dragTapeType: string | null;
  usesMousepad: UsesMousepad | null;
  mousepadType: string | null;
  zeroCycle: FrequencyLevel | null;
  groundZero: CanCannot | null;
  oneshot: CanCannot | null;
  favoriteBastion: BastionType | null;
}

/**
 * validatePlaystyle が返す errorKey の一覧（`mePlaystyle.*` ネームスペース）。
 * 文言の実体は別フェーズ（app/lib/messages/pages-ja.ts への追加）で用意する。
 *
 * - mePlaystyle.errorMainVersionInvalid  … mainVersion が versions（正規化後）に含まれていない
 * - mePlaystyle.errorMainCategoryInvalid … mainCategory が categories（正規化後）に含まれていない
 * - mePlaystyle.errorInvalidOption       … enum系フィールド（hotbarSwitching / searchCraft /
 *                                          halfShift / itemLayoutPolicy / usesMousepad /
 *                                          zeroCycle / groundZero / oneshot / favoriteBastion）
 *                                          に選択肢に無い値が渡された
 * - mePlaystyle.errorDragTapeTypeTooLong  … dragTapeType が trim 後100文字を超える
 * - mePlaystyle.errorMousepadTypeTooLong  … mousepadType が trim 後100文字を超える
 */
export type PlaystyleValidationResult =
  | { ok: true; value: ValidatedPlaystyle }
  | { ok: false; errorKey: string };

const INVALID = Symbol("invalid");

/** 配列入力を既知キーのみ・重複除去・定義順（order の並び）に正規化する。非配列は空配列扱い */
function normalizeKnownArray<T extends string>(
  value: unknown,
  order: readonly T[],
  guard: (v: unknown) => v is T,
): T[] {
  if (!Array.isArray(value)) return [];
  const selected = new Set(value.filter(guard));
  return order.filter((key) => selected.has(key));
}

/** メイン選択（mainVersion / mainCategory）。未指定は null、選択済み集合に無ければ INVALID */
function normalizeMainSelection<T extends string>(
  value: unknown,
  selected: readonly T[],
  guard: (v: unknown) => v is T,
): T | null | typeof INVALID {
  if (value === undefined || value === null || value === "") return null;
  if (!guard(value) || !selected.includes(value)) return INVALID;
  return value;
}

/** 単一 enum フィールド。未指定は null、選択肢に無ければ INVALID */
function normalizeEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | null | typeof INVALID {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) return INVALID;
  return value as T;
}

/** 自由入力欄（dragTapeType / mousepadType）。trim + 最大文字数、空文字は null */
function normalizeFreeText(
  value: unknown,
  maxLength: number,
): { ok: true; value: string | null } | { ok: false } {
  if (value === undefined || value === null || typeof value !== "string") {
    return { ok: true, value: null };
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: true, value: null };
  if (trimmed.length > maxLength) return { ok: false };
  return { ok: true, value: trimmed };
}

const HOTBAR_SWITCHING_VALUES: readonly HotbarSwitching[] = HOTBAR_SWITCHING_OPTIONS.map((o) => o.value);
const SEARCH_CRAFT_VALUES: readonly SearchCraftLevel[] = SEARCH_CRAFT_OPTIONS.map((o) => o.value);
const FREQUENCY_VALUES: readonly FrequencyLevel[] = FREQUENCY_OPTIONS.map((o) => o.value);
const ITEM_LAYOUT_POLICY_VALUES: readonly ItemLayoutPolicy[] = ITEM_LAYOUT_POLICY_OPTIONS.map((o) => o.value);
const CAN_CANNOT_VALUES: readonly CanCannot[] = CAN_CANNOT_OPTIONS.map((o) => o.value);
const USES_MOUSEPAD_VALUES: readonly UsesMousepad[] = USES_MOUSEPAD_OPTIONS.map((o) => o.value);
const BASTION_VALUES: readonly BastionType[] = BASTION_OPTIONS.map((o) => o.value);

const FREE_TEXT_MAX_LENGTH = 100;

export function validatePlaystyle(input: PlaystyleInput): PlaystyleValidationResult {
  const versions = normalizeKnownArray(input.versions, ALL_VERSION_KEYS, isVersionKey);
  const categories = normalizeKnownArray(input.categories, CATEGORY_KEYS, isCategoryKey);
  const clickMethods = normalizeKnownArray(input.clickMethods, CLICK_METHOD_KEYS, isClickMethod);

  const mainVersion = normalizeMainSelection(input.mainVersion, versions, isVersionKey);
  if (mainVersion === INVALID) return { ok: false, errorKey: "mePlaystyle.errorMainVersionInvalid" };

  const mainCategory = normalizeMainSelection(input.mainCategory, categories, isCategoryKey);
  if (mainCategory === INVALID) return { ok: false, errorKey: "mePlaystyle.errorMainCategoryInvalid" };

  const hotbarSwitching = normalizeEnum(input.hotbarSwitching, HOTBAR_SWITCHING_VALUES);
  if (hotbarSwitching === INVALID) return { ok: false, errorKey: "mePlaystyle.errorInvalidOption" };

  const searchCraft = normalizeEnum(input.searchCraft, SEARCH_CRAFT_VALUES);
  if (searchCraft === INVALID) return { ok: false, errorKey: "mePlaystyle.errorInvalidOption" };

  const halfShift = normalizeEnum(input.halfShift, FREQUENCY_VALUES);
  if (halfShift === INVALID) return { ok: false, errorKey: "mePlaystyle.errorInvalidOption" };

  const itemLayoutPolicy = normalizeEnum(input.itemLayoutPolicy, ITEM_LAYOUT_POLICY_VALUES);
  if (itemLayoutPolicy === INVALID) return { ok: false, errorKey: "mePlaystyle.errorInvalidOption" };

  const usesMousepad = normalizeEnum(input.usesMousepad, USES_MOUSEPAD_VALUES);
  if (usesMousepad === INVALID) return { ok: false, errorKey: "mePlaystyle.errorInvalidOption" };

  const zeroCycle = normalizeEnum(input.zeroCycle, FREQUENCY_VALUES);
  if (zeroCycle === INVALID) return { ok: false, errorKey: "mePlaystyle.errorInvalidOption" };

  const groundZero = normalizeEnum(input.groundZero, CAN_CANNOT_VALUES);
  if (groundZero === INVALID) return { ok: false, errorKey: "mePlaystyle.errorInvalidOption" };

  const oneshot = normalizeEnum(input.oneshot, CAN_CANNOT_VALUES);
  if (oneshot === INVALID) return { ok: false, errorKey: "mePlaystyle.errorInvalidOption" };

  const favoriteBastion = normalizeEnum(input.favoriteBastion, BASTION_VALUES);
  if (favoriteBastion === INVALID) return { ok: false, errorKey: "mePlaystyle.errorInvalidOption" };

  const dragTapeTypeResult = normalizeFreeText(input.dragTapeType, FREE_TEXT_MAX_LENGTH);
  if (!dragTapeTypeResult.ok) return { ok: false, errorKey: "mePlaystyle.errorDragTapeTypeTooLong" };

  const mousepadTypeResult = normalizeFreeText(input.mousepadType, FREE_TEXT_MAX_LENGTH);
  if (!mousepadTypeResult.ok) return { ok: false, errorKey: "mePlaystyle.errorMousepadTypeTooLong" };

  return {
    ok: true,
    value: {
      versions,
      categories,
      mainVersion,
      mainCategory,
      hotbarSwitching,
      searchCraft,
      halfShift,
      itemLayoutPolicy,
      clickMethods,
      dragTapeType: dragTapeTypeResult.value,
      usesMousepad,
      mousepadType: mousepadTypeResult.value,
      zeroCycle,
      groundZero,
      oneshot,
      favoriteBastion,
    },
  };
}
