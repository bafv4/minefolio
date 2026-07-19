import { useLoaderData, Link, useParams, useSearchParams, useRevalidator, useNavigation, type ShouldRevalidateFunctionArgs } from "react-router";
import { useState, useEffect, useMemo } from "react";
import {
  ViewToggle,
  GuideCardGrid,
  GuideListView,
  type GuideItem,
} from "@/components/guide-list-views";
import type { Route } from "./+types/profile";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getOptionalSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users, categoryRecords, keybindings, playerConfigs, socialLinks, itemLayouts, searchCrafts, keyRemaps, configPresets, customKeys, customActions, guides } from "@/lib/schema";
import { eq, asc, desc, sql } from "drizzle-orm";
import {
  fetchAllExternalStats,
  fetchMCSRRankedStats,
  checkPaceManPlayer,
  fetchSpeedrunComStats,
  type MCSRRankedMatch,
} from "@/lib/external-stats";
import {
  MinecraftItemIcon,
  formatItemName,
  getItemNameJa,
} from "@bafv4/mcitems/1.16/react";
import { MinecraftFullBody, type PoseName } from "@/components/minecraft-fullbody";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import { formatTime } from "@/lib/time-utils";
import { formatDistanceToNow } from "date-fns";
import { ja } from "date-fns/locale";
import { t } from "@/lib/messages";
import { useMediaQuery } from "@/hooks/use-media-query";
import { getGameLanguageName } from "@/lib/game-languages";
import { toUiRemaps, filterRemapsForContext, normalizeKeyRemapType, type RemapContext, type RemapInfo } from "@/lib/remap-utils";
import type { PresetSearchCraftData } from "@/lib/preset-utils";
import { SearchCraftGroupedList, KeyBadgeLegend } from "@/components/search-craft-template-view";
import { RemapTypeBadge } from "@/components/remap-type-badge";
import { RemapViewToggle } from "@/components/remap-view-toggle";

const SKIN_VIEW_SIZE_DESKTOP = { width: 240, height: 280 } as const;
const SKIN_VIEW_SIZE_MOBILE = { width: 320, height: 380 } as const;
const SKIN_VIEW_MOBILE_QUERY = "(max-width: 640px)"; // Tailwind sm 未満

// OGPメタタグ
export function meta({ loaderData, params }: Route.MetaArgs) {
  if (!loaderData?.player) {
    return [
      { title: "Player Not Found - Minefolio" },
      { name: "description", content: "Player profile not found" },
    ];
  }

  const { player } = loaderData;
  const displayName = player.displayName || player.mcid || player.slug;
  const description = player.shortBio || player.bio || `${displayName}'s Minecraft speedrunning profile`;
  // OGP画像: MCIDがある場合のみMCIDパラメータを付与
  const ogImageUrl = player.mcid
    ? `${loaderData.appUrl}/og-image?mcid=${encodeURIComponent(player.mcid)}`
    : `${loaderData.appUrl}/og-image?slug=${encodeURIComponent(player.slug)}`;
  const mentionDisplay = player.mcid ? `@${player.mcid}` : player.slug;

  return [
    { title: `${displayName} (${mentionDisplay}) - Minefolio` },
    { name: "description", content: description },

    // Open Graph
    { property: "og:type", content: "profile" },
    { property: "og:title", content: `${displayName} - Minefolio` },
    { property: "og:description", content: description },
    { property: "og:image", content: ogImageUrl },
    { property: "og:image:type", content: "image/png" },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { property: "og:url", content: `${loaderData.appUrl}/player/${player.slug}` },

    // Twitter Card
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: `${displayName} - Minefolio` },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: ogImageUrl },

    // Profile-specific meta (MCIDがある場合のみ)
    ...(player.mcid ? [{ property: "profile:username", content: player.mcid }] : []),
  ];
}

// ClientLoaderを削除し、通常のloaderのみを使用
// これにより、ナビゲーション時に即座にHydrateFallbackが表示される

// ローディング中に表示するスケルトンUI
export function HydrateFallback() {
  const params = useParams();
  const slug = params.slug || "loading";

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
import { getActionLabel, getKeyLabel, normalizeKeyCode, parseKeyCombination, MODIFIER_LABELS, UNBOUND_KEY, type FingerType } from "@/lib/keybindings";
import { VirtualKeyboard, VirtualMouse, VirtualNumpad, FingerLegend, keybindingsToMap } from "@/components/virtual-keyboard";
import { KeyboardExportDialog } from "@/components/keybindings/keyboard-export-dialog";
import { PaceManSplitMark } from "@/components/paceman-split-mark";
import { cn } from "@/lib/utils";
import Markdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
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
  ChevronsDown,
  X,
  Loader2,
  BookOpen,
  Eye,
  Maximize2,
  Languages,
} from "lucide-react";
import { ShareButton } from "@/components/share-button";
import { FavoriteButton } from "@/components/favorite-button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { getNetherEnterCount, getRecentPacesForPlayer } from "@/lib/paceman-cache";
import {
  calculateCm360,
  calculateCursorSpeed,
  WINDOWS_POINTER_MULTIPLIERS,
} from "@/lib/mouse-settings";

