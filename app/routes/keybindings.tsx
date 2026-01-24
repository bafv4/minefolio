import { useLoaderData, useSearchParams, Link } from "react-router";
import { useState, useMemo } from "react";
import type { Route } from "./+types/keybindings";
import { createDb } from "@/lib/db";
import { getEnv } from "@/lib/env.server";
import { users, keybindings, customKeys } from "@/lib/schema";
import { desc, asc, like, eq, and } from "drizzle-orm";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Search, Keyboard, Mouse, Users, ArrowUpDown, ArrowUp, ArrowDown, BarChart3, X, SlidersHorizontal } from "lucide-react";
import { getKeyLabel, isUnbound } from "@/lib/keybindings";
import { cn } from "@/lib/utils";

export const meta: Route.MetaFunction = () => {
  return [
    { title: "操作設定一覧 - Minefolio" },
    { name: "description", content: "RTA走者の操作設定・キー配置を一覧で確認できます。" },
  ];
};

// 全プレイヤーを表示（ページネーションなし）

// キーボード系の主要なキーバインド
const KEYBOARD_COLUMNS = [
  { action: "forward", label: "前進", shortLabel: "前" },
  { action: "back", label: "後退", shortLabel: "後" },
  { action: "left", label: "左", shortLabel: "左" },
  { action: "right", label: "右", shortLabel: "右" },
  { action: "sprint", label: "ダッシュ", shortLabel: "ﾀﾞｯｼｭ" },
  { action: "sneak", label: "スニーク", shortLabel: "ｽﾆｰｸ" },
  { action: "inventory", label: "インベントリ", shortLabel: "ｲﾝﾍﾞﾝﾄﾘ" },
  { action: "swapHands", label: "オフハンド", shortLabel: "OH" },
  { action: "drop", label: "捨てる", shortLabel: "捨てる" },
  { action: "pickBlock", label: "ピック", shortLabel: "ﾋﾟｯｸ" },
  { action: "hotbar1", label: "HB1", shortLabel: "HB1" },
  { action: "hotbar2", label: "HB2", shortLabel: "HB2" },
  { action: "hotbar3", label: "HB3", shortLabel: "HB3" },
  { action: "hotbar4", label: "HB4", shortLabel: "HB4" },
  { action: "hotbar5", label: "HB5", shortLabel: "HB5" },
  { action: "hotbar6", label: "HB6", shortLabel: "HB6" },
  { action: "hotbar7", label: "HB7", shortLabel: "HB7" },
  { action: "hotbar8", label: "HB8", shortLabel: "HB8" },
  { action: "hotbar9", label: "HB9", shortLabel: "HB9" },
] as const;

// マウス設定の列定義
const MOUSE_COLUMNS = [
  { key: "dpi", label: "DPI", shortLabel: "DPI" },
  { key: "sensitivity", label: "ゲーム内感度", shortLabel: "感度" },
  { key: "cm360", label: "振り向き", shortLabel: "振向" },
  { key: "windowsSpeed", label: "Win Sens", shortLabel: "Win" },
  { key: "cursorSpeed", label: "カーソル速度", shortLabel: "カーソル速度" },
  { key: "rawInput", label: "Raw Input", shortLabel: "Raw Input" },
  { key: "mouseAcceleration", label: "マウス加速", shortLabel: "マウス加速" },
] as const;

