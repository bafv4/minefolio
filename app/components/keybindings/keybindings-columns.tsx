// /keybindings の TanStack Table 列プリセット定義。
// 4 つのサブタブ（actions / remaps / custom-actions / mouse）ごとに ColumnDef 配列を export。
import type { ColumnDef } from "@tanstack/react-table";
import { getActionLabel } from "@/lib/keybindings";
import { calculateCm360, calculateCursorSpeed } from "@/lib/mouse-settings";
import { t } from "@/lib/messages";
import {
  ActionKeyCell,
  Cm360Cell,
  CursorSpeedCell,
  DpiCell,
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
  customSkinUrl: string | null;
  keybindings: Array<{
    id: string;
    action: string;
    keyCode: string;
    category: string;
  }>;
  keyRemaps: RemapItem[];
  customActions: CustomActionItem[];
  playerConfig: MouseConfig;
};

/* ============================================================
 * 共通: 走者列（左端 sticky）
 * ========================================================== */

const runnerColumn: ColumnDef<KeybindingsRow> = {
  id: "runner",
  header: () => t("keybindings.columnRunner"),
  cell: ({ row }) => <RunnerCell player={row.original} />,
  enableSorting: false,
  size: 224,
};

/* ============================================================
 * actions プリセット（19 列）
 * ========================================================== */

const ACTION_KEYS = [
  { action: "forward", short: "Fwd" },
  { action: "back", short: "Back" },
  { action: "left", short: "Left" },
  { action: "right", short: "Right" },
  { action: "sprint", short: "Spr" },
  { action: "sneak", short: "Snk" },
  { action: "inventory", short: "Inv" },
  { action: "swapHands", short: "OH" },
  { action: "drop", short: "Drop" },
  { action: "pickBlock", short: "Pick" },
  { action: "hotbar1", short: "HB1" },
  { action: "hotbar2", short: "HB2" },
  { action: "hotbar3", short: "HB3" },
  { action: "hotbar4", short: "HB4" },
  { action: "hotbar5", short: "HB5" },
  { action: "hotbar6", short: "HB6" },
  { action: "hotbar7", short: "HB7" },
  { action: "hotbar8", short: "HB8" },
  { action: "hotbar9", short: "HB9" },
] as const;

export const actionsColumns: ColumnDef<KeybindingsRow>[] = [
  runnerColumn,
  ...ACTION_KEYS.map<ColumnDef<KeybindingsRow>>(({ action, short }) => ({
    id: `action.${action}`,
    header: () => (
      <span title={getActionLabel(action)}>
        <span className="hidden sm:inline">{getActionLabel(action)}</span>
        <span className="sm:hidden">{short}</span>
      </span>
    ),
    accessorFn: (row) =>
      row.keybindings.find((kb) => kb.action === action)?.keyCode ?? null,
    cell: ({ getValue, row }) => (
      <ActionKeyCell
        keyCode={getValue<string | null>() ?? undefined}
        keyboardLayout={row.original.playerConfig?.keyboardLayout}
      />
    ),
    enableSorting: false,
    size: 64,
    meta: { align: "center" as const },
  })),
];

/* ============================================================
 * remaps プリセット
 * ========================================================== */

export const remapsColumns: ColumnDef<KeybindingsRow>[] = [
  runnerColumn,
  {
    id: "remaps",
    header: () => t("keybindings.remapsTab"),
    cell: ({ row }) => (
      <RemapCell
        remaps={row.original.keyRemaps}
        keyboardLayout={row.original.playerConfig?.keyboardLayout}
      />
    ),
    enableSorting: false,
    size: 600,
  },
];

/* ============================================================
 * custom-actions プリセット
 * ========================================================== */

export const customActionsColumns: ColumnDef<KeybindingsRow>[] = [
  runnerColumn,
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

export const mouseColumns: ColumnDef<KeybindingsRow>[] = [
  runnerColumn,
  {
    id: "mouse.dpi",
    header: () => "DPI",
    accessorFn: (row) => row.playerConfig?.mouseDpi ?? null,
    cell: ({ row }) => <DpiCell config={row.original.playerConfig} />,
    enableSorting: true,
    sortUndefined: "last",
    size: 88,
    meta: { align: "center" as const },
  },
  {
    id: "mouse.sensitivity",
    header: () => (
      <span title={t("keybindings.inGameSensitivityRange")}>
        <span className="hidden sm:inline">
          {t("keybindings.inGameSensitivityRange")}
        </span>
        <span className="sm:hidden">Sens</span>
      </span>
    ),
    accessorFn: (row) => sensitivityPercent(row.playerConfig),
    cell: ({ row }) => <SensitivityCell config={row.original.playerConfig} />,
    enableSorting: true,
    sortUndefined: "last",
    size: 120,
    meta: { align: "center" as const },
  },
  {
    id: "mouse.cm360",
    header: () => (
      <span title={t("keybindings.turnDistanceRange")}>
        <span className="hidden sm:inline">
          {t("keybindings.turnDistanceRange")}
        </span>
        <span className="sm:hidden">Turn</span>
      </span>
    ),
    accessorFn: (row) => {
      const config = row.playerConfig;
      return config
        ? calculateCm360(
            config.mouseDpi,
            config.gameSensitivity,
            config.rawInput,
            config.windowsSpeed,
            config.windowsSpeedMultiplier,
          )
        : null;
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
    accessorFn: (row) => windowsMultiplier(row.playerConfig),
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
      return config
        ? calculateCursorSpeed(
            config.mouseDpi,
            config.windowsSpeed,
            config.windowsSpeedMultiplier,
          )
        : null;
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

/** プリセット名 → ColumnDef */
export const COLUMN_PRESETS = {
  actions: actionsColumns,
  remaps: remapsColumns,
  "custom-actions": customActionsColumns,
  mouse: mouseColumns,
} as const;

export type PresetKey = keyof typeof COLUMN_PRESETS;
