import type { Database } from "./db";

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

// 新規ユーザーのデフォルト設定を一括作成
// 注: 現在は何も作成しない（ユーザーが自分で設定する）
export async function createDefaultsForNewUser(_db: Database, _userId: string) {
  // デフォルトのキーバインドやプレイヤー設定は作成しない
  // ユーザーがoptions.txtをインポートするか、手動で設定することを想定
}
