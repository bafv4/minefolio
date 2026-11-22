import type { Translator } from "@/lib/messages";
import { createId } from "@paralleldrive/cuid2";
import type { Database } from "./db";
import { keybindings, playerConfigs, customKeys, keyRemaps, itemLayouts, searchCrafts, searchCraftLoops, customActions } from "./schema";
import { eq } from "drizzle-orm";
import { normalizeKeyCode, type FingerType } from "./keybindings";
import { sanitizeFingerAssignments } from "./finger-assignments";
import { isValidMouseDpi, isValidSensitivity } from "./mouse-settings";
import { createPresetFromOnboarding } from "./preset-utils";
import { errorSummary } from "./error-summary";

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

type LegacyImportTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

interface LegacyImportCounts {
  keybindingsImported: number;
  customKeysImported: number;
  remapsImported: number;
  fingerAssignmentsImported: boolean;
  settingsImported: boolean;
  itemLayoutsImported: number;
  searchCraftsImported: number;
}

/**
 * 旧データをライブテーブルへ書き込む（トランザクション内で呼ぶ）。
 * 既存データの削除と挿入を同じトランザクションに入れるため、途中で失敗すると全体がロールバックされ、
 * 既存のデータが消えたまま残ることはない。外部 fetch は呼び出し側で済ませてから渡す。
 */
