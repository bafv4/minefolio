import { createId } from "@paralleldrive/cuid2";
import type { Database } from "./db";
import { configPresets, configHistory, type ConfigPreset } from "./schema";
import type { Keybinding, PlayerConfig, KeyRemap, ItemLayout, SearchCraft } from "./schema";

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
 * FOV, GUIスケール, ゲーム言語, 切替スニーク, 自動ジャンプを含む
 */
export interface PresetPlayerConfigData {
  keyboardLayout?: string | null;
  keyboardModel?: string | null;
  mouseDpi?: number | null;
  gameSensitivity?: number | null;
  rawInput?: boolean | null;
  mouseAcceleration?: boolean | null;
  toggleSprint?: boolean | null;
  // 追加項目
  toggleSneak?: boolean | null;
  autoJump?: boolean | null;
  fov?: number | null;
  guiScale?: number | null;
  gameLanguage?: string | null;
}

/**
 * プリセットに保存するリマップデータの型
 */
export interface PresetRemapData {
  sourceKey: string;
  targetKey: string | null;
  software: string | null;
  notes: string | null;
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
 * FOV, GUIスケール, ゲーム言語, 切替スニーク, 自動ジャンプを含む
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
    // 追加項目
    toggleSneak: config.toggleSneak,
    autoJump: config.autoJump,
    fov: config.fov,
    guiScale: config.guiScale,
    gameLanguage: config.gameLanguage,
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
  }));
  return JSON.stringify(data);
}

/**
 * プリセットを作成する共通関数
 */
export async function createPreset(
  db: Database,
  options: CreatePresetOptions
): Promise<ConfigPreset> {
  const {
    userId,
    name,
    description = null,
    isActive = false,
    keybindings = [],
    playerConfig = null,
    keyRemaps = [],
    source = "manual",
  } = options;

  const now = new Date();
  const presetId = createId();

  // データをシリアライズ
  const keybindingsData = keybindings.length > 0 ? serializeKeybindings(keybindings) : null;
  const playerConfigData = playerConfig ? serializePlayerConfig(playerConfig) : null;
  const remapsData = keyRemaps.length > 0 ? serializeRemaps(keyRemaps) : null;
  const fingerAssignmentsData = playerConfig?.fingerAssignments ?? null;

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
    itemLayoutsData: null,
    searchCraftsData: null,
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
  keyRemaps: KeyRemap[]
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
  keyRemaps: KeyRemap[]
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
    source: "onboarding",
  });
}
