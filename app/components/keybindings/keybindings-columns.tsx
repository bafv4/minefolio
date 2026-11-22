// /keybindings の TanStack Table 列プリセット定義。
// 4 つのサブタブ（actions / remaps / custom-actions / mouse）ごとに ColumnDef 配列を export。
import {
  columnResizingFeature,
  columnSizingFeature,
  createSortedRowModel,
  rowSortingFeature,
  sortFn_basic,
  tableFeatures,
  type ColumnDef,
} from "@tanstack/react-table";
import { getActionLabel } from "@/lib/keybindings";
import {
  compareKeyLabels,
  getBoundKeyCode,
  getBoundKeyLabel,
} from "@/lib/keybindings-filter";
import {
  COMBAT_UI_ACTIONS,
  INVENTORY_ACTIONS,
  MOVEMENT_ACTIONS,
} from "@/lib/keybindings-search-params";
import { DEFAULT_LOCALE, type Locale } from "@/lib/locale";
import {
  calculateCm360,
  calculateCursorSpeed,
  isValidSensitivity,
  toSensitivityPercent,
} from "@/lib/mouse-settings";
import type { Translator } from "@/lib/messages";
import {
  ActionKeyCell,
  buildCustomKeyNames,
  Cm360Cell,
  CursorSpeedCell,
  DpiCell,
  HotbarSummaryCell,
  RawInputCell,
  AccelerationCell,
  RemapCell,
  CustomActionCell,
  RunnerCell,
  SensitivityCell,
  WindowsSpeedCell,
  type CustomActionItem,
  type MouseConfig,
  type RemapItem,
} from "./keybindings-cells";

/**
 * TanStack Table v9 の feature 構成。使う機能（ソート・列サイズ・列リサイズ）だけを明示登録する。
 * ソート可能な列は数値のみで、`sortFn: "auto"` は `basic` に解決されるため `basic` だけ登録する。
 * 参照が安定するようモジュールスコープで 1 度だけ作る。
 */
export const keybindingsTableFeatures = tableFeatures({
  rowSortingFeature,
  columnSizingFeature,
  // columnResizingFeature は columnSizingFeature を前提とするため後に置く
  columnResizingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { basic: sortFn_basic },
});

export type KeybindingsFeatures = typeof keybindingsTableFeatures;

/** 本テーブルの列定義型（v9 は `ColumnDef<TFeatures, TData>`） */
export type KeybindingsColumnDef = ColumnDef<KeybindingsFeatures, KeybindingsRow>;

/** TanStack Table が受け取る行データ型（4 ビュー共通） */
export type KeybindingsRow = {
  id: string;
  slug: string;
  mcid: string | null;
  uuid: string | null;
  displayName: string | null;
  displayNameAlphabet?: string | null;
  customSkinUrl: string | null;
  keybindings: Array<{
    id: string;
    action: string;
    keyCode: string;
    category: string;
  }>;
  keyRemaps: RemapItem[];
  customActions: CustomActionItem[];
  customKeys?: Array<{ keyCode: string; keyName: string; category: string }>;
  playerConfig: MouseConfig;
};

/* ============================================================
 * 共通: 走者列（左端 sticky）
 * ========================================================== */

const runnerColumn = (t: Translator): KeybindingsColumnDef => ({
  id: "runner",
  header: () => t("keybindings.columnRunner"),
  cell: ({ row }) => <RunnerCell player={row.original} />,
  enableSorting: false,
  size: 224,
  minSize: 140,
  // 幅は md 未満 / 以上で違うため CSS 変数で持つ（リサイズ後は px）
  meta: { widthVar: "--kb-runner-col", fixed: true },
});

/* ============================================================
 * アクション列ジェネレーター
 * 操作はプレイヤー画面と同じ粒度（移動 / インベントリ / 戦闘・UI）で分割する。
 * ========================================================== */

