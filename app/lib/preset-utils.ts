import { createId } from "@paralleldrive/cuid2";
import { eq } from "drizzle-orm";
import type { Database } from "./db";
import {
  configPresets,
  configHistory,
  keybindings,
  playerConfigs,
  keyRemaps,
  itemLayouts,
  searchCrafts,
  customKeys,
  customActions,
  type ConfigPreset,
} from "./schema";
import type {
  Keybinding,
  PlayerConfig,
  KeyRemap,
  ItemLayout,
  SearchCraft,
  CustomKey,
  CustomAction,
} from "./schema";

/**
 * プリセットに保存するキーバインドデータの型
 */
export interface PresetKeybindingData {
  action: string;
  keyCode: string;
  category: string;
}

/**
 * プリセットに保存するプレイヤー設定データの型
 * FOV, GUIスケール, ゲーム言語, 切替スニーク, 自動ジャンプ, コントローラー設定を含む
 */
export interface PresetPlayerConfigData {
  keyboardLayout?: string | null;
  keyboardModel?: string | null;
  mouseDpi?: number | null;
  gameSensitivity?: number | null;
  rawInput?: boolean | null;
  mouseAcceleration?: boolean | null;
  toggleSprint?: boolean | null;
  toggleSneak?: boolean | null;
  autoJump?: boolean | null;
  fov?: number | null;
  guiScale?: number | null;
  gameLanguage?: string | null;
  mouseModel?: string | null;
  windowsSpeed?: number | null;
  windowsSpeedMultiplier?: number | null;
  cm360?: number | null;
  notes?: string | null;
  controllerSettings?: string | null;
}

/**
 * プリセットに保存するリマップデータの型
 */
export interface PresetRemapData {
  sourceKey: string;
  targetKey: string | null;
  software: string | null;
  notes: string | null;
  outputMode?: "key" | "character" | null;
  outputCharacter?: string | null;
}

/**
 * プリセットに保存するアイテム配置データの型
 */
export interface PresetItemLayoutData {
  segment: string;
  slots: string;
  offhand: string | null;
  notes: string | null;
  displayOrder: number;
}

/**
 * プリセットに保存するサーチクラフトデータの型
 */
export interface PresetSearchCraftData {
  sequence: number;
  items: string;
  keys: string;
  searchStr: string | null;
  comment: string | null;
  timing?: "bastion" | "fortress" | "other" | null;
}

/**
 * プリセットに保存するカスタムキー定義データの型
 */
export interface PresetCustomKeyData {
  keyCode: string;
  keyName: string;
  category: "mouse" | "keyboard" | "controller";
  position: string | null;
  size: string | null;
  notes: string | null;
}

/**
 * プリセットに保存するカスタムアクションデータの型
 */
export interface PresetCustomActionData {
  actionName: string;
  description: string | null;
  category: "other" | "macro" | "tool";
  triggerKey: string;
  displayOrder: number;
}

/**
 * プリセット作成用のオプション
 */
export interface CreatePresetOptions {
  userId: string;
  name: string;
  description?: string | null;
  isActive?: boolean;
  keybindings?: Keybinding[];
  playerConfig?: PlayerConfig | null;
  keyRemaps?: KeyRemap[];
  itemLayouts?: ItemLayout[];
  searchCrafts?: SearchCraft[];
  customKeys?: CustomKey[];
  customActions?: CustomAction[];
  source?: "manual" | "import" | "onboarding";
}

/**
 * キーバインド配列からプリセット用のJSONデータを作成
 */
export function serializeKeybindings(keybindings: Keybinding[]): string {
  const data: PresetKeybindingData[] = keybindings.map((kb) => ({
    action: kb.action,
    keyCode: kb.keyCode,
    category: kb.category,
  }));
  return JSON.stringify(data);
}

/**
 * プレイヤー設定からプリセット用のJSONデータを作成
 * FOV, GUIスケール, ゲーム言語, 切替スニーク, 自動ジャンプ, コントローラー設定を含む
 */
export function serializePlayerConfig(config: PlayerConfig): string {
  const data: PresetPlayerConfigData = {
    keyboardLayout: config.keyboardLayout,
    keyboardModel: config.keyboardModel,
    mouseDpi: config.mouseDpi,
    gameSensitivity: config.gameSensitivity,
    rawInput: config.rawInput,
    mouseAcceleration: config.mouseAcceleration,
    toggleSprint: config.toggleSprint,
    toggleSneak: config.toggleSneak,
    autoJump: config.autoJump,
    fov: config.fov,
    guiScale: config.guiScale,
    gameLanguage: config.gameLanguage,
    mouseModel: config.mouseModel,
    windowsSpeed: config.windowsSpeed,
    windowsSpeedMultiplier: config.windowsSpeedMultiplier,
    cm360: config.cm360,
    notes: config.notes,
    controllerSettings: config.controllerSettings,
  };
  return JSON.stringify(data);
}

/**
 * リマップ配列からプリセット用のJSONデータを作成
 */
