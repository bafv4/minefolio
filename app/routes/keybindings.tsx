import { useLoaderData, useSearchParams, Link } from "react-router";
import { useState, useMemo } from "react";
import type { Route } from "./+types/keybindings";
import { createDb } from "@/lib/db";
import { users, keybindings, playerConfigs } from "@/lib/schema";
import { desc, asc, like, sql } from "drizzle-orm";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Search, Keyboard, Mouse, Users, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { getKeyLabel } from "@/lib/keybindings";
import { cn } from "@/lib/utils";

export const meta: Route.MetaFunction = () => {
  return [
    { title: "操作設定一覧 - Minefolio" },
    { name: "description", content: "スピードランナーの操作設定・キー配置を一覧で確認できます。" },
  ];
};

const PLAYERS_PER_PAGE = 30;

// キーボード系の主要なキーバインド
const KEYBOARD_COLUMNS = [
  { action: "sprint", label: "ダッシュ", shortLabel: "走" },
  { action: "sneak", label: "スニーク", shortLabel: "忍" },
  { action: "inventory", label: "インベントリ", shortLabel: "E" },
  { action: "swapHands", label: "オフハンド", shortLabel: "F" },
  { action: "drop", label: "捨てる", shortLabel: "Q" },
  { action: "pickBlock", label: "ピック", shortLabel: "選" },
  { action: "hotbar1", label: "1", shortLabel: "1" },
  { action: "hotbar2", label: "2", shortLabel: "2" },
  { action: "hotbar3", label: "3", shortLabel: "3" },
  { action: "hotbar4", label: "4", shortLabel: "4" },
  { action: "hotbar5", label: "5", shortLabel: "5" },
  { action: "hotbar6", label: "6", shortLabel: "6" },
  { action: "hotbar7", label: "7", shortLabel: "7" },
  { action: "hotbar8", label: "8", shortLabel: "8" },
  { action: "hotbar9", label: "9", shortLabel: "9" },
] as const;

// マウス設定の列定義
const MOUSE_COLUMNS = [
  { key: "dpi", label: "DPI", shortLabel: "DPI" },
  { key: "sensitivity", label: "ゲーム内感度", shortLabel: "感度" },
  { key: "cm360", label: "振り向き", shortLabel: "振向" },
  { key: "windowsSpeed", label: "Win Sens", shortLabel: "Win" },
  { key: "cursorSpeed", label: "カーソル速度", shortLabel: "速度" },
  { key: "rawInput", label: "Raw Input", shortLabel: "Raw" },
  { key: "mouseAcceleration", label: "マウス加速", shortLabel: "加速" },
] as const;

// Windowsポインター速度の乗数（6/11がデフォルト）
// https://liquipedia.net/counterstrike/Mouse_Settings#Windows_Sensitivity
const WINDOWS_POINTER_MULTIPLIERS: Record<number, number> = {
  1: 0.03125,
  2: 0.0625,
  3: 0.25,
  4: 0.5,
  5: 0.75,
  6: 1.0,
  7: 1.5,
  8: 2.0,
  9: 2.5,
  10: 3.0,
  11: 3.5,
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

// カーソル速度（実効DPI / eDPI）を計算
// Raw Input ON: DPIそのまま
// Raw Input OFF: DPI × Windowsポインター速度乗数
function calculateCursorSpeed(
  dpi: number | null,
  rawInput: boolean | null,
  windowsSpeed: number | null,
  windowsSpeedMultiplier: number | null = null
): number | null {
  if (dpi == null) return null;

  // Raw Input が ON の場合、Windowsポインター速度は無視
  if (rawInput === true) {
    return dpi;
  }

  // Raw Input が OFF の場合、Windowsポインター速度を適用
  const winMultiplier = getWindowsMultiplier(windowsSpeed, windowsSpeedMultiplier);
  return Math.round(dpi * winMultiplier);
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const { env } = context;
  const db = createDb();
  const url = new URL(request.url);

  const search = url.searchParams.get("q") ?? "";
  const sort = url.searchParams.get("sort") ?? "recent";
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));

  let orderBy;
  switch (sort) {
    case "name":
      orderBy = asc(users.mcid);
      break;
    case "updated":
      orderBy = desc(users.updatedAt);
      break;
    case "recent":
    default:
      orderBy = desc(users.createdAt);
      break;
  }

  const whereClause = search ? like(users.mcid, `%${search}%`) : undefined;

  // キー配置を持つユーザーを取得
  const [playersWithKeybindings, countResult] = await Promise.all([
    db.query.users.findMany({
      where: whereClause,
      orderBy: [orderBy],
      limit: PLAYERS_PER_PAGE,
      offset: (page - 1) * PLAYERS_PER_PAGE,
      columns: {
        id: true,
        mcid: true,
        uuid: true,
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
      },
    }),
    db.select({ count: sql<number>`count(*)` }).from(users).where(whereClause),
  ]);

  // キー配置があるプレイヤーのみをフィルタ
  const players = playersWithKeybindings.filter(p => p.keybindings.length > 0);

  const totalPlayers = countResult[0]?.count ?? 0;
  const totalPages = Math.ceil(totalPlayers / PLAYERS_PER_PAGE);

  return { players, totalPlayers, totalPages, currentPage: page, search, sort };
}

