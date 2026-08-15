import { createTranslator } from "@/lib/messages";
import { resolveLocale, localeFromMatches, type Locale } from "@/lib/locale";
import { useLoaderData, Link, useParams, useSearchParams, useNavigation, useLocation, type ShouldRevalidateFunctionArgs } from "react-router";
import { useState, useEffect, useMemo, lazy, Suspense, type ReactNode } from "react";
import { ViewToggle } from "@/components/view-toggle";
import {
  GuideCardGrid,
  GuideListView,
  type GuideItem,
} from "@/components/guide-list-views";
import type { Route } from "./+types/profile";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getOptionalSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users, categoryRecords, keybindings, playerConfigs, socialLinks, profileVideos, itemLayouts, searchCrafts, searchCraftLoops, keyRemaps, configPresets, customKeys, customActions, guides } from "@/lib/schema";
import { eq, asc, desc, sql } from "drizzle-orm";
import {
  fetchAllExternalStats,
  fetchMCSRRankedStats,
  checkPaceManPlayer,
  fetchSpeedrunComStats,
} from "@/lib/external-stats";
import { getLocalizedItemName } from "@/components/item-icon";
import { ItemHotbar, type Slot } from "@/components/item-hotbar";
import { MinecraftFullBody, type PoseName } from "@/components/minecraft-fullbody";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import {
  MCSRRankedCard,
  PaceManLinkCard,
  PaceManStatsCard,
  SpeedrunComCard,
  StatsServiceLoadingCard,
} from "@/components/player-stats-cards";
import { platformLabel } from "@/lib/platform-label";
import { formatTime } from "@/lib/time-utils";
import { getLocalizedDisplayName } from "@/lib/slug";
import { format, formatDistanceToNow } from "date-fns";
import { dateFnsLocale, dateFormatPattern } from "@/lib/date-locale";
import { useT, useLocale } from "@/hooks/use-locale";
import type { Translator } from "@/lib/messages";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useProfileReactions } from "@/hooks/use-profile-reactions";
import { getGameLanguageName } from "@/lib/game-languages";
import { toUiRemaps, filterRemapsForContext, type RemapContext, type RemapInfo } from "@/lib/remap-utils";
import { decodePresetConfig } from "@/lib/preset-read";
import { SearchCraftGroupedList, KeyBadgeLegend } from "@/components/search-craft-template-view";
import {
  groupLoopsByTiming,
  makeLoopGroupExtra,
  type SearchCraftLoopRowData,
} from "@/components/search-craft-loop-view";
import { parseLoopSteps } from "@/lib/search-craft-loops";
import { resolveRowVariations } from "@/lib/search-craft-variations";
import { RemapTypeBadge } from "@/components/remap-type-badge";
import { RemapViewToggle } from "@/components/remap-view-toggle";
import { getYouTubeEmbedUrl } from "@/lib/youtube-url";
import { parseRunIdList } from "@/lib/run-id-list";
import {
  hasRtaCareerRemainder,
  rtaCareerExactLabel,
  rtaCareerLabel,
  rtaCareerView,
} from "@/lib/rta-career";
import { safeExternalHref } from "@/lib/safe-url";
import { guideLikeCountSql } from "@/lib/likes.server";
import {
  getProfileReactionCounts,
  getViewerProfileReactions,
} from "@/lib/profile-reactions.server";
import type { ProfileReactionCount } from "@/lib/profile-reactions";
import { YouTubeEmbed } from "@/components/youtube-embed";
import type { YouTubeChannelStats } from "@/lib/youtube";
import type { TwitchChannelStats } from "@/lib/twitch";

const SKIN_VIEW_SIZE_DESKTOP = { width: 240, height: 280 } as const;
const SKIN_VIEW_SIZE_MOBILE = { width: 320, height: 380 } as const;
const SKIN_VIEW_MOBILE_QUERY = "(max-width: 640px)"; // Tailwind sm 未満

// OGPメタタグ
export function meta({ loaderData, params, matches }: Route.MetaArgs) {
  if (!loaderData?.player) {
    return [
      { title: "Player Not Found - Minefolio" },
      { name: "description", content: "Player profile not found" },
    ];
  }

  const { player } = loaderData;
  const displayName = getLocalizedDisplayName(player, localeFromMatches(matches));
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
  const t = useT();
  const locale = useLocale();
  const params = useParams();
  const slug = params.slug || "loading";

  return (
    <div className="flex flex-col lg:flex-row gap-8 animate-in fade-in duration-200">
      {/* Left Sidebar Skeleton */}
      <aside className="lg:w-72 shrink-0 space-y-6">
        <div className="flex flex-col items-center lg:items-start">
          {/* Skin Skeleton */}
          <div className="w-40 h-60 flex items-center justify-center">
            <Skeleton className="w-12 h-40 rounded-lg" />
          </div>

          <div className="mt-4 text-center lg:text-left w-full space-y-2">
            <Skeleton className="h-8 w-32 mx-auto lg:mx-0" />
            <Skeleton className="h-5 w-24 mx-auto lg:mx-0" />
          </div>
        </div>

        {/* Bio Skeleton */}
        <div className="space-y-2">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-20 w-full" />
        </div>
      </aside>

      {/* Main Content Skeleton */}
      <main className="flex-1 min-w-0 space-y-6">
        {/* Tabs Skeleton */}
        <Skeleton className="h-10 w-80" />

        {/* Content Skeleton */}
        <div className="space-y-4">
          <Skeleton className="h-64 w-full rounded-lg" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Skeleton className="h-40 rounded-lg" />
            <Skeleton className="h-40 rounded-lg" />
          </div>
        </div>
      </main>
    </div>
  );
}
import { getActionLabel, getKeyLabel, normalizeKeyCode, parseKeyCombination, MODIFIER_LABELS, UNBOUND_KEY, type FingerType } from "@/lib/keybindings";
import { VirtualKeyboard, VirtualMouse, VirtualNumpad, FingerLegend, keybindingsToMap } from "@/components/virtual-keyboard";
import { KeyboardExportDialog } from "@/components/keybindings/keyboard-export-dialog";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
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
  History,
  Target,
  CheckCircle2,
  Video,
  Package,
  Search,
  BarChart3,
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
  Pin,
  Gamepad2,
  Layers,
  SlidersHorizontal,
  Sparkles,
  Speech,
} from "lucide-react";
import { ShareButton } from "@/components/share-button";
import { FavoriteButton } from "@/components/favorite-button";
import { ProfileReactionBar } from "@/components/profile-reaction-bar";
import { EmptyState } from "@/components/empty-state";
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
  isValidSensitivity,
  toSensitivityPercent,
} from "@/lib/mouse-settings";
import {
  cm360MissingReasons,
  cursorSpeedMissingReasons,
  type MouseReasonConfig,
} from "@/lib/mouse-settings-reasons";
import { HintTip } from "@/components/hint-tip";
import { SensitivityWarning } from "@/components/sensitivity-warning";
import { MissingMouseValue, WinSensValue } from "@/components/mouse-setting-values";
import {
  HOTBAR_SWITCHING_OPTIONS,
  SEARCH_CRAFT_OPTIONS,
  FREQUENCY_OPTIONS,
  ITEM_LAYOUT_POLICY_OPTIONS,
  CLICK_METHOD_OPTIONS,
  CAN_CANNOT_OPTIONS,
  USES_MOUSEPAD_OPTIONS,
  BASTION_OPTIONS,
  versionLabel,
  groupVersionsByEdition,
  parsePlaystyleVersions,
  parsePlaystyleCategories,
  parsePlaystyleClickMethods,
  isVersionKey,
  isCategoryKey,
  isKbmPlaystyle,
  playsJavaRsgOrRanked,
  hasBastionVersions,
  hidesSearchCraft,
  categoryLabel,
  playstyleOptionLabel,
} from "@/lib/playstyle";

// bio の markdown 描画（react-markdown 一式）は Bio カード表示時にだけロードする。
// チャンク取得に失敗した場合（再デプロイ後の旧タブ等）はページ全体をエラーに
// 落とさず、bio 原文のプレーンテキスト表示にフォールバックする（whats-new.tsx と同じパターン）
const BioMarkdown = lazy(() =>
  import("@/components/profile/bio-markdown")
    .then((mod) => ({ default: mod.BioMarkdown }))
    .catch(() => ({
      default: ({ bio }: { bio: string }) => (
        <p className="whitespace-pre-wrap text-sm text-muted-foreground">{bio}</p>
      ),
    })),
);