// Windowsポインター速度の乗数（11/11がデフォルト）
// https://liquipedia.net/counterstrike/Mouse_Settings#Windows_Sensitivity
const WINDOWS_POINTER_MULTIPLIERS: Record<number, number> = {
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

// Windowsポインター速度乗数を取得（カスタム係数優先）
function getWindowsMultiplier(
  windowsSpeed: number | null,
  windowsSpeedMultiplier: number | null
): number {
  // カスタム係数が設定されている場合はそれを優先
  if (windowsSpeedMultiplier != null && windowsSpeedMultiplier > 0) {
    return windowsSpeedMultiplier;
  }
  // Windowsポインター速度から乗数を取得
  return windowsSpeed != null ? (WINDOWS_POINTER_MULTIPLIERS[windowsSpeed] ?? 1.0) : 1.0;
}

// 振り向き（cm/360）を計算
// 計算式: 6096 / (DPI * 8 * (0.6 * sensitivity + 0.2)^3) / 2
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

  // Raw Input が ON の場合、Windowsポインター速度は無視
  if (rawInput === true) {
    return cm360Base;
  }

  // Raw Input が OFF の場合、Windowsポインター速度を考慮
  const winMultiplier = getWindowsMultiplier(windowsSpeed, windowsSpeedMultiplier);
  return cm360Base / winMultiplier;
}

