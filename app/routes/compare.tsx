import { createTranslator } from "@/lib/messages";
import { localeFromMatches } from "@/lib/locale";
import { useLoaderData, useSearchParams, Link } from "react-router";
import type { Route } from "./+types/compare";
import { createDb } from "@/lib/db";
import { getEnv } from "@/lib/env.server";
import { users, configPresets } from "@/lib/schema";
import { eq, asc, and, sql } from "drizzle-orm";
import { decodePresetConfig, decodePresetKeybindings, type PresetSnapshot } from "@/lib/preset-read";
import { publiclyReferencableCondition } from "@/lib/users-filter";
import { getActionLabel, getKeyLabel, normalizeKeyCode } from "@/lib/keybindings";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
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
import { useT } from "@/hooks/use-locale";
import type { Translator } from "@/lib/messages";

export const meta: Route.MetaFunction = ({ matches, loaderData }) => {
  const t = createTranslator(localeFromMatches(matches));
  const title = `${t("compare.title")} - Minefolio`;
  const description = t("compare.description");
  const appUrl = loaderData?.appUrl || "https://minefolio.app";
  const ogImage = `${appUrl}/icon.png`;
  return [
    { title },
    { name: "description", content: description },
    { property: "og:type", content: "website" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:image", content: ogImage },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: ogImage },
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

// ラベルは描画時に t() で解決する（モジュール評価時はロケールが未確定）
const categoryLabelsOf = (t: Translator): Record<string, string> => ({
  movement: t("compare.movement"),
  combat: t("compare.combat"),
  inventory: t("compare.inventory"),
  ui: "UI",
});

// 比較用に取得するメイン（公開用）プリセットのスナップショット列
const MAIN_PRESET_COLUMNS = {
  id: true,
  keybindingsData: true,
  playerConfigData: true,
  remapsData: true,
  fingerAssignmentsData: true,
} as const;

// 公開比較はメイン（公開用）プリセットのスナップショットを優先する。
// メインが無いユーザーのみライブ（従来挙動）へフォールバック。
// メインがある場合、null の種別は「空」であり編集中のライブデータを混ぜない。
// デコード行はライブ行と構造互換のためキャストで型を維持する。
function applyMainPreset<
  P extends {
    id: string;
    keybindings: unknown;
    keyRemaps: unknown;
    playerConfig: unknown;
    configPresets: (PresetSnapshot & { id: string })[];
  },
>(player: P): Omit<P, "configPresets"> {
  const { configPresets: userPresets, ...rest } = player;
  const main = userPresets[0];
  if (!main) return rest;
  const decoded = decodePresetConfig(main, player.id);
  return {
    ...rest,
    keybindings: decoded.keybindings,
    keyRemaps: decoded.keyRemaps,
    playerConfig: decoded.playerConfig
      ? {
          ...(player.playerConfig ?? {}),
          ...decoded.playerConfig,
          fingerAssignments: decoded.fingerAssignments,
        }
      : null,
  } as unknown as Omit<P, "configPresets">;
}

export async function loader({ request }: Route.LoaderArgs) {
  const env = getEnv();
  const appUrl = env.APP_URL || "https://minefolio.app";
  const db = createDb();
  const url = new URL(request.url);

  const p1 = url.searchParams.get("p1");
  const p2 = url.searchParams.get("p2");

  // 走者一覧（選択用）: 一覧なので公開プロフィールのみ
  const allPlayers = await db.query.users.findMany({
    where: eq(users.profileVisibility, "public"),
    columns: {
      mcid: true,
      uuid: true,
      slug: true,
      displayName: true,
      customSkinUrl: true,
    },
    orderBy: [asc(users.slug)],
    limit: 100,
  });

  // p1のみ指定の場合、類似走者を検索（slugで検索）
  if (p1 && !p2) {
    const player1Raw = await db.query.users.findFirst({
      // 非公開（private）は比較対象にしない。限定公開（unlisted）はURL指定なら可
      where: and(
        eq(users.slug, p1),
        publiclyReferencableCondition,
      ),
      with: {
        keybindings: true,
        playerConfig: true,
        keyRemaps: true,
        configPresets: {
          where: eq(configPresets.isMain, true),
          columns: MAIN_PRESET_COLUMNS,
        },
      },
    });

    if (!player1Raw) {
      return { allPlayers, player1: null, player2: null, similarPlayers: [], appUrl };
    }
    const player1Data = applyMainPreset(player1Raw);

    // p1のキーバインドをマップ化
    const p1KeyMap: Record<string, string> = {};
    for (const kb of player1Data.keybindings) {
      p1KeyMap[kb.action] = kb.keyCode;
    }

    // 全ユーザーのキーバインドを取得して類似度を計算
    // （メインプリセットのスナップショットを優先。無いユーザーのみライブ）
    const allUsersWithKeybindings = await db.query.users.findMany({
      where: and(sql`${users.slug} != ${p1}`, eq(users.profileVisibility, "public")),
      columns: {
        id: true,
        mcid: true,
        uuid: true,
        slug: true,
        displayName: true,
        customSkinUrl: true,
      },
      with: {
        // 類似度計算に使うのは action / keyCode のみ（メイン持ちユーザーでは未使用のため最小限に）
        keybindings: { columns: { action: true, keyCode: true } },
        configPresets: {
          where: eq(configPresets.isMain, true),
          columns: { id: true, keybindingsData: true },
        },
      },
      limit: 50,
    });

    const similarPlayers = allUsersWithKeybindings
      .map((user) => {
        const mainPreset = user.configPresets[0];
        const userKeybindings = mainPreset
          ? (decodePresetKeybindings(mainPreset.keybindingsData, user.id) ?? [])
          : user.keybindings;
        const userKeyMap: Record<string, string> = {};
        for (const kb of userKeybindings) {
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
          slug: user.slug,
          displayName: user.displayName,
          customSkinUrl: user.customSkinUrl,
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
      appUrl,
    };
  }

  // 両方指定されていない場合は選択画面のみ
  if (!p1 || !p2) {
    return { allPlayers, player1: null, player2: null, similarPlayers: [], appUrl };
  }

  // 両走者のデータを取得（slugで検索・メインプリセットのスナップショット優先）
  const [player1Raw, player2Raw] = await Promise.all([
    db.query.users.findFirst({
      // 非公開（private）は比較対象にしない。限定公開（unlisted）はURL指定なら可
      where: and(
        eq(users.slug, p1),
        publiclyReferencableCondition,
      ),
      with: {
        keybindings: true,
        playerConfig: true,
        keyRemaps: true,
        configPresets: {
          where: eq(configPresets.isMain, true),
          columns: MAIN_PRESET_COLUMNS,
        },
      },
    }),
    db.query.users.findFirst({
      where: and(
        eq(users.slug, p2),
        publiclyReferencableCondition,
      ),
      with: {
        keybindings: true,
        playerConfig: true,
        keyRemaps: true,
        configPresets: {
          where: eq(configPresets.isMain, true),
          columns: MAIN_PRESET_COLUMNS,
        },
      },
    }),
  ]);
  const player1Data = player1Raw ? applyMainPreset(player1Raw) : undefined;
  const player2Data = player2Raw ? applyMainPreset(player2Raw) : undefined;

  return {
    allPlayers,
    player1: player1Data ?? null,
    player2: player2Data ?? null,
    similarPlayers: [],
    appUrl,
  };
}

export default function ComparePage() {
  const t = useT();
  const { allPlayers, player1, player2, similarPlayers } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search1, setSearch1] = useState("");
  const [search2, setSearch2] = useState("");

  const selectedP1 = searchParams.get("p1") ?? "";
  const selectedP2 = searchParams.get("p2") ?? "";

  const handleSelectPlayer = (slot: "p1" | "p2", slug: string) => {
    const params = new URLSearchParams(searchParams);
    if (slug) {
      params.set(slot, slug);
    } else {
      params.delete(slot);
    }
    setSearchParams(params);
  };

  // フィルタリングされた走者一覧
  const filteredPlayers1 = useMemo(() => {
    if (!search1) return allPlayers;
    const lower = search1.toLowerCase();
    return allPlayers.filter(
      (p) =>
        p.slug.toLowerCase().includes(lower) ||
        p.mcid?.toLowerCase().includes(lower) ||
        p.displayName?.toLowerCase().includes(lower)
    );
  }, [allPlayers, search1]);

  const filteredPlayers2 = useMemo(() => {
    if (!search2) return allPlayers;
    const lower = search2.toLowerCase();
    return allPlayers.filter(
      (p) =>
        p.slug.toLowerCase().includes(lower) ||
        p.mcid?.toLowerCase().includes(lower) ||
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
          {t("compare.title")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("compare.description")}
        </p>
      </div>

      {/* 走者選択 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t("compare.runner1")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t("compare.searchPlaceholder")}
                value={search1}
                onChange={(e) => setSearch1(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={selectedP1} onValueChange={(v) => handleSelectPlayer("p1", v)}>
              <SelectTrigger>
                <SelectValue placeholder={t("compare.selectRunner")} />
              </SelectTrigger>
              <SelectContent className="max-h-60">
                {filteredPlayers1.map((p) => (
                  <SelectItem key={p.slug} value={p.slug}>
                    <div className="flex items-center gap-2">
                      <MinecraftAvatar uuid={p.uuid} size={20} skinUrl={p.customSkinUrl} />
                      <span>{p.displayName ?? p.mcid ?? p.slug}</span>
                      {p.mcid && <span className="text-muted-foreground text-xs">@{p.mcid}</span>}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {player1 && (
              <Link
                to={`/player/${player1.slug}`}
                className="flex items-center gap-2 text-sm text-primary hover:underline"
              >
                <User className="h-4 w-4" />
                {t("compare.viewProfile")}
              </Link>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t("compare.runner2")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t("compare.searchPlaceholder")}
                value={search2}
                onChange={(e) => setSearch2(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={selectedP2} onValueChange={(v) => handleSelectPlayer("p2", v)}>
              <SelectTrigger>
                <SelectValue placeholder={t("compare.selectRunner")} />
              </SelectTrigger>
              <SelectContent className="max-h-60">
                {filteredPlayers2.map((p) => (
                  <SelectItem key={p.slug} value={p.slug}>
                    <div className="flex items-center gap-2">
                      <MinecraftAvatar uuid={p.uuid} size={20} skinUrl={p.customSkinUrl} />
                      <span>{p.displayName ?? p.mcid ?? p.slug}</span>
                      {p.mcid && <span className="text-muted-foreground text-xs">@{p.mcid}</span>}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {player2 && (
              <Link
                to={`/player/${player2.slug}`}
                className="flex items-center gap-2 text-sm text-primary hover:underline"
              >
                <User className="h-4 w-4" />
                {t("compare.viewProfile")}
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
            <CardContent>
              <div className="flex flex-wrap items-center justify-center gap-6">
                <div className="flex items-center gap-2">
                  <MinecraftAvatar uuid={player1.uuid} size={40} skinUrl={player1.customSkinUrl} />
                  <div>
                    <p className="font-bold">{player1.displayName ?? player1.mcid ?? player1.slug}</p>
                    {player1.mcid && <p className="text-xs text-muted-foreground">@{player1.mcid}</p>}
                  </div>
                </div>
                <div className="text-center px-6">
                  <div className="flex items-center gap-4">
                    <div className="text-center">
                      <p className="text-2xl font-bold text-green-500">{stats.same}</p>
                      <p className="text-xs text-muted-foreground">{t("compare.same")}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-2xl font-bold text-red-500">{stats.different}</p>
                      <p className="text-xs text-muted-foreground">{t("compare.different")}</p>
                    </div>
                  </div>
                  {stats.total > 0 && (
                    <p className="text-sm text-muted-foreground mt-2">
                      {t("compare.matchRate", { rate: Math.round((stats.same / stats.total) * 100) })}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <MinecraftAvatar uuid={player2.uuid} size={40} skinUrl={player2.customSkinUrl} />
                  <div>
                    <p className="font-bold">{player2.displayName ?? player2.mcid ?? player2.slug}</p>
                    {player2.mcid && <p className="text-xs text-muted-foreground">@{player2.mcid}</p>}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* キーバインド比較 */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">{t("compare.keybindingComparison")}</h2>
            {Object.entries(groupedActions).map(([category, actions]) => (
              <Card key={category}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{categoryLabelsOf(t)[category]}</CardTitle>
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
            <h2 className="text-lg font-semibold">{t("compare.deviceComparison")}</h2>
            <Card>
              <CardContent>
                <div className="grid grid-cols-3 gap-4">
                  <div className="font-medium text-sm text-muted-foreground">{t("compare.item")}</div>
                  <div className="font-medium text-sm text-center">{player1.displayName ?? player1.mcid ?? player1.slug}</div>
                  <div className="font-medium text-sm text-center">{player2.displayName ?? player2.mcid ?? player2.slug}</div>

                  <CompareRow
                    label={t("compare.mouseDpi")}
                    value1={player1.playerConfig?.mouseDpi?.toString()}
                    value2={player2.playerConfig?.mouseDpi?.toString()}
                  />
                  <CompareRow
                    label={t("compare.inGameSensitivity")}
                    value1={player1.playerConfig?.gameSensitivity ? `${Math.round(player1.playerConfig.gameSensitivity * 200)}%` : undefined}
                    value2={player2.playerConfig?.gameSensitivity ? `${Math.round(player2.playerConfig.gameSensitivity * 200)}%` : undefined}
                  />
                  <CompareRow
                    label={t("compare.keyboardLayout")}
                    value1={player1.playerConfig?.keyboardLayout ?? undefined}
                    value2={player2.playerConfig?.keyboardLayout ?? undefined}
                  />
                  <CompareRow
                    label={t("compare.toggleSprint")}
                    value1={player1.playerConfig?.toggleSprint != null ? (player1.playerConfig.toggleSprint ? t("common.on") : t("common.off")) : undefined}
                    value2={player2.playerConfig?.toggleSprint != null ? (player2.playerConfig.toggleSprint ? t("common.on") : t("common.off")) : undefined}
                  />
                  <CompareRow
                    label="Raw Input"
                    value1={player1.playerConfig?.rawInput != null ? (player1.playerConfig.rawInput ? t("common.on") : t("common.off")) : undefined}
                    value2={player2.playerConfig?.rawInput != null ? (player2.playerConfig.rawInput ? t("common.on") : t("common.off")) : undefined}
                  />
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {/* 類似設定の走者を探す */}
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
  onSelectPlayer: (slug: string) => void;
}) {
  const t = useT();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          {t("compare.similarTitle")}
        </CardTitle>
        <CardDescription>
          {(targetPlayer.displayName ?? targetPlayer.mcid ?? targetPlayer.slug) + t("compare.similarSuffix")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {similarPlayers.length > 0 ? (
          <div className="space-y-2">
            {similarPlayers.map((player) => (
              <div
                key={player.slug}
                className="flex items-center justify-between p-3 rounded-lg border hover:bg-secondary/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <MinecraftAvatar uuid={player.uuid} size={32} skinUrl={player.customSkinUrl} />
                  <div>
                    <p className="font-medium">{player.displayName ?? player.mcid ?? player.slug}</p>
                    {player.mcid && <p className="text-xs text-muted-foreground">@{player.mcid}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="font-bold text-green-500">
                      {Math.round(player.similarity * 100)}%
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("compare.matched", { matches: player.matches, total: player.total })}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onSelectPlayer(player.slug)}
                  >
                    {t("compare.compareButton")}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">
            {t("compare.noSimilar")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function HydrateFallback() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-8 w-48 mb-2" />
        <Skeleton className="h-5 w-72" />
      </div>

      {/* 走者選択スケルトン */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="pb-3">
              <Skeleton className="h-5 w-24" />
            </CardHeader>
            <CardContent className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 統計サマリースケルトン */}
      <Card>
        <CardContent>
          <div className="flex flex-wrap items-center justify-center gap-6">
            <div className="flex items-center gap-2">
              <Skeleton className="w-10 h-10 rounded-lg" />
              <div className="space-y-2">
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-3 w-16" />
              </div>
            </div>
            <div className="text-center px-6">
              <div className="flex items-center gap-4 mb-2">
                <div className="text-center">
                  <Skeleton className="h-8 w-12 mx-auto mb-1" />
                  <Skeleton className="h-3 w-8 mx-auto" />
                </div>
                <div className="text-center">
                  <Skeleton className="h-8 w-12 mx-auto mb-1" />
                  <Skeleton className="h-3 w-12 mx-auto" />
                </div>
              </div>
              <Skeleton className="h-4 w-24 mx-auto" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="w-10 h-10 rounded-lg" />
              <div className="space-y-2">
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-3 w-16" />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* キーバインド比較スケルトン */}
      <div className="space-y-4">
        <Skeleton className="h-6 w-40" />
        {Array.from({ length: 4 }).map((_, categoryIndex) => (
          <Card key={categoryIndex}>
            <CardHeader className="pb-2">
              <Skeleton className="h-5 w-20" />
            </CardHeader>
            <CardContent>
              <div className="divide-y">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="flex items-center justify-between py-2 px-2 -mx-2">
                    <Skeleton className="h-4 w-24" />
                    <div className="flex items-center gap-4">
                      <Skeleton className="h-8 w-20" />
                      <Skeleton className="h-4 w-4" />
                      <Skeleton className="h-8 w-20" />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* デバイス・設定の比較スケルトン */}
      <div className="space-y-4">
        <Skeleton className="h-6 w-48" />
        <Card>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              {Array.from({ length: 15 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