// isOwner・プリセット選択・絵文字リアクションなど閲覧者依存のデータを含むため、
// ブラウザ/CDN にキャッシュさせない（React Router のシングルフェッチは `.data` サブ
// リクエストにもこの headers() を適用する）。ProfileFeedCard 等の `prefetch="intent"`
// Link がホバー時に `.data` を先読みするが、これがキャッシュされると「リアクション後に
// 別ページへ行き、ホームのカードから再訪すると反応前の古い状態が表示される」不具合になる
// （ハードリロードはキャッシュを無視するため直る＝症状と一致）。
export function headers(_: Route.HeadersArgs) {
  return { "Cache-Control": "private, no-store" };
}

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
  const t = createTranslator(resolveLocale(request));
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
      playstyle: true,
      keybindings: {
        orderBy: [asc(keybindings.category), asc(keybindings.action)],
      },
      categoryRecords: {
        where: eq(categoryRecords.isVisible, true),
        // ピン留めを先頭に表示
        orderBy: [desc(categoryRecords.isPinned), asc(categoryRecords.displayOrder)],
      },
      socialLinks: {
        orderBy: [asc(socialLinks.displayOrder)],
      },
      profileVideos: {
        // ピン留めを先頭に表示
        orderBy: [desc(profileVideos.isPinned), asc(profileVideos.displayOrder)],
      },
      itemLayouts: {
        orderBy: [asc(itemLayouts.displayOrder)],
      },
      searchCrafts: {
        orderBy: [asc(searchCrafts.sequence)],
      },
      searchCraftLoops: {
        orderBy: [asc(searchCraftLoops.sequence)],
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

  // プリセット一覧を取得（メインを先頭に）。重量JSON列（*Data）はここでは取得せず、
  // 選択されたプリセットが非アクティブな場合のみ後段で1件だけ取得する（2段フェッチ）。
  const presets = await db.query.configPresets.findMany({
    where: eq(configPresets.userId, player.id),
    orderBy: [desc(configPresets.isMain), desc(configPresets.updatedAt)],
    columns: {
      id: true,
      name: true,
      description: true,
      isActive: true,
      isMain: true,
    },
    extras: {
      hasItemLayouts: sql<number>`(${configPresets.itemLayoutsData} is not null)`.as("has_item_layouts"),
      hasSearchCrafts: sql<number>`(${configPresets.searchCraftsData} is not null)`.as("has_search_crafts"),
    },
  });

  // 表示プリセットの解決: `?preset=` が有効ならそのプリセット、
  // 無指定・不正・削除済みの場合はメイン（公開用）プリセットへフォールバック。
  // メインが無い場合（移行前データ等）は編集中プリセットへさらにフォールバック
  const requestedPreset = presetId
    ? presets.find((p) => p.id === presetId)
    : undefined;
  const selectedPreset =
    requestedPreset ??
    presets.find((p) => p.isMain) ??
    presets.find((p) => p.isActive) ??
    null;

  // Check if current user is viewing their own profile
  // （285行目の非公開判定と同じ discordId 比較。player は既に取得済みのため再クエリ不要）
  const isOwner = session?.user?.id === player.discordId;

  // アクティブプリセットはライブ設定と同内容（不変条件）のため、
  // 非アクティブなプリセットを選択した場合のみスナップショットを適用する。
  // 重量JSON列（*Data）はここで初めて1件だけ取得する（2段フェッチ）。
  // デコードは共通ヘルパー（preset-read.ts）に委譲: null の種別は「空」として表示し、
  // ライブ（編集中）データへはフォールバックしない（正準解釈。漏出防止）
  const resolvePresetOverride = async () => {
    if (!selectedPreset || selectedPreset.isActive) return null;
    const presetSnapshot = await db.query.configPresets.findFirst({
      where: eq(configPresets.id, selectedPreset.id),
      columns: {
        keybindingsData: true,
        playerConfigData: true,
        remapsData: true,
        fingerAssignmentsData: true,
        itemLayoutsData: true,
        searchCraftsData: true,
        searchCraftLoopsData: true,
        customKeysData: true,
        customActionsData: true,
      },
    });
    return decodePresetConfig(presetSnapshot ?? {}, player.id);
  };

  // プロフィール絵文字リアクション（docs/profile-reactions.md）。
  const resolveProfileReactions = async (): Promise<{
    counts: ProfileReactionCount[];
    viewerReactions: string[];
    viewerHasAccount: boolean;
  }> => {
    // 本人なら player.id をそのまま使う（追加クエリなし）。他人がログイン中の場合のみ
    // discordId → 内部 userId を1回引く（session.user.id は Discord ID）
    const viewerUserId = isOwner
      ? player.id
      : session
        ? ((await db.query.users.findFirst({
            where: eq(users.discordId, session.user.id),
            columns: { id: true },
          }))?.id ?? null)
        : null;
    const [counts, viewerReactions] = await Promise.all([
      getProfileReactionCounts(db, player.id),
      getViewerProfileReactions(db, player.id, viewerUserId),
    ]);
    return { counts, viewerReactions, viewerHasAccount: viewerUserId !== null };
  };

  // PaceManの統計情報を取得（MCIDがある場合のみ）
  const resolvePacemanStats = async () => {
    if (!player.mcid) return null;
    try {
      const [netherEnterCount, mainPaces] = await Promise.all([
        getNetherEnterCount(player.mcid),
        getRecentPacesForPlayer(player.mcid, 10),
      ]);
      return { netherEnterCount, mainPaces };
    } catch (error) {
      console.error("Failed to fetch PaceMan stats:", error);
      return null;
    }
  };

  // プリセットスナップショットの解決・絵文字リアクション集計・公開ガイド一覧・PaceMan統計は
  // 互いに独立したクエリのため、1つの Promise.all にまとめて並列実行する
  // （Turso は HTTP のため RTT を1つでも減らす。browse-query.server.ts と同じ方針）。
  const [presetOverride, profileReactions, playerGuides, pacemanStats] = await Promise.all([
    resolvePresetOverride(),
    resolveProfileReactions(),
    // プレイヤーの公開ガイドを取得
    db.query.guides.findMany({
      where: (g, { and, eq }) => and(eq(g.authorId, player.id), eq(g.isPublished, true)),
      // ピン留めを先頭に表示
      orderBy: [desc(guides.isPinned), desc(guides.updatedAt)],
      columns: {
        id: true,
        slug: true,
        title: true,
        summary: true,
        tags: true,
        coverImageUrl: true,
        viewCount: true,
        updatedAt: true,
        isPinned: true,
      },
      extras: { likeCount: guideLikeCountSql().as("like_count") },
    }),
    resolvePacemanStats(),
  ]);

  let displayKeybindings = player.keybindings;
  let displayPlayerConfig = player.playerConfig;
  let displayKeyRemaps = player.keyRemaps;
  let displayItemLayouts = player.itemLayouts;
  let displaySearchCrafts = player.searchCrafts;
  // Loop（繋ぎ方）: crafts と必ず同一ソースから解決する（ライブ crafts × スナップショット loops の
  // 混在は craftId 参照が壊れるため厳禁）。ライブ行は steps（JSON列）を parseLoopSteps でパースする
  let displaySearchCraftLoops: SearchCraftLoopRowData[] = player.searchCraftLoops.map((loop) => ({
    id: loop.id,
    steps: parseLoopSteps(loop.steps),
    comment: loop.comment,
    timing: loop.timing,
  }));
  let displayCustomKeys = player.customKeys;
  let displayCustomActions = player.customActions;

  if (presetOverride) {
    displayKeybindings = presetOverride.keybindings;
    displayKeyRemaps = presetOverride.keyRemaps;
    displayItemLayouts = presetOverride.itemLayouts;
    displaySearchCrafts = presetOverride.searchCrafts;
    // presetOverride.searchCraftLoops は decodePresetSearchCraftLoops が既に craftId を
    // 合成 id（preset-craft-${idx}）へ解決済み。displaySearchCrafts と同じスナップショットから
    // 導出されているため参照は必ず解決できる
    displaySearchCraftLoops = presetOverride.searchCraftLoops.map((loop) => ({
      id: loop.id,
      steps: loop.steps,
      comment: loop.comment,
      timing: loop.timing ?? null,
    }));
    displayCustomKeys = presetOverride.customKeys;
    displayCustomActions = presetOverride.customActions;
    // 表示専用のためライブ行の型にキャストする（id 等の DB 固有列は表示では未使用。
    // playerConfig 無しのスナップショットは「設定なし」= null 表示 —
    // ライブ設定行が無いユーザーと同じ扱いで、消費側は null 安全に書かれている）
    displayPlayerConfig = (presetOverride.playerConfig
      ? {
          ...presetOverride.playerConfig,
          fingerAssignments: presetOverride.fingerAssignments,
        }
      : null) as typeof player.playerConfig;
  }

  // 非表示・ピン留め記録IDをパース（Speedrun.com記録はDBに行を持たないため、run IDの配列で管理）
  const hiddenSpeedrunRecords = parseRunIdList(player.hiddenSpeedrunRecords);
  const pinnedSpeedrunRecords = parseRunIdList(player.pinnedSpeedrunRecords);

  // 外部APIは呼び出さず、クライアント側で取得する
  return {
    appUrl: env.APP_URL || "https://minefolio.app",
    // RTA歴の経過計算の基準時刻。SSRとハイドレーションで new Date() を別々に評価すると
    // 月替わり境界（TZ差）で表示がずれるため、サーバーの時刻を単一の基準にする
    now: Date.now(),
    player: {
      ...player,
      keybindings: displayKeybindings,
      playerConfig: displayPlayerConfig,
      keyRemaps: displayKeyRemaps,
      itemLayouts: displayItemLayouts,
      searchCrafts: displaySearchCrafts,
      searchCraftLoops: displaySearchCraftLoops,
      customKeys: displayCustomKeys,
      customActions: displayCustomActions,
    },
    isOwner,
    profileReactions,
    hiddenSpeedrunRecords,
    pinnedSpeedrunRecords,
    pacemanStats,
    presets: presets.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      isActive: p.isActive,
      isMain: p.isMain,
      hasItemLayouts: !!p.hasItemLayouts,
      hasSearchCrafts: !!p.hasSearchCrafts,
    })),
    selectedPresetId: selectedPreset?.id ?? null,
    playerGuides,
  };
}