export function serializeRemaps(remaps: KeyRemap[]): string {
  const data: PresetRemapData[] = remaps.map((r) => ({
    sourceKey: r.sourceKey,
    targetKey: r.targetKey,
    software: r.software,
    notes: r.notes,
    outputMode: r.outputMode,
    outputCharacter: r.outputCharacter,
  }));
  return JSON.stringify(data);
}

/**
 * アイテム配置配列からプリセット用のJSONデータを作成
 */
export function serializeItemLayouts(layouts: ItemLayout[]): string {
  const data: PresetItemLayoutData[] = layouts.map((l) => ({
    segment: l.segment,
    slots: l.slots,
    offhand: l.offhand,
    notes: l.notes,
    displayOrder: l.displayOrder,
  }));
  return JSON.stringify(data);
}

/**
 * サーチクラフト配列からプリセット用のJSONデータを作成
 */
export function serializeSearchCrafts(crafts: SearchCraft[]): string {
  const data: PresetSearchCraftData[] = crafts.map((c) => ({
    sequence: c.sequence,
    items: c.items,
    keys: c.keys,
    searchStr: c.searchStr,
    comment: c.comment,
    timing: c.timing,
  }));
  return JSON.stringify(data);
}

/**
 * カスタムキー配列からプリセット用のJSONデータを作成
 */
export function serializeCustomKeys(keys: CustomKey[]): string {
  const data: PresetCustomKeyData[] = keys.map((k) => ({
    keyCode: k.keyCode,
    keyName: k.keyName,
    category: k.category,
    position: k.position,
    size: k.size,
    notes: k.notes,
  }));
  return JSON.stringify(data);
}

/**
 * カスタムアクション配列からプリセット用のJSONデータを作成
 */
export function serializeCustomActions(actions: CustomAction[]): string {
  const data: PresetCustomActionData[] = actions.map((a) => ({
    actionName: a.actionName,
    description: a.description,
    category: a.category,
    triggerKey: a.triggerKey,
    displayOrder: a.displayOrder,
  }));
  return JSON.stringify(data);
}

/**
 * 同期対象の種別
 */
export type PresetSyncKind =
  | "keybindings"
  | "playerConfig"
  | "remaps"
  | "fingers"
  | "itemLayouts"
  | "searchCrafts"
  | "customKeys"
  | "customActions";

/**
 * アクティブプリセットのスナップショットを、指定種別のライブテーブル内容で更新する。
 * アクティブプリセットがない場合は no-op。
 */
export async function syncActivePresetSnapshot(
  db: Database,
  userId: string,
  kinds: PresetSyncKind[],
): Promise<void> {
  if (kinds.length === 0) return;

  const active = await db.query.configPresets.findFirst({
    where: (p, { and, eq }) => and(eq(p.userId, userId), eq(p.isActive, true)),
  });
  if (!active) return;

  const updates: Partial<typeof configPresets.$inferInsert> = {};
  const now = new Date();

  for (const kind of kinds) {
    switch (kind) {
      case "keybindings": {
        const rows = await db.query.keybindings.findMany({
          where: eq(keybindings.userId, userId),
        });
        updates.keybindingsData = rows.length > 0 ? serializeKeybindings(rows) : null;
        break;
      }
      case "playerConfig": {
        const config = await db.query.playerConfigs.findFirst({
          where: eq(playerConfigs.userId, userId),
        });
        updates.playerConfigData = config ? serializePlayerConfig(config) : null;
        break;
      }
      case "remaps": {
        const rows = await db.query.keyRemaps.findMany({
          where: eq(keyRemaps.userId, userId),
        });
        updates.remapsData = rows.length > 0 ? serializeRemaps(rows) : null;
        break;
      }
      case "fingers": {
        const config = await db.query.playerConfigs.findFirst({
          where: eq(playerConfigs.userId, userId),
        });
        updates.fingerAssignmentsData = config?.fingerAssignments ?? null;
        break;
      }
      case "itemLayouts": {
        const rows = await db.query.itemLayouts.findMany({
          where: eq(itemLayouts.userId, userId),
        });
        updates.itemLayoutsData = rows.length > 0 ? serializeItemLayouts(rows) : null;
        break;
      }
      case "searchCrafts": {
        const rows = await db.query.searchCrafts.findMany({
          where: eq(searchCrafts.userId, userId),
        });
        updates.searchCraftsData = rows.length > 0 ? serializeSearchCrafts(rows) : null;
        break;
      }
      case "customKeys": {
        const rows = await db.query.customKeys.findMany({
          where: eq(customKeys.userId, userId),
        });
        updates.customKeysData = rows.length > 0 ? serializeCustomKeys(rows) : null;
        break;
      }
      case "customActions": {
        const rows = await db.query.customActions.findMany({
          where: eq(customActions.userId, userId),
        });
        updates.customActionsData = rows.length > 0 ? serializeCustomActions(rows) : null;
        break;
      }
    }
  }

  updates.updatedAt = now;
  await db.update(configPresets).set(updates).where(eq(configPresets.id, active.id));
}

/**
 * 編集ページから受け取った presetId が現在のアクティブプリセットと一致するか検証する。
 * 不一致の場合（別タブでプリセット切替が起きた等）はエラーをスロー。
 * presetId が null の場合（プリセットが存在しない初期状態）は検証をスキップ。
 */