// タブ切替は URL の `tab` パラメータだけを更新する。タブ内容はすでに読み込み済みの
// データで描画できるため、`tab` のみの変化では loader を再実行しない（DB 再取得や
// プリセット切替オーバーレイの誤表示を防ぐ）。パス変更・preset 切替などは通常通り。
export function shouldRevalidate({
  currentUrl,
  nextUrl,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  if (
    currentUrl.pathname === nextUrl.pathname &&
    currentUrl.search !== nextUrl.search
  ) {
    const cur = new URLSearchParams(currentUrl.search);
    const next = new URLSearchParams(nextUrl.search);
    cur.delete("tab");
    next.delete("tab");
    if (cur.toString() === next.toString()) return false;
  }
  return defaultShouldRevalidate;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const env = getEnv();
  const db = createDb();
  const auth = createAuth(db, env);
  const session = await getOptionalSession(request, auth);

  const { slug } = params;
  const url = new URL(request.url);
  const presetId = url.searchParams.get("preset");
  const normalizedSlug = slug?.toLowerCase();

  // Fetch player with all related data (slugで検索)
  const player = await db.query.users.findFirst({
    where: normalizedSlug
      ? sql`lower(${users.slug}) = ${normalizedSlug}`
      : sql`0 = 1`,
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
      customKeys: {
        orderBy: [asc(customKeys.category), asc(customKeys.keyName)],
      },
      customActions: {
        orderBy: [asc(customActions.displayOrder), asc(customActions.actionName)],
      },
    },
  });

  if (!player) {
    throw new Response(t("playerProfile.notFound"), { status: 404 });
  }

  // プライベートプロフィールは本人以外に404を返す
  if (
    player.profileVisibility === "private" &&
    session?.user?.id !== player.discordId
  ) {
    throw new Response(t("playerProfile.notFound"), { status: 404 });
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
      itemLayoutsData: true,
      searchCraftsData: true,
      customKeysData: true,
      customActionsData: true,
    },
  });

  // 選択されたプリセットのデータを適用
  let activePresetId: string | null = null;
  let displayKeybindings = player.keybindings;
  let displayPlayerConfig = player.playerConfig;
  let displayKeyRemaps = player.keyRemaps;
  let displayItemLayouts = player.itemLayouts;
  let displaySearchCrafts = player.searchCrafts;
  let displayCustomKeys = player.customKeys;
  let displayCustomActions = player.customActions;

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

      // プリセットの走者設定を適用
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
          outputMode?: "key" | "character" | null;
          outputCharacter?: string | null;
          remapType?: string | null;
        }>;
        displayKeyRemaps = presetRemaps.map((r, idx) => ({
          id: `preset-remap-${idx}`,
          userId: player.id,
          sourceKey: r.sourceKey,
          targetKey: r.targetKey,
          software: r.software,
          notes: r.notes,
          outputMode: r.outputMode ?? "key",
          outputCharacter: r.outputCharacter ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
          remapType: normalizeKeyRemapType(r.remapType),
        }));
      }

      // プリセットのアイテム配置を適用
      if (selectedPreset.itemLayoutsData) {
        const presetItemLayouts = JSON.parse(selectedPreset.itemLayoutsData) as Array<{
          segment: string;
          slots: string;
          offhand: string | null;
          notes: string | null;
          displayOrder: number;
        }>;
        displayItemLayouts = presetItemLayouts.map((layout, idx) => ({
          id: `preset-layout-${idx}`,
          userId: player.id,
          segment: layout.segment,
          slots: layout.slots,
          offhand: layout.offhand,
          notes: layout.notes,
          displayOrder: layout.displayOrder,
          createdAt: new Date(),
          updatedAt: new Date(),
        }));
      }

      // プリセットのサーチクラフトを適用
      if (selectedPreset.searchCraftsData) {
        const presetSearchCrafts = JSON.parse(
          selectedPreset.searchCraftsData,
        ) as PresetSearchCraftData[];
        displaySearchCrafts = presetSearchCrafts.map((craft, idx) => ({
          id: `preset-craft-${idx}`,
          userId: player.id,
          sequence: craft.sequence,
          items: craft.items,
          keys: craft.keys,
          searchStr: craft.searchStr,
          comment: craft.comment,
          timing: craft.timing ?? null,
          withShift: craft.withShift === true,
          createdAt: new Date(),
          updatedAt: new Date(),
        }));
      }

      // プリセットのカスタムキー定義を適用
      if (selectedPreset.customKeysData) {
        const presetCustomKeys = JSON.parse(selectedPreset.customKeysData) as Array<{
          keyCode: string;
          keyName: string;
          category: "mouse" | "keyboard" | "controller";
          position: string | null;
          size: string | null;
          notes: string | null;
        }>;
        displayCustomKeys = presetCustomKeys.map((ck, idx) => ({
          id: `preset-customkey-${idx}`,
          userId: player.id,
          keyCode: ck.keyCode,
          keyName: ck.keyName,
          category: ck.category,
          position: ck.position,
          size: ck.size,
          notes: ck.notes,
          createdAt: new Date(),
          updatedAt: new Date(),
        }));
      }

      // プリセットのカスタムアクションを適用
      if (selectedPreset.customActionsData) {
        const presetCustomActions = JSON.parse(selectedPreset.customActionsData) as Array<{
          actionName: string;
          description: string | null;
          category: "other" | "macro" | "tool";
          triggerKey: string;
          displayOrder: number;
        }>;
        displayCustomActions = presetCustomActions.map((ca, idx) => ({
          id: `preset-customaction-${idx}`,
          userId: player.id,
          actionName: ca.actionName,
          description: ca.description,
          category: ca.category,
          triggerKey: ca.triggerKey,
          displayOrder: ca.displayOrder,
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

  // プレイヤーの公開ガイドを取得
  const playerGuides = await db.query.guides.findMany({
    where: (g, { and, eq }) => and(eq(g.authorId, player.id), eq(g.isPublished, true)),
    orderBy: [desc(guides.updatedAt)],
    columns: {
      id: true,
      slug: true,
      title: true,
      summary: true,
      tags: true,
      coverImageUrl: true,
      viewCount: true,
      updatedAt: true,
    },
  });

  // 非表示記録IDをパース
  const hiddenSpeedrunRecords: string[] = player.hiddenSpeedrunRecords
    ? JSON.parse(player.hiddenSpeedrunRecords)
    : [];

  // PaceManの統計情報を取得（MCIDがある場合のみ）
  let pacemanStats = null;
  if (player.mcid) {
    try {
      const [netherEnterCount, mainPaces] = await Promise.all([
        getNetherEnterCount(player.mcid),
        getRecentPacesForPlayer(player.mcid, 10),
      ]);
      pacemanStats = {
        netherEnterCount,
        mainPaces,
      };
    } catch (error) {
      console.error("Failed to fetch PaceMan stats:", error);
    }
  }

  // 外部APIは呼び出さず、クライアント側で取得する
  return {
    appUrl: env.APP_URL || "https://minefolio.app",
    player: {
      ...player,
      keybindings: displayKeybindings,
      playerConfig: displayPlayerConfig,
      keyRemaps: displayKeyRemaps,
      itemLayouts: displayItemLayouts,
      searchCrafts: displaySearchCrafts,
      customKeys: displayCustomKeys,
      customActions: displayCustomActions,
    },
    isOwner,
    hiddenSpeedrunRecords,
    pacemanStats,
    presets: presets.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      isActive: p.isActive,
      hasItemLayouts: !!p.itemLayoutsData,
      hasSearchCrafts: !!p.searchCraftsData,
    })),
    activePresetId,
    playerGuides,
  };
}

