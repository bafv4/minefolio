// /keybindings の TanStack Table 列プリセット定義。
// 4 つのサブタブ（actions / remaps / custom-actions / mouse）ごとに ColumnDef 配列を export。
import type { ColumnDef } from "@tanstack/react-table";
import { getActionLabel } from "@/lib/keybindings";
import { calculateCm360, calculateCursorSpeed } from "@/lib/mouse-settings";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
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

const runnerColumn = (t: Translator): ColumnDef<KeybindingsRow> => ({
  id: "runner",
  header: () => t("keybindings.columnRunner"),
  cell: ({ row }) => <RunnerCell player={row.original} />,
  enableSorting: false,
  size: 224,
  minSize: 140,
});

/* ============================================================
 * アクション列ジェネレーター
 * 操作はプレイヤー画面と同じ粒度（移動 / インベントリ / 戦闘・UI）で分割する。
 * ========================================================== */

/** アクション 1 件分のキー表示列を生成 */
function actionColumn(t: Translator, action: string): ColumnDef<KeybindingsRow> {
  return {
    id: `action.${action}`,
    header: () => (
      <Tooltip>
        <TooltipTrigger asChild>
          <span>{getActionLabel(t, action)}</span>
        </TooltipTrigger>
        <TooltipContent>{getActionLabel(t, action)}</TooltipContent>
      </Tooltip>
    ),
    accessorFn: (row) =>
      row.keybindings.find((kb) => kb.action === action)?.keyCode ?? null,
    cell: ({ getValue, row }) => (
      <ActionKeyCell
        keyCode={getValue<string | null>() ?? undefined}
        keyboardLayout={row.original.playerConfig?.keyboardLayout}
        customKeyNames={buildCustomKeyNames(row.original.customKeys)}
      />
    ),
    enableSorting: false,
    size: 88,
    minSize: 56,
    meta: { align: "center" as const },
  };
}

const hotbarColumn = (t: Translator): ColumnDef<KeybindingsRow> => ({
  id: "action.hotbar",
  header: () => (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>{t("keybindings.hotbarColumn")}</span>
      </TooltipTrigger>
      <TooltipContent>{t("keybindings.hotbarColumn")}</TooltipContent>
    </Tooltip>
  ),
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
  meta: { align: "left" as const },
});

// 移動: 前進・後退・左右・ジャンプ・スニーク・ダッシュ
const movementColumns = (t: Translator): ColumnDef<KeybindingsRow>[] => [
  runnerColumn(t),
  ...["forward", "back", "left", "right", "jump", "sneak", "sprint"].map((a) => actionColumn(t, a)),
];

// インベントリ: ホットバー（集約）・オフハンド・インベントリ・ブロック選択・ドロップ
const inventoryColumns = (t: Translator): ColumnDef<KeybindingsRow>[] => [
  runnerColumn(t),
  hotbarColumn(t),
  ...["swapHands", "inventory", "pickBlock", "drop"].map((a) => actionColumn(t, a)),
];

// 戦闘・UI: 攻撃・使用・視点切替・チャット・コマンド・全画面
const combatUiColumns = (t: Translator): ColumnDef<KeybindingsRow>[] => [
  runnerColumn(t),
  ...["attack", "use", "togglePerspective", "chat", "command", "fullscreen"].map(
    (a: string) => actionColumn(t, a),
  ),
];

/* ============================================================
 * remaps プリセット
 * ========================================================== */

const remapsColumns = (t: Translator): ColumnDef<KeybindingsRow>[] => [
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
  },
];

/* ============================================================
 * custom-actions プリセット
 * ========================================================== */

const customActionsColumns = (t: Translator): ColumnDef<KeybindingsRow>[] => [
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

const sensitivityPercent = (config: MouseConfig): number | null =>
  config?.gameSensitivity != null
    ? Math.floor(config.gameSensitivity * 200)
    : null;

const windowsMultiplier = (config: MouseConfig): number | null => {
  if (config == null) return null;
  if (config.windowsSpeedMultiplier != null) return config.windowsSpeedMultiplier;
  if (config.windowsSpeed == null) return null;
  return config.windowsSpeed;
};

const mouseColumns = (t: Translator): ColumnDef<KeybindingsRow>[] => [
  runnerColumn(t),
  {
    id: "mouse.dpi",
    header: () => "DPI",
    accessorFn: (row) => forSort(row.playerConfig?.mouseDpi),
    cell: ({ row }) => <DpiCell config={row.original.playerConfig} />,
    enableSorting: true,
    sortUndefined: "last",
    size: 88,
    meta: { align: "center" as const },
  },
  {
    id: "mouse.sensitivity",
    header: () => (
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <span className="hidden sm:inline">
              {t("keybindings.inGameSensitivityRange")}
            </span>
            <span className="sm:hidden">Sens</span>
          </span>
        </TooltipTrigger>
        <TooltipContent>{t("keybindings.inGameSensitivityRange")}</TooltipContent>
      </Tooltip>
    ),
    accessorFn: (row) => forSort(sensitivityPercent(row.playerConfig)),
    cell: ({ row }) => <SensitivityCell config={row.original.playerConfig} />,
    enableSorting: true,
    sortUndefined: "last",
    size: 120,
    meta: { align: "center" as const },
  },
  {
    id: "mouse.cm360",
    header: () => (
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <span className="hidden sm:inline">
              {t("keybindings.turnDistanceRange")}
            </span>
            <span className="sm:hidden">Turn</span>
          </span>
        </TooltipTrigger>
        <TooltipContent>{t("keybindings.turnDistanceRange")}</TooltipContent>
      </Tooltip>
    ),
    accessorFn: (row) => {
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
    cell: ({ row }) => <Cm360Cell config={row.original.playerConfig} />,
    enableSorting: true,
    sortUndefined: "last",
    size: 120,
    meta: { align: "center" as const },
  },
  {
    id: "mouse.windowsSpeed",
    header: () => "Win Sens",
    accessorFn: (row) => forSort(windowsMultiplier(row.playerConfig)),
    cell: ({ row }) => <WindowsSpeedCell config={row.original.playerConfig} />,
    enableSorting: true,
    sortUndefined: "last",
    size: 140,
    meta: { align: "center" as const },
  },
  {
    id: "mouse.cursorSpeed",
    header: () => "Cursor Speed",
    accessorFn: (row) => {
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
    cell: ({ row }) => <CursorSpeedCell config={row.original.playerConfig} />,
    enableSorting: true,
    sortUndefined: "last",
    size: 120,
    meta: { align: "center" as const },
  },
  {
    id: "mouse.rawInput",
    header: () => "Raw Input",
    cell: ({ row }) => <RawInputCell config={row.original.playerConfig} />,
    enableSorting: false,
    size: 100,
    meta: { align: "center" as const },
  },
  {
    id: "mouse.accel",
    header: () => "Mouse Accel",
    cell: ({ row }) => <AccelerationCell config={row.original.playerConfig} />,
    enableSorting: false,
    size: 120,
    meta: { align: "center" as const },
  },
];

/** プリセット名 → ColumnDef（プリセット名は TAB_OPTIONS と一致） */
/** プリセット名 → ColumnDef。ヘッダーの文言がロケール依存なので描画時に組み立てる */
export function columnPresets(t: Translator) {
  return {
    movement: movementColumns(t),
    inventory: inventoryColumns(t),
    "combat-ui": combatUiColumns(t),
    remaps: remapsColumns(t),
    "custom-actions": customActionsColumns(t),
    mouse: mouseColumns(t),
  } as const;
}

export type PresetKey = keyof ReturnType<typeof columnPresets>;
