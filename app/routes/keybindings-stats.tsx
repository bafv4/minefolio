import { useLoaderData, Link } from "react-router";
import { useState } from "react";
import type { Route } from "./+types/keybindings-stats";
import { createDb } from "@/lib/db";
import { users, keybindings, playerConfigs, keyRemaps } from "@/lib/schema";
import { eq, sql, and, isNotNull } from "drizzle-orm";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  BarChart3,
  Keyboard,
  Mouse,
  ArrowLeft,
  Users,
  TrendingUp,
} from "lucide-react";
import { getKeyLabel } from "@/lib/keybindings";
import { cn } from "@/lib/utils";
import { MinecraftAvatar } from "@/components/minecraft-avatar";

export const meta: Route.MetaFunction = () => {
  return [
    { title: "操作設定統計 - Minefolio" },
    { name: "description", content: "RTA走者の操作設定・キー配置の統計情報を確認できます。" },
  ];
};

// 主要なアクション（集計対象）
const TRACKED_ACTIONS = [
  { action: "forward", label: "前進" },
  { action: "back", label: "後退" },
  { action: "left", label: "左" },
  { action: "right", label: "右" },
  { action: "sprint", label: "ダッシュ" },
  { action: "sneak", label: "スニーク" },
  { action: "jump", label: "ジャンプ" },
  { action: "inventory", label: "インベントリ" },
  { action: "swapHands", label: "オフハンド" },
  { action: "drop", label: "捨てる" },
  { action: "pickBlock", label: "ピック" },
  { action: "attack", label: "攻撃" },
  { action: "use", label: "使用" },
  { action: "hotbar1", label: "ホットバー1" },
  { action: "hotbar2", label: "ホットバー2" },
  { action: "hotbar3", label: "ホットバー3" },
  { action: "hotbar4", label: "ホットバー4" },
  { action: "hotbar5", label: "ホットバー5" },
  { action: "hotbar6", label: "ホットバー6" },
  { action: "hotbar7", label: "ホットバー7" },
  { action: "hotbar8", label: "ホットバー8" },
  { action: "hotbar9", label: "ホットバー9" },
] as const;

