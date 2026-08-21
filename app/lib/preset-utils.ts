import { createId } from "@paralleldrive/cuid2";
import { and, asc, eq } from "drizzle-orm";
import type { Database } from "./db";
import {
  configPresets,
  configHistory,
  keybindings,
  playerConfigs,
  keyRemaps,
  itemLayouts,
  searchCrafts,
  searchCraftLoops,
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
  SearchCraftLoop,
  CustomKey,
  CustomAction,
} from "./schema";
import type { KeyRemapType } from "./remap-utils";
import { parseLoopSteps, type LoopTransition } from "./search-craft-loops";
import { resolveVariations, parseVariationsJson, type SearchCraftVariation } from "./search-craft-variations";

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
  /** リマップ種別（古いスナップショットには存在しない → unset扱いで読む） */
  remapType?: KeyRemapType | null;
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
  /** 第1バリエーションのミラー（旧リーダー・ロールバック互換のため書き込み継続） */
  searchStr: string | null;
  comment: string | null;
  timing?: "ow" | "bastion" | "bastion_fort" | "fortress" | "blinded" | "other" | null;
  /** 第1バリエーションのミラー（古いスナップショットには存在しない） */
  withShift?: boolean;
  /** 複数サーチ文字列バリエーション（任意フィールド。正準の読み取りは resolveVariations() 経由） */
  variations?: SearchCraftVariation[];
}

/**
 * プリセットに保存するサーチクラフトLoop（繋ぎ方）の1ステップの型。
 * 行 id はスナップショットに保持できないため、同一スナップショット内
 * searchCraftsData の sequence 値（craftSeq）でステップの参照先を表す。
 */
export interface PresetLoopStepData {
  /** 同一スナップショット内 searchCraftsData の sequence 値で参照（行 id はスナップショットに無いため） */
  craftSeq: number;
  transition: LoopTransition | null;
  /** 参照先クラフトのバリエーション index（0始まり）。0 は省略する（既存データとバイト同一を保つため） */
  variationIndex?: number;
}

/**
 * プリセットに保存するサーチクラフトLoop（繋ぎ方）データの型
 */