async function writeLegacyData(
  tx: LegacyImportTransaction,
  userId: string,
  legacyData: LegacyPlayerData
): Promise<LegacyImportCounts> {
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
        await tx.delete(keybindings).where(eq(keybindings.userId, userId));

        const now = new Date();

        // D1/SQLiteでは一度に1つずつ挿入する（バッチ挿入の互換性問題を回避）
        for (const legacyAction of keybindActions) {
          const rawKeyCode = settings[legacyAction as keyof typeof settings] as string | undefined;
          const mapping = KEYBIND_ACTION_MAP[legacyAction];
          if (mapping && rawKeyCode && typeof rawKeyCode === "string") {
            // Minecraft形式のキーコードをJavaScript形式に正規化
            const keyCode = normalizeKeyCode(rawKeyCode);
            await tx.insert(keybindings).values({
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
      const existingConfig = await tx.query.playerConfigs.findFirst({
        where: eq(playerConfigs.userId, userId),
      });

      // 旧データは無検証で入ってくるため、数値項目は妥当性を確認する。
      // 無効値はクランプせず取り込まない（null）方針。未設定（undefined）は従来どおり列を更新しない。
      const importedMouseDpi =
        settings.mouseDpi === undefined
          ? undefined
          : isValidMouseDpi(settings.mouseDpi)
            ? settings.mouseDpi
            : null;
      const importedGameSensitivity =
        settings.gameSensitivity === undefined
          ? undefined
          : isValidSensitivity(settings.gameSensitivity)
            ? settings.gameSensitivity
            : null;
      const importedCm360 =
        settings.cm360 === undefined
          ? undefined
          : Number.isFinite(settings.cm360) && settings.cm360 > 0
            ? settings.cm360
            : null;

      const configValues = {
        keyboardLayout: settings.keyboardLayout as "JIS" | "US" | "JIS_TKL" | "US_TKL" | undefined,
        keyboardModel: settings.keyboardModel,
        mouseModel: settings.mouseModel,
        mouseDpi: importedMouseDpi,
        gameSensitivity: importedGameSensitivity,
        cm360: importedCm360,
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
        await tx
          .update(playerConfigs)
          .set(configValues)
          .where(eq(playerConfigs.userId, userId));
      } else {
        await tx.insert(playerConfigs).values({
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
      await tx.delete(customKeys).where(eq(customKeys.userId, userId));

      const now = new Date();

      for (const customKey of legacyData.customKeys) {
        if (customKey.keyCode && customKey.keyName) {
          // Minecraft形式のキーコードをJavaScript形式に正規化
          const keyCode = normalizeKeyCode(customKey.keyCode);
          const category = guessCustomKeyCategory(keyCode, customKey.keyName);
          await tx.insert(customKeys).values({
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
      await tx.delete(keyRemaps).where(eq(keyRemaps.userId, userId));

      const now = new Date();

      for (const [sourceKeyRaw, targetKeyRaw] of Object.entries(legacyData.remappings)) {
        // 変換元キーコード（すでにJavaScript形式の可能性もある）
        const sourceKey = normalizeKeyCode(sourceKeyRaw);
        // 変換先キーコード（"key.keyboard.disabled"や単一文字の場合もある）
        let targetKey: string | null = null;
        if (targetKeyRaw && targetKeyRaw !== "key.keyboard.disabled") {
          targetKey = normalizeKeyCode(targetKeyRaw);
        }

        await tx.insert(keyRemaps).values({
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
      // 指割り当てをマップに変換（キーコードはすでにJavaScript形式）。
      // 有効な指だけを残し、件数・長さの上限も共通のサニタイズ（finger-assignments.ts）で揃える
      const fingerMap: Record<string, FingerType[]> = {};
      for (const [keyCode, fingers] of Object.entries(sanitizeFingerAssignments(apiFingerAssignments))) {
        if (fingers.length > 0) fingerMap[keyCode] = fingers;
      }

      // 指割り当てがある場合はplayerConfigsに保存
      if (Object.keys(fingerMap).length > 0) {
        const now = new Date();
        const existingConfig = await tx.query.playerConfigs.findFirst({
          where: eq(playerConfigs.userId, userId),
        });

        const fingerAssignmentsJson = JSON.stringify(fingerMap);

        if (existingConfig) {
          await tx
            .update(playerConfigs)
            .set({ fingerAssignments: fingerAssignmentsJson, updatedAt: now })
            .where(eq(playerConfigs.userId, userId));
        } else {
          await tx.insert(playerConfigs).values({
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
      await tx.delete(itemLayouts).where(eq(itemLayouts.userId, userId));

      const now = new Date();

      for (const layout of legacyData.itemLayouts) {
        // セグメント名はそのまま使用（変換しない）
        const segment = layout.segment;

        // 同じセグメントが既にインポートされていないか確認
        const existingLayout = await tx.query.itemLayouts.findFirst({
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

        await tx.insert(itemLayouts).values({
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
      // 既存のサーチクラフト・Loop（繋ぎ方）を削除
      // Loop は searchCrafts.id を参照するため、crafts を入れ替える前に必ず Loop も削除する
      // （残すと新しい crafts の id に対して古い Loop が孤児参照になる）
      await tx.delete(searchCraftLoops).where(eq(searchCraftLoops.userId, userId));
      await tx.delete(searchCrafts).where(eq(searchCrafts.userId, userId));

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

        await tx.insert(searchCrafts).values({
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

  return {
    keybindingsImported,
    customKeysImported,
    remapsImported,
    fingerAssignmentsImported,
    settingsImported,
    itemLayoutsImported,
    searchCraftsImported
  };
}

/** 取り込めなかったときの返り値（件数はすべて 0） */
function legacyImportFailure(error: string) {
  return {
    success: false,
    keybindingsImported: 0,
    customKeysImported: 0,
    remapsImported: 0,
    fingerAssignmentsImported: false,
    settingsImported: false,
    itemLayoutsImported: 0,
    searchCraftsImported: 0,
    error,
  };
}

/**
 * MCSRer Hotkeysからデータをインポート
 *
 * - 旧 API の取得（外部 fetch）はトランザクションの外で先に行う
 * - ライブテーブルへの書き込み（既存データの削除＋挿入）と、取り込んだ内容での新しいプリセットの作成
 *   （編集先にする）は 1 トランザクション。途中で失敗すると全体がロールバックされ、既存のライブデータも
 *   既存のプリセットも元のまま残る（プリセットの作成だけ失敗して、データがどのプリセットにも属さなくなることもない）
 * - 取り込みのたびに新しいプリセットを作る（既存プリセットの中身・updatedAt は変えない。既存のアクティブは
 *   createPreset が非アクティブにする）。取り込み後も元のプリセットへ切り替えて戻せる
 * - 失敗時にユーザーへ返す文言は翻訳済みの固定文言だけ（drizzle のエラー文は SQL を含むため返さない）
 */
export async function importFromLegacy(
  t: Translator,
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
      return legacyImportFailure(t("meImport.legacyNotFound"));
    }

    const counts = await db.transaction(async (tx) => {
      const written = await writeLegacyData(tx, userId, legacyData);

      // 書き込んだ内容（ライブテーブル）で新しいプリセットを作り、編集先にする。
      // 更新されたデータを取得する
      const [
        userKeybindings,
        userPlayerConfig,
        userKeyRemaps,
        userItemLayouts,
        userSearchCrafts,
        userCustomKeys,
        userCustomActions,
      ] = await Promise.all([
        tx.query.keybindings.findMany({ where: eq(keybindings.userId, userId) }),
        tx.query.playerConfigs.findFirst({ where: eq(playerConfigs.userId, userId) }),
        tx.query.keyRemaps.findMany({ where: eq(keyRemaps.userId, userId) }),
        tx.query.itemLayouts.findMany({ where: eq(itemLayouts.userId, userId) }),
        tx.query.searchCrafts.findMany({ where: eq(searchCrafts.userId, userId) }),
        tx.query.customKeys.findMany({ where: eq(customKeys.userId, userId) }),
        // カスタムアクションはレガシーAPIに存在しないが、ライブテーブルに既存データが残っている場合は
        // スナップショットへ含める（アクティブプリセット=ライブテーブルの不変条件）
        tx.query.customActions.findMany({ where: eq(customActions.userId, userId) }),
      ]);

      // レガシーインポートもオンボーディングの一種として扱う
      await createPresetFromOnboarding(
        t,
        tx,
        userId,
        userKeybindings,
        userPlayerConfig ?? null,
        userKeyRemaps,
        userItemLayouts,
        userSearchCrafts,
        userCustomKeys,
        userCustomActions
      );
      return written;
    });

    return { success: true, ...counts };
  } catch (error) {
    // 失敗したクエリの SQL・パラメータ（入力値）をログとユーザーへ出さない
    console.error("Legacy import error:", errorSummary(error));
    return legacyImportFailure(t("meImport.legacyImportFailed"));
  }
}
