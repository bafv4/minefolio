// 操作設定の統計を集計するサーバー側ロジック。
// 旧 /keybindings/stats の loader を関数として切り出したもの。
// /keybindings?view=stats からも呼び出される。
import { and, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { keybindings, keyRemaps, playerConfigs, users } from "./schema";
import type { Database } from "./db";
import { excludeViewersCondition } from "./users-filter";
import {
  calculateCm360,
  isValidSensitivity,
  toSensitivityPercent,
} from "./mouse-settings";
import type { MessageKey } from "./messages";
import { getCached, setCached } from "./cache";
// 描画側（stats-view.tsx）も値として参照するため、非 .server モジュールに置いている
import { UNASSIGNED_INPUT_KEY } from "./keybindings-stats-shared";

export { UNASSIGNED_INPUT_KEY };

// 主要なアクション（集計対象）。ラベルはロケール依存なのでキーで持ち、描画時に解決する
export const TRACKED_ACTIONS = [
  { action: "forward", labelKey: "actionLabels.forward" as const },
  { action: "back", labelKey: "actionLabels.back" as const },
  { action: "left", labelKey: "actionLabels.left" as const },
  { action: "right", labelKey: "actionLabels.right" as const },
  { action: "sprint", labelKey: "actionLabels.sprint" as const },
  { action: "sneak", labelKey: "actionLabels.sneak" as const },
  { action: "jump", labelKey: "actionLabels.jump" as const },
  { action: "inventory", labelKey: "actionLabels.inventory" as const },
  { action: "swapHands", labelKey: "actionLabels.swapHands" as const },
  { action: "drop", labelKey: "actionLabels.drop" as const },
  { action: "pickBlock", labelKey: "actionLabels.pickBlock" as const },
  { action: "attack", labelKey: "actionLabels.attack" as const },
  { action: "use", labelKey: "actionLabels.use" as const },
  { action: "hotbar1", labelKey: "actionLabels.hotbar1" as const },
  { action: "hotbar2", labelKey: "actionLabels.hotbar2" as const },
  { action: "hotbar3", labelKey: "actionLabels.hotbar3" as const },
  { action: "hotbar4", labelKey: "actionLabels.hotbar4" as const },
  { action: "hotbar5", labelKey: "actionLabels.hotbar5" as const },
  { action: "hotbar6", labelKey: "actionLabels.hotbar6" as const },
  { action: "hotbar7", labelKey: "actionLabels.hotbar7" as const },
  { action: "hotbar8", labelKey: "actionLabels.hotbar8" as const },
  { action: "hotbar9", labelKey: "actionLabels.hotbar9" as const },
] as const;

// DPI 区分（11段階）
export const DPI_RANGES = [
  { min: 0, max: 399, label: "< 400" },
  { min: 400, max: 799, label: "400-799" },
  { min: 800, max: 1199, label: "800-1199" },
  { min: 1200, max: 1599, label: "1200-1599" },
  { min: 1600, max: 1999, label: "1600-1999" },
  { min: 2000, max: 2399, label: "2000-2399" },
  { min: 2400, max: 3199, label: "2400-3199" },
  { min: 3200, max: 4799, label: "3200-4799" },
  { min: 4800, max: 6399, label: "4800-6399" },
  { min: 6400, max: 12799, label: "6400-12799" },
  { min: 12800, max: Infinity, label: "≥ 12800" },
];

// 振り向き（cm/180）区分（13段階）
export const CM180_RANGES = [
  { min: 0, max: 5, label: "< 5 cm" },
  { min: 5, max: 10, label: "5-9 cm" },
  { min: 10, max: 15, label: "10-14 cm" },
  { min: 15, max: 20, label: "15-19 cm" },
  { min: 20, max: 25, label: "20-24 cm" },
  { min: 25, max: 30, label: "25-29 cm" },
  { min: 30, max: 35, label: "30-34 cm" },
  { min: 35, max: 40, label: "35-39 cm" },
  { min: 40, max: 45, label: "40-44 cm" },
  { min: 45, max: 50, label: "45-49 cm" },
  { min: 50, max: 60, label: "50-59 cm" },
  { min: 60, max: 70, label: "60-69 cm" },
  { min: 70, max: Infinity, label: "≥ 70 cm" },
];

// ゲーム内感度区分（10段階）
// 表示・CSV・編集画面と同じ 0〜200%（Minecraft 準拠）基準。max は DPI 区分と同じく閉端で、
// 最終区分の 200% も含む（有効範囲外の感度は集計対象から除外しているため上限は 200% で足りる）。
export const SENSITIVITY_RANGES = [
  { min: 0, max: 19, label: "< 20%" },
  { min: 20, max: 39, label: "20-39%" },
  { min: 40, max: 59, label: "40-59%" },
  { min: 60, max: 79, label: "60-79%" },
  { min: 80, max: 99, label: "80-99%" },
  { min: 100, max: 119, label: "100-119%" },
  { min: 120, max: 139, label: "120-139%" },
  { min: 140, max: 159, label: "140-159%" },
  { min: 160, max: 179, label: "160-179%" },
  { min: 180, max: 200, label: "180-200%" },
];

export interface PlayerInfo {
  slug: string;
  mcid: string | null;
  uuid: string | null;
  displayName: string | null;
  displayNameAlphabet: string | null;
  customSkinUrl: string | null;
}

export interface KeybindingStats {
  action: string;
  /** ラベルは翻訳キーで返し、描画側（useT）で解決する */
  labelKey: MessageKey;
  topKeys: Array<{ keyCode: string; count: number; percentage: number; players: PlayerInfo[] }>;
  totalCount: number;
}

export interface F3RemapStats {
  topTargets: Array<{ targetKey: string; count: number; percentage: number; players: PlayerInfo[] }>;
  totalCount: number;
}

export interface RangeStatWithPlayers {
  label: string;
  count: number;
  percentage: number;
  players: PlayerInfo[];
}

export interface DpiStats {
  ranges: RangeStatWithPlayers[];
  average: number | null;
  median: number | null;
  totalCount: number;
}

export interface Cm180Stats {
  ranges: RangeStatWithPlayers[];
  average: number | null;
  median: number | null;
  totalCount: number;
}

export interface SensitivityStats {
  ranges: RangeStatWithPlayers[];
  average: number | null;
  totalCount: number;
}

export interface RawInputStats {
  onCount: number;
  offCount: number;
  totalCount: number;
  onPlayers: PlayerInfo[];
  offPlayers: PlayerInfo[];
}

export interface KeybindingsStatsData {
  keybindingStats: KeybindingStats[];
  f3RemapStats: F3RemapStats;
  dpiStats: DpiStats;
  cm180Stats: Cm180Stats;
  sensitivityStats: SensitivityStats;
  rawInputStats: RawInputStats;
  totalPlayers: number;
  playersWithKeybindings: number;
  playersWithMouseSettings: number;
}

const KEYBINDINGS_STATS_CACHE_KEY = "keybindings:stats";
const KEYBINDINGS_STATS_CACHE_TTL = 60 * 1000; // 1分

export async function loadKeybindingsStats(
  db: Database,
): Promise<KeybindingsStatsData> {
  const cached = await getCached<KeybindingsStatsData>(KEYBINDINGS_STATS_CACHE_KEY);
  if (cached) return cached;

  const publicCondition = and(
    eq(users.profileVisibility, "public"),
    excludeViewersCondition,
  );

  // 総走者数
  const [totalResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(users)
    .where(publicCondition);
  const totalPlayers = totalResult?.count ?? 0;

  // キーバインドを持つユーザー数
  const [keybindingCountResult] = await db
    .select({ count: sql<number>`count(distinct ${keybindings.userId})` })
    .from(keybindings)
    .innerJoin(users, eq(keybindings.userId, users.id))
    .where(publicCondition);
  const playersWithKeybindings = keybindingCountResult?.count ?? 0;

  // マウス設定を持つユーザー数
  const [mouseCountResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(playerConfigs)
    .innerJoin(users, eq(playerConfigs.userId, users.id))
    .where(and(publicCondition, isNotNull(playerConfigs.mouseDpi)));
  const playersWithMouseSettings = mouseCountResult?.count ?? 0;

  // キーバインド統計（TRACKED_ACTIONS 全アクション分を1クエリでまとめて取得し、JS側で集計する）
  const keybindingStats: KeybindingStats[] = [];
  const trackedActionNames = TRACKED_ACTIONS.map((a) => a.action);
  const trackedRows = await db
    .select({
      action: keybindings.action,
      keyCode: keybindings.keyCode,
      slug: users.slug,
      mcid: users.mcid,
      uuid: users.uuid,
      displayName: users.displayName,
      displayNameAlphabet: users.displayNameAlphabet,
      customSkinUrl: users.customSkinUrl,
    })
    .from(keybindings)
    .innerJoin(users, eq(keybindings.userId, users.id))
    .where(and(publicCondition, inArray(keybindings.action, trackedActionNames)));

  const rowsByAction = new Map<string, typeof trackedRows>();
  for (const r of trackedRows) {
    const rows = rowsByAction.get(r.action) ?? [];
    rows.push(r);
    rowsByAction.set(r.action, rows);
  }

  for (const tracked of TRACKED_ACTIONS) {
    const results = rowsByAction.get(tracked.action) ?? [];

    const keyGroups = new Map<string, PlayerInfo[]>();
    for (const r of results) {
      const players = keyGroups.get(r.keyCode) ?? [];
      players.push({ slug: r.slug, mcid: r.mcid, uuid: r.uuid, displayName: r.displayName, displayNameAlphabet: r.displayNameAlphabet, customSkinUrl: r.customSkinUrl });
      keyGroups.set(r.keyCode, players);
    }

    const totalCount = results.length;
    const topKeys = Array.from(keyGroups.entries())
      .map(([keyCode, players]) => ({
        keyCode,
        count: players.length,
        percentage: totalCount > 0 ? (players.length / totalCount) * 100 : 0,
        players,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    keybindingStats.push({
      action: tracked.action,
      labelKey: tracked.labelKey,
      topKeys,
      totalCount,
    });
  }

  // F3 入力キー統計（ゲーム入力の統計なので chat 種別のリマップは除外）
  const f3InputRemaps = await db
    .select({
      userId: keyRemaps.userId,
      sourceKey: keyRemaps.sourceKey,
      slug: users.slug,
      mcid: users.mcid,
      uuid: users.uuid,
      displayName: users.displayName,
      displayNameAlphabet: users.displayNameAlphabet,
      customSkinUrl: users.customSkinUrl,
    })
    .from(keyRemaps)
    .innerJoin(users, eq(keyRemaps.userId, users.id))
    .where(and(publicCondition, eq(keyRemaps.targetKey, "F3"), ne(keyRemaps.remapType, "chat")));

  const remappedToF3UserIds = new Set(f3InputRemaps.map((r) => r.userId));
  const usersWithKeybindingsData = await db
    .select({
      userId: keybindings.userId,
      slug: users.slug,
      mcid: users.mcid,
      uuid: users.uuid,
      displayName: users.displayName,
      displayNameAlphabet: users.displayNameAlphabet,
      customSkinUrl: users.customSkinUrl,
    })
    .from(keybindings)
    .innerJoin(users, eq(keybindings.userId, users.id))
    .where(publicCondition)
    .groupBy(keybindings.userId, users.slug, users.mcid, users.uuid, users.displayName, users.displayNameAlphabet, users.customSkinUrl);

  const f3DefaultUsers = usersWithKeybindingsData.filter(
    (u) => !remappedToF3UserIds.has(u.userId),
  );

  const f3Groups = new Map<string, PlayerInfo[]>();
  if (f3DefaultUsers.length > 0) {
    f3Groups.set(
      "F3",
      f3DefaultUsers.map((u) => ({
        slug: u.slug,
        mcid: u.mcid,
        uuid: u.uuid,
        displayName: u.displayName,
        displayNameAlphabet: u.displayNameAlphabet,
        customSkinUrl: u.customSkinUrl,
      })),
    );
  }

  for (const r of f3InputRemaps) {
    // sourceKey が無い行のグループ化キー。表示は描画側が unassigned を訳す
    const inputKey = r.sourceKey ?? UNASSIGNED_INPUT_KEY;
    const players = f3Groups.get(inputKey) ?? [];
    players.push({ slug: r.slug, mcid: r.mcid, uuid: r.uuid, displayName: r.displayName, displayNameAlphabet: r.displayNameAlphabet, customSkinUrl: r.customSkinUrl });
    f3Groups.set(inputKey, players);
  }

  const f3TotalCount = f3DefaultUsers.length + f3InputRemaps.length;
  const f3RemapStats: F3RemapStats = {
    topTargets: Array.from(f3Groups.entries())
      .map(([targetKey, players]) => ({
        targetKey,
        count: players.length,
        percentage: f3TotalCount > 0 ? (players.length / f3TotalCount) * 100 : 0,
        players,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    totalCount: f3TotalCount,
  };

  // マウス設定
  const mouseConfigs = await db
    .select({
      mouseDpi: playerConfigs.mouseDpi,
      gameSensitivity: playerConfigs.gameSensitivity,
      windowsSpeed: playerConfigs.windowsSpeed,
      windowsSpeedMultiplier: playerConfigs.windowsSpeedMultiplier,
      rawInput: playerConfigs.rawInput,
      slug: users.slug,
      mcid: users.mcid,
      uuid: users.uuid,
      displayName: users.displayName,
      displayNameAlphabet: users.displayNameAlphabet,
      customSkinUrl: users.customSkinUrl,
    })
    .from(playerConfigs)
    .innerJoin(users, eq(playerConfigs.userId, users.id))
    .where(publicCondition);

  // DPI 統計
  const dpiConfigs = mouseConfigs.filter((c) => c.mouseDpi != null);
  const dpiValues = dpiConfigs.map((c) => c.mouseDpi!);

  const dpiRangeStats: RangeStatWithPlayers[] = DPI_RANGES.map((range) => {
    const matching = dpiConfigs.filter(
      (c) => c.mouseDpi! >= range.min && c.mouseDpi! <= range.max,
    );
    return {
      label: range.label,
      count: matching.length,
      percentage: dpiValues.length > 0 ? (matching.length / dpiValues.length) * 100 : 0,
      players: matching.map((c) => ({
        slug: c.slug,
        mcid: c.mcid,
        uuid: c.uuid,
        displayName: c.displayName,
        displayNameAlphabet: c.displayNameAlphabet,
        customSkinUrl: c.customSkinUrl,
      })),
    };
  });

  const sortedDpi = [...dpiValues].sort((a, b) => a - b);
  const dpiStats: DpiStats = {
    ranges: dpiRangeStats,
    average: dpiValues.length > 0
      ? Math.round(dpiValues.reduce((a, b) => a + b, 0) / dpiValues.length)
      : null,
    median: sortedDpi.length > 0
      ? sortedDpi[Math.floor(sortedDpi.length / 2)]
      : null,
    totalCount: dpiValues.length,
  };

  // 振り向き（cm/180）統計
  const cm180Configs = mouseConfigs
    .map((c) => ({
      ...c,
      cm180: calculateCm360(
        c.mouseDpi,
        c.gameSensitivity,
        c.rawInput,
        c.windowsSpeed,
        c.windowsSpeedMultiplier,
      ),
    }))
    .filter((c): c is typeof c & { cm180: number } => c.cm180 != null);

  const cm180Values = cm180Configs.map((c) => c.cm180);
  const cm180RangeStats: RangeStatWithPlayers[] = CM180_RANGES.map((range) => {
    const matching = cm180Configs.filter(
      (c) => c.cm180 >= range.min && c.cm180 < range.max,
    );
    return {
      label: range.label,
      count: matching.length,
      percentage: cm180Values.length > 0 ? (matching.length / cm180Values.length) * 100 : 0,
      players: matching.map((c) => ({
        slug: c.slug,
        mcid: c.mcid,
        uuid: c.uuid,
        displayName: c.displayName,
        displayNameAlphabet: c.displayNameAlphabet,
        customSkinUrl: c.customSkinUrl,
      })),
    };
  });

  const sortedCm180 = [...cm180Values].sort((a, b) => a - b);
  const cm180Stats: Cm180Stats = {
    ranges: cm180RangeStats,
    average: cm180Values.length > 0
      ? cm180Values.reduce((a, b) => a + b, 0) / cm180Values.length
      : null,
    median: sortedCm180.length > 0
      ? sortedCm180[Math.floor(sortedCm180.length / 2)]
      : null,
    totalCount: cm180Values.length,
  };

  // ゲーム内感度統計
  // 有効範囲（内部値 0..1 = 表示 0..200%）外の感度は分布・平均を歪めるため、
  // cm/360 が異常値を null にして除外するのと同様に母数から外す。
  const sensitivityConfigs = mouseConfigs
    .map((c) => ({
      ...c,
      sensitivityPercent: isValidSensitivity(c.gameSensitivity)
        ? toSensitivityPercent(c.gameSensitivity)
        : null,
    }))
    .filter(
      (c): c is typeof c & { sensitivityPercent: number } =>
        c.sensitivityPercent != null,
    );

  const sensitivityValues = sensitivityConfigs.map((c) => c.sensitivityPercent);
  const sensitivityRangeStats: RangeStatWithPlayers[] = SENSITIVITY_RANGES.map((range) => {
    const matching = sensitivityConfigs.filter(
      (c) => c.sensitivityPercent >= range.min && c.sensitivityPercent <= range.max,
    );
    return {
      label: range.label,
      count: matching.length,
      percentage: sensitivityValues.length > 0
        ? (matching.length / sensitivityValues.length) * 100
        : 0,
      players: matching.map((c) => ({
        slug: c.slug,
        mcid: c.mcid,
        uuid: c.uuid,
        displayName: c.displayName,
        displayNameAlphabet: c.displayNameAlphabet,
        customSkinUrl: c.customSkinUrl,
      })),
    };
  });

  const sensitivityStats: SensitivityStats = {
    ranges: sensitivityRangeStats,
    average: sensitivityValues.length > 0
      ? Math.round(
          sensitivityValues.reduce((a, b) => a + b, 0) / sensitivityValues.length,
        )
      : null,
    totalCount: sensitivityValues.length,
  };

  // Raw Input 統計
  const rawInputConfigs = mouseConfigs.filter((c) => c.rawInput != null);
  const onConfigs = rawInputConfigs.filter((c) => c.rawInput === true);
  const offConfigs = rawInputConfigs.filter((c) => c.rawInput === false);

  const rawInputStats: RawInputStats = {
    onCount: onConfigs.length,
    offCount: offConfigs.length,
    totalCount: rawInputConfigs.length,
    onPlayers: onConfigs.map((c) => ({
      slug: c.slug,
      mcid: c.mcid,
      uuid: c.uuid,
      displayName: c.displayName,
      displayNameAlphabet: c.displayNameAlphabet,
      customSkinUrl: c.customSkinUrl,
    })),
    offPlayers: offConfigs.map((c) => ({
      slug: c.slug,
      mcid: c.mcid,
      uuid: c.uuid,
      displayName: c.displayName,
      displayNameAlphabet: c.displayNameAlphabet,
      customSkinUrl: c.customSkinUrl,
    })),
  };

  const result: KeybindingsStatsData = {
    keybindingStats,
    f3RemapStats,
    dpiStats,
    cm180Stats,
    sensitivityStats,
    rawInputStats,
    totalPlayers,
    playersWithKeybindings,
    playersWithMouseSettings,
  };

  await setCached(KEYBINDINGS_STATS_CACHE_KEY, result, KEYBINDINGS_STATS_CACHE_TTL);
  return result;
}