export interface PresetSearchCraftLoopData {
  sequence: number;
  steps: PresetLoopStepData[];
  comment: string | null;
  timing?: "ow" | "bastion" | "bastion_fort" | "fortress" | "blinded" | "other" | null;
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
  searchCraftLoops?: SearchCraftLoop[];
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
    remapType: r.remapType,
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
 * サーチクラフト配列からプリセット用のJSONデータを作成。
 * variations は searchVariations 列（無ければ searchStr/withShift から1件合成）を
 * resolveVariations() 経由で正準化して含める。searchStr/withShift は第1バリエーションの
 * ミラーとして引き続き書き込む。
 */
export function serializeSearchCrafts(crafts: SearchCraft[]): string {
  const data: PresetSearchCraftData[] = crafts.map((c) => {
    const variations = resolveVariations({
      variations: parseVariationsJson(c.searchVariations) ?? undefined,
      searchStr: c.searchStr,
      withShift: c.withShift,
    });
    return {
      sequence: c.sequence,
      items: c.items,
      keys: c.keys,
      searchStr: c.searchStr,
      comment: c.comment,
      timing: c.timing,
      withShift: c.withShift,
      variations,
    };
  });
  return JSON.stringify(data);
}

/**
 * サーチクラフトLoop（繋ぎ方）配列からプリセット用のJSONデータを作成する。
 * ステップの craftId は同一スナップショット内 crafts の sequence 値（craftSeq）へ変換する
 * （プリセットスナップショットは行 id を保持しないため）。
 * 参照切れステップ（crafts に存在しない craftId）は除去し、残りが2件未満になった
 * Loop は丸ごと除去する。Loop が0件になった場合は null を返す。
 */
export function serializeSearchCraftLoops(
  loops: SearchCraftLoop[],
  crafts: SearchCraft[],
): string | null {
  const craftIdToSeq = new Map(crafts.map((c) => [c.id, c.sequence]));
  const sortedLoops = [...loops].sort((a, b) => a.sequence - b.sequence);

  const data: PresetSearchCraftLoopData[] = [];
  for (const loop of sortedLoops) {
    const steps = parseLoopSteps(loop.steps);
    const mappedSteps: PresetLoopStepData[] = [];
    for (const step of steps) {
      const craftSeq = craftIdToSeq.get(step.craftId);
      if (craftSeq === undefined) continue;
      mappedSteps.push({
        craftSeq,
        transition: step.transition,
        // 0 は省略する（既存データとバイト同一を保つため）
        ...(step.variationIndex ? { variationIndex: step.variationIndex } : {}),
      });
    }
    if (mappedSteps.length < 2) continue;
    // 除去でズレる場合に備え、先頭ステップの transition は常に null に統一する
    mappedSteps[0] = { ...mappedSteps[0], transition: null };

    data.push({
      sequence: loop.sequence,
      steps: mappedSteps,
      comment: loop.comment,
      timing: loop.timing,
    });
  }

  return data.length > 0 ? JSON.stringify(data) : null;
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
    columns: { id: true },
  });
  if (!active) return;

  const now = new Date();

  // kind ごとの読み取りは互いに独立（書き込みキーも kind ごとに排他）なので並列実行する
  const resolveKind = async (
    kind: PresetSyncKind,
  ): Promise<Partial<typeof configPresets.$inferInsert>> => {
    switch (kind) {
      case "keybindings": {
        const rows = await db.query.keybindings.findMany({
          where: eq(keybindings.userId, userId),
        });
        return { keybindingsData: rows.length > 0 ? serializeKeybindings(rows) : null };
      }
      case "playerConfig": {
        const config = await db.query.playerConfigs.findFirst({
          where: eq(playerConfigs.userId, userId),
        });
        return { playerConfigData: config ? serializePlayerConfig(config) : null };
      }
      case "remaps": {
        const rows = await db.query.keyRemaps.findMany({
          where: eq(keyRemaps.userId, userId),
        });
        return { remapsData: rows.length > 0 ? serializeRemaps(rows) : null };
      }
      case "fingers": {
        const config = await db.query.playerConfigs.findFirst({
          where: eq(playerConfigs.userId, userId),
        });
        return { fingerAssignmentsData: config?.fingerAssignments ?? null };
      }
      case "itemLayouts": {
        const rows = await db.query.itemLayouts.findMany({
          where: eq(itemLayouts.userId, userId),
        });
        return { itemLayoutsData: rows.length > 0 ? serializeItemLayouts(rows) : null };
      }
      case "searchCrafts": {
        // crafts と loops のスキューを防ぐため、常に両列を同時に書く（loops 専用の同期 kind は作らない）。
        // 互いに独立したクエリ（両方 userId のみで絞り込み）なので並列化する
        const [rows, loopRows] = await Promise.all([
          db.query.searchCrafts.findMany({
            where: eq(searchCrafts.userId, userId),
          }),
          db.query.searchCraftLoops.findMany({
            where: eq(searchCraftLoops.userId, userId),
            orderBy: [asc(searchCraftLoops.sequence)],
          }),
        ]);
        return {
          searchCraftsData: rows.length > 0 ? serializeSearchCrafts(rows) : null,
          searchCraftLoopsData: serializeSearchCraftLoops(loopRows, rows),
        };
      }
      case "customKeys": {
        const rows = await db.query.customKeys.findMany({
          where: eq(customKeys.userId, userId),
        });
        return { customKeysData: rows.length > 0 ? serializeCustomKeys(rows) : null };
      }
      case "customActions": {
        const rows = await db.query.customActions.findMany({
          where: eq(customActions.userId, userId),
        });
        return { customActionsData: rows.length > 0 ? serializeCustomActions(rows) : null };
      }
    }
  };

  const parts = await Promise.all(kinds.map((kind) => resolveKind(kind)));
  const updates: Partial<typeof configPresets.$inferInsert> = Object.assign({}, ...parts);

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