// マウスソートのキー型
type MouseSortKey = "dpi" | "sensitivity" | "cm360" | "windowsSpeed" | "cursorSpeed" | null;
type SortDirection = "asc" | "desc";

export default function KeybindingsListPage() {
  const { players, totalPages, currentPage, search, sort } =
    useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();

  // マウスタブのソート状態
  const [mouseSortKey, setMouseSortKey] = useState<MouseSortKey>(null);
  const [mouseSortDirection, setMouseSortDirection] = useState<SortDirection>("asc");

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

  // ソート済みプレイヤーリスト（マウスタブ用）
  const sortedPlayersForMouse = useMemo(() => {
    if (!mouseSortKey) return players;

    return [...players].sort((a, b) => {
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
            configA.rawInput,
            configA.windowsSpeed,
            configA.windowsSpeedMultiplier
          ) : null;
          valueB = configB ? calculateCursorSpeed(
            configB.mouseDpi,
            configB.rawInput,
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
  }, [players, mouseSortKey, mouseSortDirection]);

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

  const handleSort = (value: string) => {
    const params = new URLSearchParams(searchParams);
    params.set("sort", value);
    params.delete("page");
    setSearchParams(params);
  };

  const handlePageChange = (newPage: number) => {
    const params = new URLSearchParams(searchParams);
    params.set("page", String(newPage));
    setSearchParams(params);
  };

  return (
    <div className="flex-1 flex flex-col space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Keyboard className="h-8 w-8" />
          操作設定一覧
        </h1>
        <p className="text-muted-foreground mt-1">
          スピードランナーの操作設定・キー配置を一覧で確認できます。
        </p>
      </div>

      {/* Search and Filter */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="MCIDで検索..."
            defaultValue={search}
            onChange={(e) => handleSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={sort} onValueChange={handleSort}>
          <SelectTrigger className="w-full sm:w-45">
            <SelectValue placeholder="並び替え" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="recent">新着順</SelectItem>
            <SelectItem value="updated">更新順</SelectItem>
            <SelectItem value="name">名前順 (A-Z)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <p className="text-sm text-muted-foreground">
        {players.length}人のプレイヤー
      </p>

      {/* Tabs for Keyboard / Mouse */}
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

        {/* Keyboard Tab */}
        <TabsContent value="keyboard">
          {players.length > 0 ? (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="sticky left-0 bg-muted/50 z-10 min-w-36">
                      プレイヤー
                    </TableHead>
                    {KEYBOARD_COLUMNS.map((col) => (
                      <TableHead
                        key={col.action}
                        className="text-center px-2 min-w-12"
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
              </Table>
            </div>
          ) : (
            <EmptyState search={search} onClear={() => handleSearch("")} />
          )}
        </TabsContent>

        {/* Mouse Tab */}
        <TabsContent value="mouse">
          {players.length > 0 ? (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="sticky left-0 bg-muted/50 z-10 min-w-36">
                      プレイヤー
                    </TableHead>
                    {MOUSE_COLUMNS.map((col) => {
                      const sortKey = col.key as MouseSortKey;
                      const isSortable = ["dpi", "sensitivity", "cm360", "windowsSpeed", "cursorSpeed"].includes(col.key);
                      const isActive = mouseSortKey === sortKey;

                      return (
                        <TableHead
                          key={col.key}
                          className="text-center px-1 min-w-20"
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
              </Table>
            </div>
          ) : (
            <EmptyState search={search} onClear={() => handleSearch("")} />
          )}
        </TabsContent>
      </Tabs>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage <= 1}
            onClick={() => handlePageChange(currentPage - 1)}
          >
            前へ
          </Button>
          <div className="flex items-center gap-1">
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              let pageNum;
              if (totalPages <= 5) {
                pageNum = i + 1;
              } else if (currentPage <= 3) {
                pageNum = i + 1;
              } else if (currentPage >= totalPages - 2) {
                pageNum = totalPages - 4 + i;
              } else {
                pageNum = currentPage - 2 + i;
              }
              return (
                <Button
                  key={pageNum}
                  variant={pageNum === currentPage ? "default" : "outline"}
                  size="sm"
                  onClick={() => handlePageChange(pageNum)}
                >
                  {pageNum}
                </Button>
              );
            })}
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage >= totalPages}
            onClick={() => handlePageChange(currentPage + 1)}
          >
            次へ
          </Button>
        </div>
      )}
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
    mcid: string;
    uuid: string;
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
          to={`/player/${player.mcid}`}
          className="flex items-center gap-2 hover:opacity-80 transition-opacity"
        >
          <MinecraftAvatar
            uuid={player.uuid}
            size={28}
            className="rounded-sm shrink-0"
          />
          <div className="min-w-0">
            <p className="font-medium text-sm truncate">
              {player.displayName ?? player.mcid}
            </p>
          </div>
        </Link>
      </TableCell>
      {columns.map((col) => {
        const keyCode = keybindMap.get(col.action);
        return (
          <TableCell key={col.action} className="text-center px-2">
            {keyCode ? (
              <KeyBadge keyCode={keyCode} />
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
    mcid: string;
    uuid: string;
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
        config.rawInput,
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
          to={`/player/${player.mcid}`}
          className="flex items-center gap-2 hover:opacity-80 transition-opacity"
        >
          <MinecraftAvatar
            uuid={player.uuid}
            size={28}
            className="rounded-sm shrink-0"
          />
          <div className="min-w-0">
            <p className="font-medium text-sm truncate">
              {player.displayName ?? player.mcid}
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
          <span className="font-mono text-sm">{sensitivityDisplay}%</span>
        ) : (
          <span className="text-muted-foreground/40">-</span>
        )}
      </TableCell>
      <TableCell className="text-center px-3">
        {cm360 != null ? (
          <span className="font-mono text-sm">{cm360.toFixed(1)}cm</span>
        ) : (
          <span className="text-muted-foreground/40">-</span>
        )}
      </TableCell>
      <TableCell className="text-center px-3">
        {config?.windowsSpeedMultiplier != null ? (
          <span className="font-mono text-sm" title="カスタム係数">
            ×{config.windowsSpeedMultiplier}
          </span>
        ) : config?.windowsSpeed != null ? (
          <span className="font-mono text-sm">{config.windowsSpeed}/11</span>
        ) : (
          <span className="text-muted-foreground/40">-</span>
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

// キー表示バッジ
function KeyBadge({ keyCode }: { keyCode: string }) {
  const label = getKeyLabel(keyCode);
  const isMouse = keyCode.startsWith("Mouse") || keyCode.toLowerCase().includes("mouse");

  return (
    <Badge
      variant="secondary"
      className={cn(
        "font-mono text-xs px-1.5 py-0.5",
        isMouse && "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20"
      )}
    >
      {label}
    </Badge>
  );
}