// DPIの範囲区分（旧サイトと同じ11段階）
const DPI_RANGES = [
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

// 振り向き（cm/180）の範囲区分（旧サイトと同じ13段階）
// ※DBにはcm360という名前だが、実際の値はcm/180
const CM180_RANGES = [
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

// ゲーム内感度の範囲区分（旧サイトと同じ9段階）
// ※Options.txt形式 (0.0-1.0) を100倍してパーセンテージ表示
const SENSITIVITY_RANGES = [
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

// Windowsポインター速度の乗数
const WINDOWS_POINTER_MULTIPLIERS: Record<number, number> = {
  1: 0.03125, 2: 0.0625, 3: 0.125, 4: 0.25, 5: 0.375,
  6: 0.5, 7: 0.625, 8: 0.75, 9: 0.875, 10: 1,
  11: 1.25, 12: 1.5, 13: 1.75, 14: 2, 15: 2.25,
  16: 2.5, 17: 2.75, 18: 3, 19: 3.25, 20: 3.5,
};

function calculateCm360(
  dpi: number | null,
  sensitivity: number | null,
  rawInput: boolean | null,
  windowsSpeed: number | null,
  windowsSpeedMultiplier: number | null = null
): number | null {
  if (dpi == null || sensitivity == null) return null;

  const f = 0.6 * sensitivity + 0.2;
  const cm360Base = 6096 / (dpi * 8 * f * f * f) / 2;

  if (rawInput === true) {
    return cm360Base;
  }

  const winMultiplier = windowsSpeedMultiplier ??
    (windowsSpeed != null ? WINDOWS_POINTER_MULTIPLIERS[windowsSpeed] ?? 1 : 1);
  return cm360Base / winMultiplier;
}

// プレイヤー情報
interface PlayerInfo {
  slug: string;
  mcid: string | null;
  uuid: string | null;
  displayName: string | null;
}

interface KeybindingStats {
  action: string;
  label: string;
  topKeys: Array<{ keyCode: string; count: number; percentage: number; players: PlayerInfo[] }>;
  totalCount: number;
}

interface F3RemapStats {
  topTargets: Array<{ targetKey: string; count: number; percentage: number; players: PlayerInfo[] }>;
  totalCount: number;
}

interface RangeStatWithPlayers {
  label: string;
  count: number;
  percentage: number;
  players: PlayerInfo[];
}

interface DpiStats {
  ranges: RangeStatWithPlayers[];
  average: number | null;
  median: number | null;
  totalCount: number;
}

interface Cm180Stats {
  ranges: RangeStatWithPlayers[];
  average: number | null;
  median: number | null;
  totalCount: number;
}

interface SensitivityStats {
  ranges: RangeStatWithPlayers[];
  average: number | null;
  totalCount: number;
}

interface RawInputStats {
  onCount: number;
  offCount: number;
  totalCount: number;
  onPlayers: PlayerInfo[];
  offPlayers: PlayerInfo[];
}

interface LoaderData {
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

export async function loader({ context }: Route.LoaderArgs): Promise<LoaderData> {
  const db = createDb();

  // 公開ユーザーのみ対象
  const publicCondition = eq(users.profileVisibility, "public");

  // 総プレイヤー数
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

  // キーバインド統計を取得（プレイヤー情報付き）
  const keybindingStats: KeybindingStats[] = [];

  for (const tracked of TRACKED_ACTIONS) {
    const results = await db
      .select({
        keyCode: keybindings.keyCode,
        slug: users.slug,
        mcid: users.mcid,
        uuid: users.uuid,
        displayName: users.displayName,
      })
      .from(keybindings)
      .innerJoin(users, eq(keybindings.userId, users.id))
      .where(and(publicCondition, eq(keybindings.action, tracked.action)));

    // キーコードでグループ化
    const keyGroups = new Map<string, PlayerInfo[]>();
    for (const r of results) {
      const players = keyGroups.get(r.keyCode) ?? [];
      players.push({ slug: r.slug, mcid: r.mcid, uuid: r.uuid, displayName: r.displayName });
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

  // F3入力キー統計を取得
  // 「F3を入力するためにどのキーを使っているか」を調べる
  // targetKey = "F3" のリマップを検索し、sourceKey（入力キー）を取得
  const f3InputRemaps = await db
    .select({
      userId: keyRemaps.userId,
      sourceKey: keyRemaps.sourceKey,
      slug: users.slug,
      mcid: users.mcid,
      uuid: users.uuid,
      displayName: users.displayName,
    })
    .from(keyRemaps)
    .innerJoin(users, eq(keyRemaps.userId, users.id))
    .where(and(publicCondition, eq(keyRemaps.targetKey, "F3")));

  // キーバインドを持つが、F3へのリマップがないユーザー（F3キーをそのまま使用）を取得
  const remappedToF3UserIds = new Set(f3InputRemaps.map((r) => r.userId));
  const usersWithKeybindingsData = await db
    .select({
      userId: keybindings.userId,
      slug: users.slug,
      mcid: users.mcid,
      uuid: users.uuid,
      displayName: users.displayName,
    })
    .from(keybindings)
    .innerJoin(users, eq(keybindings.userId, users.id))
    .where(publicCondition)
    .groupBy(keybindings.userId, users.slug, users.mcid, users.uuid, users.displayName);

  // F3キーをそのまま使っているユーザー
  const f3DefaultUsers = usersWithKeybindingsData.filter(
    (u) => !remappedToF3UserIds.has(u.userId)
  );

  // 入力キーでグループ化
  const f3Groups = new Map<string, PlayerInfo[]>();

  // F3キーをそのまま使っているユーザーを追加
  if (f3DefaultUsers.length > 0) {
    f3Groups.set(
      "F3",
      f3DefaultUsers.map((u) => ({
        slug: u.slug,
        mcid: u.mcid,
        uuid: u.uuid,
        displayName: u.displayName,
      }))
    );
  }

  // リマップしているユーザーを追加（sourceKeyでグループ化）
  for (const r of f3InputRemaps) {
    const inputKey = r.sourceKey ?? "未設定";
    const players = f3Groups.get(inputKey) ?? [];
    players.push({ slug: r.slug, mcid: r.mcid, uuid: r.uuid, displayName: r.displayName });
    f3Groups.set(inputKey, players);
  }

  const f3TotalCount = f3DefaultUsers.length + f3InputRemaps.length;
  const f3RemapStats: F3RemapStats = {
    topTargets: Array.from(f3Groups.entries())
      .map(([targetKey, players]) => ({
        targetKey, // 実際はinputKeyだが、インターフェースの互換性のためtargetKeyのまま
        count: players.length,
        percentage: f3TotalCount > 0 ? (players.length / f3TotalCount) * 100 : 0,
        players,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    totalCount: f3TotalCount,
  };

  // マウス設定を取得（プレイヤー情報付き）
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
    })
    .from(playerConfigs)
    .innerJoin(users, eq(playerConfigs.userId, users.id))
    .where(publicCondition);

  // DPI統計
  const dpiConfigs = mouseConfigs.filter((c) => c.mouseDpi != null);
  const dpiValues = dpiConfigs.map((c) => c.mouseDpi!);

  const dpiRangeStats: RangeStatWithPlayers[] = DPI_RANGES.map((range) => {
    const matchingConfigs = dpiConfigs.filter(
      (c) => c.mouseDpi! >= range.min && c.mouseDpi! <= range.max
    );
    return {
      label: range.label,
      count: matchingConfigs.length,
      percentage: dpiValues.length > 0 ? (matchingConfigs.length / dpiValues.length) * 100 : 0,
      players: matchingConfigs.map((c) => ({
        slug: c.slug,
        mcid: c.mcid,
        uuid: c.uuid,
        displayName: c.displayName,
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
        c.windowsSpeedMultiplier
      ),
    }))
    .filter((c): c is typeof c & { cm180: number } => c.cm180 != null);

  const cm180Values = cm180Configs.map((c) => c.cm180);

  const cm180RangeStats: RangeStatWithPlayers[] = CM180_RANGES.map((range) => {
    const matchingConfigs = cm180Configs.filter(
      (c) => c.cm180 >= range.min && c.cm180 < range.max
    );
    return {
      label: range.label,
      count: matchingConfigs.length,
      percentage: cm180Values.length > 0 ? (matchingConfigs.length / cm180Values.length) * 100 : 0,
      players: matchingConfigs.map((c) => ({
        slug: c.slug,
        mcid: c.mcid,
        uuid: c.uuid,
        displayName: c.displayName,
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
    const matchingConfigs = sensitivityConfigs.filter(
      (c) => c.sensitivityPercent >= range.min && c.sensitivityPercent < range.max
    );
    return {
      label: range.label,
      count: matchingConfigs.length,
      percentage: sensitivityValues.length > 0 ? (matchingConfigs.length / sensitivityValues.length) * 100 : 0,
      players: matchingConfigs.map((c) => ({
        slug: c.slug,
        mcid: c.mcid,
        uuid: c.uuid,
        displayName: c.displayName,
      })),
    };
  });

  const sensitivityStats: SensitivityStats = {
    ranges: sensitivityRangeStats,
    average: sensitivityValues.length > 0
      ? Math.round(
          sensitivityValues.reduce((a, b) => a + b, 0) / sensitivityValues.length
        )
      : null,
    totalCount: sensitivityValues.length,
  };

  // Raw Input統計
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
    })),
    offPlayers: offConfigs.map((c) => ({
      slug: c.slug,
      mcid: c.mcid,
      uuid: c.uuid,
      displayName: c.displayName,
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

export default function KeybindingsStatsPage() {
  const {
    keybindingStats,
    f3RemapStats,
    dpiStats,
    cm180Stats,
    sensitivityStats,
    rawInputStats,
    totalPlayers,
    playersWithKeybindings,
    playersWithMouseSettings,
  } = useLoaderData<typeof loader>();

  // ダイアログ状態
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogTitle, setDialogTitle] = useState("");
  const [dialogPlayers, setDialogPlayers] = useState<PlayerInfo[]>([]);

  const openPlayersDialog = (title: string, players: PlayerInfo[]) => {
    setDialogTitle(title);
    setDialogPlayers(players);
    setDialogOpen(true);
  };

  return (
    <div className="flex-1 flex flex-col space-y-6">
      {/* ヘッダー */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <BarChart3 className="h-8 w-8" />
            操作設定統計
          </h1>
          <p className="text-muted-foreground mt-1">
            RTA走者の操作設定・キー配置の統計情報
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link to="/keybindings">
            <ArrowLeft className="mr-2 h-4 w-4" />
            一覧に戻る
          </Link>
        </Button>
      </div>

      {/* 概要 */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              登録プレイヤー数
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold flex items-center gap-2">
              <Users className="h-5 w-5 text-muted-foreground" />
              {totalPlayers}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              キーバインド登録者
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold flex items-center gap-2">
              <Keyboard className="h-5 w-5 text-muted-foreground" />
              {playersWithKeybindings}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {totalPlayers > 0
                ? `${((playersWithKeybindings / totalPlayers) * 100).toFixed(1)}%`
                : "0%"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              マウス設定登録者
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold flex items-center gap-2">
              <Mouse className="h-5 w-5 text-muted-foreground" />
              {playersWithMouseSettings}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {totalPlayers > 0
                ? `${((playersWithMouseSettings / totalPlayers) * 100).toFixed(1)}%`
                : "0%"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* タブ */}
      <Tabs defaultValue="keyboard" className="w-full">
        <TabsList>
          <TabsTrigger value="keyboard" className="gap-1.5">
            <Keyboard className="h-4 w-4" />
            キーボード
          </TabsTrigger>
          <TabsTrigger value="mouse" className="gap-1.5">
            <Mouse className="h-4 w-4" />
            マウス
          </TabsTrigger>
        </TabsList>

        {/* キーボード統計 */}
        <TabsContent value="keyboard" className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {keybindingStats.map((stat) => (
              <KeybindingStatCard
                key={stat.action}
                stat={stat}
                onPlayerClick={openPlayersDialog}
              />
            ))}
            {/* F3の位置 */}
            <F3RemapStatCard
              stat={f3RemapStats}
              onPlayerClick={openPlayersDialog}
            />
          </div>
        </TabsContent>

        {/* マウス統計 */}
        <TabsContent value="mouse" className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            {/* DPI分布 */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  DPI分布
                </CardTitle>
                <CardDescription>
                  {dpiStats.totalCount}人のデータ
                  {dpiStats.average != null && ` / 平均: ${dpiStats.average}`}
                  {dpiStats.median != null && ` / 中央値: ${dpiStats.median}`}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {dpiStats.ranges.map((range) => (
                    <button
                      key={range.label}
                      type="button"
                      className="w-full text-left space-y-1 hover:bg-muted/50 rounded-md p-1 -m-1 transition-colors cursor-pointer disabled:cursor-default disabled:hover:bg-transparent"
                      disabled={range.count === 0}
                      onClick={() => openPlayersDialog(`DPI ${range.label}`, range.players)}
                    >
                      <div className="flex justify-between text-sm">
                        <span>{range.label}</span>
                        <span className="text-muted-foreground">
                          {range.count}人 ({range.percentage.toFixed(1)}%)
                        </span>
                      </div>
                      <Progress value={range.percentage} className="h-2" />
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* 振り向き分布 */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  振り向き (cm/180°) 分布
                </CardTitle>
                <CardDescription>
                  {cm180Stats.totalCount}人のデータ
                  {cm180Stats.average != null &&
                    ` / 平均: ${cm180Stats.average.toFixed(1)}cm`}
                  {cm180Stats.median != null &&
                    ` / 中央値: ${cm180Stats.median.toFixed(1)}cm`}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {cm180Stats.ranges.map((range) => (
                    <button
                      key={range.label}
                      type="button"
                      className="w-full text-left space-y-1 hover:bg-muted/50 rounded-md p-1 -m-1 transition-colors cursor-pointer disabled:cursor-default disabled:hover:bg-transparent"
                      disabled={range.count === 0}
                      onClick={() => openPlayersDialog(`振り向き ${range.label}`, range.players)}
                    >
                      <div className="flex justify-between text-sm">
                        <span>{range.label}</span>
                        <span className="text-muted-foreground">
                          {range.count}人 ({range.percentage.toFixed(1)}%)
                        </span>
                      </div>
                      <Progress value={range.percentage} className="h-2" />
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* ゲーム内感度分布 */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  ゲーム内感度分布
                </CardTitle>
                <CardDescription>
                  {sensitivityStats.totalCount}人のデータ
                  {sensitivityStats.average != null &&
                    ` / 平均: ${sensitivityStats.average}%`}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {sensitivityStats.ranges.map((range) => (
                    <button
                      key={range.label}
                      type="button"
                      className="w-full text-left space-y-1 hover:bg-muted/50 rounded-md p-1 -m-1 transition-colors cursor-pointer disabled:cursor-default disabled:hover:bg-transparent"
                      disabled={range.count === 0}
                      onClick={() => openPlayersDialog(`感度 ${range.label}`, range.players)}
                    >
                      <div className="flex justify-between text-sm">
                        <span>{range.label}</span>
                        <span className="text-muted-foreground">
                          {range.count}人 ({range.percentage.toFixed(1)}%)
                        </span>
                      </div>
                      <Progress value={range.percentage} className="h-2" />
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Raw Input */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  Raw Input設定
                </CardTitle>
                <CardDescription>
                  {rawInputStats.totalCount}人のデータ
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <button
                    type="button"
                    className="w-full text-left space-y-1 hover:bg-muted/50 rounded-md p-1 -m-1 transition-colors cursor-pointer disabled:cursor-default disabled:hover:bg-transparent"
                    disabled={rawInputStats.onCount === 0}
                    onClick={() => openPlayersDialog("Raw Input ON", rawInputStats.onPlayers)}
                  >
                    <div className="flex justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <Badge>ON</Badge>
                      </span>
                      <span className="text-muted-foreground">
                        {rawInputStats.onCount}人 (
                        {rawInputStats.totalCount > 0
                          ? (
                              (rawInputStats.onCount / rawInputStats.totalCount) *
                              100
                            ).toFixed(1)
                          : 0}
                        %)
                      </span>
                    </div>
                    <Progress
                      value={
                        rawInputStats.totalCount > 0
                          ? (rawInputStats.onCount / rawInputStats.totalCount) * 100
                          : 0
                      }
                      className="h-2"
                    />
                  </button>
                  <button
                    type="button"
                    className="w-full text-left space-y-1 hover:bg-muted/50 rounded-md p-1 -m-1 transition-colors cursor-pointer disabled:cursor-default disabled:hover:bg-transparent"
                    disabled={rawInputStats.offCount === 0}
                    onClick={() => openPlayersDialog("Raw Input OFF", rawInputStats.offPlayers)}
                  >
                    <div className="flex justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <Badge variant="secondary">OFF</Badge>
                      </span>
                      <span className="text-muted-foreground">
                        {rawInputStats.offCount}人 (
                        {rawInputStats.totalCount > 0
                          ? (
                              (rawInputStats.offCount / rawInputStats.totalCount) *
                              100
                            ).toFixed(1)
                          : 0}
                        %)
                      </span>
                    </div>
                    <Progress
                      value={
                        rawInputStats.totalCount > 0
                          ? (rawInputStats.offCount / rawInputStats.totalCount) * 100
                          : 0
                      }
                      className="h-2"
                    />
                  </button>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* プレイヤー一覧ダイアログ */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
          </DialogHeader>
          <div className="overflow-y-auto flex-1 -mx-6 px-6">
            <div className="space-y-2">
              {dialogPlayers.map((player) => (
                <Link
                  key={player.slug}
                  to={`/player/${player.slug}`}
                  className="flex items-center gap-3 p-2 rounded-md hover:bg-muted transition-colors"
                  onClick={() => setDialogOpen(false)}
                >
                  <MinecraftAvatar uuid={player.uuid} size={32} className="rounded-sm shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">
                      {player.displayName ?? player.mcid ?? player.slug}
                    </p>
                    {player.mcid && (
                      <p className="text-xs text-muted-foreground">@{player.mcid}</p>
                    )}
                  </div>
                </Link>
              ))}
              {dialogPlayers.length === 0 && (
                <p className="text-muted-foreground text-sm text-center py-4">
                  該当するプレイヤーはいません
                </p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// キーバインド統計カード
function KeybindingStatCard({
  stat,
  onPlayerClick,
}: {
  stat: KeybindingStats;
  onPlayerClick: (title: string, players: PlayerInfo[]) => void;
}) {
  if (stat.totalCount === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{stat.label}</CardTitle>
          <CardDescription>データなし</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{stat.label}</CardTitle>
        <CardDescription>{stat.totalCount}人のデータ</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {stat.topKeys.map((key, index) => {
            const label = getKeyLabel(key.keyCode);
            const isMouse =
              key.keyCode.startsWith("Mouse") ||
              key.keyCode.toLowerCase().includes("mouse");

            return (
              <button
                key={key.keyCode}
                type="button"
                className="w-full flex items-center gap-2 hover:bg-muted/50 rounded-md p-1 -m-1 transition-colors cursor-pointer"
                onClick={() => onPlayerClick(`${stat.label}: ${label}`, key.players)}
              >
                <span className="text-sm text-muted-foreground w-4">
                  {index + 1}.
                </span>
                <Badge
                  variant="secondary"
                  className={cn(
                    "font-mono text-xs min-w-16 px-2 justify-center shrink-0",
                    isMouse &&
                      "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20"
                  )}
                >
                  {label}
                </Badge>
                <div className="flex-1">
                  <Progress value={key.percentage} className="h-1.5" />
                </div>
                <span className="text-xs text-muted-foreground w-20 text-right shrink-0">
                  {key.count}人 ({key.percentage.toFixed(0)}%)
                </span>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// F3入力キー統計カード
function F3RemapStatCard({
  stat,
  onPlayerClick,
}: {
  stat: F3RemapStats;
  onPlayerClick: (title: string, players: PlayerInfo[]) => void;
}) {
  if (stat.totalCount === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">F3の入力キー</CardTitle>
          <CardDescription>データなし</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">F3の入力キー</CardTitle>
        <CardDescription>{stat.totalCount}人のデータ</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {stat.topTargets.map((target, index) => {
            // targetKeyは実際にはinputKey（F3を入力するためのキー）
            const inputKey = target.targetKey;
            const label = getKeyLabel(inputKey);
            const isDefault = inputKey === "F3";
            const isMouse =
              inputKey.startsWith("Mouse") ||
              inputKey.toLowerCase().includes("mouse");
            const dialogTitle = isDefault
              ? "F3キーでF3入力"
              : `${label}でF3入力`;

            return (
              <button
                key={inputKey}
                type="button"
                className="w-full flex items-center gap-2 hover:bg-muted/50 rounded-md p-1 -m-1 transition-colors cursor-pointer"
                onClick={() => onPlayerClick(dialogTitle, target.players)}
              >
                <span className="text-sm text-muted-foreground w-4">
                  {index + 1}.
                </span>
                <Badge
                  variant="secondary"
                  className={cn(
                    "font-mono text-xs min-w-16 px-2 justify-center shrink-0",
                    isMouse &&
                      "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20"
                  )}
                >
                  {label}
                </Badge>
                <div className="flex-1">
                  <Progress value={target.percentage} className="h-1.5" />
                </div>
                <span className="text-xs text-muted-foreground w-20 text-right shrink-0">
                  {target.count}人 ({target.percentage.toFixed(0)}%)
                </span>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
