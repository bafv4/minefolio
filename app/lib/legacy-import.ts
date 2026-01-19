import { createId } from "@paralleldrive/cuid2";
import type { Database } from "./db";
import { keybindings, playerConfigs, customKeys, keyRemaps, itemLayouts, searchCrafts } from "./schema";
import { eq } from "drizzle-orm";
import { normalizeKeyCode, type FingerType } from "./keybindings";
import { createPresetFromOnboarding } from "./preset-utils";

// カスタムキーの型定義
interface LegacyCustomKey {
  keyCode: string;
  keyName: string;
}

// アイテム配置の型定義
interface LegacyItemLayout {
  uuid: string;
  segment: string;
  slot1?: string[];
  slot2?: string[];
  slot3?: string[];
  slot4?: string[];
  slot5?: string[];
  slot6?: string[];
  slot7?: string[];
  slot8?: string[];
  slot9?: string[];
  offhand?: string[];
  notes?: string;
}

// サーチクラフトの型定義
interface LegacySearchCraft {
  id: string;
  uuid: string;
  sequence: number;
  item1?: string | null;
  item2?: string | null;
  item3?: string | null;
  key1?: string | null;
  key2?: string | null;
  key3?: string | null;
  key4?: string | null;
  searchStr?: string | null;
  comment?: string | null;
}

// MCSRer Hotkeys APIのレスポンス型
// 実際のAPIレスポンス構造に基づく
interface LegacyPlayerData {
  user?: {
    uuid: string;
    mcid: string;
    displayName?: string;
  };
  settings?: {
    // キーバインド（設定オブジェクト内に直接含まれる）
    forward?: string;
    back?: string;
    left?: string;
    right?: string;
    jump?: string;
    sneak?: string;
    sprint?: string;
    attack?: string;
    use?: string;
    pickBlock?: string;
    drop?: string;
    inventory?: string;
    swapHands?: string;
    hotbar1?: string;
    hotbar2?: string;
    hotbar3?: string;
    hotbar4?: string;
    hotbar5?: string;
    hotbar6?: string;
    hotbar7?: string;
    hotbar8?: string;
    hotbar9?: string;
    togglePerspective?: string;
    fullscreen?: string;
    chat?: string;
    command?: string;
    // デバイス・ゲーム設定
    keyboardLayout?: string;
    mouseDpi?: number;
    gameSensitivity?: number;
    windowsSpeed?: number;
    cm360?: number;
    mouseModel?: string;
    keyboardModel?: string;
    toggleSprint?: boolean;
    toggleSneak?: boolean;
    autoJump?: boolean;
    rawInput?: boolean;
    mouseAcceleration?: boolean;
    gameLanguage?: string;
    notes?: string;
    // 指割り当て（settingsオブジェクト内にある）
    // キー: キーコード, 値: 指の配列 (例: { "KeyW": ["left-middle"], "KeyS": ["left-middle"] })
    fingerAssignments?: Record<string, string[]>;
  };
  customKeys?: LegacyCustomKey[];
  // リマップ（キー: 変換元キーコード, 値: 変換先キーコード）
  remappings?: Record<string, string>;
  // 外部ツール（キー: キーコード, 値: ツール名）
  externalTools?: Record<string, string>;
  // アイテム配置
  itemLayouts?: LegacyItemLayout[];
  // サーチクラフト
  searchCrafts?: LegacySearchCraft[];
}

// キーバインドのアクション名マッピング（MCSRer Hotkeys → Minefolio）
const KEYBIND_ACTION_MAP: Record<string, { action: string; category: "movement" | "combat" | "inventory" | "ui" }> = {
  // Movement
  forward: { action: "forward", category: "movement" },
  back: { action: "back", category: "movement" },
  left: { action: "left", category: "movement" },
  right: { action: "right", category: "movement" },
  jump: { action: "jump", category: "movement" },
  sneak: { action: "sneak", category: "movement" },
  sprint: { action: "sprint", category: "movement" },
  // Combat
  attack: { action: "attack", category: "combat" },
  use: { action: "use", category: "combat" },
  pickBlock: { action: "pickBlock", category: "combat" },
  drop: { action: "drop", category: "combat" },
  // Inventory
  inventory: { action: "inventory", category: "inventory" },
  swapHands: { action: "swapHands", category: "inventory" },
  hotbar1: { action: "hotbar1", category: "inventory" },
  hotbar2: { action: "hotbar2", category: "inventory" },
  hotbar3: { action: "hotbar3", category: "inventory" },
  hotbar4: { action: "hotbar4", category: "inventory" },
  hotbar5: { action: "hotbar5", category: "inventory" },
  hotbar6: { action: "hotbar6", category: "inventory" },
  hotbar7: { action: "hotbar7", category: "inventory" },
  hotbar8: { action: "hotbar8", category: "inventory" },
  hotbar9: { action: "hotbar9", category: "inventory" },
  // UI
  togglePerspective: { action: "togglePerspective", category: "ui" },
  fullscreen: { action: "fullscreen", category: "ui" },
  chat: { action: "chat", category: "ui" },
  command: { action: "command", category: "ui" },
};

