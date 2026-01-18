import { useLoaderData, Link, useParams, useSearchParams, useNavigate } from "react-router";
import { lazy, Suspense, useState } from "react";
import type { Route } from "./+types/profile";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getOptionalSession } from "@/lib/session";
import { users, categoryRecords, keybindings, playerConfigs, socialLinks, itemLayouts, searchCrafts, keyRemaps, configPresets } from "@/lib/schema";
import { eq, asc, desc } from "drizzle-orm";
import { fetchAllExternalStats, type MCSRRankedMatch } from "@/lib/external-stats";
import {
  MinecraftItemIcon,
  formatItemName,
  getItemNameJa,
} from "@bafv4/mcitems/1.16/react";
import type { PoseName } from "@/components/minecraft-fullbody";
import { formatTime } from "@/lib/time-utils";

// クライアントサイドのみでレンダリング
const MinecraftFullBody = lazy(() =>
  import("@/components/minecraft-fullbody").then((mod) => ({ default: mod.MinecraftFullBody }))
);

const MinecraftAvatar = lazy(() =>
  import("@/components/minecraft-avatar").then((mod) => ({ default: mod.MinecraftAvatar }))
);

// OGPメタタグ
export function meta({ data, params }: Route.MetaArgs) {
  if (!data?.player) {
    return [
      { title: "Player Not Found - Minefolio" },
      { name: "description", content: "Player profile not found" },
    ];
  }

  const { player } = data;
  const displayName = player.displayName || player.mcid;
  const description = player.shortBio || player.bio || `${displayName}'s Minecraft speedrunning profile`;
  const ogImageUrl = `${data.appUrl}/og-image?mcid=${encodeURIComponent(player.mcid)}`;

  return [
    { title: `${displayName} (@${player.mcid}) - Minefolio` },
    { name: "description", content: description },

    // Open Graph
    { property: "og:type", content: "profile" },
    { property: "og:title", content: `${displayName} - Minefolio` },
    { property: "og:description", content: description },
    { property: "og:image", content: ogImageUrl },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { property: "og:url", content: `${data.appUrl}/player/${player.mcid}` },

    // Twitter Card
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: `${displayName} - Minefolio` },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: ogImageUrl },

    // Profile-specific meta
    { property: "profile:username", content: player.mcid },
  ];
}

// クライアントローダーでサーバーからデータを取得
export async function clientLoader({ serverLoader }: Route.ClientLoaderArgs) {
  return await serverLoader();
}

// クライアントローダーを使用することを明示
clientLoader.hydrate = true as const;

// ローディング中に表示するスケルトンUI
export function HydrateFallback() {
  const params = useParams();
  const mcid = params.mcid || "loading";

  return (
    <div className="flex flex-col lg:flex-row gap-8 animate-in fade-in duration-200">
      {/* Left Sidebar Skeleton */}
      <aside className="lg:w-72 shrink-0 space-y-6">
        <div className="flex flex-col items-center lg:items-start">
          {/* Skin Skeleton */}
          <div className="w-40 h-60 flex items-center justify-center">
            <div className="w-12 h-40 bg-muted rounded-lg animate-pulse" />
          </div>

          <div className="mt-4 text-center lg:text-left w-full space-y-2">
            <div className="h-8 w-32 bg-muted rounded animate-pulse mx-auto lg:mx-0" />
            <div className="h-5 w-24 bg-muted rounded animate-pulse mx-auto lg:mx-0" />
          </div>
        </div>

        {/* Bio Skeleton */}
        <div className="space-y-2">
          <div className="h-4 w-16 bg-muted rounded animate-pulse" />
          <div className="h-20 w-full bg-muted rounded animate-pulse" />
        </div>
      </aside>

      {/* Main Content Skeleton */}
      <main className="flex-1 min-w-0 space-y-6">
        {/* Tabs Skeleton */}
        <div className="h-10 w-80 bg-muted rounded animate-pulse" />

        {/* Content Skeleton */}
        <div className="space-y-4">
          <div className="h-64 w-full bg-muted rounded-lg animate-pulse" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="h-40 bg-muted rounded-lg animate-pulse" />
            <div className="h-40 bg-muted rounded-lg animate-pulse" />
          </div>
        </div>
      </main>
    </div>
  );
}
import { getActionLabel, getKeyLabel, type FingerType } from "@/lib/keybindings";
import { VirtualKeyboard, VirtualMouse, VirtualNumpad, FingerLegend, keybindingsToMap, FINGER_KEY_COLORS } from "@/components/virtual-keyboard";
import { cn } from "@/lib/utils";
import Markdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MapPin,
  Trophy,
  Keyboard,
  Mouse,
  Settings,
  ExternalLink,
  Youtube,
  Twitch,
  Twitter,
  Pencil,
  Calendar,
  Target,
  CheckCircle2,
  Video,
  Package,
  Search,
  BarChart3,
  Swords,
  Timer,
  GitCompare,
  Save,
  User,
  Menu,
  X,
} from "lucide-react";
import { ShareButton } from "@/components/share-button";
import { FavoriteButton } from "@/components/favorite-button";
import { getFavoritesFromCookie, isFavorite } from "@/lib/favorites";

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
  windowsSpeed: number | null | undefined,
  windowsSpeedMultiplier: number | null | undefined
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
  dpi: number | null | undefined,
  sensitivity: number | null | undefined,
  rawInput: boolean | null | undefined,
  windowsSpeed: number | null | undefined,
  windowsSpeedMultiplier: number | null | undefined = null
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

export const meta: Route.MetaFunction = ({ data }) => {
  if (!data?.player) {
    return [{ title: "プレイヤーが見つかりません - Minefolio" }];
  }

  const displayName = data.player.displayName ?? data.player.mcid;
  const description = data.player.shortBio
    ? `${displayName} - ${data.player.shortBio}`
    : `${displayName}のMinecraftスピードランポートフォリオ、キー配置、自己ベストを表示。`;

  // OGP画像URL（Crafatar APIを使用したスキン画像）
  const ogImageUrl = `https://crafatar.com/renders/body/${data.player.uuid}?overlay=true&scale=4`;
  const profileUrl = `https://minefolio.pages.dev/player/${data.player.mcid}`;

  return [
    { title: `${displayName} - Minefolio` },
    { name: "description", content: description },
    // Open Graph
    { property: "og:title", content: `${displayName} - Minefolio` },
    { property: "og:description", content: description },
    { property: "og:image", content: ogImageUrl },
    { property: "og:url", content: profileUrl },
    { property: "og:type", content: "profile" },
    { property: "og:site_name", content: "Minefolio" },
    // Twitter Card
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: `${displayName} - Minefolio` },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: ogImageUrl },
  ];
};

