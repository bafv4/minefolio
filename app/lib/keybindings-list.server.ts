// /keybindings（表）と /keybindings/visual（ビジュアル）で共有する走者一覧ローダー。
// ユーザー絞り込み・数値フィルタはクライアント側で行うため、ここでは公開ユーザーを全件返す。
//
// 表示データはメイン（公開用）プリセットのスナップショットを優先する。
// メインプリセットが無いユーザーのみライブテーブル（従来挙動）へフォールバックする
// （メインがある場合、null の種別は「空」であり、編集中のライブデータを混ぜてはならない）。
import { asc, desc, and, eq } from "drizzle-orm";
import type { Database } from "./db";
import {
  users,
  keybindings,
  keyRemaps,
  customKeys,
  customActions,
  configPresets,
} from "./schema";
import { excludeViewersCondition } from "./users-filter";
import { decodePresetConfig } from "./preset-read";

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
      configPresets: {
        where: eq(configPresets.isMain, true),
        columns: {
          id: true,
          keybindingsData: true,
          playerConfigData: true,
          remapsData: true,
          fingerAssignmentsData: true,
          customKeysData: true,
          customActionsData: true,
        },
      },
    },
  });

  const players = playersWithKeybindings.map((p) => {
    const { configPresets: userPresets, ...rest } = p;
    const mainPreset = userPresets[0];
    if (!mainPreset) return rest;

    const decoded = decodePresetConfig(mainPreset, p.id);
    const cfg = decoded.playerConfig;
    return {
      ...rest,
      keybindings: decoded.keybindings,
      keyRemaps: decoded.keyRemaps,
      customKeys: decoded.customKeys,
      customActions: decoded.customActions,
      playerConfig: cfg
        ? {
            keyboardLayout: (cfg.keyboardLayout as string | null) ?? null,
            fingerAssignments: decoded.fingerAssignments,
            mouseDpi: (cfg.mouseDpi as number | null) ?? null,
            gameSensitivity: (cfg.gameSensitivity as number | null) ?? null,
            windowsSpeed: (cfg.windowsSpeed as number | null) ?? null,
            windowsSpeedMultiplier:
              (cfg.windowsSpeedMultiplier as number | null) ?? null,
            rawInput: (cfg.rawInput as boolean | null) ?? null,
            mouseAcceleration: (cfg.mouseAcceleration as boolean | null) ?? null,
          }
        : null,
    };
  });

  return players.filter(
    (p) =>
      p.keybindings.length > 0 ||
      p.keyRemaps.length > 0 ||
      p.customActions.length > 0,
  );
}

export type KeybindingsListPlayer = Awaited<
  ReturnType<typeof loadKeybindingsListPlayers>
>[number];