export default function PlayerProfilePage() {
  const { player, isOwner, hiddenSpeedrunRecords, pacemanStats, presets, activePresetId, playerGuides } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const revalidator = useRevalidator();
  const navigation = useNavigation();
  const [skin3dOpen, setSkin3dOpen] = useState(false);

  // プリセット切替中のローディング状態（URL変更によるナビゲーション or 明示的な再検証）
  const isSwitchingPreset = navigation.state === "loading" || revalidator.state === "loading";

  // プリセット選択ハンドラー
  const handlePresetChange = (presetId: string) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (presetId === "current") {
          next.delete("preset");
        } else {
          next.set("preset", presetId);
        }
        return next;
      },
      { preventScrollReset: true, replace: true },
    );
    // 明示的に loader を再実行（クエリ変更だけでは再検証されないケースの保険）
    revalidator.revalidate();
  };

  // 廃止されたアクションを除外
  const deprecatedActions = ["toggleHud"];

  // アクション → キーバインドの逆引きマップ（表示順を明示的に制御するため）
  const keybindingsByAction = new Map(
    player.keybindings
      .filter((kb) => !deprecatedActions.includes(kb.action))
      .map((kb) => [kb.action, kb] as const)
  );

  // カスタムキーの keyCode → 表示名（keyName）の解決マップ。
  // リマップやカスタムアクションが "0x05" のような非標準キーコードを参照しているとき、
  // 生のキーコードではなくユーザー登録名を優先表示するために使う。
  const customKeyLabelByCode = new Map<string, string>(
    player.customKeys.map((ck) => [normalizeKeyCode(ck.keyCode), ck.keyName])
  );
  const resolveKeyLabel = (keyCode: string): string => {
    const customLabel = customKeyLabelByCode.get(normalizeKeyCode(keyCode));
    if (customLabel) return customLabel;
    return getKeyLabel(keyCode);
  };
  const resolveKeyCombinationLabel = (combo: string): string => {
    if (!combo || combo === UNBOUND_KEY) return resolveKeyLabel(combo);
    const parsed = parseKeyCombination(combo);
    const keyLabel = resolveKeyLabel(parsed.keyCode);
    if (parsed.modifiers.length === 0) return keyLabel;
    const modifierLabels = parsed.modifiers.map((m) => MODIFIER_LABELS[m]);
    return [...modifierLabels, keyLabel].join("+");
  };
  // 同時押しを別 chip で並べるためのラベル配列ヘルパー
  const resolveKeyCombinationChips = (combo: string): string[] => {
    if (!combo || combo === UNBOUND_KEY) return [resolveKeyLabel(combo)];
    const parsed = parseKeyCombination(combo);
    const modifierLabels = parsed.modifiers.map((m) => MODIFIER_LABELS[m]);
    return [...modifierLabels, resolveKeyLabel(parsed.keyCode)];
  };

  // List View の表示グループ定義（要件: 移動 → インベントリ → 戦闘・UI）
  type KeybindingDisplayGroup = {
    key: string;
    label: string;
    colorClass: string;
    actions: string[];
  };
  const keybindingDisplayGroups: KeybindingDisplayGroup[] = [
    {
      key: "movement",
      label: t("playerProfile.movement"),
      colorClass: getCategoryColorClass("movement"),
      actions: ["forward", "back", "left", "right", "jump", "sneak", "sprint"],
    },
    {
      key: "inventory",
      label: t("playerProfile.inventory"),
      colorClass: getCategoryColorClass("inventory"),
      actions: [
        "hotbar1", "hotbar2", "hotbar3", "hotbar4", "hotbar5",
        "hotbar6", "hotbar7", "hotbar8", "hotbar9",
        "swapHands", "inventory", "pickBlock", "drop",
      ],
    },
    {
      key: "combat-ui",
      label: t("playerProfile.combatAndUi"),
      colorClass: getCategoryColorClass("combat"),
      actions: ["attack", "use", "togglePerspective", "chat", "command", "fullscreen"],
    },
  ];

  // ユーザーの指割り当てをパース（不正な JSON でも描画を壊さない）
  const userFingerAssignments = (() => {
    if (!player.playerConfig?.fingerAssignments) return {};
    try {
      return JSON.parse(player.playerConfig.fingerAssignments);
    } catch {
      return {};
    }
  })();

  // 仮想キーボードの Trigger/Chat 表示切替。種別付きリマップがある場合のみ切替UIを出す
  // （all/unset のみなら両文脈で表示が同一のため "trigger" 固定でよい）
  const [remapView, setRemapView] = useState<RemapContext>("trigger");
  // 別プレイヤーへ遷移してもルートコンポーネントは再利用されるため、表示を Trigger に戻す
  useEffect(() => {
    setRemapView("trigger");
  }, [player.id]);
  const hasTypedRemaps = useMemo(
    () => player.keyRemaps.some((r) => r.remapType === "trigger" || r.remapType === "chat"),
    [player.keyRemaps],
  );

  // リマップを表示文脈で絞り込み、表示用形式に変換（disabled/characterの扱いを統一）
  const remapsForKeyboard = useMemo(
    () => toUiRemaps(filterRemapsForContext(player.keyRemaps, remapView)),
    [player.keyRemaps, remapView],
  );

  // キーボードレイアウト判定
  const keyboardLayout = (player.playerConfig?.keyboardLayout || "US") as "US" | "JIS" | "US_TKL" | "JIS_TKL";
  const isTKL = keyboardLayout === "US_TKL" || keyboardLayout === "JIS_TKL";


  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [guidesViewMode, setGuidesViewMode] = useState<"card" | "list">("card");

  // スキン3Dビューワのサイズ（モバイルでは大きめに）
  const isMobileSkinView = useMediaQuery(SKIN_VIEW_MOBILE_QUERY);
  const skinViewSize = isMobileSkinView ? SKIN_VIEW_SIZE_MOBILE : SKIN_VIEW_SIZE_DESKTOP;

  // タブ項目の定義（編集画面のメニュー順に合わせる）
  const tabItems = [
    { value: "stats", icon: BarChart3, label: t("playerProfile.activityAndStats") },
    { value: "keybindings", icon: Keyboard, label: t("playerProfile.keybindingsTab") },
    { value: "devices", icon: Mouse, label: t("playerProfile.devicesTab") },
    { value: "items", icon: Package, label: t("playerProfile.itemLayoutsTab") },
    { value: "searchcraft", icon: Search, label: t("playerProfile.searchCraftTab") },
    { value: "guides", icon: BookOpen, label: "ガイド" },
  ];

  // 有効なタブ値のリスト
  const validTabs = ["profile", ...tabItems.map((t) => t.value)];

  // URLパラメータ `tab` を唯一の指定元とする（共有・ブックマーク・戻る/進むに対応）。
  // 不正値や未指定時は defaultProfileTab にフォールバック。
  const tabFromUrl = searchParams.get("tab");
  const defaultTab = player.defaultProfileTab ?? "keybindings";
  const resolvedTab = tabFromUrl && validTabs.includes(tabFromUrl) ? tabFromUrl : defaultTab;

  // 描画はローカル状態で即時反映しつつ、URL（戻る/進む等）の変化に追従させる。
  const [activeTab, setActiveTab] = useState(resolvedTab);
  useEffect(() => {
    setActiveTab(resolvedTab);
  }, [resolvedTab]);

  // タブ変更ハンドラー: 即時にローカル反映し、URL の `tab` パラメータも更新する。
  // （`shouldRevalidate` により loader は再実行されない）
  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("tab", tab);
        return next;
      },
      { preventScrollReset: true, replace: true },
    );
  };

  // プリセット選択を表示するタブ
  const presetTabs = ["keybindings", "devices", "items", "searchcraft"];
  const showPresetSelector = presets.length > 0 && presetTabs.includes(activeTab);

  return (
    <>
    {/* Mobile Menu Toggle — extracted outside Tabs for reliable sticky behavior */}
    <div className="lg:hidden sticky top-16 z-30 -mx-4 sm:-mx-6 px-4 sm:px-6 pb-2 pt-2 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b border-border/40">
      <Button
        variant="outline"
        className="w-full justify-between h-14 py-3 touch-manipulation"
        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
      >
        <div className="flex items-center gap-3">
          {player.uuid ? (
            <MinecraftAvatar
              uuid={player.uuid}
              skinUrl={player.customSkinUrl}
              mcid={player.mcid}
              size={32}
              className="rounded"
            />
          ) : player.discordAvatar ? (
            <img
              src={player.discordAvatar}
              alt={player.displayName ?? "Avatar"}
              className="w-8 h-8 rounded"
            />
          ) : (
            <div className="w-8 h-8 bg-muted rounded" />
          )}
          <div className="text-left">
            <p className="font-medium text-sm">{player.displayName ?? player.mcid ?? player.slug}</p>
            {player.mcid && <p className="text-xs text-muted-foreground">@{player.mcid}</p>}
          </div>
        </div>
        {mobileMenuOpen ? <X className="h-4 w-4" /> : <ChevronsDown className="h-4 w-4" />}
      </Button>

      {/* Mobile Menu Dropdown */}
      {mobileMenuOpen && (
        <div className="mt-2 p-2 border rounded-xl bg-background space-y-1">
          <button
            className={cn("flex items-center w-full gap-3 px-3 py-2 rounded-md text-sm transition-colors", activeTab === "profile" ? "bg-secondary font-medium" : "hover:bg-muted")}
            onClick={() => { handleTabChange("profile"); setMobileMenuOpen(false); }}
          >
            <User className="h-4 w-4 shrink-0" />
            <span>{t("playerProfile.profile")}</span>
          </button>
          {tabItems.map((item) => (
            <button
              key={item.value}
              className={cn("flex items-center w-full gap-3 px-3 py-2 rounded-md text-sm transition-colors", activeTab === item.value ? "bg-secondary font-medium" : "hover:bg-muted")}
              onClick={() => { handleTabChange(item.value); setMobileMenuOpen(false); }}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>

    <Tabs value={activeTab} onValueChange={handleTabChange} className="flex flex-col lg:flex-row gap-6">

      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-56 shrink-0">
        <div className="sticky top-20 space-y-4">
          <TabsList className="flex flex-col h-auto w-full bg-transparent gap-1">
            {/* Profile Tab with Avatar */}
            <TabsTrigger
              value="profile"
              className="w-full justify-start gap-3 px-3 py-3 h-auto data-[state=active]:bg-secondary"
            >
              {player.uuid ? (
                <MinecraftAvatar
                  uuid={player.uuid}
                  skinUrl={player.customSkinUrl}
                  mcid={player.mcid}
                  size={40}
                  className="rounded shrink-0"
                />
              ) : player.discordAvatar ? (
                <img
                  src={player.discordAvatar}
                  alt={player.displayName ?? "Avatar"}
                  className="w-10 h-10 rounded shrink-0"
                />
              ) : (
                <div className="w-10 h-10 bg-muted rounded shrink-0" />
              )}
              <div className="text-left min-w-0 flex-1">
                <p className="font-medium text-sm truncate">{player.displayName ?? player.mcid ?? player.slug}</p>
                {player.mcid && <p className="text-xs text-muted-foreground truncate">@{player.mcid}</p>}
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
                <span>{t("playerProfile.preset")}</span>
              </div>
              <Select
                value={activePresetId ?? "current"}
                onValueChange={handlePresetChange}
              >
                <SelectTrigger className="w-full text-sm">
                  <SelectValue placeholder={t("playerProfile.currentSetting")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="current">{t("playerProfile.currentSetting")}</SelectItem>
                  {presets.map((preset) => (
                    <SelectItem key={preset.id} value={preset.id}>
                      {preset.name}
                      {preset.isActive && t("playerProfile.presetAppliedSuffix")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {activePresetId && (
                <Badge variant="secondary" className="text-xs w-full justify-center">
                  {t("playerProfile.presetViewing")}
                </Badge>
              )}
            </div>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 min-w-0 space-y-6 relative">
        {/* プリセット切替中のオーバーレイ（メインコンテンツ全体を覆う） */}
        {isSwitchingPreset && (
          <div
            className="absolute inset-0 z-30 flex items-start justify-center rounded-lg bg-background/70 backdrop-blur-sm"
            aria-live="polite"
            aria-busy="true"
          >
            <div className="sticky top-32 mt-8 flex items-center gap-3 rounded-full border bg-card px-4 py-2 shadow-md">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span className="text-sm font-medium">{t("playerProfile.presetLoading")}</span>
            </div>
          </div>
        )}

        {/* Mobile Preset Selector */}
        {showPresetSelector && (
          <div className="lg:hidden flex items-center gap-3 p-3 border rounded-lg">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Save className="h-4 w-4" />
              <span>{t("playerProfile.presetWithColon")}</span>
            </div>
            <Select
              value={activePresetId ?? "current"}
              onValueChange={handlePresetChange}
            >
              <SelectTrigger className="flex-1">
                <SelectValue placeholder={t("playerProfile.currentSetting")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="current">{t("playerProfile.currentSetting")}</SelectItem>
                {presets.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>
                    {preset.name}
                    {preset.isActive && t("playerProfile.presetAppliedSuffix")}
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
              <div className="flex flex-col sm:flex-row sm:items-center gap-6">
                {/* Skin - only show when uuid exists */}
                {player.uuid && (() => {
                  // 静止画と interactive で共通の MinecraftFullBody プロパティ
                  const skinProps = {
                    uuid: player.uuid,
                    skinUrl: player.customSkinUrl ?? undefined,
                    mcid: player.mcid ?? undefined,
                    pose: (player.profilePose as PoseName) ?? "waving",
                    slim:
                      player.customSkinModel === "slim" || player.slimSkin || false,
                    angle: -35,
                    elevation: 5,
                    zoom: 0.9,
                  };
                  const modalSize = { width: 360, height: 480 };
                  return (
                    <div className="flex justify-center sm:justify-start shrink-0">
                      <Dialog open={skin3dOpen} onOpenChange={setSkin3dOpen}>
                        <DialogTrigger asChild>
                          <button
                            type="button"
                            aria-label="スキンを 3D で表示"
                            className="group relative rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {/* ページ上は静止画。WebGL を常駐させない（仕様 3.3） */}
                            <MinecraftFullBody
                              {...skinProps}
                              width={skinViewSize.width}
                              height={skinViewSize.height}
                              asImage
                            />
                            <div className="absolute inset-0 flex items-center justify-center rounded-md bg-background/40 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity">
                              <Maximize2
                                className="h-8 w-8 text-foreground drop-shadow"
                                aria-hidden
                              />
                            </div>
                          </button>
                        </DialogTrigger>
                        <DialogContent className="max-w-2xl">
                          <DialogHeader>
                            <DialogTitle>
                              {player.displayName ?? player.mcid ?? player.slug} のスキン
                            </DialogTitle>
                          </DialogHeader>
                          {/* open のときのみ interactive 版をマウント → 閉じたら WebGL を解放 */}
                          {skin3dOpen && (
                            <div className="flex justify-center">
                              <MinecraftFullBody
                                {...skinProps}
                                {...modalSize}
                                interactive
                                showInteractiveHint
                              />
                            </div>
                          )}
                        </DialogContent>
                      </Dialog>
                    </div>
                  );
                })()}

                {/* Info */}
                <div className="flex-1 space-y-4">
                  <div className="text-center sm:text-left">
                    <h1 className="text-2xl font-bold">{player.displayName ?? player.mcid ?? player.slug}</h1>
                    {player.mcid && <p className="text-muted-foreground">@{player.mcid}</p>}
                    {player.shortBio && (
                      <p className="text-sm text-muted-foreground mt-2">{player.shortBio}</p>
                    )}
                  </div>

                  {/* Badges */}
                  <div className="flex flex-wrap gap-2 justify-center sm:justify-start">
                    {player.role && (
                      <Badge variant={player.role === "runner" ? "default" : "secondary"}>
                        {player.role === "runner" ? t("common.runner") : t("common.viewer")}
                      </Badge>
                    )}
                    {player.mainEdition && (
                      <Badge variant="outline">{player.mainEdition === "java" ? "Java" : "Bedrock"}</Badge>
                    )}
                    {player.mainPlatform && (
                      <Badge variant="outline">{getPlatformLabel(player.mainPlatform)}</Badge>
                    )}
                    {player.inputMethodBadge && (
                      <Badge variant="outline">
                        {player.inputMethodBadge === "keyboard_mouse" && "KBM"}
                        {player.inputMethodBadge === "controller" && "Controller"}
                        {player.inputMethodBadge === "touch" && "Touch"}
                      </Badge>
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
                          {t("playerProfile.edit")}
                        </Link>
                      </Button>
                    )}
                    <FavoriteButton slug={player.slug} />
                    <ShareButton
                      title={`${player.displayName ?? player.mcid ?? player.slug} - Minefolio`}
                      description={player.shortBio ?? undefined}
                      includeTab={true}
                    />
                    <Button asChild variant="outline" size="sm">
                      <Link to={`/compare?p1=${player.slug}`}>
                        <GitCompare className="h-4 w-4 mr-2" />
                        {t("playerProfile.compare")}
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
                <CardTitle className="text-base">{t("playerProfile.links")}</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 pb-4">
                <div className="flex flex-wrap gap-2">
                  {player.socialLinks.map((link) => (
                    <Button key={link.id} variant="outline" asChild className="gap-2 h-10 px-4">
                      <a href={getSocialUrl(link.platform, link.identifier, link.customUrl)} target="_blank" rel="noopener noreferrer">
                        <SocialIcon platform={link.platform} />
                        <span className="font-medium">{getSocialPlatformName(link.platform, link.customLabel)}</span>
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
                <CardTitle className="text-base">{t("playerProfile.bio")}</CardTitle>
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
                  {t("playerProfile.featuredVideo")}
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
                    <CardTitle className="text-base">{t("playerProfile.keyboardView")}</CardTitle>
                    <div className="flex flex-wrap items-center gap-3">
                      {/* Trigger/Chat 表示切替（種別付きリマップがある場合のみ） */}
                      {hasTypedRemaps && (
                        <RemapViewToggle value={remapView} onChange={setRemapView} />
                      )}
                      <FingerLegend />
                      <KeyboardExportDialog
                        layout={keyboardLayout}
                        keybindings={player.keybindings}
                        fingerAssignments={userFingerAssignments}
                        remaps={remapsForKeyboard}
                        customKeys={player.customKeys
                          .filter((ck) => ck.category === "keyboard")
                          .map((ck) => ({ code: ck.keyCode, label: ck.keyName }))}
                        customButtons={player.customKeys.map((ck) => ({
                          code: ck.keyCode,
                          label: ck.keyName,
                          category: ck.category as "mouse" | "keyboard",
                        }))}
                        isTKL={isTKL}
                        player={{
                          uuid: player.uuid,
                          skinUrl: player.customSkinUrl,
                          mcid: player.mcid,
                          displayName: player.displayName,
                          slug: player.slug,
                        }}
                      />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 pb-4">
                  <div className="flex flex-col items-start gap-4">
                    {/* メインキーボード */}
                    <div className="overflow-x-auto pb-2 w-full">
                      <VirtualKeyboard
                        layout={keyboardLayout}
                        keybindings={keybindingsToMap(player.keybindings)}
                        fingerAssignments={userFingerAssignments}
                        remaps={remapsForKeyboard}
                        customActions={player.customActions}
                        customKeys={player.customKeys
                          .filter((ck) => ck.category === "keyboard")
                          .map((ck) => ({ code: ck.keyCode, label: ck.keyName }))}
                        showActionLabels
                        showFingerAssignments
                        showRemaps
                        hideNumpad
                      />
                    </div>
                    {/* テンキーとマウスを横並び */}
                    <div className="overflow-x-auto pb-2 w-full">
                      <div className="flex items-start gap-6">
                        {!isTKL && (
                          <VirtualNumpad
                            keybindings={keybindingsToMap(player.keybindings)}
                            fingerAssignments={userFingerAssignments}
                            remaps={remapsForKeyboard}
                            customActions={player.customActions}
                            showActionLabels
                            showFingerAssignments
                            showRemaps
                          />
                        )}
                        <VirtualMouse
                          keybindings={keybindingsToMap(player.keybindings)}
                          fingerAssignments={userFingerAssignments}
                          remaps={remapsForKeyboard}
                          customActions={player.customActions}
                          customButtons={player.customKeys.map((ck) => ({
                            code: ck.keyCode,
                            label: ck.keyName,
                            category: ck.category as "mouse" | "keyboard",
                          }))}
                          showActionLabels
                          showFingerAssignments
                          showRemaps
                        />
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* List View */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {keybindingDisplayGroups.map((group) => {
                  const bindings = group.actions
                    .map((action) => keybindingsByAction.get(action))
                    .filter((kb): kb is NonNullable<typeof kb> => kb !== undefined);
                  if (bindings.length === 0) return null;

                  return (
                    <Card key={group.key}>
                      <CardHeader className="py-2">
                        <CardTitle className={`text-base font-semibold ${group.colorClass}`}>
                          {group.label}
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
                                {resolveKeyLabel(kb.keyCode)}
                              </kbd>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}

                {/* カスタムアクション（登録されている場合のみ） */}
                {player.customActions.length > 0 && (
                  <Card>
                    <CardHeader className="py-2">
                      <CardTitle className="text-base font-semibold">
                        {t("playerProfile.customActions")}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0 pb-3">
                      <div className="divide-y">
                        {player.customActions.map((ca) => {
                          const chips = resolveKeyCombinationChips(ca.triggerKey);
                          return (
                            <div
                              key={ca.id}
                              className="flex justify-between items-center gap-3 py-2.5"
                            >
                              <span className="text-sm">{ca.actionName}</span>
                              <div className="flex items-center gap-1">
                                {chips.map((label, i) => (
                                  <span key={i} className="flex items-center gap-1">
                                    {i > 0 && (
                                      <span className="text-muted-foreground text-xs">+</span>
                                    )}
                                    <kbd className="px-2.5 py-1 bg-secondary/80 rounded text-sm font-mono min-w-12 text-center">
                                      {label}
                                    </kbd>
                                  </span>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* リマップ（登録されている場合のみ） */}
                {player.keyRemaps.length > 0 && (
                  <Card>
                    <CardHeader className="py-2">
                      <CardTitle className="text-base font-semibold">
                        {t("playerProfile.remaps")}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0 pb-3">
                      <div className="divide-y">
                        {player.keyRemaps.map((remap) => {
                          const sourceChips = resolveKeyCombinationChips(remap.sourceKey);
                          const targetChips =
                            remap.outputMode === "character" && remap.outputCharacter
                              ? [remap.outputCharacter]
                              : remap.targetKey
                              ? resolveKeyCombinationChips(remap.targetKey)
                              : ["-"];
                          const renderChipGroup = (
                            chips: string[],
                            justify: "start" | "end",
                          ) => (
                            <div
                              className={`flex items-center gap-1 ${
                                justify === "start" ? "justify-start" : "justify-end"
                              }`}
                            >
                              {chips.map((label, i) => (
                                <span key={i} className="flex items-center gap-1">
                                  {i > 0 && (
                                    <span className="text-muted-foreground text-xs">+</span>
                                  )}
                                  <kbd className="px-2.5 py-1 bg-secondary/80 rounded text-sm font-mono min-w-12 text-center">
                                    {label}
                                  </kbd>
                                </span>
                              ))}
                            </div>
                          );
                          return (
                            <div
                              key={remap.id}
                              className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 py-2.5"
                            >
                              <div className="flex flex-wrap items-center gap-1.5">
                                <RemapTypeBadge remapType={remap.remapType} />
                                {renderChipGroup(sourceChips, "start")}
                              </div>
                              <span className="text-muted-foreground text-sm">→</span>
                              {renderChipGroup(targetChips, "end")}
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            </>
          ) : (
            <EmptyState
              icon={<Keyboard className="h-12 w-12" />}
              title={t("playerProfile.noKeybindingsTitle")}
              description={t("playerProfile.noKeybindings")}
            />
          )}
        </TabsContent>

        {/* Stats Tab */}
        <TabsContent value="stats" className="space-y-4">
          <StatsTabContent
            player={player}
            hiddenSpeedrunRecords={hiddenSpeedrunRecords}
            pacemanStats={pacemanStats}
          />
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
              title={t("playerProfile.noItemLayoutsTitle")}
              description={t("playerProfile.noItemLayouts")}
            />
          )}
        </TabsContent>

        {/* Search Craft Tab */}
        <TabsContent value="searchcraft" className="space-y-4">
          {player.searchCrafts.length > 0 ? (
            <>
              {/* サマリーバー: ゲーム言語・件数・凡例 */}
              <div className="rounded-lg border bg-card px-4 py-3 space-y-2.5">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                  {player.playerConfig?.gameLanguage && (
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Languages className="h-4 w-4" />
                      <span>{t("playerProfile.gameLanguage")}:</span>
                      <Badge variant="secondary">
                        {getGameLanguageName(player.playerConfig.gameLanguage)}
                      </Badge>
                    </div>
                  )}
                  <Badge variant="outline" className="text-muted-foreground">
                    {t("playerProfile.searchCraftCount", { count: player.searchCrafts.length })}
                  </Badge>
                </div>
                <KeyBadgeLegend
                  showFingers={Object.keys(userFingerAssignments).length > 0}
                />
              </div>
              <SearchCraftGroupedList
                crafts={player.searchCrafts.map((craft) => ({
                  ...craft,
                  items: JSON.parse(craft.items) as string[],
                }))}
                remaps={player.keyRemaps}
                fingerAssignments={userFingerAssignments}
                gameLanguage={player.playerConfig?.gameLanguage}
              />
            </>
          ) : (
            <EmptyState
              icon={<Search className="h-12 w-12" />}
              title={t("playerProfile.searchCraftNoneTitle")}
              description={t("playerProfile.noSearchCraft")}
            />
          )}
        </TabsContent>

        {/* Devices Tab (merged with settings) */}
        <TabsContent value="devices" className="space-y-4">
          {player.playerConfig ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Keyboard */}
                <Card>
                  <CardHeader className="py-2">
                    <CardTitle className="text-base font-semibold flex items-center gap-2">
                      <Keyboard className="h-5 w-5" />
                      {t("playerProfile.keyboard")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0 pb-3">
                    {player.playerConfig.keyboardModel || player.playerConfig.keyboardLayout ? (
                      <div className="divide-y">
                        {player.playerConfig.keyboardModel && (
                          <DeviceRow
                            label={t("playerProfile.model")}
                            value={player.playerConfig.keyboardModel}
                          />
                        )}
                        {player.playerConfig.keyboardLayout && (
                          <DeviceRow
                            label={t("playerProfile.layout")}
                            value={player.playerConfig.keyboardLayout}
                          />
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground py-2">
                        {t("playerProfile.keyboardNoInfo")}
                      </p>
                    )}
                  </CardContent>
                </Card>

                {/* Mouse */}
                <Card>
                  <CardHeader className="py-2">
                    <CardTitle className="text-base font-semibold flex items-center gap-2">
                      <Mouse className="h-5 w-5" />
                      {t("playerProfile.mouse")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0 pb-3">
                    {player.playerConfig.mouseModel || player.playerConfig.mouseDpi ? (
                      <div className="divide-y">
                        {/* モデル */}
                        {player.playerConfig.mouseModel && (
                          <DeviceRow
                            label={t("playerProfile.model")}
                            value={player.playerConfig.mouseModel}
                          />
                        )}
                        {/* DPI */}
                        {player.playerConfig.mouseDpi && (
                          <DeviceRow
                            label={t("playerProfile.dpi")}
                            value={player.playerConfig.mouseDpi.toString()}
                          />
                        )}
                        {/* Win Sens または カスタム係数 */}
                        {player.playerConfig.windowsSpeedMultiplier != null ? (
                          <DeviceRow
                            label={t("playerProfile.mouseSpeedMultiplier")}
                            value={`x${player.playerConfig.windowsSpeedMultiplier.toFixed(3)}`}
                          />
                        ) : player.playerConfig.windowsSpeed != null ? (
                          <DeviceRow
                            label={t("playerProfile.winSens")}
                            value={player.playerConfig.windowsSpeed.toString()}
                            unit={`(x${WINDOWS_POINTER_MULTIPLIERS[player.playerConfig.windowsSpeed]?.toFixed(3) ?? "1.000"})`}
                          />
                        ) : (
                          <DeviceRow
                            label={t("playerProfile.winSens")}
                            value={t("playerProfile.noValue")}
                          />
                        )}
                        {/* マウス加速 */}
                        {player.playerConfig.mouseAcceleration != null && (
                          <DeviceRow
                            label={t("playerProfile.mouseAcceleration")}
                            value={player.playerConfig.mouseAcceleration ? t("common.on") : t("common.off")}
                          />
                        )}
                        {/* ゲーム内感度 */}
                        {player.playerConfig.gameSensitivity != null && (
                          <DeviceRow
                            label={t("playerProfile.inGameSensitivity")}
                            value={Math.round(player.playerConfig.gameSensitivity * 200).toString()}
                            unit="%"
                          />
                        )}
                        {/* Raw Input */}
                        {player.playerConfig.rawInput != null && (
                          <DeviceRow
                            label={t("playerProfile.rawInput")}
                            value={player.playerConfig.rawInput ? t("common.on") : t("common.off")}
                          />
                        )}
                        {/* 振り向き */}
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
                            label={t("playerProfile.turnDistance")}
                              value={cm360.toFixed(2)}
                              unit="cm"
                            />
                          ) : null;
                        })()}
                        {/* カーソル速度 */}
                        {(() => {
                          const cursorSpeed = calculateCursorSpeed(
                            player.playerConfig.mouseDpi,
                            player.playerConfig.windowsSpeed,
                            player.playerConfig.windowsSpeedMultiplier
                          );
                          return cursorSpeed != null ? (
                            <DeviceRow
                              label={t("playerProfile.cursorSpeed")}
                              value={cursorSpeed.toString()}
                            />
                          ) : null;
                        })()}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground py-2">
                        {t("playerProfile.mouseNoInfo")}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Game Settings */}
              <Card>
                <CardHeader className="py-2">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Settings className="h-5 w-5" />
                    {t("playerProfile.inGameSettings")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 pb-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
                    <div className="divide-y">
                      {player.playerConfig.toggleSprint != null && (
                        <DeviceRow
                          label={t("playerProfile.toggleSprint")}
                          value={player.playerConfig.toggleSprint ? t("common.on") : t("common.off")}
                        />
                      )}
                      {player.playerConfig.toggleSneak != null && (
                        <DeviceRow
                          label={t("playerProfile.toggleSneak")}
                          value={player.playerConfig.toggleSneak ? t("common.on") : t("common.off")}
                        />
                      )}
                      {player.playerConfig.autoJump != null && (
                        <DeviceRow
                          label={t("playerProfile.autoJump")}
                          value={player.playerConfig.autoJump ? t("common.on") : t("common.off")}
                        />
                      )}
                      {player.playerConfig.gameLanguage && (
                        <DeviceRow
                          label={t("playerProfile.gameLanguage")}
                          value={getGameLanguageName(player.playerConfig.gameLanguage)}
                        />
                      )}
                    </div>
                    <div className="divide-y">
                      {player.playerConfig.fov != null && (
                        <DeviceRow
                          label={t("playerProfile.fov")}
                          value={player.playerConfig.fov.toString()}
                        />
                      )}
                      {player.playerConfig.guiScale !== null && player.playerConfig.guiScale !== undefined && (
                        <DeviceRow
                          label={t("playerProfile.guiScale")}
                          value={player.playerConfig.guiScale.toString()}
                        />
                      )}
                    </div>
                  </div>
                  {player.playerConfig.notes && (
                    <div className="mt-4 p-3 bg-secondary/50 rounded-lg">
                      <p className="text-sm">{player.playerConfig.notes}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          ) : (
            <EmptyState
              icon={<Mouse className="h-12 w-12" />}
              title={t("playerProfile.noDevicesTitle")}
              description={t("playerProfile.noDevices")}
            />
          )}
        </TabsContent>

        {/* Guides Tab */}
        <TabsContent value="guides" className="space-y-4">
          {playerGuides.length > 0 ? (
            <>
              <div className="flex justify-end">
                <ViewToggle viewMode={guidesViewMode} onChange={setGuidesViewMode} />
              </div>
              {guidesViewMode === "card" ? (
                <GuideCardGrid
                  guides={playerGuides as GuideItem[]}
                  linkFn={(guide) => `/guides/${player.slug}/${guide.slug}`}
                  gridCols="sm:grid-cols-2"
                />
              ) : (
                <GuideListView
                  guides={playerGuides as GuideItem[]}
                  linkFn={(guide) => `/guides/${player.slug}/${guide.slug}`}
                />
              )}
            </>
          ) : (
            <EmptyState
              icon={<BookOpen className="h-12 w-12" />}
              title="ガイドがありません"
              description="このプレイヤーはまだガイドを公開していません。"
            />
          )}
        </TabsContent>

      </div>
    </Tabs>
    </>
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
        <h4 className="text-sm font-medium text-muted-foreground">{t("playerProfile.eloTrend", { count: sortedMatches.length })}</h4>
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

// ゲーム言語名の取得は共通モジュールを使用（app/lib/game-languages.ts）

// プラットフォーム表示名を取得
function getPlatformLabel(platform: string): string {
  const labels: Record<string, string> = {
    pc_windows: "PC（Windows）",
    pc_mac: "PC（Mac）",
    pc_linux: "PC（Linux）",
    switch: "Switch",
    mobile: "Mobile",
    other: "Other",
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
                  <Tooltip key={slotNum}>
                    <TooltipTrigger asChild>
                      <div className="w-12 h-12 rounded border bg-secondary/50 flex items-center justify-center relative">
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
                    </TooltipTrigger>
                    <TooltipContent>
                      {items.map(getItemDisplayName).join(", ") || t("playerProfile.slot", { num: slotNum })}
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
            {/* オフハンド */}
            <div className="w-px h-10 bg-border mx-1" />
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="w-12 h-12 rounded border bg-secondary/50 flex items-center justify-center relative">
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
              </TooltipTrigger>
              <TooltipContent>
                {offhand.map(getItemDisplayName).join(", ") || t("playerProfile.offhand")}
              </TooltipContent>
            </Tooltip>
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

// KeyBadge / SearchCraftLegend / SearchCraftList 系は @/components/search-craft-template-view に共通化済み

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
            <span className="text-sm text-muted-foreground">{t("playerProfile.pb")}</span>
          </div>
        )}
        {record.targetTime && (
          <div className="flex items-center gap-2 text-sm">
            <Target className="h-4 w-4 text-muted-foreground" />
            <span>{t("playerProfile.target")}: {formatTime(record.targetTime)}</span>
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
              {t("playerProfile.watchVideo")}
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
  platform: string;
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

function getSocialUrl(platform: string, identifier: string, customUrl?: string | null): string {
  switch (platform) {
    case "speedruncom":
      return `https://www.speedrun.com/users/${identifier}`;
    case "youtube":
      return `https://www.youtube.com/@${identifier}`;
    case "twitch":
      return `https://www.twitch.tv/${identifier}`;
    case "twitter":
      return `https://x.com/${identifier}`;
    case "custom":
      return customUrl || "#";
    default:
      return "#";
  }
}

function getSocialPlatformName(platform: string, customLabel?: string | null): string {
  switch (platform) {
    case "speedruncom":
      return "Speedrun.com";
    case "youtube":
      return "YouTube";
    case "twitch":
      return "Twitch";
    case "twitter":
      return "X";
    case "custom":
      return customLabel || platform;
    default:
      return platform;
  }
}

function DeviceRow({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="flex justify-between items-center py-2.5">
      <span className="text-sm">{label}</span>
      <span className="font-medium font-mono text-sm">
        {value}
        {unit && <span className="text-muted-foreground ml-1">{unit}</span>}
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
        {enabled ? t("common.on") : t("common.off")}
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

// Stats タブのコンテナ（クライアント側でデータ取得）
function StatsTabContent({
  player,
  hiddenSpeedrunRecords,
  pacemanStats,
}: {
  player: any;
  hiddenSpeedrunRecords: string[];
  pacemanStats: { netherEnterCount: number; mainPaces: any[] } | null;
}) {
  const [externalStats, setExternalStats] = useState<Awaited<ReturnType<typeof fetchAllExternalStats>>>({});
  const [loadState, setLoadState] = useState({
    ranked: "loading" as "loading" | "done" | "error",
    paceman: "loading" as "loading" | "done" | "error",
    speedruncom: (player.speedruncomUsername ? "loading" : "done") as "loading" | "done" | "error",
  });

  useEffect(() => {
    let cancelled = false;

    async function fetchStats() {
      setLoadState({
        ranked: "loading",
        paceman: "loading",
        speedruncom: player.speedruncomUsername ? "loading" : "done",
      });

      const tasks: Promise<void>[] = [
        fetchMCSRRankedStats(player.mcid)
          .then((ranked) => {
            if (cancelled) return;
            setExternalStats((prev) => ({ ...prev, ranked }));
            setLoadState((prev) => ({ ...prev, ranked: "done" }));
          })
          .catch((error) => {
            console.error("Failed to fetch MCSR Ranked stats:", error);
            if (cancelled) return;
            setLoadState((prev) => ({ ...prev, ranked: "error" }));
          }),
        checkPaceManPlayer(player.mcid)
          .then((paceman) => {
            if (cancelled) return;
            setExternalStats((prev) => ({ ...prev, paceman }));
            setLoadState((prev) => ({ ...prev, paceman: "done" }));
          })
          .catch((error) => {
            console.error("Failed to fetch PaceMan status:", error);
            if (cancelled) return;
            setLoadState((prev) => ({ ...prev, paceman: "error" }));
          }),
      ];

      if (player.speedruncomUsername) {
        tasks.push(
          fetchSpeedrunComStats(player.speedruncomUsername)
            .then((speedruncom) => {
              if (cancelled) return;
              setExternalStats((prev) => ({ ...prev, speedruncom }));
              setLoadState((prev) => ({ ...prev, speedruncom: "done" }));
            })
            .catch((error) => {
              console.error("Failed to fetch speedrun.com stats:", error);
              if (cancelled) return;
              setLoadState((prev) => ({ ...prev, speedruncom: "error" }));
            })
        );
      }

      await Promise.all(tasks);
    }

    fetchStats();

    return () => {
      cancelled = true;
    };
  }, [player.mcid, player.speedruncomUsername]);

  return (
    <StatsContent
      externalStats={externalStats}
      player={player}
      hiddenSpeedrunRecords={hiddenSpeedrunRecords}
      pacemanStats={pacemanStats}
      loadState={loadState}
    />
  );
}

function LoadingProgressRing() {
  return (
    <div className="relative h-10 w-10 shrink-0">
      <div className="absolute inset-0 rounded-full border-4 border-muted" />
      <div className="absolute inset-0 rounded-full border-4 border-primary border-t-transparent animate-spin" />
    </div>
  );
}

function StatsServiceLoadingCard({
  title,
  description,
  state,
}: {
  title: string;
  description: string;
  state: "loading" | "done" | "error";
}) {
  const isLoading = state === "loading";
  const isError = state === "error";

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-4">
          {isLoading ? (
            <LoadingProgressRing />
          ) : isError ? (
            <div className="h-10 w-10 shrink-0 rounded-full border-2 border-destructive/40 flex items-center justify-center">
              <span className="text-destructive text-sm font-bold">!</span>
            </div>
          ) : (
            <div className="h-10 w-10 shrink-0 rounded-full border-2 border-primary/40 flex items-center justify-center">
              <Loader2 className="h-4 w-4 text-primary" />
            </div>
          )}
          <div>
            <p className="font-medium">{title}</p>
            <p className="text-sm text-muted-foreground">
              {isLoading ? description : isError ? "読み込みに失敗しました" : "読み込み完了"}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function filterWeeklyMainPaces(mainPaces: any[]): any[] {
  const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return mainPaces.filter((pace) => {
    const date = pace?.date ? new Date(pace.date).getTime() : NaN;
    return Number.isFinite(date) && date >= oneWeekAgo;
  });
}

function formatRelativeDateTime(dateStr: string): string {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return "";

  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMinutes / 60);

  if (diffMinutes < 1) return t("playerStats.justNow");
  if (diffMinutes < 60) return t("playerStats.minutesAgo", { count: diffMinutes });
  if (diffHours < 24) return t("playerStats.hoursAgo", { count: diffHours });
  return t("playerStats.daysAgo", { count: Math.floor(diffHours / 24) });
}

// Stats タブのコンテンツ
function StatsContent({
  externalStats,
  player,
  hiddenSpeedrunRecords,
  pacemanStats,
  loadState,
}: {
  externalStats: Awaited<ReturnType<typeof fetchAllExternalStats>>;
  player: any;
  hiddenSpeedrunRecords: string[];
  pacemanStats: { netherEnterCount: number; mainPaces: any[] } | null;
  loadState: {
    ranked: "loading" | "done" | "error";
    paceman: "loading" | "done" | "error";
    speedruncom: "loading" | "done" | "error";
  };
}) {
  const weeklyMainPaces = pacemanStats ? filterWeeklyMainPaces(pacemanStats.mainPaces) : [];
  const allExternalResolved = loadState.ranked !== "loading"
    && loadState.paceman !== "loading"
    && loadState.speedruncom !== "loading";

  return (
    <>
      {/* MCSR Ranked Section */}
      {player.showRankedStats !== false && loadState.ranked === "loading" && (
        <StatsServiceLoadingCard
          title="MCSR Ranked"
          description="レート・対戦統計を読み込み中"
          state={loadState.ranked}
        />
      )}
      {externalStats.ranked?.isRegistered && player.showRankedStats !== false && loadState.ranked !== "loading" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Swords className="h-5 w-5" />
              MCSR Ranked
            </CardTitle>
            <CardDescription>
              {t("playerProfile.rankedDescription")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {externalStats.ranked.user?.eloRate && (
                <div className="text-center p-3 bg-secondary/50 rounded-lg">
                  <p className="text-2xl font-bold">{externalStats.ranked.user.eloRate}</p>
                  <p className="text-xs text-muted-foreground">{t("playerProfile.eloRate")}</p>
                </div>
              )}
              {externalStats.ranked.user?.eloRank && (
                <div className="text-center p-3 bg-secondary/50 rounded-lg">
                  <p className="text-2xl font-bold">#{externalStats.ranked.user.eloRank}</p>
                  <p className="text-xs text-muted-foreground">{t("playerProfile.ranking")}</p>
                </div>
              )}
              {externalStats.ranked.seasonData && (
                <>
                  <div className="text-center p-3 bg-secondary/50 rounded-lg">
                    <p className="text-2xl font-bold">
                      {externalStats.ranked.seasonData.records.win}W - {externalStats.ranked.seasonData.records.lose}L
                    </p>
                    <p className="text-xs text-muted-foreground">{t("playerProfile.seasonRecord")}</p>
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
                    <p className="text-xs text-muted-foreground mb-1">{t("playerProfile.allTimePb")}</p>
                    <p className="text-xl font-mono font-bold">
                      {formatTime(externalStats.ranked.seasonData.bestTimeAllTime)}
                    </p>
                  </div>
                )}
                {typeof externalStats.ranked.seasonData.bestTime === "number" && (
                  <div className="p-3 bg-secondary/30 rounded-lg">
                    <p className="text-xs text-muted-foreground mb-1">{t("playerProfile.seasonPb")}</p>
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
                <h4 className="text-sm font-medium text-muted-foreground">{t("playerProfile.recentMatches")}</h4>
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
      {loadState.paceman === "loading" && (
        <StatsServiceLoadingCard
          title="PaceMan"
          description="登録状態とペース情報を読み込み中"
          state={loadState.paceman}
        />
      )}
      {externalStats.paceman?.isRegistered && loadState.paceman !== "loading" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Timer className="h-5 w-5" />
              PaceMan Stats
            </CardTitle>
            <CardDescription>
              {t("playerProfile.pacemanSummary")}
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
                {t("playerProfile.pacemanOpenDetails")}
              </a>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* PaceMan 過去1週間の統計 */}
      {pacemanStats && player.showPacemanStats !== false && (pacemanStats.netherEnterCount > 0 || weeklyMainPaces.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Timer className="h-5 w-5" />
              {t("playerProfile.weeklyActivityPaceman")}
            </CardTitle>
            <CardDescription>
              {t("playerProfile.weeklyActivityDescription")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* ネザーイン回数 */}
            {pacemanStats.netherEnterCount > 0 && (
              <div className="p-3 bg-secondary/50 rounded-lg">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">{t("playerProfile.netherEntryCount")}</span>
                  <span className="text-2xl font-bold">{pacemanStats.netherEnterCount}</span>
                </div>
              </div>
            )}

            {/* 主なペース（2nd Structure以降） */}
            {weeklyMainPaces.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-muted-foreground">{t("playerProfile.mainPacesSince2nd")}</h4>
                <div className="space-y-1">
                  {weeklyMainPaces.map((pace: any, idx: number) => (
                    (() => {
                      const timeline = pace?.latestSplit?.timeline ?? pace?.timeline;
                      const rta = pace?.latestSplit?.rta ?? pace?.rta;
                      if (!timeline || typeof rta !== "number") return null;

                      const runUrl = pace?.pacemanRunId
                        ? `https://paceman.gg/stats/run/${pace.pacemanRunId}`
                        : null;
                      const relativeDate = pace?.date ? formatRelativeDateTime(pace.date) : "";
                      const dateLabel = pace?.date ? new Date(pace.date).toLocaleString() : null;

                      return runUrl ? (
                        <Tooltip key={`run-${pace.pacemanRunId}`}>
                          <TooltipTrigger asChild>
                            <a
                              href={runUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={cn(
                                "flex items-center justify-between p-2 rounded text-sm transition-colors",
                                timeline === "Finish"
                                  ? "border border-cyan-400/60 bg-cyan-500/10 hover:bg-cyan-500/15"
                                  : "bg-secondary/30 hover:bg-secondary/50"
                              )}
                            >
                              <div className="min-w-0">
                                <PaceManSplitMark timeline={timeline} className="font-medium" />
                                {relativeDate && (
                                  <p className="text-xs text-muted-foreground">{relativeDate}</p>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="font-mono">{formatTime(rta)}</span>
                                <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                              </div>
                            </a>
                          </TooltipTrigger>
                          {dateLabel && <TooltipContent>{dateLabel}</TooltipContent>}
                        </Tooltip>
                      ) : (
                        <div
                          key={`${timeline}-${idx}`}
                          className={cn(
                            "flex items-center justify-between p-2 rounded text-sm",
                            timeline === "Finish"
                              ? "border border-cyan-400/60 bg-cyan-500/10"
                              : "bg-secondary/30"
                          )}
                        >
                          <div className="min-w-0">
                            <PaceManSplitMark timeline={timeline} className="font-medium" />
                            {relativeDate && (
                              <p className="text-xs text-muted-foreground">{relativeDate}</p>
                            )}
                          </div>
                          <span className="font-mono">{formatTime(rta)}</span>
                        </div>
                      );
                    })()
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Speedrun.com Section */}
      {player.speedruncomUsername && loadState.speedruncom === "loading" && (
        <StatsServiceLoadingCard
          title="Speedrun.com"
          description="自己ベスト記録を読み込み中"
          state={loadState.speedruncom}
        />
      )}
      {externalStats.speedruncom && !externalStats.speedruncom.error && externalStats.speedruncom.personalBests.length > 0 && loadState.speedruncom !== "loading" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trophy className="h-5 w-5" />
              Speedrun.com
            </CardTitle>
            <CardDescription>
              {t("playerProfile.officialRecords")}
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
                        {pb.category?.data?.name ?? t("common.unknown")}
                      </span>
                      <Badge variant="outline" className="shrink-0">
                        #{pb.place}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {pb.game?.data?.names?.international ?? t("common.unknownGame")}
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
                        {t("playerProfile.viewRecord")}
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
              {t("playerProfile.customRecords")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {player.categoryRecords.map((record: any) => (
                <RecordCard key={record.id} record={record} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* データがない場合 */}
      {allExternalResolved && (!externalStats.ranked?.isRegistered && !externalStats.paceman?.isRegistered && !externalStats.speedruncom?.personalBests?.length && player.categoryRecords.length === 0) && (
        <EmptyState
          icon={<BarChart3 className="h-12 w-12" />}
          title={t("playerProfile.noStatsTitle")}
          description={t("playerProfile.noStatsDescription")}
        />
      )}
    </>
  );
}