export async function loader({ context, request, params }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const db = createDb(env.DB);
  const auth = createAuth(db, env);
  const session = await getOptionalSession(request, auth);

  const { mcid } = params;
  const url = new URL(request.url);
  const presetId = url.searchParams.get("preset");

  // Fetch player with all related data
  const player = await db.query.users.findFirst({
    where: eq(users.mcid, mcid),
    with: {
      playerConfig: true,
      keybindings: {
        orderBy: [asc(keybindings.category), asc(keybindings.action)],
      },
      categoryRecords: {
        where: eq(categoryRecords.isVisible, true),
        orderBy: [asc(categoryRecords.displayOrder)],
      },
      socialLinks: {
        orderBy: [asc(socialLinks.displayOrder)],
      },
      itemLayouts: {
        orderBy: [asc(itemLayouts.displayOrder)],
      },
      searchCrafts: {
        orderBy: [asc(searchCrafts.sequence)],
      },
      keyRemaps: true,
    },
  });

  if (!player) {
    throw new Response("プレイヤーが見つかりません", { status: 404 });
  }

  // プリセット一覧を取得
  const presets = await db.query.configPresets.findMany({
    where: eq(configPresets.userId, player.id),
    orderBy: [desc(configPresets.isActive), desc(configPresets.updatedAt)],
    columns: {
      id: true,
      name: true,
      description: true,
      isActive: true,
      keybindingsData: true,
      playerConfigData: true,
      remapsData: true,
      fingerAssignmentsData: true,
    },
  });

  // 選択されたプリセットのデータを適用
  let activePresetId: string | null = null;
  let displayKeybindings = player.keybindings;
  let displayPlayerConfig = player.playerConfig;
  let displayKeyRemaps = player.keyRemaps;

  if (presetId && presets.length > 0) {
    const selectedPreset = presets.find((p) => p.id === presetId);
    if (selectedPreset) {
      activePresetId = selectedPreset.id;

      // プリセットのキーバインドを適用
      if (selectedPreset.keybindingsData) {
        const presetKeybindings = JSON.parse(selectedPreset.keybindingsData) as Array<{
          action: string;
          keyCode: string;
          category: string;
        }>;
        displayKeybindings = presetKeybindings.map((kb, idx) => ({
          id: `preset-${idx}`,
          userId: player.id,
          action: kb.action,
          keyCode: kb.keyCode,
          category: kb.category as "movement" | "combat" | "inventory" | "ui",
          createdAt: new Date(),
          updatedAt: new Date(),
        }));
      }

      // プリセットのプレイヤー設定を適用
      if (selectedPreset.playerConfigData) {
        const presetConfig = JSON.parse(selectedPreset.playerConfigData);
        displayPlayerConfig = {
          ...player.playerConfig,
          ...presetConfig,
          fingerAssignments: selectedPreset.fingerAssignmentsData ?? player.playerConfig?.fingerAssignments,
        } as typeof player.playerConfig;
      }

      // プリセットのリマップを適用
      if (selectedPreset.remapsData) {
        const presetRemaps = JSON.parse(selectedPreset.remapsData) as Array<{
          sourceKey: string;
          targetKey: string | null;
          software: string | null;
          notes: string | null;
        }>;
        displayKeyRemaps = presetRemaps.map((r, idx) => ({
          id: `preset-remap-${idx}`,
          userId: player.id,
          sourceKey: r.sourceKey,
          targetKey: r.targetKey,
          software: r.software,
          notes: r.notes,
          createdAt: new Date(),
          updatedAt: new Date(),
        }));
      }
    }
  }

  // Check if current user is viewing their own profile
  let isOwner = false;
  if (session) {
    const currentUser = await db.query.users.findFirst({
      where: eq(users.discordId, session.user.id),
    });
    isOwner = currentUser?.id === player.id;
  }

  // 外部サービスから統計情報を取得（エラーが発生しても空オブジェクトを返す）
  let externalStats: Awaited<ReturnType<typeof fetchAllExternalStats>> = {};
  try {
    externalStats = await fetchAllExternalStats(
      player.mcid,
      player.speedruncomUsername
    );
  } catch (error) {
    console.error("Failed to fetch external stats:", error);
  }

  // 非表示記録IDをパース
  const hiddenSpeedrunRecords: string[] = player.hiddenSpeedrunRecords
    ? JSON.parse(player.hiddenSpeedrunRecords)
    : [];

  // お気に入り状態を確認
  const cookieHeader = request.headers.get("Cookie");
  const favorites = getFavoritesFromCookie(cookieHeader);
  const isFavorited = isFavorite(favorites, mcid);

  return {
    appUrl: env.APP_URL || "https://minefolio.pages.dev",
    player: {
      ...player,
      keybindings: displayKeybindings,
      playerConfig: displayPlayerConfig,
      keyRemaps: displayKeyRemaps,
    },
    isOwner,
    externalStats,
    hiddenSpeedrunRecords,
    isFavorited,
    presets: presets.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      isActive: p.isActive,
    })),
    activePresetId,
  };
}

