import { useLoaderData, useSearchParams, Link } from "react-router";
import type { Route } from "./+types/compare";
import { createDb } from "@/lib/db";
import { users, keybindings, playerConfigs, keyRemaps } from "@/lib/schema";
import { eq, asc, and, inArray, sql } from "drizzle-orm";
import { getActionLabel, getKeyLabel, normalizeKeyCode } from "@/lib/keybindings";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, GitCompare, User, Check, X, ArrowRight, Users } from "lucide-react";
import { useState, useMemo } from "react";

export const meta: Route.MetaFunction = () => {
  return [
    { title: "プレイヤー比較 - Minefolio" },
    {
      name: "description",
      content: "2人のプレイヤーのキー配置・設定を比較します",
    },
  ];
};

// 比較用のアクション一覧
const COMPARE_ACTIONS = [
  // 移動
  { action: "forward", category: "movement" },
  { action: "back", category: "movement" },
  { action: "left", category: "movement" },
  { action: "right", category: "movement" },
  { action: "jump", category: "movement" },
  { action: "sneak", category: "movement" },
  { action: "sprint", category: "movement" },
  // 戦闘
  { action: "attack", category: "combat" },
  { action: "use", category: "combat" },
  { action: "pickBlock", category: "combat" },
  { action: "drop", category: "combat" },
  // インベントリ
  { action: "inventory", category: "inventory" },
  { action: "swapHands", category: "inventory" },
  { action: "hotbar1", category: "inventory" },
  { action: "hotbar2", category: "inventory" },
  { action: "hotbar3", category: "inventory" },
  { action: "hotbar4", category: "inventory" },
  { action: "hotbar5", category: "inventory" },
  { action: "hotbar6", category: "inventory" },
  { action: "hotbar7", category: "inventory" },
  { action: "hotbar8", category: "inventory" },
  { action: "hotbar9", category: "inventory" },
  // UI
  { action: "togglePerspective", category: "ui" },
  { action: "fullscreen", category: "ui" },
  { action: "chat", category: "ui" },
  { action: "command", category: "ui" },
];

const categoryLabels: Record<string, string> = {
  movement: "移動",
  combat: "戦闘",
  inventory: "インベントリ",
  ui: "UI",
};

export async function loader({ context, request }: Route.LoaderArgs) {
  const { env } = context;
  const db = createDb();
  const url = new URL(request.url);

  const p1 = url.searchParams.get("p1");
  const p2 = url.searchParams.get("p2");

  // プレイヤー一覧（選択用）
  const allPlayers = await db.query.users.findMany({
    columns: {
      mcid: true,
      uuid: true,
      displayName: true,
    },
    orderBy: [asc(users.mcid)],
    limit: 100,
  });

  // p1のみ指定の場合、類似プレイヤーを検索
  if (p1 && !p2) {
    const player1Data = await db.query.users.findFirst({
      where: eq(users.mcid, p1),
      with: {
        keybindings: true,
        playerConfig: true,
        keyRemaps: true,
      },
    });

    if (!player1Data) {
      return { allPlayers, player1: null, player2: null, similarPlayers: [] };
    }

    // p1のキーバインドをマップ化
    const p1KeyMap: Record<string, string> = {};
    for (const kb of player1Data.keybindings) {
      p1KeyMap[kb.action] = kb.keyCode;
    }

    // 全ユーザーのキーバインドを取得して類似度を計算
    const allUsersWithKeybindings = await db.query.users.findMany({
      where: sql`${users.mcid} != ${p1}`,
      columns: {
        id: true,
        mcid: true,
        uuid: true,
        displayName: true,
      },
      with: {
        keybindings: true,
      },
      limit: 50,
    });

    const similarPlayers = allUsersWithKeybindings
      .map((user) => {
        const userKeyMap: Record<string, string> = {};
        for (const kb of user.keybindings) {
          userKeyMap[kb.action] = kb.keyCode;
        }

        // 一致数を計算
        let matches = 0;
        let total = 0;
        for (const item of COMPARE_ACTIONS) {
          const k1 = p1KeyMap[item.action];
          const k2 = userKeyMap[item.action];
          if (k1 && k2) {
            total++;
            if (k1 === k2) {
              matches++;
            }
          }
        }

        const similarity = total > 0 ? matches / total : 0;
        return {
          mcid: user.mcid,
          uuid: user.uuid,
          displayName: user.displayName,
          matches,
          total,
          similarity,
        };
      })
      .filter((p) => p.total > 0 && p.similarity > 0)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 10);

    return {
      allPlayers,
      player1: player1Data,
      player2: null,
      similarPlayers,
    };
  }

  // 両方指定されていない場合は選択画面のみ
  if (!p1 || !p2) {
    return { allPlayers, player1: null, player2: null, similarPlayers: [] };
  }

  // 両プレイヤーのデータを取得
  const [player1Data, player2Data] = await Promise.all([
    db.query.users.findFirst({
      where: eq(users.mcid, p1),
      with: {
        keybindings: true,
        playerConfig: true,
        keyRemaps: true,
      },
    }),
    db.query.users.findFirst({
      where: eq(users.mcid, p2),
      with: {
        keybindings: true,
        playerConfig: true,
        keyRemaps: true,
      },
    }),
  ]);

  return {
    allPlayers,
    player1: player1Data ?? null,
    player2: player2Data ?? null,
    similarPlayers: [],
  };
}