export async function assertPresetIsActive(
  db: Database,
  userId: string,
  presetId: string | null,
): Promise<void> {
  if (!presetId) return;
  const active = await db.query.configPresets.findFirst({
    where: (p, { and, eq }) => and(eq(p.userId, userId), eq(p.isActive, true)),
    columns: { id: true },
  });
  if (!active || active.id !== presetId) {
    throw new PresetMismatchError();
  }
}

/**
 * プリセット切替競合エラー
 */
export class PresetMismatchError extends Error {
  constructor() {
    super("PRESET_MISMATCH");
    this.name = "PresetMismatchError";
  }
}

/**
 * プリセットを作成する共通関数
 */
export async function createPreset(
  db: Database,
  options: CreatePresetOptions,
): Promise<ConfigPreset> {
  const {
    userId,
    name,
    description = null,
    isActive = false,
    keybindings = [],
    playerConfig = null,
    keyRemaps = [],
    itemLayouts = [],
    searchCrafts = [],
    customKeys = [],
    customActions = [],
    source = "manual",
  } = options;

  const now = new Date();
  const presetId = createId();

  // データをシリアライズ
  const keybindingsData = keybindings.length > 0 ? serializeKeybindings(keybindings) : null;
  const playerConfigData = playerConfig ? serializePlayerConfig(playerConfig) : null;
  const remapsData = keyRemaps.length > 0 ? serializeRemaps(keyRemaps) : null;
  const fingerAssignmentsData = playerConfig?.fingerAssignments ?? null;
  const itemLayoutsData = itemLayouts.length > 0 ? serializeItemLayouts(itemLayouts) : null;
  const searchCraftsData = searchCrafts.length > 0 ? serializeSearchCrafts(searchCrafts) : null;
  const customKeysData = customKeys.length > 0 ? serializeCustomKeys(customKeys) : null;
  const customActionsData = customActions.length > 0 ? serializeCustomActions(customActions) : null;

  // プリセットを挿入
  await db.insert(configPresets).values({
    id: presetId,
    userId,
    name,
    description,
    isActive,
    keybindingsData,
    playerConfigData,
    remapsData,
    fingerAssignmentsData,
    itemLayoutsData,
    searchCraftsData,
    customKeysData,
    customActionsData,
    createdAt: now,
    updatedAt: now,
  });

  // 変更履歴に記録
  const changeDescriptions: Record<string, string> = {
    manual: `プリセット「${name}」を作成`,
    import: `プリセット「${name}」をインポートから作成`,
    onboarding: `プリセット「${name}」を初期設定として作成`,
  };

  await db.insert(configHistory).values({
    id: createId(),
    userId,
    changeType: "preset_switch",
    changeDescription: changeDescriptions[source] ?? `プリセット「${name}」を作成`,
    presetId,
    createdAt: now,
  });

  return {
    id: presetId,
    userId,
    name,
    description,
    isActive,
    keybindingsData,
    playerConfigData,
    remapsData,
    fingerAssignmentsData,
    itemLayoutsData,
    searchCraftsData,
    customKeysData,
    customActionsData,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * 初期プリセットの名前を生成
 */
export function generateInitialPresetName(source: "import" | "onboarding"): string {
  const date = new Date();
  const dateStr = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;

  if (source === "import") {
    return `インポート (${dateStr})`;
  }
  return `初期設定 (${dateStr})`;
}

/**
 * インポート時にプリセットを自動作成
 */
export async function createPresetFromImport(
  db: Database,
  userId: string,
  keybindings: Keybinding[],
  playerConfig: PlayerConfig | null,
  keyRemaps: KeyRemap[],
  itemLayouts: ItemLayout[] = [],
  searchCrafts: SearchCraft[] = [],
  customKeys: CustomKey[] = [],
  customActions: CustomAction[] = [],
): Promise<ConfigPreset> {
  const name = generateInitialPresetName("import");

  return createPreset(db, {
    userId,
    name,
    description: "インポートされた設定から自動作成されたプリセット",
    isActive: true,
    keybindings,
    playerConfig,
    keyRemaps,
    itemLayouts,
    searchCrafts,
    customKeys,
    customActions,
    source: "import",
  });
}

/**
 * オンボーディング時にプリセットを自動作成
 */
export async function createPresetFromOnboarding(
  db: Database,
  userId: string,
  keybindings: Keybinding[],
  playerConfig: PlayerConfig | null,
  keyRemaps: KeyRemap[],
  itemLayouts: ItemLayout[] = [],
  searchCrafts: SearchCraft[] = [],
  customKeys: CustomKey[] = [],
  customActions: CustomAction[] = [],
): Promise<ConfigPreset> {
  const name = generateInitialPresetName("onboarding");

  return createPreset(db, {
    userId,
    name,
    description: "アカウント作成時の初期設定",
    isActive: true,
    keybindings,
    playerConfig,
    keyRemaps,
    itemLayouts,
    searchCrafts,
    customKeys,
    customActions,
    source: "onboarding",
  });
}