/** drizzle のトランザクション内外どちらでも使える最小インターフェース */
type DatabaseOrTransaction = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * 指定プリセットをメイン（公開用）に設定する。
 * is_main フラグを排他的に付け替えるだけで、ライブテーブル・isActive（編集対象）には一切触れない。
 * 公開面（プロフィール等）はメインプリセットのスナップショットを表示するため、即座に反映される。
 * 所有権・存在の検証は呼び出し側で済ませたプリセット行を渡すこと（ここでは再照会しない）。
 */
export async function setMainPreset(
  db: Database,
  preset: { id: string; userId: string },
): Promise<void> {
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(configPresets)
      .set({ isMain: false, updatedAt: now })
      .where(and(eq(configPresets.userId, preset.userId), eq(configPresets.isMain, true)));
    await tx
      .update(configPresets)
      .set({ isMain: true, updatedAt: now })
      .where(eq(configPresets.id, preset.id));
  });
}

/**
 * 新規プリセットを自動でメイン（公開用）にすべきか。
 * メイン未設定のユーザーの最初の1件だけ true — 初回プリセット・オンボーディング・インポート・
 * Playground / テンプレート経由のすべての作成経路が共有する単一の判定点。
 * 既にメインがある場合は false（新規作成は「編集対象になるだけ」で公開の見え方を変えない）。
 */
export async function resolveIsMainForNewPreset(
  db: DatabaseOrTransaction,
  userId: string,
): Promise<boolean> {
  const existingMain = await db.query.configPresets.findFirst({
    where: and(eq(configPresets.userId, userId), eq(configPresets.isMain, true)),
    columns: { id: true },
  });
  return !existingMain;
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
    searchCraftLoops = [],
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
  const searchCraftLoopsData = serializeSearchCraftLoops(searchCraftLoops, searchCrafts);
  const customKeysData = customKeys.length > 0 ? serializeCustomKeys(customKeys) : null;
  const customActionsData = customActions.length > 0 ? serializeCustomActions(customActions) : null;

  // 変更履歴の説明文
  const changeDescriptions: Record<string, string> = {
    manual: `プリセット「${name}」を作成`,
    import: `プリセット「${name}」をインポートから作成`,
    onboarding: `プリセット「${name}」を初期設定として作成`,
  };

  // 非アクティブ化＋挿入＋履歴記録を単一トランザクションで実行
  let isMain = false;
  await db.transaction(async (tx) => {
    // アクティブとして作成する場合、既存のアクティブプリセットを先に非アクティブ化する
    // （「アクティブプリセットはユーザーごとに高々1件」の不変条件を維持）
    if (isActive) {
      await tx
        .update(configPresets)
        .set({ isActive: false, updatedAt: now })
        .where(and(eq(configPresets.userId, userId), eq(configPresets.isActive, true)));
    }

    // メイン（公開用）プリセットが未設定のユーザーには、このプリセットを自動でメインにする
    isMain = await resolveIsMainForNewPreset(tx, userId);

    // プリセットを挿入
    await tx.insert(configPresets).values({
      id: presetId,
      userId,
      name,
      description,
      isActive,
      isMain,
      keybindingsData,
      playerConfigData,
      remapsData,
      fingerAssignmentsData,
      itemLayoutsData,
      searchCraftsData,
      searchCraftLoopsData,
      customKeysData,
      customActionsData,
      createdAt: now,
      updatedAt: now,
    });

    // 変更履歴に記録
    await tx.insert(configHistory).values({
      id: createId(),
      userId,
      changeType: "preset_switch",
      changeDescription: changeDescriptions[source] ?? `プリセット「${name}」を作成`,
      presetId,
      createdAt: now,
    });
  });

  return {
    id: presetId,
    userId,
    name,
    description,
    isActive,
    isMain,
    keybindingsData,
    playerConfigData,
    remapsData,
    fingerAssignmentsData,
    itemLayoutsData,
    searchCraftsData,
    searchCraftLoopsData,
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