/** アクション 1 件分のキー表示列を生成。並べ替えはキーの表示ラベル（その走者の配列で決まる名前）で行う */
function actionColumn(t: Translator, locale: Locale, action: string): KeybindingsColumnDef {
  return {
    id: `action.${action}`,
    // 見えている文字と同じ内容の Tooltip は付けない（ノイズになる）
    header: () => getActionLabel(t, action),
    // 未割り当ては undefined（sortUndefined: "last" は undefined だけを見るので、昇順・降順どちらでも末尾になる）
    accessorFn: (row) => getBoundKeyLabel(t, row, action),
    cell: ({ row }) => (
      <ActionKeyCell
        keyCode={getBoundKeyCode(row.original, action)}
        keyboardLayout={row.original.playerConfig?.keyboardLayout}
        customKeyNames={buildCustomKeyNames(row.original.customKeys)}
      />
    ),
    enableSorting: true,
    sortUndefined: "last",
    sortFn: (rowA, rowB, columnId) =>
      compareKeyLabels(
        String(rowA.getValue(columnId)),
        String(rowB.getValue(columnId)),
        locale,
      ),
    size: 104,
    minSize: 56,
    // md 未満は約 68px（1 キーのバッジが収まる幅）。余りは比例配分で広げる
    meta: { align: "center" as const, widthVar: "--kb-action-col" },
  };
}

const hotbarColumn = (t: Translator): KeybindingsColumnDef => ({
  id: "action.hotbar",
  header: () => t("keybindings.hotbarColumn"),
  cell: ({ row }) => (
    <HotbarSummaryCell
      keybindings={row.original.keybindings}
      keyboardLayout={row.original.playerConfig?.keyboardLayout}
      customKeyNames={buildCustomKeyNames(row.original.customKeys)}
    />
  ),
  enableSorting: false,
  // hotbar1〜9 をすべて 1 行で表示するため、デフォルトで十分広く取る
  size: 360,
  minSize: 140,
  // md 未満は 240px（9 枠が 2 行に折り返して収まる）
  meta: { align: "left" as const, widthVar: "--kb-hotbar-col" },
});

// 移動: 前進・後退・左右・ジャンプ・スニーク・ダッシュ
const movementColumns = (t: Translator, locale: Locale): KeybindingsColumnDef[] => [
  runnerColumn(t),
  ...MOVEMENT_ACTIONS.map((a) => actionColumn(t, locale, a)),
];

// インベントリ: ホットバー（集約）・オフハンド・インベントリ・ブロック選択・ドロップ
const inventoryColumns = (t: Translator, locale: Locale): KeybindingsColumnDef[] => [
  runnerColumn(t),
  hotbarColumn(t),
  ...INVENTORY_ACTIONS.map((a) => actionColumn(t, locale, a)),
];

// 戦闘・UI: 攻撃・使用・視点切替・チャット・コマンド・全画面
const combatUiColumns = (t: Translator, locale: Locale): KeybindingsColumnDef[] => [
  runnerColumn(t),
  ...COMBAT_UI_ACTIONS.map((a) => actionColumn(t, locale, a)),
];

/* ============================================================
 * remaps プリセット
 * ========================================================== */

const remapsColumns = (t: Translator): KeybindingsColumnDef[] => [
  runnerColumn(t),
  {
    id: "remaps",
    header: () => t("keybindings.remapsTab"),
    cell: ({ row }) => (
      <RemapCell
        remaps={row.original.keyRemaps}
        keyboardLayout={row.original.playerConfig?.keyboardLayout}
        customKeyNames={buildCustomKeyNames(row.original.customKeys)}
      />
    ),
    enableSorting: false,
    size: 600,
    minSize: 200,
    // md 未満は残りの幅に収めてチップを折り返す。md 以上は 600px を下限に余りを吸収する
    meta: { widthVar: "--kb-fill-col" },
  },
];

/* ============================================================
 * custom-actions プリセット
 * ========================================================== */

const customActionsColumns = (t: Translator): KeybindingsColumnDef[] => [
  runnerColumn(t),
  {
    id: "custom-actions",
    header: () => t("keybindings.customActionsTab"),
    cell: ({ row }) => (
      <CustomActionCell
        customActions={row.original.customActions}
        keyboardLayout={row.original.playerConfig?.keyboardLayout}
      />
    ),
    enableSorting: false,
    size: 600,
    meta: { widthVar: "--kb-fill-col" },
  },
];

