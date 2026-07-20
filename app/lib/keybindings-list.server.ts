// /keybindings（表）と /keybindings/visual（ビジュアル）で共有する走者一覧ローダー
// （/api/keybindings-csv も slugs オプション付きで再利用する）。
// ユーザー絞り込み・数値フィルタはクライアント側で行うため、ここでは公開ユーザーを全件返す。
//
// 表示データはメイン（公開用）プリセットのスナップショットを優先する。
// メインプリセットが無いユーザーのみライブテーブル（従来挙動）へフォールバックする
// （メインがある場合、null の種別は「空」であり、編集中のライブデータを混ぜてはならない）。
//
// フェッチは2段構え: まず全員分のスナップショットだけを取り、メインが無いユーザーに限って
// 2段目でライブ行を取る。メイン整備後はほぼ全ユーザーがスナップショット表示のため、
// 全員分のライブ行を取ってから捨てる一括フェッチより転送量が大幅に少ない。
import { asc, desc, and, eq, inArray } from "drizzle-orm";
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

export async function loadKeybindingsListPlayers(
  db: Database,
  options?: { slugs?: string[] },
) {
  const baseCondition = and(
    eq(users.profileVisibility, "public"),
    excludeViewersCondition,
    ...(options?.slugs && options.slugs.length > 0
      ? [inArray(users.slug, options.slugs)]
      : []),
  );

  const playersWithMain = await db.query.users.findMany({
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

  // 2段目: メインプリセットが無いユーザーのライブ行のみ取得
  const fallbackIds = playersWithMain
    .filter((p) => p.configPresets.length === 0)
    .map((p) => p.id);
  const liveRows =
    fallbackIds.length > 0
      ? await db.query.users.findMany({
          where: inArray(users.id, fallbackIds),
          columns: { id: true },
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
        })
      : [];
  const liveById = new Map(liveRows.map((u) => [u.id, u]));

  const players = playersWithMain.map((p) => {
    const { configPresets: userPresets, ...rest } = p;
    const mainPreset = userPresets[0];

    if (!mainPreset) {
      const live = liveById.get(p.id);
      return {
        ...rest,
        keybindings: live?.keybindings ?? [],
        keyRemaps: live?.keyRemaps ?? [],
        customKeys: live?.customKeys ?? [],
        customActions: live?.customActions ?? [],
        playerConfig: live?.playerConfig ?? null,
      };
    }

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
            keyboardLayout: cfg.keyboardLayout ?? null,
            fingerAssignments: decoded.fingerAssignments,
            mouseDpi: cfg.mouseDpi ?? null,
            gameSensitivity: cfg.gameSensitivity ?? null,
            windowsSpeed: cfg.windowsSpeed ?? null,
            windowsSpeedMultiplier: cfg.windowsSpeedMultiplier ?? null,
            rawInput: cfg.rawInput ?? null,
            mouseAcceleration: cfg.mouseAcceleration ?? null,
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