/**
 * MCSRer Hotkeys APIからレガシーデータが存在するか確認
 */
export async function checkLegacyData(
  legacyApiUrl: string,
  mcid: string
): Promise<boolean> {
  try {
    const response = await fetch(`${legacyApiUrl}/api/player/${mcid}`);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * MCSRer Hotkeys APIからデータを取得
 */
export async function fetchLegacyData(
  legacyApiUrl: string,
  mcid: string
): Promise<LegacyPlayerData | null> {
  try {
    const response = await fetch(`${legacyApiUrl}/api/player/${mcid}`);
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * カスタムキーのカテゴリを推定する
 * keyNameに「マウス」「MB」「クリック」「チルト」「ホイール」などが含まれる場合はmouse
 */
function guessCustomKeyCategory(keyCode: string, keyName: string): "mouse" | "keyboard" {
  const lowerName = keyName.toLowerCase();
  const lowerCode = keyCode.toLowerCase();

  // マウス関連のキーワード
  const mouseKeywords = ["mouse", "マウス", "mb", "クリック", "チルト", "ホイール", "wheel", "click", "サイド", "side"];

  for (const keyword of mouseKeywords) {
    if (lowerName.includes(keyword) || lowerCode.includes(keyword)) {
      return "mouse";
    }
  }

  return "keyboard";
}

/**
 * MCSRer Hotkeysからデータをインポート
 */
export async function importFromLegacy(
  db: Database,
  userId: string,
  legacyApiUrl: string,
  mcid: string
): Promise<{
  success: boolean;
  keybindingsImported: number;
  customKeysImported: number;
  remapsImported: number;
  fingerAssignmentsImported: boolean;
  settingsImported: boolean;
  itemLayoutsImported: number;
  searchCraftsImported: number;
  error?: string;
}> {
  try {
    const legacyData = await fetchLegacyData(legacyApiUrl, mcid);

    if (!legacyData) {
      return {
        success: false,
        keybindingsImported: 0,
        customKeysImported: 0,
        remapsImported: 0,
        fingerAssignmentsImported: false,
        settingsImported: false,
        itemLayoutsImported: 0,
        searchCraftsImported: 0,
        error: "レガシーデータが見つかりません"
      };
    }

    // デバッグログ: インポートされるデータの確認
    console.log("[Legacy Import] Data keys:", Object.keys(legacyData));
    console.log("[Legacy Import] remappings:", legacyData.remappings);
    console.log("[Legacy Import] remappings count:", legacyData.remappings ? Object.keys(legacyData.remappings).length : 0);
    console.log("[Legacy Import] settings.fingerAssignments:", legacyData.settings?.fingerAssignments);
    console.log("[Legacy Import] fingerAssignments count:", legacyData.settings?.fingerAssignments ? Object.keys(legacyData.settings.fingerAssignments).length : 0);

    let keybindingsImported = 0;
    let customKeysImported = 0;
    let remapsImported = 0;
    let fingerAssignmentsImported = false;
    let settingsImported = false;
    let itemLayoutsImported = 0;
    let searchCraftsImported = 0;

    // キーバインドをインポート（settingsオブジェクト内に直接含まれる）
    if (legacyData.settings) {
      const settings = legacyData.settings;

      // キーバインドのキーを抽出
      const keybindActions = Object.keys(KEYBIND_ACTION_MAP);
      const hasKeybinds = keybindActions.some(
        (action) => settings[action as keyof typeof settings] !== undefined
      );

      if (hasKeybinds) {
        // 既存のキーバインドを削除
        await db.delete(keybindings).where(eq(keybindings.userId, userId));

        const now = new Date();

        // D1/SQLiteでは一度に1つずつ挿入する（バッチ挿入の互換性問題を回避）
        for (const legacyAction of keybindActions) {
          const rawKeyCode = settings[legacyAction as keyof typeof settings] as string | undefined;
          const mapping = KEYBIND_ACTION_MAP[legacyAction];
          if (mapping && rawKeyCode && typeof rawKeyCode === "string") {
            // Minecraft形式のキーコードをJavaScript形式に正規化
            const keyCode = normalizeKeyCode(rawKeyCode);
            await db.insert(keybindings).values({
              id: createId(),
              userId,
              action: mapping.action,
              keyCode,
              category: mapping.category,
              createdAt: now,
              updatedAt: now,
            });
            keybindingsImported++;
          }
        }
      }
    }

    // 設定をインポート
    if (legacyData.settings) {
      const settings = legacyData.settings;
      const now = new Date();

      // 既存の設定を確認
      const existingConfig = await db.query.playerConfigs.findFirst({
        where: eq(playerConfigs.userId, userId),
      });

      const configValues = {
        keyboardLayout: settings.keyboardLayout as "JIS" | "US" | "JIS_TKL" | "US_TKL" | undefined,
        keyboardModel: settings.keyboardModel,
        mouseModel: settings.mouseModel,
        mouseDpi: settings.mouseDpi,
        gameSensitivity: settings.gameSensitivity,
        cm360: settings.cm360,
        toggleSprint: settings.toggleSprint,
        toggleSneak: settings.toggleSneak,
        autoJump: settings.autoJump,
        rawInput: settings.rawInput,
        mouseAcceleration: settings.mouseAcceleration,
        gameLanguage: settings.gameLanguage,
        notes: settings.notes,
        updatedAt: now,
      };

      if (existingConfig) {
        await db
          .update(playerConfigs)
          .set(configValues)
          .where(eq(playerConfigs.userId, userId));
      } else {
        await db.insert(playerConfigs).values({
          id: createId(),
          userId,
          ...configValues,
          createdAt: now,
        });
      }

      settingsImported = true;
    }

    // カスタムキーをインポート
    if (legacyData.customKeys && legacyData.customKeys.length > 0) {
      // 既存のカスタムキーを削除
      await db.delete(customKeys).where(eq(customKeys.userId, userId));

      const now = new Date();

      for (const customKey of legacyData.customKeys) {
        if (customKey.keyCode && customKey.keyName) {
          // Minecraft形式のキーコードをJavaScript形式に正規化
          const keyCode = normalizeKeyCode(customKey.keyCode);
          const category = guessCustomKeyCategory(keyCode, customKey.keyName);
          await db.insert(customKeys).values({
            id: createId(),
            userId,
            keyCode,
            keyName: customKey.keyName,
            category,
            createdAt: now,
            updatedAt: now,
          });
          customKeysImported++;
        }
      }
    }

    // キーリマップをインポート（remappingsはRecord<string, string>形式）
    if (legacyData.remappings && Object.keys(legacyData.remappings).length > 0) {
      // 既存のリマップを削除
      await db.delete(keyRemaps).where(eq(keyRemaps.userId, userId));

      const now = new Date();

      for (const [sourceKeyRaw, targetKeyRaw] of Object.entries(legacyData.remappings)) {
        // 変換元キーコード（すでにJavaScript形式の可能性もある）
        const sourceKey = normalizeKeyCode(sourceKeyRaw);
        // 変換先キーコード（"key.keyboard.disabled"や単一文字の場合もある）
        let targetKey: string | null = null;
        if (targetKeyRaw && targetKeyRaw !== "key.keyboard.disabled") {
          targetKey = normalizeKeyCode(targetKeyRaw);
        }

        await db.insert(keyRemaps).values({
          id: createId(),
          userId,
          sourceKey,
          targetKey,
          software: null, // APIからはソフトウェア情報は提供されない
          notes: null,
          createdAt: now,
          updatedAt: now,
        });
        remapsImported++;
      }
    }

    // 指割り当てをインポート（settings.fingerAssignmentsはRecord<string, string[]>形式）
    const apiFingerAssignments = legacyData.settings?.fingerAssignments;
    if (apiFingerAssignments && Object.keys(apiFingerAssignments).length > 0) {
      // 有効な指タイプのリスト
      const validFingers: FingerType[] = [
        "left-pinky", "left-ring", "left-middle", "left-index", "left-thumb",
        "right-thumb", "right-index", "right-middle", "right-ring", "right-pinky"
      ];

      // 指割り当てをマップに変換（キーコードはすでにJavaScript形式）
      const fingerMap: Record<string, FingerType[]> = {};
      for (const [keyCode, fingers] of Object.entries(apiFingerAssignments)) {
        if (keyCode && fingers && Array.isArray(fingers)) {
          // 有効な指のみをフィルタリング
          const validFingerList = fingers.filter((f): f is FingerType => validFingers.includes(f as FingerType));
          if (validFingerList.length > 0) {
            fingerMap[keyCode] = validFingerList;
          }
        }
      }

      // 指割り当てがある場合はplayerConfigsに保存
      if (Object.keys(fingerMap).length > 0) {
        const now = new Date();
        const existingConfig = await db.query.playerConfigs.findFirst({
          where: eq(playerConfigs.userId, userId),
        });

        const fingerAssignmentsJson = JSON.stringify(fingerMap);

        if (existingConfig) {
          await db
            .update(playerConfigs)
            .set({ fingerAssignments: fingerAssignmentsJson, updatedAt: now })
            .where(eq(playerConfigs.userId, userId));
        } else {
          await db.insert(playerConfigs).values({
            id: createId(),
            userId,
            fingerAssignments: fingerAssignmentsJson,
            createdAt: now,
            updatedAt: now,
          });
        }

        fingerAssignmentsImported = true;
      }
    }

    // アイテム配置をインポート
    if (legacyData.itemLayouts && legacyData.itemLayouts.length > 0) {
      // 既存のアイテム配置を削除
      await db.delete(itemLayouts).where(eq(itemLayouts.userId, userId));

      const now = new Date();

      for (const layout of legacyData.itemLayouts) {
        // セグメント名はそのまま使用（変換しない）
        const segment = layout.segment;

        // 同じセグメントが既にインポートされていないか確認
        const existingLayout = await db.query.itemLayouts.findFirst({
          where: (layouts, { and, eq: eqOp }) =>
            and(eqOp(layouts.userId, userId), eqOp(layouts.segment, segment)),
        });
        if (existingLayout) {
          // 既に同じセグメントが存在する場合はスキップ
          continue;
        }

        // スロットデータを配列形式に変換
        const slots: { slot: number; items: string[] }[] = [];
        for (let i = 1; i <= 9; i++) {
          const slotKey = `slot${i}` as keyof LegacyItemLayout;
          const slotItems = layout[slotKey] as string[] | undefined;
          if (slotItems && Array.isArray(slotItems) && slotItems.length > 0) {
            // "any" は除外
            const filteredItems = slotItems.filter(item => item !== "any");
            if (filteredItems.length > 0) {
              slots.push({ slot: i, items: filteredItems });
            }
          }
        }

        // オフハンドデータ
        const offhand = layout.offhand && Array.isArray(layout.offhand)
          ? layout.offhand.filter(item => item !== "any")
          : [];

        await db.insert(itemLayouts).values({
          id: createId(),
          userId,
          segment,
          slots: JSON.stringify(slots),
          offhand: JSON.stringify(offhand),
          notes: layout.notes || null,
          displayOrder: itemLayoutsImported,
          createdAt: now,
          updatedAt: now,
        });
        itemLayoutsImported++;
      }
    }

    // サーチクラフトをインポート
    if (legacyData.searchCrafts && legacyData.searchCrafts.length > 0) {
      // 既存のサーチクラフトを削除
      await db.delete(searchCrafts).where(eq(searchCrafts.userId, userId));

      const now = new Date();

      for (const craft of legacyData.searchCrafts) {
        // アイテムを配列に変換（nullでないものだけ）
        const items: string[] = [];
        if (craft.item1) items.push(craft.item1);
        if (craft.item2) items.push(craft.item2);
        if (craft.item3) items.push(craft.item3);

        // アイテムがない場合はスキップ
        if (items.length === 0) {
          continue;
        }

        // キーを配列に変換（nullでないものだけ）
        const keys: string[] = [];
        if (craft.key1) keys.push(craft.key1);
        if (craft.key2) keys.push(craft.key2);
        if (craft.key3) keys.push(craft.key3);
        if (craft.key4) keys.push(craft.key4);

        await db.insert(searchCrafts).values({
          id: createId(),
          userId,
          sequence: craft.sequence,
          items: JSON.stringify(items),
          keys: JSON.stringify(keys),
          searchStr: craft.searchStr || null,
          comment: craft.comment || null,
          createdAt: now,
          updatedAt: now,
        });
        searchCraftsImported++;
      }
    }

    // インポート完了後にプリセットを自動作成
    // 更新されたデータを取得
    const userKeybindings = await db.query.keybindings.findMany({
      where: eq(keybindings.userId, userId),
    });
    const userPlayerConfig = await db.query.playerConfigs.findFirst({
      where: eq(playerConfigs.userId, userId),
    });
    const userKeyRemaps = await db.query.keyRemaps.findMany({
      where: eq(keyRemaps.userId, userId),
    });

    // 初期プリセットを作成（レガシーインポートもオンボーディングの一種として扱う）
    await createPresetFromOnboarding(
      db,
      userId,
      userKeybindings,
      userPlayerConfig ?? null,
      userKeyRemaps
    );

    return {
      success: true,
      keybindingsImported,
      customKeysImported,
      remapsImported,
      fingerAssignmentsImported,
      settingsImported,
      itemLayoutsImported,
      searchCraftsImported
    };
  } catch (error) {
    console.error("Legacy import error:", error);
    return {
      success: false,
      keybindingsImported: 0,
      customKeysImported: 0,
      remapsImported: 0,
      fingerAssignmentsImported: false,
      settingsImported: false,
      itemLayoutsImported: 0,
      searchCraftsImported: 0,
      error: error instanceof Error ? error.message : "インポート中にエラーが発生しました"
    };
  }
}
