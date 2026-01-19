import { createId } from "@paralleldrive/cuid2";
import type { Database } from "./db";
import { keybindings, playerConfigs } from "./schema";
import { eq } from "drizzle-orm";
import { createPresetFromOnboarding } from "./preset-utils";

// デフォルトキーバインド定義
export const DEFAULT_KEYBINDINGS = [
  // Movement (7)
  { action: "forward", keyCode: "KeyW", category: "movement" as const },
  { action: "back", keyCode: "KeyS", category: "movement" as const },
  { action: "left", keyCode: "KeyA", category: "movement" as const },
  { action: "right", keyCode: "KeyD", category: "movement" as const },
  { action: "jump", keyCode: "Space", category: "movement" as const },
  { action: "sneak", keyCode: "ShiftLeft", category: "movement" as const },
  { action: "sprint", keyCode: "ControlLeft", category: "movement" as const },

  // Combat (4)
  { action: "attack", keyCode: "Mouse0", category: "combat" as const },
  { action: "use", keyCode: "Mouse1", category: "combat" as const },
  { action: "pickBlock", keyCode: "Mouse2", category: "combat" as const },
  { action: "drop", keyCode: "KeyQ", category: "combat" as const },

  // Inventory (11)
  { action: "inventory", keyCode: "KeyE", category: "inventory" as const },
  { action: "swapHands", keyCode: "KeyF", category: "inventory" as const },
  { action: "hotbar1", keyCode: "Digit1", category: "inventory" as const },
  { action: "hotbar2", keyCode: "Digit2", category: "inventory" as const },
  { action: "hotbar3", keyCode: "Digit3", category: "inventory" as const },
  { action: "hotbar4", keyCode: "Digit4", category: "inventory" as const },
  { action: "hotbar5", keyCode: "Digit5", category: "inventory" as const },
  { action: "hotbar6", keyCode: "Digit6", category: "inventory" as const },
  { action: "hotbar7", keyCode: "Digit7", category: "inventory" as const },
  { action: "hotbar8", keyCode: "Digit8", category: "inventory" as const },
  { action: "hotbar9", keyCode: "Digit9", category: "inventory" as const },

  // UI (5)
  { action: "togglePerspective", keyCode: "F5", category: "ui" as const },
  { action: "fullscreen", keyCode: "F11", category: "ui" as const },
  { action: "chat", keyCode: "KeyT", category: "ui" as const },
  { action: "command", keyCode: "Slash", category: "ui" as const },
  { action: "toggleHud", keyCode: "F1", category: "ui" as const },
] as const;

// キーバインドアクションの表示名
export const KEYBINDING_LABELS: Record<string, string> = {
  // Movement
  forward: "Forward",
  back: "Back",
  left: "Left",
  right: "Right",
  jump: "Jump",
  sneak: "Sneak",
  sprint: "Sprint",
  // Combat
  attack: "Attack",
  use: "Use Item",
  pickBlock: "Pick Block",
  drop: "Drop",
  // Inventory
  inventory: "Inventory",
  swapHands: "Swap Hands",
  hotbar1: "Hotbar 1",
  hotbar2: "Hotbar 2",
  hotbar3: "Hotbar 3",
  hotbar4: "Hotbar 4",
  hotbar5: "Hotbar 5",
  hotbar6: "Hotbar 6",
  hotbar7: "Hotbar 7",
  hotbar8: "Hotbar 8",
  hotbar9: "Hotbar 9",
  // UI
  togglePerspective: "Perspective",
  fullscreen: "Fullscreen",
  chat: "Chat",
  command: "Command",
  toggleHud: "Toggle HUD",
};

// カテゴリの表示名
export const CATEGORY_LABELS: Record<string, string> = {
  movement: "Movement",
  combat: "Combat",
  inventory: "Inventory",
  ui: "UI",
};

// デフォルトキーバインドを作成
export async function createDefaultKeybindings(db: Database, userId: string) {
  const now = new Date();
  const values = DEFAULT_KEYBINDINGS.map((kb) => ({
    id: createId(),
    userId,
    action: kb.action,
    keyCode: kb.keyCode,
    category: kb.category,
    createdAt: now,
    updatedAt: now,
  }));

  // D1のSQL変数制限を回避するため、バッチで挿入
  const BATCH_SIZE = 10;
  for (let i = 0; i < values.length; i += BATCH_SIZE) {
    const batch = values.slice(i, i + BATCH_SIZE);
    await db.insert(keybindings).values(batch);
  }
}

// デフォルトプレイヤー設定を作成
export async function createDefaultPlayerConfig(db: Database, userId: string) {
  const now = new Date();
  await db.insert(playerConfigs).values({
    id: createId(),
    userId,
    keyboardLayout: "US",
    mouseAcceleration: false,
    rawInput: true,
    createdAt: now,
    updatedAt: now,
  });
}

// 新規ユーザーのデフォルト設定を一括作成
export async function createDefaultsForNewUser(db: Database, userId: string) {
  await Promise.all([
    createDefaultKeybindings(db, userId),
    createDefaultPlayerConfig(db, userId),
  ]);

  // 作成したデータを取得してプリセットを作成
  const userKeybindings = await db.query.keybindings.findMany({
    where: eq(keybindings.userId, userId),
  });
  const userPlayerConfig = await db.query.playerConfigs.findFirst({
    where: eq(playerConfigs.userId, userId),
  });

  // 初期プリセットを作成
  await createPresetFromOnboarding(
    db,
    userId,
    userKeybindings,
    userPlayerConfig ?? null,
    [] // 新規ユーザーにはリマップなし
  );
}

// Windowsポインター速度の乗数（11/11がデフォルト）
const WINDOWS_SPEED_MULTIPLIERS: Record<number, number> = {
  1: 0.03125,
  2: 0.0625,
  3: 0.125,
  4: 0.25,
  5: 0.375,
  6: 0.5,
  7: 0.625,
  8: 0.75,
  9: 0.875,
  10: 1,
  11: 1.25,
  12: 1.5,
  13: 1.75,
  14: 2,
  15: 2.25,
  16: 2.5,
  17: 2.75,
  18: 3,
  19: 3.25,
  20: 3.5,
};

// cm/360 計算式
export function calculateCm360(
  dpi: number,
  sensitivity: number,
  windowsSpeed: number = 11
): number {
  const mcSensitivity = sensitivity * 0.6 + 0.2;
  const winMultiplier = WINDOWS_SPEED_MULTIPLIERS[windowsSpeed] ?? 1.25;
  const eDPI = dpi * mcSensitivity * winMultiplier;
  return Math.round((360 / eDPI) * 2.54 * 10) / 10;
}
