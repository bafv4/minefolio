// 操作設定の統計を集計するサーバー側ロジック。
// 旧 /keybindings/stats の loader を関数として切り出したもの。
// /keybindings?view=stats からも呼び出される。
import { and, eq, isNotNull, ne, sql } from "drizzle-orm";
import { keybindings, keyRemaps, playerConfigs, users } from "./schema";
import type { Database } from "./db";
import { excludeViewersCondition } from "./users-filter";
import { calculateCm360 } from "./mouse-settings";
import { getActionLabel } from "./keybindings";
import { t } from "./messages";

// 主要なアクション（集計対象）
export const TRACKED_ACTIONS = [
  { action: "forward", label: getActionLabel("forward") },
  { action: "back", label: getActionLabel("back") },
  { action: "left", label: getActionLabel("left") },
  { action: "right", label: getActionLabel("right") },
  { action: "sprint", label: getActionLabel("sprint") },
  { action: "sneak", label: getActionLabel("sneak") },
  { action: "jump", label: getActionLabel("jump") },
  { action: "inventory", label: getActionLabel("inventory") },
  { action: "swapHands", label: getActionLabel("swapHands") },
  { action: "drop", label: getActionLabel("drop") },
  { action: "pickBlock", label: getActionLabel("pickBlock") },
  { action: "attack", label: getActionLabel("attack") },
  { action: "use", label: getActionLabel("use") },
  { action: "hotbar1", label: getActionLabel("hotbar1") },
  { action: "hotbar2", label: getActionLabel("hotbar2") },
  { action: "hotbar3", label: getActionLabel("hotbar3") },
  { action: "hotbar4", label: getActionLabel("hotbar4") },
  { action: "hotbar5", label: getActionLabel("hotbar5") },
  { action: "hotbar6", label: getActionLabel("hotbar6") },
  { action: "hotbar7", label: getActionLabel("hotbar7") },
  { action: "hotbar8", label: getActionLabel("hotbar8") },
  { action: "hotbar9", label: getActionLabel("hotbar9") },
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

// ゲーム内感度区分（9段階）
export const SENSITIVITY_RANGES = [
  { min: 0, max: 5, label: "< 5%" },
  { min: 5, max: 10, label: "5-9%" },
  { min: 10, max: 15, label: "10-14%" },
  { min: 15, max: 20, label: "15-19%" },
  { min: 20, max: 40, label: "20-39%" },
  { min: 40, max: 60, label: "40-59%" },
  { min: 60, max: 80, label: "60-79%" },
  { min: 80, max: 100, label: "80-99%" },
  { min: 100, max: Infinity, label: "100%" },
];

export interface PlayerInfo {
  slug: string;
  mcid: string | null;
  uuid: string | null;
  displayName: string | null;
  customSkinUrl: string | null;
}

export interface KeybindingStats {
  action: string;
  label: string;
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

export async function loadKeybindingsStats(
  db: Database,
): Promise<KeybindingsStatsData> {
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

  // キーバインド統計
  const keybindingStats: KeybindingStats[] = [];
  for (const tracked of TRACKED_ACTIONS) {
    const results = await db
      .select({
        keyCode: keybindings.keyCode,
        slug: users.slug,
        mcid: users.mcid,
        uuid: users.uuid,
        displayName: users.displayName,
        customSkinUrl: users.customSkinUrl,
      })
      .from(keybindings)
      .innerJoin(users, eq(keybindings.userId, users.id))
      .where(and(publicCondition, eq(keybindings.action, tracked.action)));

    const keyGroups = new Map<string, PlayerInfo[]>();
    for (const r of results) {
      const players = keyGroups.get(r.keyCode) ?? [];
      players.push({ slug: r.slug, mcid: r.mcid, uuid: r.uuid, displayName: r.displayName, customSkinUrl: r.customSkinUrl });
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
      label: tracked.label,
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
      customSkinUrl: users.customSkinUrl,
    })
    .from(keybindings)
    .innerJoin(users, eq(keybindings.userId, users.id))
    .where(publicCondition)
    .groupBy(keybindings.userId, users.slug, users.mcid, users.uuid, users.displayName, users.customSkinUrl);

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
        customSkinUrl: u.customSkinUrl,
      })),
    );
  }

  for (const r of f3InputRemaps) {
    const inputKey = r.sourceKey ?? t("meKeybindings.unassigned");
    const players = f3Groups.get(inputKey) ?? [];
    players.push({ slug: r.slug, mcid: r.mcid, uuid: r.uuid, displayName: r.displayName, customSkinUrl: r.customSkinUrl });
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
  const sensitivityConfigs = mouseConfigs
    .filter((c) => c.gameSensitivity != null)
    .map((c) => ({
      ...c,
      sensitivityPercent: Math.round(c.gameSensitivity! * 100),
    }));

  const sensitivityValues = sensitivityConfigs.map((c) => c.sensitivityPercent);
  const sensitivityRangeStats: RangeStatWithPlayers[] = SENSITIVITY_RANGES.map((range) => {
    const matching = sensitivityConfigs.filter(
      (c) => c.sensitivityPercent >= range.min && c.sensitivityPercent < range.max,
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
      customSkinUrl: c.customSkinUrl,
    })),
    offPlayers: offConfigs.map((c) => ({
      slug: c.slug,
      mcid: c.mcid,
      uuid: c.uuid,
      displayName: c.displayName,
      customSkinUrl: c.customSkinUrl,
    })),
  };

  return {
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
}