export default function ComparePage() {
  const { allPlayers, player1, player2, similarPlayers } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search1, setSearch1] = useState("");
  const [search2, setSearch2] = useState("");

  const selectedP1 = searchParams.get("p1") ?? "";
  const selectedP2 = searchParams.get("p2") ?? "";

  const handleSelectPlayer = (slot: "p1" | "p2", mcid: string) => {
    const params = new URLSearchParams(searchParams);
    if (mcid) {
      params.set(slot, mcid);
    } else {
      params.delete(slot);
    }
    setSearchParams(params);
  };

  // フィルタリングされたプレイヤー一覧
  const filteredPlayers1 = useMemo(() => {
    if (!search1) return allPlayers;
    const lower = search1.toLowerCase();
    return allPlayers.filter(
      (p) =>
        p.mcid.toLowerCase().includes(lower) ||
        p.displayName?.toLowerCase().includes(lower)
    );
  }, [allPlayers, search1]);

  const filteredPlayers2 = useMemo(() => {
    if (!search2) return allPlayers;
    const lower = search2.toLowerCase();
    return allPlayers.filter(
      (p) =>
        p.mcid.toLowerCase().includes(lower) ||
        p.displayName?.toLowerCase().includes(lower)
    );
  }, [allPlayers, search2]);

  // キーバインドをマップ化
  const p1Keybindings = useMemo(() => {
    const map: Record<string, string> = {};
    if (player1?.keybindings) {
      for (const kb of player1.keybindings) {
        map[kb.action] = kb.keyCode;
      }
    }
    return map;
  }, [player1]);

  const p2Keybindings = useMemo(() => {
    const map: Record<string, string> = {};
    if (player2?.keybindings) {
      for (const kb of player2.keybindings) {
        map[kb.action] = kb.keyCode;
      }
    }
    return map;
  }, [player2]);

  // カテゴリ別にグループ化
  const groupedActions = useMemo(() => {
    const groups: Record<string, typeof COMPARE_ACTIONS> = {};
    for (const item of COMPARE_ACTIONS) {
      if (!groups[item.category]) {
        groups[item.category] = [];
      }
      groups[item.category].push(item);
    }
    return groups;
  }, []);

  // 一致・不一致の統計
  const stats = useMemo(() => {
    if (!player1 || !player2) return { same: 0, different: 0, total: 0 };

    let same = 0;
    let different = 0;

    for (const item of COMPARE_ACTIONS) {
      const k1 = p1Keybindings[item.action];
      const k2 = p2Keybindings[item.action];
      if (k1 && k2) {
        if (k1 === k2) {
          same++;
        } else {
          different++;
        }
      }
    }

    return { same, different, total: same + different };
  }, [player1, player2, p1Keybindings, p2Keybindings]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <GitCompare className="h-6 w-6" />
          プレイヤー比較
        </h1>
        <p className="text-muted-foreground">
          2人のプレイヤーのキー配置・設定を比較します
        </p>
      </div>

      {/* プレイヤー選択 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">プレイヤー 1</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="検索..."
                value={search1}
                onChange={(e) => setSearch1(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={selectedP1} onValueChange={(v) => handleSelectPlayer("p1", v)}>
              <SelectTrigger>
                <SelectValue placeholder="プレイヤーを選択" />
              </SelectTrigger>
              <SelectContent className="max-h-60">
                {filteredPlayers1.map((p) => (
                  <SelectItem key={p.mcid} value={p.mcid}>
                    <div className="flex items-center gap-2">
                      <MinecraftAvatar uuid={p.uuid} size={20} />
                      <span>{p.displayName ?? p.mcid}</span>
                      <span className="text-muted-foreground text-xs">@{p.mcid}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {player1 && (
              <Link
                to={`/player/${player1.mcid}`}
                className="flex items-center gap-2 text-sm text-primary hover:underline"
              >
                <User className="h-4 w-4" />
                プロフィールを見る
              </Link>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">プレイヤー 2</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="検索..."
                value={search2}
                onChange={(e) => setSearch2(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={selectedP2} onValueChange={(v) => handleSelectPlayer("p2", v)}>
              <SelectTrigger>
                <SelectValue placeholder="プレイヤーを選択" />
              </SelectTrigger>
              <SelectContent className="max-h-60">
                {filteredPlayers2.map((p) => (
                  <SelectItem key={p.mcid} value={p.mcid}>
                    <div className="flex items-center gap-2">
                      <MinecraftAvatar uuid={p.uuid} size={20} />
                      <span>{p.displayName ?? p.mcid}</span>
                      <span className="text-muted-foreground text-xs">@{p.mcid}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {player2 && (
              <Link
                to={`/player/${player2.mcid}`}
                className="flex items-center gap-2 text-sm text-primary hover:underline"
              >
                <User className="h-4 w-4" />
                プロフィールを見る
              </Link>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 比較結果 */}
      {player1 && player2 && (
        <>
          {/* 統計サマリー */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex flex-wrap items-center justify-center gap-6">
                <div className="flex items-center gap-2">
                  <MinecraftAvatar uuid={player1.uuid} size={40} />
                  <div>
                    <p className="font-bold">{player1.displayName ?? player1.mcid}</p>
                    <p className="text-xs text-muted-foreground">@{player1.mcid}</p>
                  </div>
                </div>
                <div className="text-center px-6">
                  <div className="flex items-center gap-4">
                    <div className="text-center">
                      <p className="text-2xl font-bold text-green-500">{stats.same}</p>
                      <p className="text-xs text-muted-foreground">一致</p>
                    </div>
                    <div className="text-center">
                      <p className="text-2xl font-bold text-red-500">{stats.different}</p>
                      <p className="text-xs text-muted-foreground">異なる</p>
                    </div>
                  </div>
                  {stats.total > 0 && (
                    <p className="text-sm text-muted-foreground mt-2">
                      一致率: {Math.round((stats.same / stats.total) * 100)}%
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <MinecraftAvatar uuid={player2.uuid} size={40} />
                  <div>
                    <p className="font-bold">{player2.displayName ?? player2.mcid}</p>
                    <p className="text-xs text-muted-foreground">@{player2.mcid}</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* キーバインド比較 */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">キー配置の比較</h2>
            {Object.entries(groupedActions).map(([category, actions]) => (
              <Card key={category}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{categoryLabels[category]}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="divide-y">
                    {actions.map((item) => {
                      const key1 = p1Keybindings[item.action];
                      const key2 = p2Keybindings[item.action];
                      const isSame = key1 && key2 && key1 === key2;
                      const isDifferent = key1 && key2 && key1 !== key2;

                      return (
                        <div
                          key={item.action}
                          className={cn(
                            "flex items-center justify-between py-2 px-2 -mx-2",
                            isSame && "bg-green-500/5",
                            isDifferent && "bg-red-500/5"
                          )}
                        >
                          <div className="flex items-center gap-2 flex-1">
                            {isSame && <Check className="h-4 w-4 text-green-500" />}
                            {isDifferent && <X className="h-4 w-4 text-red-500" />}
                            <span className="text-sm">{getActionLabel(item.action)}</span>
                          </div>
                          <div className="flex items-center gap-4">
                            <kbd className="min-w-20 text-center px-2 py-1 bg-secondary/80 rounded text-sm font-mono">
                              {key1 ? getKeyLabel(key1) : "-"}
                            </kbd>
                            <ArrowRight className="h-4 w-4 text-muted-foreground" />
                            <kbd className="min-w-20 text-center px-2 py-1 bg-secondary/80 rounded text-sm font-mono">
                              {key2 ? getKeyLabel(key2) : "-"}
                            </kbd>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* デバイス・設定の比較 */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">デバイス・設定の比較</h2>
            <Card>
              <CardContent className="pt-6">
                <div className="grid grid-cols-3 gap-4">
                  <div className="font-medium text-sm text-muted-foreground">項目</div>
                  <div className="font-medium text-sm text-center">{player1.displayName ?? player1.mcid}</div>
                  <div className="font-medium text-sm text-center">{player2.displayName ?? player2.mcid}</div>

                  <CompareRow
                    label="マウスDPI"
                    value1={player1.playerConfig?.mouseDpi?.toString()}
                    value2={player2.playerConfig?.mouseDpi?.toString()}
                  />
                  <CompareRow
                    label="ゲーム内感度"
                    value1={player1.playerConfig?.gameSensitivity ? `${Math.round(player1.playerConfig.gameSensitivity * 200)}%` : undefined}
                    value2={player2.playerConfig?.gameSensitivity ? `${Math.round(player2.playerConfig.gameSensitivity * 200)}%` : undefined}
                  />
                  <CompareRow
                    label="キーボードレイアウト"
                    value1={player1.playerConfig?.keyboardLayout ?? undefined}
                    value2={player2.playerConfig?.keyboardLayout ?? undefined}
                  />
                  <CompareRow
                    label="ダッシュ切替"
                    value1={player1.playerConfig?.toggleSprint != null ? (player1.playerConfig.toggleSprint ? "オン" : "オフ") : undefined}
                    value2={player2.playerConfig?.toggleSprint != null ? (player2.playerConfig.toggleSprint ? "オン" : "オフ") : undefined}
                  />
                  <CompareRow
                    label="Raw Input"
                    value1={player1.playerConfig?.rawInput != null ? (player1.playerConfig.rawInput ? "オン" : "オフ") : undefined}
                    value2={player2.playerConfig?.rawInput != null ? (player2.playerConfig.rawInput ? "オン" : "オフ") : undefined}
                  />
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {/* 類似設定のプレイヤーを探す */}
      {player1 && !player2 && (
        <SimilarPlayersSection
          targetPlayer={player1}
          similarPlayers={similarPlayers}
          onSelectPlayer={(mcid) => handleSelectPlayer("p2", mcid)}
        />
      )}
    </div>
  );
}

function CompareRow({
  label,
  value1,
  value2,
}: {
  label: string;
  value1?: string;
  value2?: string;
}) {
  const isSame = value1 && value2 && value1 === value2;
  const isDifferent = value1 && value2 && value1 !== value2;

  return (
    <>
      <div className="text-sm py-1">{label}</div>
      <div
        className={cn(
          "text-sm text-center py-1 rounded",
          isSame && "bg-green-500/10",
          isDifferent && "bg-red-500/10"
        )}
      >
        {value1 ?? "-"}
      </div>
      <div
        className={cn(
          "text-sm text-center py-1 rounded",
          isSame && "bg-green-500/10",
          isDifferent && "bg-red-500/10"
        )}
      >
        {value2 ?? "-"}
      </div>
    </>
  );
}

function SimilarPlayersSection({
  targetPlayer,
  similarPlayers,
  onSelectPlayer,
}: {
  targetPlayer: NonNullable<Awaited<ReturnType<typeof loader>>["player1"]>;
  similarPlayers: Awaited<ReturnType<typeof loader>>["similarPlayers"];
  onSelectPlayer: (mcid: string) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          類似設定のプレイヤー
        </CardTitle>
        <CardDescription>
          {targetPlayer.displayName ?? targetPlayer.mcid}と似たキー配置のプレイヤー
        </CardDescription>
      </CardHeader>
      <CardContent>
        {similarPlayers.length > 0 ? (
          <div className="space-y-2">
            {similarPlayers.map((player) => (
              <div
                key={player.mcid}
                className="flex items-center justify-between p-3 rounded-lg border hover:bg-secondary/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <MinecraftAvatar uuid={player.uuid} size={32} />
                  <div>
                    <p className="font-medium">{player.displayName ?? player.mcid}</p>
                    <p className="text-xs text-muted-foreground">@{player.mcid}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="font-bold text-green-500">
                      {Math.round(player.similarity * 100)}%
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {player.matches}/{player.total} 一致
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onSelectPlayer(player.mcid)}
                  >
                    比較
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">
            類似するプレイヤーが見つかりませんでした
          </p>
        )}
      </CardContent>
    </Card>
  );
}