// カーソル速度（実効DPI）を計算
// RawInputの状態に関わらず、DPIにWindows速度の係数をかける
function calculateCursorSpeed(
  dpi: number | null,
  windowsSpeed: number | null,
  windowsSpeedMultiplier: number | null = null
): number | null {
  if (dpi == null) return null;

  // RawInputの状態に関わらず、Windows速度係数を適用
  const winMultiplier = getWindowsMultiplier(windowsSpeed, windowsSpeedMultiplier);
  return Math.round(dpi * winMultiplier);
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const env = context.env ?? getEnv();
  const db = createDb();
  const url = new URL(request.url);

  const search = url.searchParams.get("q") ?? "";

  // 新着順で固定
  const orderBy = desc(users.createdAt);

  // 公開プロフィールのみ表示
  const baseCondition = eq(users.profileVisibility, "public");

  // 検索条件（MCID、displayName、slugで検索）
  const searchCondition = search
    ? like(users.mcid, `%${search}%`)
    : undefined;

  // クエリ条件を組み合わせ
  const whereClause = searchCondition
    ? and(baseCondition, searchCondition)
    : baseCondition;

  // キー配置を持つユーザーを全件取得
  const playersWithKeybindings = await db.query.users.findMany({
    where: whereClause,
    orderBy: [orderBy],
    columns: {
      id: true,
      mcid: true,
      uuid: true,
      slug: true,
      displayName: true,
    },
    with: {
      keybindings: {
        orderBy: [asc(keybindings.category), asc(keybindings.action)],
      },
      playerConfig: {
        columns: {
          keyboardLayout: true,
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
    },
  });

  // キー配置があるプレイヤーのみをフィルタ
  const players = playersWithKeybindings.filter(p => p.keybindings.length > 0);

  return { players, search };
}

// マウスソートのキー型
type MouseSortKey = "dpi" | "sensitivity" | "cm360" | "windowsSpeed" | "cursorSpeed" | null;
type SortDirection = "asc" | "desc";

// マウスフィルタの型
type MouseFilters = {
  dpiMin: string;
  dpiMax: string;
  sensitivityMin: string; // %表記（0-200）
  sensitivityMax: string;
  cm360Min: string;
  cm360Max: string;
};

const DEFAULT_MOUSE_FILTERS: MouseFilters = {
  dpiMin: "",
  dpiMax: "",
  sensitivityMin: "",
  sensitivityMax: "",
  cm360Min: "",
  cm360Max: "",
};

export default function KeybindingsListPage() {
  const { players, search } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();

  // URLパラメータからタブを取得
  const tabFromUrl = searchParams.get("tab") || "keyboard";

  // マウスタブのソート状態
  const [mouseSortKey, setMouseSortKey] = useState<MouseSortKey>(null);
  const [mouseSortDirection, setMouseSortDirection] = useState<SortDirection>("asc");

  // マウスタブのフィルタ状態
  const [mouseFilters, setMouseFilters] = useState<MouseFilters>(DEFAULT_MOUSE_FILTERS);
  const [isFilterDialogOpen, setIsFilterDialogOpen] = useState(false);

  // アクティブなフィルタ数
  const activeMouseFilterCount = Object.values(mouseFilters).filter(Boolean).length;

  // フィルタをクリア
  const clearMouseFilters = () => {
    setMouseFilters(DEFAULT_MOUSE_FILTERS);
  };

  // マウスソートのトグル
  const handleMouseSort = (key: MouseSortKey) => {
    if (mouseSortKey === key) {
      // 同じキーなら方向を切り替え、descの次はソートなし
      if (mouseSortDirection === "asc") {
        setMouseSortDirection("desc");
      } else {
        setMouseSortKey(null);
        setMouseSortDirection("asc");
      }
    } else {
      setMouseSortKey(key);
      setMouseSortDirection("asc");
    }
  };

  // フィルタ＆ソート済みプレイヤーリスト（マウスタブ用）
  const sortedPlayersForMouse = useMemo(() => {
    // まず、DPI、ゲーム内感度、WinSensがすべて未設定のユーザーを除外
    let filtered = players.filter((player) => {
      const config = player.playerConfig;
      if (!config) return false;

      // DPI、ゲーム内感度、Windows速度のいずれかが設定されていればリストに表示
      const hasDpi = config.mouseDpi != null;
      const hasSensitivity = config.gameSensitivity != null;
      const hasWindowsSpeed = config.windowsSpeed != null || config.windowsSpeedMultiplier != null;

      return hasDpi || hasSensitivity || hasWindowsSpeed;
    });

    const dpiMin = mouseFilters.dpiMin ? parseInt(mouseFilters.dpiMin) : null;
    const dpiMax = mouseFilters.dpiMax ? parseInt(mouseFilters.dpiMax) : null;
    const sensMin = mouseFilters.sensitivityMin ? parseInt(mouseFilters.sensitivityMin) : null;
    const sensMax = mouseFilters.sensitivityMax ? parseInt(mouseFilters.sensitivityMax) : null;
    const cm360Min = mouseFilters.cm360Min ? parseFloat(mouseFilters.cm360Min) : null;
    const cm360Max = mouseFilters.cm360Max ? parseFloat(mouseFilters.cm360Max) : null;

    if (dpiMin !== null || dpiMax !== null || sensMin !== null || sensMax !== null || cm360Min !== null || cm360Max !== null) {
      filtered = filtered.filter((player) => {
        const config = player.playerConfig;
        if (!config) return false;

        // DPIフィルタ
        if (dpiMin !== null || dpiMax !== null) {
          const dpi = config.mouseDpi;
          if (dpi === null) return false;
          if (dpiMin !== null && dpi < dpiMin) return false;
          if (dpiMax !== null && dpi > dpiMax) return false;
        }

        // 感度フィルタ（%表記）
        if (sensMin !== null || sensMax !== null) {
          const sensitivity = config.gameSensitivity;
          if (sensitivity === null) return false;
          const sensitivityPercent = Math.floor(sensitivity * 200);
          if (sensMin !== null && sensitivityPercent < sensMin) return false;
          if (sensMax !== null && sensitivityPercent > sensMax) return false;
        }

        // 振り向きフィルタ
        if (cm360Min !== null || cm360Max !== null) {
          const cm360 = calculateCm360(
            config.mouseDpi,
            config.gameSensitivity,
            config.rawInput,
            config.windowsSpeed,
            config.windowsSpeedMultiplier
          );
          if (cm360 === null) return false;
          if (cm360Min !== null && cm360 < cm360Min) return false;
          if (cm360Max !== null && cm360 > cm360Max) return false;
        }

        return true;
      });
    }

    // ソートなしの場合はフィルタ結果のみ返す
    if (!mouseSortKey) return filtered;

    return [...filtered].sort((a, b) => {
      const configA = a.playerConfig;
      const configB = b.playerConfig;

      let valueA: number | null = null;
      let valueB: number | null = null;

      switch (mouseSortKey) {
        case "dpi":
          valueA = configA?.mouseDpi ?? null;
          valueB = configB?.mouseDpi ?? null;
          break;
        case "sensitivity":
          valueA = configA?.gameSensitivity ?? null;
          valueB = configB?.gameSensitivity ?? null;
          break;
        case "cm360":
          valueA = configA ? calculateCm360(
            configA.mouseDpi,
            configA.gameSensitivity,
            configA.rawInput,
            configA.windowsSpeed,
            configA.windowsSpeedMultiplier
          ) : null;
          valueB = configB ? calculateCm360(
            configB.mouseDpi,
            configB.gameSensitivity,
            configB.rawInput,
            configB.windowsSpeed,
            configB.windowsSpeedMultiplier
          ) : null;
          break;
        case "windowsSpeed":
          // カスタム係数優先
          valueA = configA?.windowsSpeedMultiplier ?? (configA?.windowsSpeed != null ? WINDOWS_POINTER_MULTIPLIERS[configA.windowsSpeed] ?? 1 : null);
          valueB = configB?.windowsSpeedMultiplier ?? (configB?.windowsSpeed != null ? WINDOWS_POINTER_MULTIPLIERS[configB.windowsSpeed] ?? 1 : null);
          break;
        case "cursorSpeed":
          valueA = configA ? calculateCursorSpeed(
            configA.mouseDpi,
            configA.windowsSpeed,
            configA.windowsSpeedMultiplier
          ) : null;
          valueB = configB ? calculateCursorSpeed(
            configB.mouseDpi,
            configB.windowsSpeed,
            configB.windowsSpeedMultiplier
          ) : null;
          break;
      }

      // nullは末尾に
      if (valueA === null && valueB === null) return 0;
      if (valueA === null) return 1;
      if (valueB === null) return -1;

      const diff = valueA - valueB;
      return mouseSortDirection === "asc" ? diff : -diff;
    });
  }, [players, mouseSortKey, mouseSortDirection, mouseFilters]);

  const handleSearch = (value: string) => {
    const params = new URLSearchParams(searchParams);
    if (value) {
      params.set("q", value);
    } else {
      params.delete("q");
    }
    params.delete("page");
    setSearchParams(params);
  };

  const handleTabChange = (value: string) => {
    const params = new URLSearchParams(searchParams);
    params.set("tab", value);
    setSearchParams(params);
  };

  return (
    <div className="flex-1 flex flex-col space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Keyboard className="h-8 w-8" />
            操作設定一覧
          </h1>
          <p className="text-muted-foreground mt-1">
            RTA走者の操作設定・キー配置を一覧で確認できます。
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link to="/keybindings/stats">
            <BarChart3 className="mr-2 h-4 w-4" />
            統計を見る
          </Link>
        </Button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="MCIDで検索..."
          defaultValue={search}
          onChange={(e) => handleSearch(e.target.value)}
          className="pl-10"
        />
      </div>

      <p className="text-sm text-muted-foreground">
        {players.length}人のプレイヤー
      </p>

      {/* Tabs for Keyboard / Mouse */}
      <Tabs value={tabFromUrl} onValueChange={handleTabChange} className="w-full">
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

        {/* Keyboard Tab */}
        <TabsContent value="keyboard">
          {players.length > 0 ? (
            <div className="relative border rounded-lg overflow-auto max-h-[600px]">
              <table className="w-full caption-bottom text-sm">
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky top-0 left-0 bg-muted z-30 min-w-36 border-r border-b-2">
                      プレイヤー
                    </TableHead>
                    {KEYBOARD_COLUMNS.map((col) => (
                      <TableHead
                        key={col.action}
                        className="sticky top-0 text-center px-2 min-w-12 bg-muted z-20 border-b-2"
                        title={col.label}
                      >
                        <span className="hidden sm:inline">{col.label}</span>
                        <span className="sm:hidden">{col.shortLabel}</span>
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {players.map((player) => (
                    <PlayerRow key={player.id} player={player} columns={KEYBOARD_COLUMNS} />
                  ))}
                </TableBody>
              </table>
            </div>
          ) : (
            <EmptyState search={search} onClear={() => handleSearch("")} />
          )}
        </TabsContent>

        {/* Mouse Tab */}
        <TabsContent value="mouse">
          {/* マウスフィルタ */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => setIsFilterDialogOpen(true)}
            >
              <SlidersHorizontal className="h-4 w-4" />
              数値フィルタ
              {activeMouseFilterCount > 0 && (
                <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-xs">
                  {activeMouseFilterCount}
                </Badge>
              )}
            </Button>

            <Dialog open={isFilterDialogOpen} onOpenChange={setIsFilterDialogOpen}>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>数値範囲で絞り込み</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  {/* DPI */}
                  <div className="space-y-2">
                    <Label className="text-sm text-muted-foreground">DPI</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        placeholder="最小"
                        value={mouseFilters.dpiMin}
                        onChange={(e) => setMouseFilters((prev) => ({ ...prev, dpiMin: e.target.value }))}
                        className="flex-1"
                      />
                      <span className="text-muted-foreground">〜</span>
                      <Input
                        type="number"
                        placeholder="最大"
                        value={mouseFilters.dpiMax}
                        onChange={(e) => setMouseFilters((prev) => ({ ...prev, dpiMax: e.target.value }))}
                        className="flex-1"
                      />
                    </div>
                  </div>

                  {/* 感度 */}
                  <div className="space-y-2">
                    <Label className="text-sm text-muted-foreground">ゲーム内感度 (%)</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        placeholder="最小"
                        value={mouseFilters.sensitivityMin}
                        onChange={(e) => setMouseFilters((prev) => ({ ...prev, sensitivityMin: e.target.value }))}
                        className="flex-1"
                      />
                      <span className="text-muted-foreground">〜</span>
                      <Input
                        type="number"
                        placeholder="最大"
                        value={mouseFilters.sensitivityMax}
                        onChange={(e) => setMouseFilters((prev) => ({ ...prev, sensitivityMax: e.target.value }))}
                        className="flex-1"
                      />
                    </div>
                  </div>

                  {/* 振り向き */}
                  <div className="space-y-2">
                    <Label className="text-sm text-muted-foreground">振り向き (cm/180)</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        step="0.1"
                        placeholder="最小"
                        value={mouseFilters.cm360Min}
                        onChange={(e) => setMouseFilters((prev) => ({ ...prev, cm360Min: e.target.value }))}
                        className="flex-1"
                      />
                      <span className="text-muted-foreground">〜</span>
                      <Input
                        type="number"
                        step="0.1"
                        placeholder="最大"
                        value={mouseFilters.cm360Max}
                        onChange={(e) => setMouseFilters((prev) => ({ ...prev, cm360Max: e.target.value }))}
                        className="flex-1"
                      />
                    </div>
                  </div>
                </div>
                <DialogFooter className="flex-col sm:flex-row gap-2">
                  {activeMouseFilterCount > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={clearMouseFilters}
                    >
                      <X className="h-4 w-4 mr-2" />
                      クリア
                    </Button>
                  )}
                  <Button onClick={() => setIsFilterDialogOpen(false)}>
                    閉じる
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* アクティブフィルタの表示 */}
            {activeMouseFilterCount > 0 && (
              <div className="flex flex-wrap gap-2">
                {(mouseFilters.dpiMin || mouseFilters.dpiMax) && (
                  <Badge variant="secondary" className="gap-1">
                    DPI: {mouseFilters.dpiMin || "0"}〜{mouseFilters.dpiMax || "∞"}
                    <button
                      onClick={() => setMouseFilters((prev) => ({ ...prev, dpiMin: "", dpiMax: "" }))}
                      className="ml-1 hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                )}
                {(mouseFilters.sensitivityMin || mouseFilters.sensitivityMax) && (
                  <Badge variant="secondary" className="gap-1">
                    感度: {mouseFilters.sensitivityMin || "0"}%〜{mouseFilters.sensitivityMax || "∞"}%
                    <button
                      onClick={() => setMouseFilters((prev) => ({ ...prev, sensitivityMin: "", sensitivityMax: "" }))}
                      className="ml-1 hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                )}
                {(mouseFilters.cm360Min || mouseFilters.cm360Max) && (
                  <Badge variant="secondary" className="gap-1">
                    振向: {mouseFilters.cm360Min || "0"}cm〜{mouseFilters.cm360Max || "∞"}cm
                    <button
                      onClick={() => setMouseFilters((prev) => ({ ...prev, cm360Min: "", cm360Max: "" }))}
                      className="ml-1 hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                )}
              </div>
            )}

            <span className="text-sm text-muted-foreground ml-auto">
              {sortedPlayersForMouse.length}人
            </span>
          </div>

          {sortedPlayersForMouse.length > 0 ? (
            <div className="relative border rounded-lg overflow-auto max-h-[600px]">
              <table className="w-full caption-bottom text-sm">
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky top-0 left-0 bg-muted z-30 min-w-36 border-r border-b-2">
                      プレイヤー
                    </TableHead>
                    {MOUSE_COLUMNS.map((col) => {
                      const sortKey = col.key as MouseSortKey;
                      const isSortable = ["dpi", "sensitivity", "cm360", "windowsSpeed", "cursorSpeed"].includes(col.key);
                      const isActive = mouseSortKey === sortKey;

                      return (
                        <TableHead
                          key={col.key}
                          className="sticky top-0 text-center px-1 min-w-20 bg-muted z-20 border-b-2"
                          title={col.label}
                        >
                          {isSortable ? (
                            <button
                              type="button"
                              className="flex items-center justify-center gap-1 w-full px-2 py-1 rounded hover:bg-muted/80 transition-colors"
                              onClick={() => handleMouseSort(sortKey)}
                            >
                              <span className="hidden sm:inline">{col.label}</span>
                              <span className="sm:hidden">{col.shortLabel}</span>
                              {isActive ? (
                                mouseSortDirection === "asc" ? (
                                  <ArrowUp className="h-3 w-3" />
                                ) : (
                                  <ArrowDown className="h-3 w-3" />
                                )
                              ) : (
                                <ArrowUpDown className="h-3 w-3 opacity-30" />
                              )}
                            </button>
                          ) : (
                            <div className="flex items-center justify-center gap-1 px-2">
                              <span className="hidden sm:inline">{col.label}</span>
                              <span className="sm:hidden">{col.shortLabel}</span>
                            </div>
                          )}
                        </TableHead>
                      );
                    })}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedPlayersForMouse.map((player) => (
                    <MouseSettingsRow key={player.id} player={player} />
                  ))}
                </TableBody>
              </table>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="text-lg">
                {activeMouseFilterCount > 0
                  ? "フィルタ条件に一致するプレイヤーがいません"
                  : "プレイヤーが見つかりません"}
              </p>
              {activeMouseFilterCount > 0 && (
                <Button variant="ghost" size="sm" className="mt-2" onClick={clearMouseFilters}>
                  フィルタをクリア
                </Button>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>

    </div>
  );
}

// 空状態コンポーネント
function EmptyState({ search, onClear }: { search: string; onClear: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center py-12 text-muted-foreground">
      <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
      <p className="text-lg">プレイヤーが見つかりません</p>
      {search && (
        <p className="text-sm mt-2">
          別の検索ワードをお試しください{" "}
          <button onClick={onClear} className="text-primary hover:underline">
            検索をクリア
          </button>
        </p>
      )}
    </div>
  );
}

// カラム定義の型
type ColumnDef = { action: string; label: string; shortLabel: string };

// プレイヤー行コンポーネント
function PlayerRow({
  player,
  columns,
}: {
  player: {
    id: string;
    mcid: string | null;
    uuid: string | null;
    slug: string;
    displayName: string | null;
    keybindings: Array<{
      id: string;
      action: string;
      keyCode: string;
      category: string;
    }>;
    playerConfig: {
      keyboardLayout: string | null;
    } | null;
  };
  columns: readonly ColumnDef[];
}) {
  // キーバインドをアクション名でマップ化
  const keybindMap = new Map(
    player.keybindings.map((kb) => [kb.action, kb.keyCode])
  );

  return (
    <TableRow className="hover:bg-muted/30">
      <TableCell className="sticky left-0 bg-background z-10">
        <Link
          to={`/player/${player.slug}`}
          className="flex items-center gap-2 hover:opacity-80 transition-opacity"
        >
          <MinecraftAvatar
            uuid={player.uuid}
            size={28}
            className="rounded-sm shrink-0"
          />
          <div className="min-w-0">
            <p className="font-medium text-sm truncate">
              {player.displayName ?? player.mcid ?? player.slug}
            </p>
          </div>
        </Link>
      </TableCell>
      {columns.map((col) => {
        const keyCode = keybindMap.get(col.action);
        return (
          <TableCell key={col.action} className="text-center px-2">
            {keyCode ? (
              <KeyBadge keyCode={keyCode} keyboardLayout={player.playerConfig?.keyboardLayout} />
            ) : (
              <span className="text-muted-foreground/40">-</span>
            )}
          </TableCell>
        );
      })}
    </TableRow>
  );
}

// マウス設定行コンポーネント
function MouseSettingsRow({
  player,
}: {
  player: {
    id: string;
    mcid: string | null;
    uuid: string | null;
    slug: string;
    displayName: string | null;
    playerConfig: {
      keyboardLayout: string | null;
      mouseDpi: number | null;
      gameSensitivity: number | null;
      windowsSpeed: number | null;
      windowsSpeedMultiplier: number | null;
      rawInput: boolean | null;
      mouseAcceleration: boolean | null;
    } | null;
  };
}) {
  const config = player.playerConfig;

  // 振り向きを計算
  const cm360 = config
    ? calculateCm360(
        config.mouseDpi,
        config.gameSensitivity,
        config.rawInput,
        config.windowsSpeed,
        config.windowsSpeedMultiplier
      )
    : null;

  // カーソル速度を計算
  const cursorSpeed = config
    ? calculateCursorSpeed(
        config.mouseDpi,
        config.windowsSpeed,
        config.windowsSpeedMultiplier
      )
    : null;

  // ゲーム内感度の表示（プロフィールページと同じ形式）
  const sensitivityDisplay = config?.gameSensitivity != null
    ? Math.floor(config.gameSensitivity * 200)
    : null;

  return (
    <TableRow className="hover:bg-muted/30">
      <TableCell className="sticky left-0 bg-background z-10">
        <Link
          to={`/player/${player.slug}`}
          className="flex items-center gap-2 hover:opacity-80 transition-opacity"
        >
          <MinecraftAvatar
            uuid={player.uuid}
            size={28}
            className="rounded-sm shrink-0"
          />
          <div className="min-w-0">
            <p className="font-medium text-sm truncate">
              {player.displayName ?? player.mcid ?? player.slug}
            </p>
          </div>
        </Link>
      </TableCell>
      <TableCell className="text-center px-3">
        {config?.mouseDpi != null ? (
          <span className="font-mono text-sm">{config.mouseDpi}</span>
        ) : (
          <span className="text-muted-foreground/40">-</span>
        )}
      </TableCell>
      <TableCell className="text-center px-3">
        {sensitivityDisplay != null ? (
          <span className="font-mono text-sm">
            {sensitivityDisplay}<span className="text-muted-foreground">%</span>
          </span>
        ) : (
          <span className="text-muted-foreground/40">-</span>
        )}
      </TableCell>
      <TableCell className="text-center px-3">
        {cm360 != null ? (
          <span className="font-mono text-sm">
            {cm360.toFixed(1)}<span className="text-muted-foreground">cm</span>
          </span>
        ) : (
          <span className="text-muted-foreground/40">-</span>
        )}
      </TableCell>
      <TableCell className="text-center px-3">
        {config?.windowsSpeedMultiplier != null ? (
          <span className="font-mono text-sm" title="カスタム係数">
            x{config.windowsSpeedMultiplier.toFixed(3)}
          </span>
        ) : config?.windowsSpeed != null ? (
          <span className="font-mono text-sm">
            {config.windowsSpeed}<span className="text-muted-foreground">(x{WINDOWS_POINTER_MULTIPLIERS[config.windowsSpeed]?.toFixed(3) ?? "1.000"})</span>
          </span>
        ) : (
          <span className="text-muted-foreground/40">値なし</span>
        )}
      </TableCell>
      <TableCell className="text-center px-3">
        {cursorSpeed != null ? (
          <span className="font-mono text-sm">{cursorSpeed}</span>
        ) : (
          <span className="text-muted-foreground/40">-</span>
        )}
      </TableCell>
      <TableCell className="text-center px-3">
        {config?.rawInput != null ? (
          <Badge variant={config.rawInput ? "default" : "secondary"} className="text-xs">
            {config.rawInput ? "ON" : "OFF"}
          </Badge>
        ) : (
          <span className="text-muted-foreground/40">-</span>
        )}
      </TableCell>
      <TableCell className="text-center px-3">
        {config?.mouseAcceleration != null ? (
          <Badge variant={config.mouseAcceleration ? "destructive" : "secondary"} className="text-xs">
            {config.mouseAcceleration ? "ON" : "OFF"}
          </Badge>
        ) : (
          <span className="text-muted-foreground/40">-</span>
        )}
      </TableCell>
    </TableRow>
  );
}

/**
 * 文字列の視覚的な幅を計算（全角=2、半角=1）
 */
function getVisualWidth(str: string): number {
  let width = 0;
  for (const char of str) {
    const code = char.charCodeAt(0);
    if (
      (code >= 0x3000 && code <= 0x9FFF) ||
      (code >= 0xFF00 && code <= 0xFFEF) ||
      (code >= 0xAC00 && code <= 0xD7AF)
    ) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

/**
 * 視覚的な幅で文字列を省略（全角5文字=半角10文字を超える場合）
 */
function truncateByVisualWidth(str: string, maxWidth: number = 10): string {
  if (getVisualWidth(str) <= maxWidth) {
    return str;
  }

  let width = 0;
  let result = '';
  for (const char of str) {
    const code = char.charCodeAt(0);
    const charWidth = (
      (code >= 0x3000 && code <= 0x9FFF) ||
      (code >= 0xFF00 && code <= 0xFFEF) ||
      (code >= 0xAC00 && code <= 0xD7AF)
    ) ? 2 : 1;

    if (width + charWidth > maxWidth - 1) {
      return result + '…';
    }
    result += char;
    width += charWidth;
  }
  return str;
}

// キー表示バッジ
function KeyBadge({ keyCode, keyboardLayout }: { keyCode: string; keyboardLayout?: string | null }) {
  // 不使用の場合は "-" を表示
  if (isUnbound(keyCode)) {
    return <span className="text-muted-foreground/40">-</span>;
  }

  const label = getKeyLabel(keyCode, keyboardLayout);
  const truncatedLabel = truncateByVisualWidth(label);
  const isTruncated = label !== truncatedLabel;
  const isMouse = keyCode.startsWith("Mouse") || keyCode.toLowerCase().includes("mouse");

  const badge = (
    <Badge
      variant="secondary"
      className={cn(
        "font-mono text-xs px-1.5 py-0.5",
        isMouse && "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20"
      )}
    >
      {truncatedLabel}
    </Badge>
  );

  // 省略された場合はtitle属性で完全なラベルを表示
  if (isTruncated) {
    return <span title={label}>{badge}</span>;
  }

  return badge;
}