export default function PlayerProfilePage() {
  const t = useT();
  const locale = useLocale();
  const { player, isOwner, profileReactions, hiddenSpeedrunRecords, pinnedSpeedrunRecords, pacemanStats, presets, selectedPresetId, playerGuides, now } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const location = useLocation();
  const [skin3dOpen, setSkin3dOpen] = useState(false);
  // Radix TabsContent は非アクティブ時に子要素を unmount するため、タブ切替で消える
  // ProfileReactionBar 側ではなく、unmount されない親（このページ）で state を保持する
  // （docs/profile-reactions.md 参照）
  const { pills: reactionPills, toggle: toggleReaction } = useProfileReactions({
    profileUserId: player.id,
    initialCounts: profileReactions.counts,
    initialViewerReactions: profileReactions.viewerReactions,
  });

  // 英語表示ではアルファベット表記を優先する（未入力なら表示名にフォールバック）
  const playerName = getLocalizedDisplayName(player, locale);

  // プリセット切替中のローディング状態（`?preset=` の実変更によるナビゲーション中のみ。
  // タブ切替や他ページへの遷移では出さない）
  const isSwitchingPreset =
    navigation.state === "loading" &&
    navigation.location != null &&
    navigation.location.pathname === location.pathname &&
    new URLSearchParams(navigation.location.search).get("preset") !==
      searchParams.get("preset");

  // プリセット選択ハンドラー。メイン（公開用）プリセット選択時は `?preset=` を外して
  // 既定表示に戻す。loader の再実行は setSearchParams による
  // ナビゲーションの既定の再検証に任せる（明示的な revalidate は loader の二重実行になる）
  const handlePresetChange = (nextPresetId: string) => {
    const isMainPreset = presets.some(
      (p) => p.id === nextPresetId && p.isMain,
    );
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (isMainPreset) {
          next.delete("preset");
        } else {
          next.set("preset", nextPresetId);
        }
        return next;
      },
      { preventScrollReset: true, replace: true },
    );
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
    return getKeyLabel(t, keyCode);
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
  const userFingerAssignments = useMemo(() => {
    if (!player.playerConfig?.fingerAssignments) return {};
    try {
      return JSON.parse(player.playerConfig.fingerAssignments);
    } catch {
      return {};
    }
  }, [player.playerConfig?.fingerAssignments]);

  // サーチクラフト（items JSON列をパース）。SearchCraftGroupedList・Loop 表示のクラフト
  // 参照解決の両方で使うため一度だけ計算する
  const parsedSearchCrafts = useMemo(
    () =>
      player.searchCrafts.map((craft) => ({
        ...craft,
        items: JSON.parse(craft.items) as string[],
        variations: resolveRowVariations(craft),
      })),
    [player.searchCrafts],
  );

  // 繋ぎ方（Loop）を timing ごとにグループ化し、SearchCraftGroupedList の
  // renderGroupExtra から各タイミンググループカード内に埋め込むための関数を作る
  const searchCraftLoopTimings = useMemo(
    () => Array.from(groupLoopsByTiming(player.searchCraftLoops).keys()),
    [player.searchCraftLoops],
  );
  const renderSearchCraftLoopExtra = useMemo(
    () =>
      makeLoopGroupExtra({
        loops: player.searchCraftLoops,
        crafts: parsedSearchCrafts,
        remaps: player.keyRemaps,
        fingerAssignments: userFingerAssignments,
      }),
    [player.searchCraftLoops, parsedSearchCrafts, player.keyRemaps, userFingerAssignments],
  );

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

  // キーバインドの action → keyCode マップ（VirtualKeyboard/Numpad/Mouse 共通）
  const keybindingsMap = useMemo(
    () => keybindingsToMap(player.keybindings),
    [player.keybindings],
  );

  // キーボードカテゴリのカスタムキー（VirtualKeyboard・エクスポートダイアログ共通）
  const customKeyboardKeys = useMemo(
    () =>
      player.customKeys
        .filter((ck) => ck.category === "keyboard")
        .map((ck) => ({ code: ck.keyCode, label: ck.keyName })),
    [player.customKeys],
  );

  // 全カスタムボタン（VirtualMouse・エクスポートダイアログ共通。カテゴリで絞り込みはコンポーネント側）
  const customButtons = useMemo(
    () =>
      player.customKeys.map((ck) => ({
        code: ck.keyCode,
        label: ck.keyName,
        category: ck.category as "mouse" | "keyboard",
      })),
    [player.customKeys],
  );

  // 動画欄: profileVideos があればそれを、無ければ旧 featuredVideoUrl を1件として表示（後方互換）
  const displayVideos: DisplayVideo[] =
    player.profileVideos.length > 0
      ? player.profileVideos.map((v) => ({
          id: v.id,
          url: v.url,
          title: v.title,
          isPinned: v.isPinned,
        }))
      : player.featuredVideoUrl
        ? [{ id: "legacy-featured", url: player.featuredVideoUrl, title: null, isPinned: false }]
        : [];

  // RTA歴（経過期間 + 開始年月）。未回答・不正値のときは表示しない
  // 基準時刻は loader の now（SSRとハイドレーションで計算結果を一致させる）
  const rtaCareer = useMemo(
    () => rtaCareerView(player.rtaStartedYearMonth, locale, new Date(now)),
    [player.rtaStartedYearMonth, locale, now],
  );

  // キーボードレイアウト判定
  const keyboardLayout = (player.playerConfig?.keyboardLayout || "US") as "US" | "JIS" | "US_TKL" | "JIS_TKL";
  const isTKL = keyboardLayout === "US_TKL" || keyboardLayout === "JIS_TKL";


  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [guidesViewMode, setGuidesViewMode] = useState<"card" | "list">("card");

  // スキン3Dビューワのサイズ（モバイルでは大きめに）
  const isMobileSkinView = useMediaQuery(SKIN_VIEW_MOBILE_QUERY);
  const skinViewSize = isMobileSkinView ? SKIN_VIEW_SIZE_MOBILE : SKIN_VIEW_SIZE_DESKTOP;

  // プレイスタイル: JSON列のパース・表示条件の判定（編集UI/me/playstyleと共有のヘルパーを使用）
  const playstyleVersions = useMemo(
    () => parsePlaystyleVersions(player.playstyle?.versions),
    [player.playstyle?.versions],
  );
  const playstyleCategories = useMemo(
    () => parsePlaystyleCategories(player.playstyle?.categories),
    [player.playstyle?.categories],
  );
  const playstyleClickMethods = useMemo(
    () => parsePlaystyleClickMethods(player.playstyle?.clickMethods),
    [player.playstyle?.clickMethods],
  );
  const playstyleMainVersionRaw = player.playstyle?.mainVersion;
  const playstyleMainVersion = isVersionKey(playstyleMainVersionRaw) ? playstyleMainVersionRaw : null;
  const playstyleMainCategoryRaw = player.playstyle?.mainCategory;
  const playstyleMainCategory = isCategoryKey(playstyleMainCategoryRaw) ? playstyleMainCategoryRaw : null;
  const showPlaystyleClickMethods = isKbmPlaystyle(player.inputMethod) && playstyleClickMethods.length > 0;
  const showPlaystyleMousepad = isKbmPlaystyle(player.inputMethod) && !!player.playstyle?.usesMousepad;
  const showPlaystyleJavaRsgRanked = playsJavaRsgOrRanked(playstyleVersions, playstyleCategories);
  const showPlaystyleBastion = hasBastionVersions(playstyleVersions) && !!player.playstyle?.favoriteBastion;
  const showPlaystyleGameLanguage =
    !hidesSearchCraft(player.playstyle?.searchCraft) && !!player.playerConfig?.gameLanguage;

  // 各カードの行を { label, value } の配列として構築する。push 条件がそのままカードの表示条件
  // （hasPlaystyleXxx は rows.length から導出）であり、JSX 側は rows.map で描画するだけにする
  // （表示条件の二重管理を避ける。値・ラベル・並び順は元の JSX 条件と同一）。
  const playstylePlayContentRows: { label: string; value: ReactNode }[] = [];
  if (playstyleVersions.length > 0) {
    playstylePlayContentRows.push({
      label: t("playerProfile.playstyleVersions"),
      value: (
        <>
          {(["java", "bedrock"] as const).map((edition) => {
            const keys = groupVersionsByEdition(playstyleVersions)[edition];
            if (keys.length === 0) return null;
            return (
              <div key={edition} className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground w-16 shrink-0">
                  {edition === "java" ? "Java" : "Bedrock"}
                </span>
                {keys.map((v) => (
                  <Badge key={v} variant={v === playstyleMainVersion ? "default" : "secondary"}>
                    {versionLabel(v)}
                    {v === playstyleMainVersion && t("playerProfile.playstyleMainSuffix")}
                  </Badge>
                ))}
              </div>
            );
          })}
        </>
      ),
    });
  }
  if (playstyleCategories.length > 0) {
    playstylePlayContentRows.push({
      label: t("playerProfile.playstyleCategories"),
      value: (
        <div className="flex flex-wrap gap-2">
          {playstyleCategories.map((c) => (
            <Badge key={c} variant={c === playstyleMainCategory ? "default" : "secondary"}>
              {categoryLabel(t, c)}
              {c === playstyleMainCategory && t("playerProfile.playstyleMainSuffix")}
            </Badge>
          ))}
        </div>
      ),
    });
  }

  const playstyleControlsRows: { label: string; value: ReactNode }[] = [];
  if (player.inputMethod) {
    playstyleControlsRows.push({
      label: t("playerProfile.playstyleInputMethod"),
      value: inputMethodLabel(t, player.inputMethod),
    });
  }
  if (player.playstyle?.hotbarSwitching) {
    playstyleControlsRows.push({
      label: t("playerProfile.playstyleHotbarSwitching"),
      value: playstyleOptionLabel(t, HOTBAR_SWITCHING_OPTIONS, player.playstyle.hotbarSwitching),
    });
  }
  if (player.playstyle?.halfShift) {
    playstyleControlsRows.push({
      label: t("playerProfile.playstyleHalfShift"),
      value: playstyleOptionLabel(t, FREQUENCY_OPTIONS, player.playstyle.halfShift),
    });
  }
  if (showPlaystyleClickMethods) {
    playstyleControlsRows.push({
      label: t("playerProfile.playstyleClickMethods"),
      value: playstyleClickMethods.map((m) => playstyleOptionLabel(t, CLICK_METHOD_OPTIONS, m)).join(" / "),
    });
  }
  if (showPlaystyleClickMethods && playstyleClickMethods.includes("drag") && player.playstyle?.dragTapeType) {
    playstyleControlsRows.push({
      label: t("playerProfile.playstyleDragTapeType"),
      value: player.playstyle.dragTapeType,
    });
  }
  if (showPlaystyleMousepad) {
    playstyleControlsRows.push({
      label: t("playerProfile.playstyleMousepad"),
      value: playstyleOptionLabel(t, USES_MOUSEPAD_OPTIONS, player.playstyle?.usesMousepad ?? ""),
    });
  }
  if (showPlaystyleMousepad && player.playstyle?.usesMousepad === "uses" && player.playstyle?.mousepadType) {
    playstyleControlsRows.push({
      label: t("playerProfile.playstyleMousepadType"),
      value: player.playstyle.mousepadType,
    });
  }

  const playstyleTechniqueRows: { label: string; value: ReactNode }[] = [];
  if (player.playstyle?.itemLayoutPolicy) {
    playstyleTechniqueRows.push({
      label: t("playerProfile.playstyleItemLayoutPolicy"),
      value: playstyleOptionLabel(t, ITEM_LAYOUT_POLICY_OPTIONS, player.playstyle.itemLayoutPolicy),
    });
  }
  if (player.playstyle?.searchCraft) {
    playstyleTechniqueRows.push({
      label: t("playerProfile.playstyleSearchCraft"),
      value: playstyleOptionLabel(t, SEARCH_CRAFT_OPTIONS, player.playstyle.searchCraft),
    });
  }
  if (showPlaystyleGameLanguage) {
    playstyleTechniqueRows.push({
      label: t("playerProfile.gameLanguage"),
      value: getGameLanguageName(t, locale, player.playerConfig?.gameLanguage ?? ""),
    });
  }
  if (showPlaystyleJavaRsgRanked && player.playstyle?.zeroCycle) {
    playstyleTechniqueRows.push({
      label: t("playerProfile.playstyleZeroCycle"),
      value: playstyleOptionLabel(t, FREQUENCY_OPTIONS, player.playstyle.zeroCycle),
    });
  }
  if (showPlaystyleJavaRsgRanked && player.playstyle?.groundZero) {
    playstyleTechniqueRows.push({
      label: t("playerProfile.playstyleGroundZero"),
      value: playstyleOptionLabel(t, CAN_CANNOT_OPTIONS, player.playstyle.groundZero),
    });
  }
  if (showPlaystyleJavaRsgRanked && player.playstyle?.oneshot) {
    playstyleTechniqueRows.push({
      label: t("playerProfile.playstyleOneshot"),
      value: playstyleOptionLabel(t, CAN_CANNOT_OPTIONS, player.playstyle.oneshot),
    });
  }
  if (showPlaystyleBastion) {
    playstyleTechniqueRows.push({
      label: t("playerProfile.playstyleFavoriteBastion"),
      value: playstyleOptionLabel(t, BASTION_OPTIONS, player.playstyle?.favoriteBastion ?? ""),
    });
  }

  const hasPlaystylePlayContent = playstylePlayContentRows.length > 0;
  const hasPlaystyleControls = playstyleControlsRows.length > 0;
  const hasPlaystyleTechnique = playstyleTechniqueRows.length > 0;
  const hasPlaystyleData = hasPlaystylePlayContent || hasPlaystyleControls || hasPlaystyleTechnique;

  // タブ項目の定義（編集画面のメニュー順に合わせる）。
  // サーチクラフトタブは「しない」設定時のみ非表示にする（null=未回答は表示する）
  const hideSearchCraftTab = hidesSearchCraft(player.playstyle?.searchCraft);
  const tabItems = [
    { value: "stats", icon: BarChart3, label: t("playerProfile.activityAndStats") },
    { value: "playstyle", icon: Gamepad2, label: t("playerProfile.playstyleTab") },
    { value: "keybindings", icon: Keyboard, label: t("playerProfile.keybindingsTab") },
    { value: "devices", icon: Mouse, label: t("playerProfile.devicesTab") },
    { value: "items", icon: Package, label: t("playerProfile.itemLayoutsTab") },
    ...(hideSearchCraftTab
      ? []
      : [{ value: "searchcraft", icon: Search, label: t("playerProfile.searchCraftTab") }]),
    { value: "guides", icon: BookOpen, label: t("playerProfile.guidesTab") },
  ];

  // 有効なタブ値のリスト
  const validTabs = ["profile", ...tabItems.map((t) => t.value)];

  // URLパラメータ `tab` を唯一の指定元とする（共有・ブックマーク・戻る/進むに対応）。
  // 不正値や未指定時は defaultProfileTab にフォールバック。defaultProfileTab 自体が無効
  // （廃止された旧enum値・SC非表示中の "searchcraft" 等）な場合は "profile" に落とす
  // （"profile" は tabItems の内容に関わらず validTabs に常に含まれるため安全）。
  // DB の defaultProfileTab は書き換えない（SC再開等で条件を満たせば自然に復活する）
  const tabFromUrl = searchParams.get("tab");
  const defaultTabRaw = player.defaultProfileTab ?? "profile";
  const defaultTab = validTabs.includes(defaultTabRaw) ? defaultTabRaw : "profile";
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

  // プリセット選択を表示するタブ（プリセットが1件も無い場合はセレクタ自体を出さない）
  const presetTabs = ["keybindings", "devices", "items", "searchcraft"];
  const showPresetSelector = presets.length > 0 && presetTabs.includes(activeTab);

  // メイン以外のプリセットを表示中か（「プリセット表示中」バッジ用)。
  // メインプリセットは既定表示そのものなのでバッジは出さない。
  const selectedPreset = presets.find((p) => p.id === selectedPresetId);
  const isViewingPresetSnapshot = !!selectedPreset && !selectedPreset.isMain;

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
              alt={playerName}
              className="w-8 h-8 rounded"
            />
          ) : (
            <div className="w-8 h-8 bg-muted rounded" />
          )}
          <div className="text-left">
            <p className="font-medium text-sm">{playerName}</p>
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

    {/* 縦サイドバー構成のためルートのカード化は打ち消す（パネル側が個別にカードになる） */}
    <Tabs value={activeTab} onValueChange={handleTabChange} orientation="vertical" className="flex flex-col lg:flex-row gap-6 overflow-visible rounded-none border-0 bg-transparent">

      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-56 shrink-0">
        {/* 初期位置と一致させ、スクロール時にサイドバーが滑らないようにする（ヘッダー65px+メイン上余白32px≈96px） */}
        <div className="sticky top-24 space-y-4">
          <TabsList className="m-0 w-full flex-col items-stretch gap-1 overflow-visible bg-transparent p-0">
            {/* Profile Tab with Avatar */}
            <TabsTrigger
              value="profile"
              className="h-auto w-full justify-start gap-3 rounded-md px-3 py-3 data-[state=inactive]:border-transparent data-[state=inactive]:bg-transparent data-[state=active]:border-b-border before:left-0 before:right-auto before:top-2 before:bottom-2 before:h-auto before:w-0.5"
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
                  alt={playerName}
                  className="w-10 h-10 rounded shrink-0"
                />
              ) : (
                <div className="w-10 h-10 bg-muted rounded shrink-0" />
              )}
              <div className="text-left min-w-0 flex-1">
                <p className="font-medium text-sm truncate">{playerName}</p>
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
                className="h-auto w-full justify-start gap-3 rounded-md px-3 py-2 data-[state=inactive]:border-transparent data-[state=inactive]:bg-transparent data-[state=active]:border-b-border before:left-0 before:right-auto before:top-2 before:bottom-2 before:h-auto before:w-0.5"
              >
                <item.icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
              </TabsTrigger>
            ))}
          </TabsList>

          {/* Preset Selector in Sidebar */}
          {showPresetSelector && (
            <div className="p-3 border rounded-lg space-y-2 bg-card">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Save className="h-3 w-3" />
                <span>{t("playerProfile.preset")}</span>
              </div>
              <Select
                value={selectedPresetId ?? ""}
                onValueChange={handlePresetChange}
              >
                <SelectTrigger className="w-full text-sm">
                  <SelectValue placeholder={t("playerProfile.currentSetting")} />
                </SelectTrigger>
                <SelectContent>
                  {presets.map((preset) => (
                    <SelectItem key={preset.id} value={preset.id}>
                      {preset.name}
                      {preset.isMain && t("playerProfile.presetMainSuffix")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isViewingPresetSnapshot && (
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
          <div className="lg:hidden flex items-center gap-3 p-3 border rounded-lg bg-card">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Save className="h-4 w-4" />
              <span>{t("playerProfile.presetWithColon")}</span>
            </div>
            <Select
              value={selectedPresetId ?? ""}
              onValueChange={handlePresetChange}
            >
              <SelectTrigger className="flex-1">
                <SelectValue placeholder={t("playerProfile.currentSetting")} />
              </SelectTrigger>
              <SelectContent>
                {presets.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>
                    {preset.name}
                    {preset.isMain && t("playerProfile.presetMainSuffix")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Profile Tab */}
        <TabsContent value="profile" className="rounded-none border-0 bg-transparent p-0 sm:p-0 space-y-4">
          {/* Header: Skin + Basic Info */}
          <Card className="py-5">
            <CardContent className="px-5">
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
                            aria-label={t("playerProfile.viewSkin3d")}
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
                              {t("playerProfile.skinDialogTitle", { name: playerName })}
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
                    <h1 className="text-2xl font-bold">{playerName}</h1>
                    {/* アルファベット表記はロケールを問わず併記する（見出しと同一なら省く） */}
                    {player.displayNameAlphabet && player.displayNameAlphabet !== playerName && (
                      <p className="text-sm text-muted-foreground">{player.displayNameAlphabet}</p>
                    )}
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
                      <Badge variant="outline">{platformLabel(t, player.mainPlatform) ?? player.mainPlatform}</Badge>
                    )}
                    {player.inputMethod && (
                      <Badge variant="outline">
                        {player.inputMethod === "keyboard_mouse" && "KBM"}
                        {player.inputMethod === "controller" && "Controller"}
                        {player.inputMethod === "touch" && "Touch"}
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
                    {player.pronouns && (
                      <span className="flex items-center gap-1">
                        <Speech className="h-4 w-4" aria-hidden />
                        {player.pronouns}
                      </span>
                    )}
                    {rtaCareer &&
                      // 年表示は端数月を切り捨てるので、その場合だけヒントで正確な経過を補う
                      (hasRtaCareerRemainder(rtaCareer) ? (
                        <HintTip
                          message={rtaCareerExactLabel(t, rtaCareer)}
                          className="text-sm"
                        >
                          <History className="h-4 w-4" aria-hidden />
                          <span className="underline decoration-dotted underline-offset-4">
                            {rtaCareerLabel(t, rtaCareer)}
                          </span>
                        </HintTip>
                      ) : (
                        <span className="flex items-center gap-1">
                          <History className="h-4 w-4" aria-hidden />
                          {rtaCareerLabel(t, rtaCareer)}
                        </span>
                      ))}
                    <span className="flex items-center gap-1">
                      <Calendar className="h-4 w-4" aria-hidden />
                      {t("playerProfile.lastUpdated", {
                        date: format(
                          new Date(player.updatedAt),
                          dateFormatPattern(locale),
                          { locale: dateFnsLocale(locale) },
                        ),
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
                      title={`${playerName} - Minefolio`}
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

                  {/* 絵文字リアクション */}
                  <ProfileReactionBar
                    pills={reactionPills}
                    toggle={toggleReaction}
                    isLoggedIn={profileReactions.viewerHasAccount}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Social Links（YouTube/Twitch は統計付きリッチカード） */}
          {player.socialLinks.length > 0 && (
            <SocialLinksCard links={player.socialLinks} slug={player.slug} />
          )}

          {/* Bio */}
          {player.bio && (
            <Card className="gap-3 py-5">
              <CardHeader className="px-5">
                <CardTitle className="text-base">{t("playerProfile.bio")}</CardTitle>
              </CardHeader>
              <CardContent className="px-5">
                <Suspense
                  fallback={
                    <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                      {player.bio}
                    </p>
                  }
                >
                  <BioMarkdown bio={player.bio} />
                </Suspense>
              </CardContent>
            </Card>
          )}

          {/* Videos（複数動画欄。行が無い場合は旧 featuredVideoUrl にフォールバック） */}
          {displayVideos.length > 0 && (
            <Card className="gap-3 py-5">
              <CardHeader className="px-5">
                <CardTitle className="text-base flex items-center gap-2">
                  <Video className="h-5 w-5" />
                  {t("playerProfile.videos")}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 space-y-4">
                {displayVideos.length === 1 ? (
                  // 1件のみは従来どおり大きく表示
                  <VideoEmbed video={displayVideos[0]} size="large" />
                ) : (
                  <>
                    {/* ピン留め動画は大きく単独表示 */}
                    {displayVideos.filter((v) => v.isPinned).map((video) => (
                      <VideoEmbed key={video.id} video={video} size="large" />
                    ))}
                    {/* その他の動画は2カラムグリッドで表示 */}
                    {displayVideos.some((v) => !v.isPinned) && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-4xl">
                        {displayVideos.filter((v) => !v.isPinned).map((video) => (
                          <VideoEmbed key={video.id} video={video} size="small" />
                        ))}
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Keybindings Tab */}
        <TabsContent value="keybindings" className="rounded-none border-0 bg-transparent p-0 sm:p-0 space-y-4">
          {player.keybindings.length > 0 ? (
            <>
              {/* Visual Keyboard */}
              <Card className="gap-3 py-5">
                <CardHeader className="px-5">
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
                        remaps={player.keyRemaps}
                        hasTypedRemaps={hasTypedRemaps}
                        initialRemapContext={remapView}
                        customKeys={customKeyboardKeys}
                        customButtons={customButtons}
                        isTKL={isTKL}
                        player={{
                          uuid: player.uuid,
                          skinUrl: player.customSkinUrl,
                          mcid: player.mcid,
                          displayName: player.displayName,
                          displayNameAlphabet: player.displayNameAlphabet,
                          slug: player.slug,
                        }}
                      />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="px-5">
                  <div className="flex flex-col items-start gap-4">
                    {/* メインキーボード */}
                    <div className="custom-scrollbar overflow-x-auto pb-2 w-full">
                      <VirtualKeyboard
                        layout={keyboardLayout}
                        keybindings={keybindingsMap}
                        fingerAssignments={userFingerAssignments}
                        remaps={remapsForKeyboard}
                        customActions={player.customActions}
                        customKeys={customKeyboardKeys}
                        showActionLabels
                        showFingerAssignments
                        showRemaps
                        hideNumpad
                      />
                    </div>
                    {/* テンキーとマウスを横並び */}
                    <div className="custom-scrollbar overflow-x-auto pb-2 w-full">
                      <div className="flex items-start gap-6">
                        {!isTKL && (
                          <VirtualNumpad
                            keybindings={keybindingsMap}
                            fingerAssignments={userFingerAssignments}
                            remaps={remapsForKeyboard}
                            customActions={player.customActions}
                            showActionLabels
                            showFingerAssignments
                            showRemaps
                          />
                        )}
                        <VirtualMouse
                          keybindings={keybindingsMap}
                          fingerAssignments={userFingerAssignments}
                          remaps={remapsForKeyboard}
                          customActions={player.customActions}
                          customButtons={customButtons}
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
                    <Card key={group.key} className="gap-3 py-5">
                      <CardHeader className="px-5">
                        <CardTitle className={`text-base ${group.colorClass}`}>
                          {group.label}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="px-5">
                        <div className="divide-y">
                          {bindings.map((kb) => (
                            <div
                              key={kb.id}
                              className="flex justify-between items-center py-2.5"
                            >
                              <span className="text-sm">{getActionLabel(t, kb.action)}</span>
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
                  <Card className="gap-3 py-5">
                    <CardHeader className="px-5">
                      <CardTitle className="text-base">
                        {t("playerProfile.customActions")}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-5">
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
                                    <kbd className="px-2.5 py-1 bg-secondary/80 rounded text-sm font-mono min-w-16 text-center">
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
                  <Card className="gap-3 py-5">
                    <CardHeader className="px-5">
                      <CardTitle className="text-base">
                        {t("playerProfile.remaps")}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-5">
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
                                  <kbd className="px-2.5 py-1 bg-secondary/80 rounded text-sm font-mono min-w-16 text-center">
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
        <TabsContent value="stats" className="rounded-none border-0 bg-transparent p-0 sm:p-0 space-y-4">
          <StatsTabContent
            player={player}
            hiddenSpeedrunRecords={hiddenSpeedrunRecords}
            pinnedSpeedrunRecords={pinnedSpeedrunRecords}
            pacemanStats={pacemanStats}
          />
        </TabsContent>

        {/* Playstyle Tab */}
        <TabsContent value="playstyle" className="rounded-none border-0 bg-transparent p-0 sm:p-0 space-y-4">
          {hasPlaystyleData ? (
            <>
              {/* プレイ内容 */}
              {hasPlaystylePlayContent && (
                <Card className="gap-3 py-5">
                  <CardHeader className="px-5">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Layers className="h-5 w-5" />
                      {t("playerProfile.playstylePlayContent")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-5 space-y-4">
                    {playstylePlayContentRows.map((row, i) => (
                      <div key={i} className="space-y-2">
                        <p className="text-sm text-muted-foreground">{row.label}</p>
                        {row.value}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* 操作 */}
              {hasPlaystyleControls && (
                <Card className="gap-3 py-5">
                  <CardHeader className="px-5">
                    <CardTitle className="text-base flex items-center gap-2">
                      <SlidersHorizontal className="h-5 w-5" />
                      {t("playerProfile.playstyleControls")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-5">
                    <div className="divide-y">
                      {playstyleControlsRows.map((row, i) => (
                        <DeviceRow key={i} label={row.label} value={row.value} />
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* テクニック */}
              {hasPlaystyleTechnique && (
                <Card className="gap-3 py-5">
                  <CardHeader className="px-5">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Sparkles className="h-5 w-5" />
                      {t("playerProfile.playstyleTechnique")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-5">
                    <div className="divide-y">
                      {playstyleTechniqueRows.map((row, i) => (
                        <DeviceRow key={i} label={row.label} value={row.value} />
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          ) : (
            <EmptyState
              icon={<Gamepad2 className="h-12 w-12" />}
              title={t("playerProfile.noPlaystyleTitle")}
              description={t("playerProfile.noPlaystyle")}
              action={
                isOwner ? (
                  <Button asChild size="sm" variant="outline" className="mt-4">
                    <Link to="/me/playstyle">{t("playerProfile.noPlaystyleEditLink")}</Link>
                  </Button>
                ) : undefined
              }
            />
          )}
        </TabsContent>

        {/* Item Layouts Tab */}
        <TabsContent value="items" className="rounded-none border-0 bg-transparent p-0 sm:p-0 space-y-4">
          {player.itemLayouts.length > 0 ? (
            <Card className="gap-3 py-5">
              <CardContent className="px-5">
                <div className="divide-y">
                  {player.itemLayouts.map((layout) => (
                    <ItemLayoutRow key={layout.id} layout={layout} />
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : (
            <EmptyState
              icon={<Package className="h-12 w-12" />}
              title={t("playerProfile.noItemLayoutsTitle")}
              description={t("playerProfile.noItemLayouts")}
            />
          )}
        </TabsContent>

        {/* Search Craft Tab */}
        <TabsContent value="searchcraft" className="rounded-none border-0 bg-transparent p-0 sm:p-0 space-y-4">
          {player.searchCrafts.length > 0 ? (
            <>
              {/* サマリーバー: ゲーム言語・件数・凡例 */}
              <div className="rounded-xl border border-border/70 bg-card px-4 py-3 space-y-2.5">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                  {player.playerConfig?.gameLanguage && (
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Languages className="h-4 w-4" />
                      <span>{t("playerProfile.gameLanguage")}:</span>
                      <Badge variant="secondary">
                        {getGameLanguageName(t, locale, player.playerConfig.gameLanguage)}
                      </Badge>
                    </div>
                  )}
                  <Badge variant="outline" className="text-muted-foreground">
                    {t("playerProfile.searchCraftCount", { count: player.searchCrafts.length })}
                  </Badge>
                  {player.searchCraftLoops.length > 0 && (
                    <Badge variant="outline" className="text-muted-foreground">
                      {t("playerProfile.loopCount", { count: player.searchCraftLoops.length })}
                    </Badge>
                  )}
                </div>
                <KeyBadgeLegend
                  showFingers={Object.keys(userFingerAssignments).length > 0}
                  showCraftMarker={player.searchCraftLoops.length > 0}
                />
              </div>
              <SearchCraftGroupedList
                crafts={parsedSearchCrafts}
                remaps={player.keyRemaps}
                fingerAssignments={userFingerAssignments}
                gameLanguage={player.playerConfig?.gameLanguage}
                extraTimings={searchCraftLoopTimings}
                renderGroupExtra={renderSearchCraftLoopExtra}
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
        <TabsContent value="devices" className="rounded-none border-0 bg-transparent p-0 sm:p-0 space-y-4">
          {player.playerConfig ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Keyboard */}
                <Card className="gap-3 py-5">
                  <CardHeader className="px-5">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Keyboard className="h-5 w-5" />
                      {t("playerProfile.keyboard")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-5">
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
                <Card className="gap-3 py-5">
                  <CardHeader className="px-5">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Mouse className="h-5 w-5" />
                      {t("playerProfile.mouse")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-5">
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
                            value={
                              <WinSensValue
                                windowsSpeed={player.playerConfig.windowsSpeed}
                                multiplierClassName="text-muted-foreground ml-1"
                              />
                            }
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
                        {/* ゲーム内感度（有効範囲外は一覧と同じく警告付きで出す） */}
                        {player.playerConfig.gameSensitivity != null &&
                          (isValidSensitivity(player.playerConfig.gameSensitivity) ? (
                            <DeviceRow
                              label={t("playerProfile.inGameSensitivity")}
                              value={String(toSensitivityPercent(player.playerConfig.gameSensitivity))}
                              unit="%"
                            />
                          ) : (
                            <DeviceRow
                              label={t("playerProfile.inGameSensitivity")}
                              value={
                                <SensitivityWarning
                                  percent={toSensitivityPercent(player.playerConfig.gameSensitivity)}
                                />
                              }
                            />
                          ))}
                        {/* Raw Input */}
                        {player.playerConfig.rawInput != null && (
                          <DeviceRow
                            label={t("playerProfile.rawInput")}
                            value={player.playerConfig.rawInput ? t("common.on") : t("common.off")}
                          />
                        )}
                        {/* 振り向き（計算できなければ行を消さず「-」+ 理由） */}
                        <DeviceRow
                          label={t("playerProfile.turnDistance")}
                          value={<TurnDistanceValue config={player.playerConfig} />}
                        />
                        {/* カーソル速度（同上） */}
                        <DeviceRow
                          label={t("playerProfile.cursorSpeed")}
                          value={<CursorSpeedValue config={player.playerConfig} />}
                        />
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
              <Card className="gap-3 py-5">
                <CardHeader className="px-5">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Settings className="h-5 w-5" />
                    {t("playerProfile.inGameSettings")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-5">
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
                          value={getGameLanguageName(t, locale, player.playerConfig.gameLanguage)}
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
        <TabsContent value="guides" className="rounded-none border-0 bg-transparent p-0 sm:p-0 space-y-4">
          {playerGuides.length > 0 ? (
            <>
              <div className="flex justify-end">
                <ViewToggle viewMode={guidesViewMode} onChange={setGuidesViewMode} />
              </div>
              {guidesViewMode === "card" ? (
                <GuideCardGrid
                  guides={playerGuides}
                  linkFn={(guide) => `/guides/${player.slug}/${guide.slug}`}
                  gridCols="sm:grid-cols-2"
                />
              ) : (
                <GuideListView
                  guides={playerGuides}
                  linkFn={(guide) => `/guides/${player.slug}/${guide.slug}`}
                />
              )}
            </>
          ) : (
            <EmptyState
              icon={<BookOpen className="h-12 w-12" />}
              title={t("playerProfile.noGuidesTitle")}
              description={t("playerProfile.noGuidesDescription")}
            />
          )}
        </TabsContent>

      </div>
    </Tabs>
    </>
  );
}

// mcitemsのテクスチャベースURL

// アイテム名のロケールフォールバックは共通ヘルパーを使用（app/components/item-icon.tsx の getLocalizedItemName）

// ゲーム言語名の取得は共通モジュールを使用（app/lib/game-languages.ts）

// プラットフォーム表示名を取得
/** 入力方法（users.inputMethod）の表示ラベル。プレイスタイルタブの行表示専用 */
function inputMethodLabel(t: Translator, value: string): string {
  switch (value) {
    case "keyboard_mouse":
      return t("playerProfile.playstyleInputMethodKeyboardMouse");
    case "controller":
      return t("playerProfile.playstyleInputMethodController");
    case "touch":
      return t("playerProfile.playstyleInputMethodTouch");
    default:
      return value;
  }
}

/**
 * アイテム配置行のセグメント名 → 見出し色ドットのマップ（完全一致。新色は導入しない）。
 * マップ外（Common / Enter Nether / Enter End 系・カスタム名）は searchcraft の
 * 「その他」タイミングと同じグレードット（bg-muted-foreground）で統一する
 */
const ITEM_LAYOUT_SEGMENT_DOT_CLASSES: Record<string, string> = {
  Overworld: "bg-success",
  Bastion: "bg-warning",
  "Bastion → Fort": "bg-info",
  Fortress: "bg-destructive",
  "Blinded / Stronghold": "bg-primary",
};

/** アイテム配置カード内の1セグメント分の行（見出し + ホットバー + メモ）。アイテム名はホットバーの Tooltip でのみ提示する */
function ItemLayoutRow({
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
  const t = useT();
  const locale = useLocale();
  const slots = JSON.parse(layout.slots) as Slot[];
  const offhand = layout.offhand ? (JSON.parse(layout.offhand) as string[]) : [];
  const dotClass = ITEM_LAYOUT_SEGMENT_DOT_CLASSES[layout.segment] ?? "bg-muted-foreground";

  return (
    <div className="py-4 first:pt-0 last:pb-0 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        {dotClass && <span className={cn("h-2.5 w-2.5 rounded-full", dotClass)} />}
        {layout.segment}
      </div>
      <ItemHotbar
        slots={slots}
        offhand={offhand}
        offhandLabel={t("playerProfile.offhandShort")}
        renderSlotWrapper={({ items, tile }) =>
          items.length === 0 ? (
            tile
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <div>{tile}</div>
              </TooltipTrigger>
              <TooltipContent>
                {items.map((item) => getLocalizedItemName(item, locale)).join(", ")}
              </TooltipContent>
            </Tooltip>
          )
        }
      />
      {layout.notes && (
        <p className="text-sm text-muted-foreground">{layout.notes}</p>
      )}
    </div>
  );
}

// KeyBadge / SearchCraftLegend / SearchCraftList 系は @/components/search-craft-template-view に共通化済み

// pbVideoUrl は http/https のみをリンク化する。過去に保存された javascript: 等の危険な
// スキームを href として DOM に到達させないためのレンダー時ガード（書き込み側の検証は
// routes/me/records.tsx にもある）。F6 所有の app/lib/safe-url.ts には依存しない局所実装。
function isHttpVideoUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:";
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
    isPinned?: boolean;
  };
}) {
  const t = useT();
  const locale = useLocale();
  return (
    // ピン留め記録はグリッド2列分に拡大し、枠線で強調する
    <Card className={cn("gap-3 py-5", record.isPinned && "md:col-span-2 border-primary/40")}>
      <CardHeader className="px-5">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-1.5">
              {record.isPinned && <Pin className="h-4 w-4 text-primary shrink-0" />}
              {record.categoryDisplayName}
            </CardTitle>
            {record.subcategory && (
              <CardDescription>{record.subcategory}</CardDescription>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-5 space-y-2">
        {record.personalBest && (
          <div className="flex items-baseline gap-2">
            <span className={cn("font-mono font-bold", record.isPinned ? "text-3xl" : "text-2xl")}>
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
              <CheckCircle2 className="h-4 w-4 text-success" />
            )}
          </div>
        )}
        {record.pbVideoUrl && isHttpVideoUrl(record.pbVideoUrl) && (
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
      // http/https 以外（javascript: 等）は href に流さず "#" に落とす。
      // 過去に保存された不正スキームの行もここで無害化される。
      return safeExternalHref(customUrl) ?? "#";
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

// ソーシャルリンクカードで扱うリンク行（loader の socialLinks から使用する列のみ）
type ProfileSocialLink = {
  id: string;
  platform: string;
  identifier: string;
  customLabel: string | null;
  customUrl: string | null;
};

// /api/social-stats のレスポンス形状
type SocialStatsData = {
  youtube: YouTubeChannelStats | null;
  twitch: TwitchChannelStats | null;
};

// 日本語は「1.2万」等のコンパクト表記（1万以上）、英語は "1.2K" 等（Intl compact）。
// いずれも閾値未満は桁区切り（例: 2,170）
function formatCompactCount(count: number, locale: Locale): string {
  const intlLocale = locale === "en" ? "en-US" : "ja-JP";
  if (count < 10000) return count.toLocaleString(intlLocale);
  return new Intl.NumberFormat(intlLocale, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(count);
}

// ソーシャルリンクカード: YouTube/Twitch は統計（登録者数・最終活動日時）付きの
// リッチカード、その他のプラットフォームは従来のボタン表示。
// 統計はAPIキーがサーバー専用のため /api/social-stats（キャッシュあり）から遅延取得する
function SocialLinksCard({ links, slug }: { links: ProfileSocialLink[]; slug: string }) {
  const t = useT();
  const locale = useLocale();
  const richLinks = links.filter((l) => l.platform === "youtube" || l.platform === "twitch");
  const plainLinks = links.filter((l) => l.platform !== "youtube" && l.platform !== "twitch");
  const [stats, setStats] = useState<SocialStatsData | null>(null);

  const hasRichLinks = richLinks.length > 0;
  useEffect(() => {
    if (!hasRichLinks) return;
    let cancelled = false;
    fetch(`/api/social-stats?slug=${encodeURIComponent(slug)}`)
      .then((res) => (res.ok ? (res.json() as Promise<SocialStatsData>) : null))
      .then((data) => {
        if (!cancelled && data) setStats(data);
      })
      .catch((error) => {
        console.error("Failed to fetch social stats:", error);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, hasRichLinks]);

  return (
    <Card className="gap-3 py-5">
      <CardHeader className="px-5">
        <CardTitle className="text-base">{t("playerProfile.links")}</CardTitle>
      </CardHeader>
      <CardContent className="px-5 space-y-2">
        {hasRichLinks && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {richLinks.map((link) => (
              <SocialLinkRichCard
                key={link.id}
                link={link}
                stats={
                  link.platform === "youtube"
                    ? (stats?.youtube ?? null)
                    : (stats?.twitch ?? null)
                }
              />
            ))}
          </div>
        )}
        {plainLinks.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {plainLinks.map((link) => (
              <Button key={link.id} variant="outline" asChild className="gap-2 h-10 px-4">
                <a href={getSocialUrl(link.platform, link.identifier, link.customUrl)} target="_blank" rel="noopener noreferrer">
                  <SocialIcon platform={link.platform} />
                  <span className="font-medium">{getSocialPlatformName(link.platform, link.customLabel)}</span>
                  <span className="text-muted-foreground">{link.identifier}</span>
                </a>
              </Button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// YouTube/Twitch のリッチカード。統計未取得（ロード中・失敗・APIキー未設定）の間は
// リンク行のみを表示し、取得後に統計行と配信中バッジを出す
function SocialLinkRichCard({
  link,
  stats,
}: {
  link: ProfileSocialLink;
  stats: YouTubeChannelStats | TwitchChannelStats | null;
}) {
  const t = useT();
  const locale = useLocale();
  const statParts: string[] = [];
  let isLive = false;

  if (stats) {
    if (link.platform === "youtube") {
      const yt = stats as YouTubeChannelStats;
      if (yt.subscriberCount != null) {
        statParts.push(
          t("playerProfile.subscribersCompact", { count: formatCompactCount(yt.subscriberCount, locale) }),
        );
      }
      if (yt.latestVideoAt) {
        statParts.push(
          t("playerProfile.latestVideoAgo", {
            time: formatDistanceToNow(new Date(yt.latestVideoAt), { addSuffix: true, locale: dateFnsLocale(locale) }),
          }),
        );
      }
    } else {
      const tw = stats as TwitchChannelStats;
      isLive = tw.isLive;
      if (tw.followerCount != null) {
        statParts.push(
          t("playerProfile.followersCompact", { count: formatCompactCount(tw.followerCount, locale) }),
        );
      }
      if (!tw.isLive && tw.lastStreamAt) {
        statParts.push(
          t("playerProfile.lastStreamAgo", {
            time: formatDistanceToNow(new Date(tw.lastStreamAt), { addSuffix: true, locale: dateFnsLocale(locale) }),
          }),
        );
      }
    }
  }

  return (
    <a
      href={getSocialUrl(link.platform, link.identifier, link.customUrl)}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 rounded-lg border bg-secondary/30 px-3.5 py-2.5 transition-colors hover:bg-secondary/60"
    >
      <SocialIcon platform={link.platform} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-sm font-medium">
            {getSocialPlatformName(link.platform, link.customLabel)}
          </span>
          <span className="truncate text-sm text-muted-foreground">{link.identifier}</span>
          {isLive && (
            <Badge className="shrink-0 gap-1 border-transparent bg-destructive px-1.5 text-white">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
              {t("playerProfile.liveNow")}
            </Badge>
          )}
        </div>
        {/* statPartsに相対時刻（latestVideoAgo/lastStreamAgo）を含む場合があり、SSRとhydrationで基準時刻がずれるため警告を抑制 */}
        {statParts.length > 0 && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground" suppressHydrationWarning>{statParts.join(" · ")}</p>
        )}
      </div>
      <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
    </a>
  );
}

function DeviceRow({ label, value, unit }: { label: string; value: ReactNode; unit?: string }) {
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

/** 振り向き（cm/360）。計算できないときは行を消さず「-」+ 理由を出す */
function TurnDistanceValue({ config }: { config: MouseReasonConfig }) {
  const t = useT();
  const cm360 = calculateCm360(
    config.mouseDpi,
    config.gameSensitivity,
    config.rawInput,
    config.windowsSpeed,
    config.windowsSpeedMultiplier,
  );
  if (cm360 == null) {
    return <MissingMouseValue reasons={cm360MissingReasons(t, config)} />;
  }
  return (
    <>
      {cm360.toFixed(2)}
      <span className="text-muted-foreground ml-1">cm</span>
    </>
  );
}

/** カーソル速度（実効 DPI）。計算できないときは行を消さず「-」+ 理由を出す */
function CursorSpeedValue({ config }: { config: MouseReasonConfig }) {
  const t = useT();
  const cursorSpeed = calculateCursorSpeed(
    config.mouseDpi,
    config.windowsSpeed,
    config.windowsSpeedMultiplier,
  );
  if (cursorSpeed == null) {
    return <MissingMouseValue reasons={cursorSpeedMissingReasons(t, config)} />;
  }
  // 一覧の CursorSpeedCell と同じく実効 DPI であることを単位で示す
  return (
    <>
      {cursorSpeed}
      <span className="ml-1 text-muted-foreground">DPI</span>
    </>
  );
}

function SettingBadge({
  label,
  enabled,
}: {
  label: string;
  enabled: boolean | null;
}) {
  const t = useT();
  const locale = useLocale();
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

/** プロフィール動画の表示用エントリ（profileVideos 行 or 旧 featuredVideoUrl フォールバック） */
type DisplayVideo = {
  id: string;
  url: string;
  title: string | null;
  isPinned: boolean;
};

/**
 * 動画の埋め込み表示。埋め込みURLへ変換できないURL（チャンネル・プレイリスト等）は
 * iframe に渡さず外部リンクとして表示する（X-Frame-Options ブロックの防止）。
 */
function VideoEmbed({ video, size }: { video: DisplayVideo; size: "large" | "small" }) {
  const embedUrl = getYouTubeEmbedUrl(video.url);
  const containerClass = size === "large" ? "max-w-2xl" : "";

  if (!embedUrl) {
    return (
      <div className={cn("rounded-lg border bg-secondary/30 p-3", containerClass)}>
        <a
          href={video.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline break-all"
        >
          <ExternalLink className="h-3.5 w-3.5 shrink-0" />
          {video.title || video.url}
        </a>
      </div>
    );
  }

  return (
    <div className={containerClass}>
      {(video.isPinned || video.title) && (
        <div className="flex items-center gap-1.5 mb-1.5">
          {video.isPinned && <Pin className="h-3.5 w-3.5 text-primary shrink-0" />}
          {video.title && <span className="text-sm font-medium truncate">{video.title}</span>}
        </div>
      )}
      <YouTubeEmbed embedUrl={embedUrl} title={video.title || "Video"} />
    </div>
  );
}

// Stats タブのコンテナ（クライアント側でデータ取得）
function StatsTabContent({
  player,
  hiddenSpeedrunRecords,
  pinnedSpeedrunRecords,
  pacemanStats,
}: {
  player: any;
  hiddenSpeedrunRecords: string[];
  pinnedSpeedrunRecords: string[];
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
      pinnedSpeedrunRecords={pinnedSpeedrunRecords}
      pacemanStats={pacemanStats}
      loadState={loadState}
    />
  );
}

function filterWeeklyMainPaces(mainPaces: any[]): any[] {
  const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return mainPaces.filter((pace) => {
    const date = pace?.date ? new Date(pace.date).getTime() : NaN;
    return Number.isFinite(date) && date >= oneWeekAgo;
  });
}

// Stats タブのコンテンツ
function StatsContent({
  externalStats,
  player,
  hiddenSpeedrunRecords,
  pinnedSpeedrunRecords,
  pacemanStats,
  loadState,
}: {
  externalStats: Awaited<ReturnType<typeof fetchAllExternalStats>>;
  player: any;
  hiddenSpeedrunRecords: string[];
  pinnedSpeedrunRecords: string[];
  pacemanStats: { netherEnterCount: number; mainPaces: any[] } | null;
  loadState: {
    ranked: "loading" | "done" | "error";
    paceman: "loading" | "done" | "error";
    speedruncom: "loading" | "done" | "error";
  };
}) {
  const t = useT();
  const weeklyMainPaces = pacemanStats ? filterWeeklyMainPaces(pacemanStats.mainPaces) : [];
  const allExternalResolved = loadState.ranked !== "loading"
    && loadState.paceman !== "loading"
    && loadState.speedruncom !== "loading";
  const hasExternalError = loadState.ranked === "error"
    || loadState.paceman === "error"
    || loadState.speedruncom === "error";
  // Speedrun.com PBの絞り込み・並び替え用（sort比較関数内でのArray.includes連発を避ける）
  const hiddenSet = new Set(hiddenSpeedrunRecords);
  const pinnedSet = new Set(pinnedSpeedrunRecords);

  return (
    <>
      {/* MCSR Ranked Section */}
      {player.showRankedStats !== false && loadState.ranked !== "done" && (
        <StatsServiceLoadingCard
          title="MCSR Ranked"
          description={t("loading.rankedStats")}
          state={loadState.ranked}
        />
      )}
      {externalStats.ranked?.isRegistered && player.showRankedStats !== false && loadState.ranked !== "loading" && (
        <MCSRRankedCard ranked={externalStats.ranked} />
      )}

      {/* PaceMan Section - リンクのみ（週間統計とは独立にロード状態を持つため別カード） */}
      {loadState.paceman !== "done" && (
        <StatsServiceLoadingCard
          title="PaceMan"
          description={t("loading.pacemanStats")}
          state={loadState.paceman}
        />
      )}
      {externalStats.paceman?.isRegistered && loadState.paceman !== "loading" && player.mcid && (
        <PaceManLinkCard mcid={player.mcid} />
      )}

      {/* PaceMan 過去1週間の統計（loader取得済みのためロード状態に依存しない） */}
      {pacemanStats && player.showPacemanStats !== false && (pacemanStats.netherEnterCount > 0 || weeklyMainPaces.length > 0) && (
        <PaceManStatsCard netherEnterCount={pacemanStats.netherEnterCount} mainPaces={weeklyMainPaces} />
      )}

      {/* Speedrun.com Section */}
      {player.speedruncomUsername && loadState.speedruncom !== "done" && (
        <StatsServiceLoadingCard
          title="Speedrun.com"
          description={t("loading.speedruncomStats")}
          state={loadState.speedruncom}
        />
      )}
      {externalStats.speedruncom && !externalStats.speedruncom.error && externalStats.speedruncom.personalBests.length > 0 && loadState.speedruncom !== "loading" && (
        <SpeedrunComCard
          speedruncom={externalStats.speedruncom}
          hiddenRunIds={hiddenSet}
          pinnedRunIds={pinnedSet}
          showVideoEmbed
        />
      )}

      {/* カスタム記録 */}
      {player.categoryRecords.length > 0 && (
        <Card className="gap-3 py-5">
          <CardHeader className="px-5">
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="h-5 w-5" />
              {t("playerProfile.customRecords")}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-5">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {player.categoryRecords.map((record: any) => (
                <RecordCard key={record.id} record={record} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* データがない場合（外部サービスがエラーの場合は各セクションのエラー表示に任せ、ここでは出さない） */}
      {allExternalResolved && !hasExternalError && (!externalStats.ranked?.isRegistered && !externalStats.paceman?.isRegistered && !externalStats.speedruncom?.personalBests?.length && player.categoryRecords.length === 0) && (
        <EmptyState
          icon={<BarChart3 className="h-12 w-12" />}
          title={t("playerProfile.noStatsTitle")}
          description={t("playerProfile.noStatsDescription")}
        />
      )}
    </>
  );
}