/* ============================================================
 * mouse プリセット（数値列のみソート可）
 * ========================================================== */

/**
 * ソート用アクセサの値。
 * TanStack Table の `sortUndefined` は `undefined` だけを見る（null は素通りして
 * 通常の比較に回る）ため、未設定は必ず undefined に寄せる。これにより
 * `sortUndefined: "last"` が昇順・降順の両方で効き、未設定行が常に末尾へ落ちる。
 */
const forSort = <T,>(value: T | null | undefined): T | undefined => value ?? undefined;

/**
 * ソート用の感度（%）。有効範囲（内部値 0..1 = 表示 0..200%）外は
 * 未設定と同じ扱い（null → undefined）にして末尾へ落とす。
 */
const sensitivityPercent = (config: MouseConfig): number | null =>
  isValidSensitivity(config?.gameSensitivity)
    ? toSensitivityPercent(config.gameSensitivity)
    : null;

const windowsMultiplier = (config: MouseConfig): number | null => {
  if (config == null) return null;
  if (config.windowsSpeedMultiplier != null) return config.windowsSpeedMultiplier;
  if (config.windowsSpeed == null) return null;
  return config.windowsSpeed;
};

/** 並べ替えキー（列 id・URL の sort）→ 行の値。未設定は undefined（表・ビジュアルで共有） */
const SORT_ACCESSORS: Record<string, (row: KeybindingsRow) => number | undefined> = {
  "mouse.dpi": (row) => forSort(row.playerConfig?.mouseDpi),
  "mouse.sensitivity": (row) => forSort(sensitivityPercent(row.playerConfig)),
  "mouse.cm360": (row) => {
    const config = row.playerConfig;
    if (!config) return undefined;
    return forSort(
      calculateCm360(
        config.mouseDpi,
        config.gameSensitivity,
        config.rawInput,
        config.windowsSpeed,
        config.windowsSpeedMultiplier,
      ),
    );
  },
  "mouse.windowsSpeed": (row) => forSort(windowsMultiplier(row.playerConfig)),
  "mouse.cursorSpeed": (row) => {
    const config = row.playerConfig;
    if (!config) return undefined;
    return forSort(
      calculateCursorSpeed(
        config.mouseDpi,
        config.windowsSpeed,
        config.windowsSpeedMultiplier,
      ),
    );
  },
};

/** アクション列の並べ替えキー（列 id・URL の sort）の接頭辞 */
const ACTION_SORT_PREFIX = "action.";

/**
 * 表の並べ替え（URL の sort）と同じ順で行を並べる（ビジュアル表示用）。
 * 未設定は昇順・降順どちらでも末尾。未知のキー・sort なしは元の順を返す。
 * `action.<操作>` はその操作のキーの表示ラベル順（表のアクション列と同じ比較）。
 */
export function sortKeybindingsRows<R extends KeybindingsRow>(
  rows: R[],
  sort: { key: string; direction: "asc" | "desc" } | null,
  t: Translator,
  locale: Locale = DEFAULT_LOCALE,
): R[] {
  if (!sort) return rows;
  const dir = sort.direction === "desc" ? -1 : 1;
  const numeric = SORT_ACCESSORS[sort.key];
  if (numeric) {
    return rows
      .map((row, index) => ({ row, index, value: numeric(row) }))
      .sort((a, b) => {
        if (a.value === undefined && b.value === undefined) return a.index - b.index;
        if (a.value === undefined) return 1;
        if (b.value === undefined) return -1;
        return a.value === b.value ? a.index - b.index : (a.value - b.value) * dir;
      })
      .map((x) => x.row);
  }
  if (!sort.key.startsWith(ACTION_SORT_PREFIX)) return rows;
  const action = sort.key.slice(ACTION_SORT_PREFIX.length);
  return rows
    .map((row, index) => ({ row, index, value: getBoundKeyLabel(t, row, action) }))
    .sort((a, b) => {
      if (a.value === undefined && b.value === undefined) return a.index - b.index;
      if (a.value === undefined) return 1;
      if (b.value === undefined) return -1;
      const c = compareKeyLabels(a.value, b.value, locale);
      return c === 0 ? a.index - b.index : c * dir;
    })
    .map((x) => x.row);
}