export default function PlayerProfilePage() {
  const { player, isOwner, externalStats, hiddenSpeedrunRecords, isFavorited, presets, activePresetId } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // プリセット選択ハンドラー
  const handlePresetChange = (presetId: string) => {
    const newParams = new URLSearchParams(searchParams);
    if (presetId === "current") {
      newParams.delete("preset");
    } else {
      newParams.set("preset", presetId);
    }
    navigate(`?${newParams.toString()}`, { preventScrollReset: true });
  };

  // 廃止されたアクションを除外
  const deprecatedActions = ["toggleHud"];

  // Group keybindings by category
  const keybindingsByCategory = player.keybindings
    .filter((kb) => !deprecatedActions.includes(kb.action))
    .reduce(
      (acc, kb) => {
        if (!acc[kb.category]) {
          acc[kb.category] = [];
        }
        acc[kb.category].push(kb);
        return acc;
      },
      {} as Record<string, typeof player.keybindings>
    );

  const categoryOrder = ["movement", "combat", "inventory", "ui"];
  const categoryLabels: Record<string, string> = {
    movement: "移動",
    combat: "戦闘",
    inventory: "インベントリ",
    ui: "UI",
  };

  // ユーザーの指割り当てをパース
  const userFingerAssignments = player.playerConfig?.fingerAssignments
    ? JSON.parse(player.playerConfig.fingerAssignments)
    : {};

  // リマップをVirtualKeyboard用の形式に変換
  const remapsForKeyboard = player.keyRemaps.map((r) => ({
    sourceKey: r.sourceKey,
    targetKey: r.targetKey,
  }));


  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // タブ項目の定義
  const tabItems = [
    { value: "stats", icon: BarChart3, label: "活動・記録" },
    { value: "keybindings", icon: Keyboard, label: "キー配置" },
    { value: "items", icon: Package, label: "アイテム配置" },
    { value: "searchcraft", icon: Search, label: "サーチクラフト" },
    { value: "devices", icon: Mouse, label: "デバイス" },
    { value: "settings", icon: Settings, label: "設定" },
  ];

  // 有効なタブ値のリスト
  const validTabs = ["profile", ...tabItems.map((t) => t.value)];

  // URLパラメータからタブを取得（無効な値はデフォルトにフォールバック）
  const tabFromUrl = searchParams.get("tab");
  const defaultTab = player.defaultProfileTab ?? "keybindings";
  const activeTab = tabFromUrl && validTabs.includes(tabFromUrl) ? tabFromUrl : defaultTab;

  // タブ変更ハンドラー（URLパラメータを更新）
  const handleTabChange = (tab: string) => {
    const newParams = new URLSearchParams(searchParams);
    if (tab === defaultTab) {
      newParams.delete("tab");
    } else {
      newParams.set("tab", tab);
    }
    navigate(`?${newParams.toString()}`, { preventScrollReset: true });
  };

  // プリセット選択を表示するタブ
  const presetTabs = ["keybindings", "devices", "settings"];
  const showPresetSelector = presets.length > 0 && presetTabs.includes(activeTab);

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange} className="flex flex-col lg:flex-row gap-6">
      {/* Mobile Menu Toggle */}
      <div className="lg:hidden">
        <Button
          variant="outline"
          className="w-full justify-between"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        >
          <div className="flex items-center gap-3">
            <Suspense fallback={<div className="w-8 h-8 bg-muted rounded animate-pulse" />}>
              <MinecraftAvatar
                uuid={player.uuid}
                mcid={player.mcid}
                size={32}
                className="rounded"
              />
            </Suspense>
            <div className="text-left">
              <p className="font-medium text-sm">{player.displayName ?? player.mcid}</p>
              <p className="text-xs text-muted-foreground">@{player.mcid}</p>
            </div>
          </div>
          {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
        </Button>

        {/* Mobile Menu Dropdown */}
        {mobileMenuOpen && (
          <div className="mt-2 p-2 border rounded-lg bg-background space-y-1">
            <TabsList className="flex flex-col h-auto w-full bg-transparent gap-1">
              {/* Profile Tab */}
              <TabsTrigger
                value="profile"
                className="w-full justify-start gap-3 px-3 py-2 data-[state=active]:bg-secondary"
                onClick={() => setMobileMenuOpen(false)}
              >
                <User className="h-4 w-4 shrink-0" />
                <span>プロフィール</span>
              </TabsTrigger>
              {tabItems.map((item) => (
                <TabsTrigger
                  key={item.value}
                  value={item.value}
                  className="w-full justify-start gap-3 px-3 py-2 data-[state=active]:bg-secondary"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  <span>{item.label}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
        )}
      </div>

      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-56 shrink-0">
        <div className="sticky top-20 space-y-4">
          <TabsList className="flex flex-col h-auto w-full bg-transparent gap-1">
            {/* Profile Tab with Avatar */}
            <TabsTrigger
              value="profile"
              className="w-full justify-start gap-3 px-3 py-3 h-auto data-[state=active]:bg-secondary"
            >
              <Suspense fallback={<div className="w-10 h-10 bg-muted rounded animate-pulse" />}>
                <MinecraftAvatar
                  uuid={player.uuid}
                  mcid={player.mcid}
                  size={40}
                  className="rounded shrink-0"
                />
              </Suspense>
              <div className="text-left min-w-0 flex-1">
                <p className="font-medium text-sm truncate">{player.displayName ?? player.mcid}</p>
                <p className="text-xs text-muted-foreground truncate">@{player.mcid}</p>
                {player.shortBio && (
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{player.shortBio}</p>
                )}
              </div>
            </TabsTrigger>

            <Separator className="my-2" />

            {/* Other Tabs */}
            {tabItems.map((item) => (
              <TabsTrigger
                key={item.value}
                value={item.value}
                className="w-full justify-start gap-3 px-3 py-2 data-[state=active]:bg-secondary"
              >
                <item.icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
              </TabsTrigger>
            ))}
          </TabsList>

          {/* Preset Selector in Sidebar */}
          {showPresetSelector && (
            <div className="p-3 border rounded-lg space-y-2">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Save className="h-3 w-3" />
                <span>プリセット</span>
              </div>
              <Select
                value={activePresetId ?? "current"}
                onValueChange={handlePresetChange}
              >
                <SelectTrigger className="w-full text-sm">
                  <SelectValue placeholder="現在の設定" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="current">現在の設定</SelectItem>
                  {presets.map((preset) => (
                    <SelectItem key={preset.id} value={preset.id}>
                      {preset.name}
                      {preset.isActive && " (適用中)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {activePresetId && (
                <Badge variant="secondary" className="text-xs w-full justify-center">
                  プリセット表示中
                </Badge>
              )}
            </div>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 min-w-0 space-y-6">
        {/* Mobile Preset Selector */}
        {showPresetSelector && (
          <div className="lg:hidden flex items-center gap-3 p-3 border rounded-lg">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Save className="h-4 w-4" />
              <span>プリセット:</span>
            </div>
            <Select
              value={activePresetId ?? "current"}
              onValueChange={handlePresetChange}
            >
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="現在の設定" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="current">現在の設定</SelectItem>
                {presets.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>
                    {preset.name}
                    {preset.isActive && " (適用中)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Profile Tab */}
        <TabsContent value="profile" className="space-y-4">
          {/* Header: Skin + Basic Info */}
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex flex-col sm:flex-row gap-6">
                {/* Skin */}
                <div className="flex justify-center sm:justify-start shrink-0">
                  <Suspense fallback={<SkinSkeleton width={120} height={180} />}>
                    <MinecraftFullBody
                      uuid={player.uuid}
                      mcid={player.mcid}
                      width={120}
                      height={180}
                      pose={(player.profilePose as PoseName) ?? "waving"}
                      angle={-25}
                      elevation={8}
                      zoom={0.85}
                      asImage
                    />
                  </Suspense>
                </div>

                {/* Info */}
                <div className="flex-1 space-y-4">
                  <div className="text-center sm:text-left">
                    <h1 className="text-2xl font-bold">{player.displayName ?? player.mcid}</h1>
                    <p className="text-muted-foreground">@{player.mcid}</p>
                    {player.shortBio && (
                      <p className="text-sm text-muted-foreground mt-2">{player.shortBio}</p>
                    )}
                  </div>

                  {/* Badges */}
                  <div className="flex flex-wrap gap-2 justify-center sm:justify-start">
                    {player.role && (
                      <Badge variant={player.role === "runner" ? "default" : "secondary"}>
                        {player.role === "runner" ? "走者" : "視聴者"}
                      </Badge>
                    )}
                    {player.mainEdition && (
                      <Badge variant="outline">{player.mainEdition === "java" ? "Java" : "Bedrock"}</Badge>
                    )}
                    {player.mainPlatform && (
                      <Badge variant="outline">{getPlatformLabel(player.mainPlatform)}</Badge>
                    )}
                  </div>

                  {/* Meta Info */}
                  <div className="flex flex-wrap gap-4 text-sm text-muted-foreground justify-center sm:justify-start">
                    {player.location && (
                      <span className="flex items-center gap-1">
                        <MapPin className="h-4 w-4" />
                        {player.location}
                      </span>
                    )}
                    {player.pronouns && <span>{player.pronouns}</span>}
                    <span className="flex items-center gap-1">
                      <Calendar className="h-4 w-4" />
                      {new Date(player.updatedAt).toLocaleDateString("ja-JP", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex flex-wrap gap-2 justify-center sm:justify-start">
                    {isOwner && (
                      <Button asChild size="sm">
                        <Link to="/me/edit">
                          <Pencil className="mr-2 h-4 w-4" />
                          編集
                        </Link>
                      </Button>
                    )}
                    <FavoriteButton mcid={player.mcid} isFavorite={isFavorited} />
                    <ShareButton
                      title={`${player.displayName ?? player.mcid} - Minefolio`}
                      description={player.shortBio ?? undefined}
                    />
                    <Button asChild variant="outline" size="sm">
                      <Link to={`/compare?p1=${player.mcid}`}>
                        <GitCompare className="h-4 w-4 mr-2" />
                        比較
                      </Link>
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Social Links */}
          {player.socialLinks.length > 0 && (
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-base">リンク</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 pb-4">
                <div className="flex flex-wrap gap-2">
                  {player.socialLinks.map((link) => (
                    <Button key={link.id} variant="outline" asChild className="gap-2 h-10 px-4">
                      <a href={getSocialUrl(link.platform, link.identifier)} target="_blank" rel="noopener noreferrer">
                        <SocialIcon platform={link.platform as "speedruncom" | "youtube" | "twitch" | "twitter"} />
                        <span className="font-medium">{getSocialPlatformName(link.platform)}</span>
                        <span className="text-muted-foreground">{link.identifier}</span>
                      </a>
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Bio */}
          {player.bio && (
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-base">自己紹介</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 pb-4">
                <div className="prose prose-sm dark:prose-invert max-w-none prose-headings:text-foreground prose-headings:font-bold prose-h1:text-xl prose-h1:mt-0 prose-h2:text-lg prose-p:text-muted-foreground prose-p:my-2">
                  <Markdown rehypePlugins={[rehypeSanitize]}>{player.bio}</Markdown>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Featured Video */}
          {player.featuredVideoUrl && (
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Video className="h-4 w-4" />
                  おすすめ動画
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 pb-4">
                <div className="aspect-video rounded-lg overflow-hidden bg-secondary max-w-2xl">
                  <iframe
                    className="w-full h-full"
                    src={getYouTubeEmbedUrl(player.featuredVideoUrl)}
                    title="Featured Video"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Keybindings Tab */}
        <TabsContent value="keybindings" className="space-y-4">
          {player.keybindings.length > 0 ? (
            <>
              {/* Visual Keyboard */}
              <Card>
                <CardHeader className="py-3">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                    <CardTitle className="text-base">キーボードビュー</CardTitle>
                    <FingerLegend />
                  </div>
                </CardHeader>
                <CardContent className="pt-0 pb-4">
                  <div className="flex flex-col items-start gap-4">
                    {/* メインキーボード */}
                    <div className="overflow-x-auto pb-2 w-full">
                      <VirtualKeyboard
                        layout={player.playerConfig?.keyboardLayout as "US" | "JIS" | "US_TKL" | "JIS_TKL" || "US"}
                        keybindings={keybindingsToMap(player.keybindings)}
                        fingerAssignments={userFingerAssignments}
                        remaps={remapsForKeyboard}
                        showActionLabels
                        showFingerAssignments
                        showRemaps
                        hideNumpad
                      />
                    </div>
                    {/* テンキーとマウスを横並び */}
                    <div className="flex items-start gap-6">
                      <VirtualNumpad
                        keybindings={keybindingsToMap(player.keybindings)}
                        fingerAssignments={userFingerAssignments}
                        remaps={remapsForKeyboard}
                        showActionLabels
                        showFingerAssignments
                        showRemaps
                      />
                      <VirtualMouse
                        keybindings={keybindingsToMap(player.keybindings)}
                        fingerAssignments={userFingerAssignments}
                        remaps={remapsForKeyboard}
                        showActionLabels
                        showFingerAssignments
                        showRemaps
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* List View */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {categoryOrder.map((category) => {
                  const bindings = keybindingsByCategory[category];
                  if (!bindings || bindings.length === 0) return null;

                  return (
                    <Card key={category}>
                      <CardHeader className="py-2">
                        <CardTitle className={`text-base font-semibold ${getCategoryColorClass(category)}`}>
                          {categoryLabels[category]}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="pt-0 pb-3">
                        <div className="divide-y">
                          {bindings.map((kb) => (
                            <div
                              key={kb.id}
                              className="flex justify-between items-center py-2.5"
                            >
                              <span className="text-sm">{getActionLabel(kb.action)}</span>
                              <kbd className="px-2.5 py-1 bg-secondary/80 rounded text-sm font-mono min-w-16 text-center">
                                {getKeyLabel(kb.keyCode)}
                              </kbd>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </>
          ) : (
            <EmptyState
              icon={<Keyboard className="h-12 w-12" />}
              title="キー配置が未設定"
              description="このプレイヤーはまだキー配置を設定していません。"
            />
          )}
        </TabsContent>

        {/* Stats Tab */}
        <TabsContent value="stats" className="space-y-4">
          {/* MCSR Ranked Section */}
          {externalStats.ranked?.isRegistered && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Swords className="h-5 w-5" />
                  MCSR Ranked
                </CardTitle>
                <CardDescription>
                  Ranked対戦の統計情報
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {externalStats.ranked.user?.eloRate && (
                    <div className="text-center p-3 bg-secondary/50 rounded-lg">
                      <p className="text-2xl font-bold">{externalStats.ranked.user.eloRate}</p>
                      <p className="text-xs text-muted-foreground">Elo レート</p>
                    </div>
                  )}
                  {externalStats.ranked.user?.eloRank && (
                    <div className="text-center p-3 bg-secondary/50 rounded-lg">
                      <p className="text-2xl font-bold">#{externalStats.ranked.user.eloRank}</p>
                      <p className="text-xs text-muted-foreground">ランキング</p>
                    </div>
                  )}
                  {externalStats.ranked.seasonData && (
                    <>
                      <div className="text-center p-3 bg-secondary/50 rounded-lg">
                        <p className="text-2xl font-bold">
                          {externalStats.ranked.seasonData.records.win}W - {externalStats.ranked.seasonData.records.lose}L
                        </p>
                        <p className="text-xs text-muted-foreground">今シーズン戦績</p>
                      </div>
                    </>
                  )}
                </div>

                {/* PB表示（全期間 / 今シーズン） */}
                {externalStats.ranked.seasonData && (
                  typeof externalStats.ranked.seasonData.bestTimeAllTime === "number" ||
                  typeof externalStats.ranked.seasonData.bestTime === "number"
                ) ? (
                  <div className="grid grid-cols-2 gap-4">
                    {typeof externalStats.ranked.seasonData.bestTimeAllTime === "number" && (
                      <div className="p-3 bg-secondary/30 rounded-lg">
                        <p className="text-xs text-muted-foreground mb-1">全期間 PB</p>
                        <p className="text-xl font-mono font-bold">
                          {formatTime(externalStats.ranked.seasonData.bestTimeAllTime)}
                        </p>
                      </div>
                    )}
                    {typeof externalStats.ranked.seasonData.bestTime === "number" && (
                      <div className="p-3 bg-secondary/30 rounded-lg">
                        <p className="text-xs text-muted-foreground mb-1">今シーズン PB</p>
                        <p className="text-xl font-mono font-bold">
                          {formatTime(externalStats.ranked.seasonData.bestTime)}
                        </p>
                      </div>
                    )}
                  </div>
                ) : null}

                {/* Eloレートグラフ */}
                {externalStats.ranked.recentMatches.length > 1 && (
                  <EloRateGraph matches={externalStats.ranked.recentMatches} />
                )}

                {/* 最近のマッチ */}
                {externalStats.ranked.recentMatches.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-muted-foreground">最近のマッチ</h4>
                    <div className="space-y-1">
                      {externalStats.ranked.recentMatches.slice(0, 5).map((match) => (
                        <div
                          key={match.id}
                          className={cn(
                            "flex items-center justify-between p-2 rounded text-sm",
                            match.result === "win" && "bg-green-500/10",
                            match.result === "lose" && "bg-red-500/10",
                            match.result === "draw" && "bg-yellow-500/10"
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <Badge
                              variant={match.result === "win" ? "default" : match.result === "lose" ? "destructive" : "secondary"}
                              className="w-12 justify-center"
                            >
                              {match.result === "win" ? "WIN" : match.result === "lose" ? "LOSE" : "DRAW"}
                            </Badge>
                            <span>vs {match.opponentNickname}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            {match.time && (
                              <span className="font-mono text-muted-foreground">
                                {formatTime(match.time)}
                              </span>
                            )}
                            <span className={cn(
                              "font-medium",
                              match.eloChange > 0 && "text-green-500",
                              match.eloChange < 0 && "text-red-500"
                            )}>
                              {match.eloChange > 0 ? "+" : ""}{match.eloChange}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* PaceMan Section - リンクのみ */}
          {externalStats.paceman?.isRegistered && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Timer className="h-5 w-5" />
                  PaceMan Stats
                </CardTitle>
                <CardDescription>
                  ペース統計・リセット情報
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild variant="outline" className="w-full">
                  <a
                    href={`https://paceman.gg/stats/player/${encodeURIComponent(player.mcid)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="mr-2 h-4 w-4" />
                    PaceMan Statsで詳細を見る
                  </a>
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Speedrun.com Section */}
          {externalStats.speedruncom && !externalStats.speedruncom.error && externalStats.speedruncom.personalBests.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Trophy className="h-5 w-5" />
                  Speedrun.com
                </CardTitle>
                <CardDescription>
                  公式記録（Minecraft関連）
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {externalStats.speedruncom.personalBests
                    .filter((pb) => !hiddenSpeedrunRecords.includes(pb.run.id))
                    .slice(0, 6)
                    .map((pb) => (
                      <div
                        key={pb.run.id}
                        className="p-3 bg-secondary/50 rounded-lg space-y-1"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-sm truncate">
                            {pb.category?.data?.name ?? "Unknown"}
                          </span>
                          <Badge variant="outline" className="shrink-0">
                            #{pb.place}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {pb.game?.data?.names?.international ?? "Unknown Game"}
                        </p>
                        {(pb.platformName || pb.versionName) && (
                          <p className="text-xs text-muted-foreground">
                            {[pb.platformName, pb.versionName].filter(Boolean).join(" / ")}
                          </p>
                        )}
                        <p className="text-xl font-mono font-bold">
                          {formatTime(pb.run.times.primary_t * 1000)}
                        </p>
                        {pb.run.weblink && (
                          <a
                            href={pb.run.weblink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-primary hover:underline flex items-center gap-1"
                          >
                            <ExternalLink className="h-3 w-3" />
                            記録を見る
                          </a>
                        )}
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* カスタム記録 */}
          {player.categoryRecords.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Target className="h-5 w-5" />
                  カスタム記録
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {player.categoryRecords.map((record) => (
                    <RecordCard key={record.id} record={record} />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* データがない場合 */}
          {(!externalStats.ranked?.isRegistered && !externalStats.paceman?.isRegistered && !externalStats.speedruncom?.personalBests?.length && player.categoryRecords.length === 0) && (
            <EmptyState
              icon={<BarChart3 className="h-12 w-12" />}
              title="統計データなし"
              description="外部サービスからの統計データがありません。"
            />
          )}
        </TabsContent>

        {/* Item Layouts Tab */}
        <TabsContent value="items" className="space-y-4">
          {player.itemLayouts.length > 0 ? (
            <div className="space-y-4">
              {player.itemLayouts.map((layout) => (
                <ItemLayoutCard key={layout.id} layout={layout} />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<Package className="h-12 w-12" />}
              title="アイテム配置なし"
              description="このプレイヤーはまだアイテム配置を設定していません。"
            />
          )}
        </TabsContent>

        {/* Search Craft Tab */}
        <TabsContent value="searchcraft" className="space-y-4">
          {player.searchCrafts.length > 0 ? (
            <>
              {/* ゲーム言語表示 */}
              {player.playerConfig?.gameLanguage && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span>ゲーム言語:</span>
                  <Badge variant="secondary">
                    {getGameLanguageName(player.playerConfig.gameLanguage)}
                  </Badge>
                </div>
              )}
              <div className="space-y-4">
                {player.searchCrafts.map((craft) => (
                  <SearchCraftCard
                    key={craft.id}
                    craft={craft}
                    keyRemaps={player.keyRemaps}
                    fingerAssignments={userFingerAssignments}
                  />
                ))}
              </div>
            </>
          ) : (
            <EmptyState
              icon={<Search className="h-12 w-12" />}
              title="サーチクラフトなし"
              description="このプレイヤーはまだサーチクラフトを設定していません。"
            />
          )}
        </TabsContent>

        {/* Devices Tab */}
        <TabsContent value="devices" className="space-y-4">
          {player.playerConfig ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Keyboard */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Keyboard className="h-5 w-5" />
                    キーボード
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {player.playerConfig.keyboardModel && (
                    <DeviceRow
                      label="モデル"
                      value={player.playerConfig.keyboardModel}
                    />
                  )}
                  {player.playerConfig.keyboardLayout && (
                    <DeviceRow
                      label="レイアウト"
                      value={player.playerConfig.keyboardLayout}
                    />
                  )}
                  {!player.playerConfig.keyboardModel &&
                    !player.playerConfig.keyboardLayout && (
                      <p className="text-sm text-muted-foreground">
                        キーボード情報なし
                      </p>
                    )}
                </CardContent>
              </Card>

              {/* Mouse */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Mouse className="h-5 w-5" />
                    マウス
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {player.playerConfig.mouseModel && (
                    <DeviceRow
                      label="モデル"
                      value={player.playerConfig.mouseModel}
                    />
                  )}
                  {player.playerConfig.mouseDpi && (
                    <DeviceRow
                      label="DPI"
                      value={player.playerConfig.mouseDpi.toString()}
                    />
                  )}
                  {player.playerConfig.gameSensitivity && (
                    <DeviceRow
                      label="ゲーム内感度"
                      value={Math.floor(player.playerConfig.gameSensitivity * 200).toString()}
                      unit="%"
                    />
                  )}
                  {(() => {
                    const cm360 = calculateCm360(
                      player.playerConfig.mouseDpi,
                      player.playerConfig.gameSensitivity,
                      player.playerConfig.rawInput,
                      player.playerConfig.windowsSpeed,
                      player.playerConfig.windowsSpeedMultiplier
                    );
                    return cm360 != null ? (
                      <DeviceRow
                        label="振り向き"
                        value={cm360.toFixed(2)}
                        unit="cm"
                      />
                    ) : null;
                  })()}
                  {!player.playerConfig.mouseModel &&
                    !player.playerConfig.mouseDpi && (
                      <p className="text-sm text-muted-foreground">
                        マウス情報なし
                      </p>
                    )}
                </CardContent>
              </Card>
            </div>
          ) : (
            <EmptyState
              icon={<Mouse className="h-12 w-12" />}
              title="デバイス情報なし"
              description="このプレイヤーはまだデバイス設定をしていません。"
            />
          )}
        </TabsContent>

        {/* Settings Tab */}
        <TabsContent value="settings" className="space-y-4">
          {player.playerConfig ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings className="h-5 w-5" />
                  ゲーム内設定
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <SettingBadge
                    label="ダッシュ切替"
                    enabled={player.playerConfig.toggleSprint}
                  />
                  <SettingBadge
                    label="スニーク切替"
                    enabled={player.playerConfig.toggleSneak}
                  />
                  <SettingBadge
                    label="自動ジャンプ"
                    enabled={player.playerConfig.autoJump}
                  />
                  <SettingBadge
                    label="Raw Input"
                    enabled={player.playerConfig.rawInput}
                  />
                  <SettingBadge
                    label="マウス加速"
                    enabled={player.playerConfig.mouseAcceleration}
                  />
                </div>
                <div className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-4">
                  {player.playerConfig.gameLanguage && (
                    <DeviceRow
                      label="ゲーム言語"
                      value={getGameLanguageName(player.playerConfig.gameLanguage)}
                    />
                  )}
                  {player.playerConfig.fov && (
                    <DeviceRow
                      label="FOV"
                      value={player.playerConfig.fov.toString()}
                    />
                  )}
                  {player.playerConfig.guiScale !== null && player.playerConfig.guiScale !== undefined && (
                    <DeviceRow
                      label="GUIスケール"
                      value={player.playerConfig.guiScale.toString()}
                    />
                  )}
                </div>
                {player.playerConfig.notes && (
                  <div className="mt-4 p-3 bg-secondary/50 rounded-lg">
                    <p className="text-sm">{player.playerConfig.notes}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <EmptyState
              icon={<Settings className="h-12 w-12" />}
              title="設定なし"
              description="このプレイヤーはまだゲーム内設定をしていません。"
            />
          )}
        </TabsContent>
      </div>
    </Tabs>
  );
}

// Eloレートグラフコンポーネント
function EloRateGraph({ matches }: { matches: MCSRRankedMatch[] }) {
  // Eloレートが0のマッチを除外してから古い順に並べ替え（グラフ表示用）
  const validMatches = matches.filter((m) => m.eloAfter > 0);
  const sortedMatches = [...validMatches].reverse();

  if (sortedMatches.length < 2) return null;

  // Eloレートの配列を作成
  const eloHistory = sortedMatches.map((m) => m.eloAfter);
  const minElo = Math.min(...eloHistory);
  const maxElo = Math.max(...eloHistory);
  const range = maxElo - minElo || 100; // 変動がない場合のデフォルト

  // グラフのサイズ
  const width = 300;
  const height = 80;
  const padding = { top: 10, bottom: 20, left: 0, right: 0 };
  const graphWidth = width - padding.left - padding.right;
  const graphHeight = height - padding.top - padding.bottom;

  // ポイントの計算
  const points = eloHistory.map((elo, i) => {
    const x = padding.left + (i / (eloHistory.length - 1)) * graphWidth;
    const y = padding.top + graphHeight - ((elo - minElo) / range) * graphHeight;
    return { x, y, elo };
  });

  // SVGパスの作成
  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");

  // グラデーション用のエリアパス
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${height - padding.bottom} L ${padding.left} ${height - padding.bottom} Z`;

  // 最初と最後のEloの変化
  const eloChange = eloHistory[eloHistory.length - 1] - eloHistory[0];
  const isPositive = eloChange >= 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-muted-foreground">Eloレート推移（直近{sortedMatches.length}試合）</h4>
        <span className={cn(
          "text-sm font-medium",
          isPositive ? "text-green-500" : "text-red-500"
        )}>
          {isPositive ? "+" : ""}{eloChange}
        </span>
      </div>
      <div className="bg-secondary/30 rounded-lg p-3">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto"
          style={{ maxHeight: "100px" }}
        >
          {/* グラデーションの定義 */}
          <defs>
            <linearGradient id="eloGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={isPositive ? "#22c55e" : "#ef4444"} stopOpacity="0.3" />
              <stop offset="100%" stopColor={isPositive ? "#22c55e" : "#ef4444"} stopOpacity="0.05" />
            </linearGradient>
          </defs>

          {/* エリア塗りつぶし */}
          <path d={areaPath} fill="url(#eloGradient)" />

          {/* ライン */}
          <path
            d={linePath}
            fill="none"
            stroke={isPositive ? "#22c55e" : "#ef4444"}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* ポイント（最初と最後のみ） */}
          <circle
            cx={points[0].x}
            cy={points[0].y}
            r="3"
            fill={isPositive ? "#22c55e" : "#ef4444"}
          />
          <circle
            cx={points[points.length - 1].x}
            cy={points[points.length - 1].y}
            r="4"
            fill={isPositive ? "#22c55e" : "#ef4444"}
          />

          {/* 最小・最大ラベル */}
          <text
            x={padding.left}
            y={height - 4}
            fontSize="10"
            fill="currentColor"
            className="text-muted-foreground"
          >
            {eloHistory[0]}
          </text>
          <text
            x={width - padding.right}
            y={height - 4}
            fontSize="10"
            fill="currentColor"
            className="text-muted-foreground"
            textAnchor="end"
          >
            {eloHistory[eloHistory.length - 1]}
          </text>
        </svg>
      </div>
    </div>
  );
}

// mcitemsのテクスチャベースURL
const TEXTURE_BASE_URL = "/mcitems";

// アイテム名を日本語で取得するヘルパー
function getItemDisplayName(itemId: string): string {
  return getItemNameJa(itemId) || formatItemName(itemId);
}

// ゲーム言語コードから言語名を取得するマッピング
const GAME_LANGUAGE_NAMES: Record<string, string> = {
  "en_us": "English (US)",
  "en_gb": "English (UK)",
  "ja_jp": "日本語",
  "zh_cn": "简体中文",
  "zh_tw": "繁體中文",
  "ko_kr": "한국어",
  "de_de": "Deutsch",
  "fr_fr": "Français",
  "es_es": "Español (España)",
  "es_mx": "Español (México)",
  "it_it": "Italiano",
  "pt_br": "Português (Brasil)",
  "pt_pt": "Português (Portugal)",
  "ru_ru": "Русский",
  "pl_pl": "Polski",
  "nl_nl": "Nederlands",
  "sv_se": "Svenska",
  "da_dk": "Dansk",
  "no_no": "Norsk",
  "fi_fi": "Suomi",
};

function getGameLanguageName(code: string): string {
  return GAME_LANGUAGE_NAMES[code.toLowerCase()] || code;
}

// プラットフォーム表示名を取得
function getPlatformLabel(platform: string): string {
  const labels: Record<string, string> = {
    pc_windows: "PC（Windows）",
    pc_mac: "PC（Mac）",
    pc_linux: "PC（Linux）",
    switch: "Switch",
    mobile: "スマホ",
    other: "その他",
  };
  return labels[platform] || platform;
}

function ItemLayoutCard({
  layout,
}: {
  layout: {
    id: string;
    segment: string;
    slots: string;
    offhand: string | null;
    notes: string | null;
  };
}) {
  const slots = JSON.parse(layout.slots) as { slot: number; items: string[] }[];
  const offhand = layout.offhand ? JSON.parse(layout.offhand) as string[] : [];

  // スロット番号をインデックスにマップ
  const slotMap = new Map<number, string[]>();
  for (const s of slots) {
    slotMap.set(s.slot, s.items);
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">{layout.segment}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* ホットバー */}
          <div className="overflow-x-auto pb-2">
            <div className="flex items-center gap-2 w-fit">
              <div className="flex gap-1.5">
              {Array.from({ length: 9 }, (_, i) => {
                const slotNum = i + 1;
                const items = slotMap.get(slotNum) || [];
                return (
                  <div
                    key={slotNum}
                    className="w-12 h-12 rounded border bg-secondary/50 flex items-center justify-center relative"
                    title={items.map(getItemDisplayName).join(", ") || `スロット ${slotNum}`}
                  >
                    {items.length > 0 ? (
                      <>
                        <MinecraftItemIcon
                          itemId={items[0]}
                          size={36}
                          textureBaseUrl={TEXTURE_BASE_URL}
                          className="pixelated"
                        />
                        {items.length > 1 && (
                          <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-xs rounded-full w-4 h-4 flex items-center justify-center">
                            {items.length}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">{slotNum}</span>
                    )}
                  </div>
                );
              })}
            </div>
            {/* オフハンド */}
            <div className="w-px h-10 bg-border mx-1" />
            <div
              className="w-12 h-12 rounded border bg-secondary/50 flex items-center justify-center relative"
              title={offhand.map(getItemDisplayName).join(", ") || "オフハンド"}
            >
              {offhand.length > 0 ? (
                <>
                  <MinecraftItemIcon
                    itemId={offhand[0]}
                    size={36}
                    textureBaseUrl={TEXTURE_BASE_URL}
                    className="pixelated"
                  />
                  {offhand.length > 1 && (
                    <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-xs rounded-full w-4 h-4 flex items-center justify-center">
                      {offhand.length}
                    </span>
                  )}
                </>
              ) : (
                <span className="text-xs text-muted-foreground">OH</span>
              )}
            </div>
            </div>
          </div>

          {/* アイテム詳細 */}
          <div className="flex flex-wrap gap-2">
            {slots.map(({ slot, items }) => (
              <div key={slot} className="flex items-center gap-1 text-sm">
                <Badge variant="outline" className="font-mono">
                  {slot}
                </Badge>
                <span className="text-muted-foreground">:</span>
                {items.map((item, idx) => (
                  <span key={idx} className="flex items-center gap-1">
                    {idx > 0 && <span className="text-muted-foreground">/</span>}
                    <MinecraftItemIcon
                      itemId={item}
                      size={16}
                      textureBaseUrl={TEXTURE_BASE_URL}
                      className="pixelated"
                    />
                    <span className="text-xs">{getItemDisplayName(item)}</span>
                  </span>
                ))}
              </div>
            ))}
            {offhand.length > 0 && (
              <div className="flex items-center gap-1 text-sm">
                <Badge variant="outline" className="font-mono">
                  OH
                </Badge>
                <span className="text-muted-foreground">:</span>
                {offhand.map((item, idx) => (
                  <span key={idx} className="flex items-center gap-1">
                    {idx > 0 && <span className="text-muted-foreground">/</span>}
                    <MinecraftItemIcon
                      itemId={item}
                      size={16}
                      textureBaseUrl={TEXTURE_BASE_URL}
                      className="pixelated"
                    />
                    <span className="text-xs">{getItemDisplayName(item)}</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* メモ */}
          {layout.notes && (
            <p className="text-sm text-muted-foreground">{layout.notes}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// キーコードから文字を抽出するヘルパー
function keyCodeToChar(keyCode: string): string {
  // "KeyA" → "a", "Digit1" → "1", etc.
  if (keyCode.startsWith("Key")) {
    return keyCode.slice(3).toLowerCase();
  }
  if (keyCode.startsWith("Digit")) {
    return keyCode.slice(5);
  }
  // 1文字の場合はそのまま返す
  if (keyCode.length === 1) {
    return keyCode.toLowerCase();
  }
  return keyCode.toLowerCase();
}

// 文字からキーコードを生成するヘルパー
function charToKeyCode(char: string): string {
  const upper = char.toUpperCase();
  if (/^[A-Z]$/.test(upper)) {
    return `Key${upper}`;
  }
  if (/^[0-9]$/.test(char)) {
    return `Digit${char}`;
  }
  return char;
}

// 検索文字列からリマップを逆算して実際に押すキーのリストを取得
function getActualKeyInfos(
  searchStr: string,
  keyRemaps: { sourceKey: string; targetKey: string | null }[]
): { char: string; keyCode: string; isRemapped: boolean }[] {
  // targetKey の文字 → sourceKey のマップを作成（逆引き）
  const reverseRemapMap = new Map<string, string>();

  for (const remap of keyRemaps) {
    if (remap.targetKey) {
      const targetChar = keyCodeToChar(remap.targetKey);
      reverseRemapMap.set(targetChar, remap.sourceKey);
    }
  }

  // 検索文字列の各文字について、実際に押すキーの情報を取得
  const result: { char: string; keyCode: string; isRemapped: boolean }[] = [];
  for (const char of searchStr) {
    const sourceKey = reverseRemapMap.get(char.toLowerCase());
    if (sourceKey) {
      // リマップされている場合
      result.push({
        char: keyCodeToChar(sourceKey),
        keyCode: sourceKey,
        isRemapped: true,
      });
    } else {
      // リマップされていない場合
      result.push({
        char: char.toLowerCase(),
        keyCode: charToKeyCode(char),
        isRemapped: false,
      });
    }
  }
  return result;
}

// キーバッジコンポーネント
function KeyBadge({
  keyCode,
  label,
  finger,
  isRemapped,
}: {
  keyCode: string;
  label: string;
  finger?: FingerType;
  isRemapped?: boolean;
}) {
  const fingerClass = finger ? FINGER_KEY_COLORS[finger] : "";

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded border-2 font-mono font-semibold text-sm min-w-7 h-7 px-1.5",
        finger
          ? fingerClass
          : "bg-secondary/50 border-border/50 text-muted-foreground",
        isRemapped && "ring-1 ring-primary ring-offset-1"
      )}
      title={isRemapped ? `リマップ: ${getKeyLabel(keyCode)}` : getKeyLabel(keyCode)}
    >
      {label.toUpperCase()}
    </span>
  );
}

function SearchCraftCard({
  craft,
  keyRemaps,
  fingerAssignments,
}: {
  craft: {
    id: string;
    sequence: number;
    items: string;
    searchStr: string | null;
    comment: string | null;
  };
  keyRemaps: { sourceKey: string; targetKey: string | null }[];
  fingerAssignments: Record<string, FingerType[]>;
}) {
  const items = JSON.parse(craft.items) as string[];
  const keyInfos = craft.searchStr ? getActualKeyInfos(craft.searchStr, keyRemaps) : [];

  // キーコードから指割り当てを取得
  const getFingerForKey = (keyCode: string): FingerType | undefined => {
    const fingers = fingerAssignments[keyCode] || fingerAssignments[keyCode.toLowerCase()];
    return fingers?.[0];
  };

  return (
    <Card>
      <CardContent className="px-4 py-3">
        <div className="flex flex-col gap-2">
          {/* アイテム */}
          <div className="flex flex-wrap items-center gap-2">
            {items.map((itemId, idx) => (
              <div key={idx} className="flex items-center gap-2 bg-secondary/50 rounded px-3 py-1.5">
                <MinecraftItemIcon
                  itemId={itemId}
                  size={28}
                  textureBaseUrl={TEXTURE_BASE_URL}
                  className="pixelated"
                />
                <span className="text-base">{getItemDisplayName(itemId)}</span>
              </div>
            ))}
          </div>

          {/* 検索文字列と押すキー */}
          {craft.searchStr && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground shrink-0">サーチ:</span>
                <code className="bg-secondary/50 px-2 py-0.5 rounded font-mono">
                  {craft.searchStr}
                </code>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground shrink-0">入力キー:</span>
                <div className="flex items-center gap-1">
                  {keyInfos.map((info, idx) => (
                    <KeyBadge
                      key={idx}
                      keyCode={info.keyCode}
                      label={info.char}
                      finger={getFingerForKey(info.keyCode)}
                      isRemapped={info.isRemapped}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* コメント */}
          {craft.comment && (
            <p className="text-sm text-muted-foreground">{craft.comment}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function RecordCard({
  record,
}: {
  record: {
    id: string;
    category: string;
    categoryDisplayName: string;
    subcategory: string | null;
    personalBest: number | null;
    targetTime: number | null;
    achieved: boolean;
    pbVideoUrl: string | null;
    pbNotes: string | null;
  };
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-lg">
              {record.categoryDisplayName}
            </CardTitle>
            {record.subcategory && (
              <CardDescription>{record.subcategory}</CardDescription>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {record.personalBest && (
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-mono font-bold">
              {formatTime(record.personalBest)}
            </span>
            <span className="text-sm text-muted-foreground">PB</span>
          </div>
        )}
        {record.targetTime && (
          <div className="flex items-center gap-2 text-sm">
            <Target className="h-4 w-4 text-muted-foreground" />
            <span>目標: {formatTime(record.targetTime)}</span>
            {record.achieved && (
              <CheckCircle2 className="h-4 w-4 text-green-500" />
            )}
          </div>
        )}
        {record.pbVideoUrl && (
          <Button variant="outline" size="sm" asChild className="w-full mt-2">
            <a
              href={record.pbVideoUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink className="mr-2 h-4 w-4" />
              動画を見る
            </a>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function SocialIcon({
  platform,
}: {
  platform: "speedruncom" | "youtube" | "twitch" | "twitter";
}) {
  switch (platform) {
    case "youtube":
      return <Youtube className="h-5 w-5" />;
    case "twitch":
      return <Twitch className="h-5 w-5" />;
    case "twitter":
      return <Twitter className="h-5 w-5" />;
    case "speedruncom":
      return <Trophy className="h-5 w-5" />;
    default:
      return <ExternalLink className="h-5 w-5" />;
  }
}

function getSocialUrl(platform: string, identifier: string): string {
  switch (platform) {
    case "speedruncom":
      return `https://www.speedrun.com/users/${identifier}`;
    case "youtube":
      return `https://www.youtube.com/${identifier}`;
    case "twitch":
      return `https://www.twitch.tv/${identifier}`;
    case "twitter":
      return `https://x.com/${identifier}`;
    default:
      return "#";
  }
}

function getSocialPlatformName(platform: string): string {
  switch (platform) {
    case "speedruncom":
      return "Speedrun.com";
    case "youtube":
      return "YouTube";
    case "twitch":
      return "Twitch";
    case "twitter":
      return "X";
    default:
      return platform;
  }
}

function DeviceRow({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="font-medium">
        {value}
        {unit && <span className="text-sm text-muted-foreground ml-1">{unit}</span>}
      </span>
    </div>
  );
}

function SettingBadge({
  label,
  enabled,
}: {
  label: string;
  enabled: boolean | null;
}) {
  if (enabled === null) return null;

  return (
    <div className="flex items-center gap-2">
      <Badge variant={enabled ? "default" : "secondary"}>
        {enabled ? "オン" : "オフ"}
      </Badge>
      <span className="text-sm">{label}</span>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="text-center py-12 text-muted-foreground">
      <div className="mx-auto mb-4 opacity-50">{icon}</div>
      <p className="text-lg font-medium">{title}</p>
      <p className="text-sm">{description}</p>
    </div>
  );
}

function getCategoryColorClass(category: string): string {
  switch (category) {
    case "movement":
      return "text-category-movement";
    case "combat":
      return "text-category-combat";
    case "inventory":
      return "text-category-inventory";
    case "ui":
      return "text-category-ui";
    default:
      return "";
  }
}

function getYouTubeEmbedUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    let videoId: string | null = null;

    if (urlObj.hostname.includes("youtube.com")) {
      videoId = urlObj.searchParams.get("v");
    } else if (urlObj.hostname.includes("youtu.be")) {
      videoId = urlObj.pathname.slice(1);
    }

    if (videoId) {
      return `https://www.youtube.com/embed/${videoId}`;
    }
  } catch {
    // Invalid URL, return as-is
  }
  return url;
}

function SkinSkeleton({ width, height }: { width: number; height: number }) {
  return (
    <div
      style={{ width, height }}
      className="flex items-center justify-center"
    >
      <div
        style={{
          width: width * 0.3,
          height: height * 0.7,
        }}
        className="bg-muted rounded-lg animate-pulse"
      />
    </div>
  );
}
