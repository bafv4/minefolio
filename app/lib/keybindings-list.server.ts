// /keybindings（表）と /keybindings/visual（ビジュアル）で共有する走者一覧ローダー。
// ユーザー絞り込み・数値フィルタはクライアント側で行うため、ここでは公開ユーザーを全件返す。
import { asc, desc, and, eq } from "drizzle-orm";
import type { Database } from "./db";
import {
  users,
  keybindings,
  keyRemaps,
  customKeys,
  customActions,
} from "./schema";
import { excludeViewersCondition } from "./users-filter";

export async function loadKeybindingsListPlayers(db: Database) {
  const baseCondition = and(
    eq(users.profileVisibility, "public"),
    excludeViewersCondition,
  );

  const playersWithKeybindings = await db.query.users.findMany({
    where: baseCondition,
    orderBy: [desc(users.createdAt)],
    columns: {
      id: true,
      mcid: true,
      uuid: true,
      slug: true,
      displayName: true,
      customSkinUrl: true,
    },
    with: {
      keybindings: {
        orderBy: [asc(keybindings.category), asc(keybindings.action)],
      },
      keyRemaps: {
        orderBy: [asc(keyRemaps.sourceKey)],
      },
      playerConfig: {
        columns: {
          keyboardLayout: true,
          fingerAssignments: true,
          mouseDpi: true,
          gameSensitivity: true,
          windowsSpeed: true,
          windowsSpeedMultiplier: true,
          rawInput: true,
          mouseAcceleration: true,
        },
      },
      customKeys: {
        orderBy: [asc(customKeys.category), asc(customKeys.keyName)],
      },
      customActions: {
        orderBy: [
          asc(customActions.displayOrder),
          asc(customActions.actionName),
        ],
      },
    },
  });

  return playersWithKeybindings.filter(
    (p) =>
      p.keybindings.length > 0 ||
      p.keyRemaps.length > 0 ||
      p.customActions.length > 0,
  );
}

export type KeybindingsListPlayer = Awaited<
  ReturnType<typeof loadKeybindingsListPlayers>
>[number];
