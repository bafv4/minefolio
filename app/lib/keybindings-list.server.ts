// /keybindings（表）と /keybindings/visual（ビジュアル）で共有する走者一覧ローダー
// （/api/keybindings-csv も slugs オプション付きで再利用する）。
// ユーザー絞り込み・数値フィルタはクライアント側で行うため、ここでは公開ユーザーを全件返す。
//
// 表示データはメイン（公開用）プリセットのスナップショットを優先する。
// ただしメインが「編集中（isActive）」の場合はライブテーブルを使う — 不変条件
// 「アクティブプリセット = ライブテーブル」により、ライブこそが現在適用中の設定だから
// （判定は shouldUsePresetSnapshot に集約。プロフィールページも同じ規則）。
// メインプリセットが無いユーザーもライブテーブル（従来挙動）へフォールバックする。
// メインが非アクティブな場合、null の種別は「空」であり、編集中のライブデータを混ぜてはならない。
//
// フェッチは2段構え: まずプリセットのフラグだけ（重量 JSON 列なし）を取り、2段目で
// 表示元がスナップショットのユーザーには *Data 列を、ライブのユーザーにはライブ行を、
// 必要な分だけ並列に取る（ユーザーごとにどちらか一方しか引かないため転送量が最小になる）。
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
import { decodePresetConfig, shouldUsePresetSnapshot } from "./preset-read";
import { getCached, setCached } from "./cache";

const KEYBINDINGS_LIST_CACHE_KEY = "keybindings:list:all";
const KEYBINDINGS_LIST_CACHE_TTL = 60 * 1000; // 1分

export async function loadKeybindingsListPlayers(
  db: Database,
  options?: { slugs?: string[] },
) {
  const useCache = !options?.slugs || options.slugs.length === 0;
  if (useCache) {
    const cached = await getCached<Awaited<ReturnType<typeof fetchKeybindingsListPlayers>>>(
      KEYBINDINGS_LIST_CACHE_KEY,
    );
    if (cached) return cached;
  }

  const result = await fetchKeybindingsListPlayers(db, options);

  if (useCache) {
    await setCached(KEYBINDINGS_LIST_CACHE_KEY, result, KEYBINDINGS_LIST_CACHE_TTL);
  }

  return result;
}

async function fetchKeybindingsListPlayers(
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

  // 1段目: ユーザー + メインプリセットのフラグのみ（重量 JSON 列は取らない）
  const playersWithMain = await db.query.users.findMany({
    where: baseCondition,
    orderBy: [desc(users.createdAt)],
    columns: {
      id: true,
      mcid: true,
      uuid: true,
      slug: true,
      displayName: true,
      displayNameAlphabet: true,
      customSkinUrl: true,
    },
    with: {
      configPresets: {
        where: eq(configPresets.isMain, true),
        columns: { id: true, isActive: true },
      },
    },
  });

  // 表示元の振り分け: メインが非アクティブならスナップショット、それ以外（メイン無し /
  // メインが編集中）はライブテーブル（＝現在適用中の設定そのもの）
  const snapshotPresetIds: string[] = [];
  const liveUserIds: string[] = [];
  for (const p of playersWithMain) {
    const mainPreset = p.configPresets[0];
    if (shouldUsePresetSnapshot(mainPreset)) {
      snapshotPresetIds.push(mainPreset.id);
    } else {
      liveUserIds.push(p.id);
    }
  }

  // 2段目: 必要な側だけを取得する
  const [snapshotRows, liveRows] = await Promise.all([
    snapshotPresetIds.length > 0
      ? db.query.configPresets.findMany({
          where: inArray(configPresets.id, snapshotPresetIds),
          columns: {
            id: true,
            keybindingsData: true,
            playerConfigData: true,
            remapsData: true,
            fingerAssignmentsData: true,
            customKeysData: true,
            customActionsData: true,
          },
        })
      : Promise.resolve([]),
    liveUserIds.length > 0
      ? db.query.users.findMany({
          where: inArray(users.id, liveUserIds),
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
      : Promise.resolve([]),
  ]);
  const snapshotById = new Map(snapshotRows.map((p) => [p.id, p]));
  const liveById = new Map(liveRows.map((u) => [u.id, u]));

  const players = playersWithMain.map((p) => {
    const { configPresets: userPresets, ...rest } = p;
    const mainPreset = userPresets[0];
    const snapshot = shouldUsePresetSnapshot(mainPreset)
      ? snapshotById.get(mainPreset.id)
      : undefined;

    if (!snapshot) {
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

    const decoded = decodePresetConfig(snapshot, p.id);
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