const mouseColumns = (t: Translator): KeybindingsColumnDef[] => [
  runnerColumn(t),
  {
    id: "mouse.dpi",
    header: () => "DPI",
    accessorFn: SORT_ACCESSORS["mouse.dpi"],
    cell: ({ row }) => <DpiCell config={row.original.playerConfig} />,
    enableSorting: true,
    sortUndefined: "last",
    size: 88,
    meta: { align: "center" as const },
  },
  {
    id: "mouse.sensitivity",
    header: () => (
      <>
        <span className="hidden sm:inline">{t("keybindings.inGameSensitivityRange")}</span>
        <span className="sm:hidden">
          {t("keybindings.columnSensShort")}
          <span className="sr-only">: {t("keybindings.inGameSensitivityRange")}</span>
        </span>
      </>
    ),
    accessorFn: SORT_ACCESSORS["mouse.sensitivity"],
    cell: ({ row }) => <SensitivityCell config={row.original.playerConfig} />,
    enableSorting: true,
    sortUndefined: "last",
    size: 120,
    meta: { align: "center" as const },
  },
  {
    id: "mouse.cm360",
    header: () => (
      <>
        <span className="hidden sm:inline">{t("keybindings.turnDistanceRange")}</span>
        <span className="sm:hidden">
          {t("keybindings.columnTurnShort")}
          <span className="sr-only">: {t("keybindings.turnDistanceRange")}</span>
        </span>
      </>
    ),
    accessorFn: SORT_ACCESSORS["mouse.cm360"],
    cell: ({ row }) => <Cm360Cell config={row.original.playerConfig} />,
    enableSorting: true,
    sortUndefined: "last",
    size: 120,
    meta: { align: "center" as const, hint: t("keybindings.hintTurnDistance") },
  },
  {
    id: "mouse.windowsSpeed",
    header: () => t("keybindings.columnWinSens"),
    accessorFn: SORT_ACCESSORS["mouse.windowsSpeed"],
    cell: ({ row }) => <WindowsSpeedCell config={row.original.playerConfig} />,
    enableSorting: true,
    sortUndefined: "last",
    size: 140,
    meta: { align: "center" as const, hint: t("keybindings.hintWinSens") },
  },
  {
    id: "mouse.cursorSpeed",
    header: () => t("keybindings.columnCursorSpeed"),
    accessorFn: SORT_ACCESSORS["mouse.cursorSpeed"],
    cell: ({ row }) => <CursorSpeedCell config={row.original.playerConfig} />,
    enableSorting: true,
    sortUndefined: "last",
    size: 140,
    meta: { align: "center" as const, hint: t("keybindings.hintCursorSpeed") },
  },
  {
    id: "mouse.rawInput",
    header: () => t("keybindings.columnRawInput"),
    cell: ({ row }) => <RawInputCell config={row.original.playerConfig} />,
    enableSorting: false,
    size: 100,
    meta: { align: "center" as const, hint: t("keybindings.hintRawInput") },
  },
  {
    id: "mouse.accel",
    header: () => t("keybindings.columnMouseAccel"),
    cell: ({ row }) => <AccelerationCell config={row.original.playerConfig} />,
    enableSorting: false,
    size: 120,
    meta: { align: "center" as const, hint: t("keybindings.hintMouseAccel") },
  },
];

/** プリセット名 → ColumnDef（プリセット名は TAB_OPTIONS と一致） */
/** プリセット名 → ColumnDef。ヘッダーの文言がロケール依存なので描画時に組み立てる */
export function columnPresets(t: Translator, locale: Locale = DEFAULT_LOCALE) {
  return {
    movement: movementColumns(t, locale),
    inventory: inventoryColumns(t, locale),
    "combat-ui": combatUiColumns(t, locale),
    remaps: remapsColumns(t),
    "custom-actions": customActionsColumns(t),
    mouse: mouseColumns(t),
  } as const;
}

export type PresetKey = keyof ReturnType<typeof columnPresets>;
