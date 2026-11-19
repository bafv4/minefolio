import { createTranslator } from "@/lib/messages";
import { resolveLocale, localeFromMatches, type Locale } from "@/lib/locale";
import { useLoaderData, useRouteLoaderData, Link, useSearchParams, useNavigation, useLocation, redirect, type ShouldRevalidateFunctionArgs } from "react-router";
import { useState, useEffect, useMemo, useRef, useCallback, lazy, Suspense, Fragment, type ReactNode } from "react";
import { ViewToggle } from "@/components/view-toggle";
import {
  GuideCardGrid,
  GuideListView,
} from "@/components/guide-list-views";
import type { Route } from "./+types/profile";
import { createDb } from "@/lib/db";
import { loadPendingSpeedrunRecords, type PendingSpeedrunRecord } from "@/lib/speedruncom-pending.server";
import { createAuth } from "@/lib/auth";
import { getOptionalSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users, categoryRecords, keybindings, socialLinks, profileVideos, itemLayouts, searchCrafts, searchCraftLoops, configPresets, customKeys, customActions, guides } from "@/lib/schema";
import { eq, asc, desc, sql } from "drizzle-orm";
import { fetchAllExternalStats } from "@/lib/external-stats";
import { fetchPaceManRegistration } from "@/lib/paceman-registration-client";
import { ItemHotbar, type Slot } from "@/components/item-hotbar";
import { MinecraftFullBody, type PoseName } from "@/components/minecraft-fullbody";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import {
  MCSRRankedCard,
  PaceManLinkCard,
  PaceManStatsCard,
  SpeedrunComCard,
  PendingSpeedrunRecordsCard,
  StatsServiceLoadingCard,
} from "@/components/player-stats-cards";
import { platformLabel } from "@/lib/platform-label";
import { getLocalizedDisplayName } from "@/lib/slug";
import { resolveCapeProps } from "@/lib/cape";
import { format, formatDistanceToNow } from "date-fns";
import { dateFnsLocale, dateFormatPattern } from "@/lib/date-locale";
import { useT, useLocale } from "@/hooks/use-locale";
import type { Translator } from "@/lib/messages";
import { useProfileReactions } from "@/hooks/use-profile-reactions";
import { getGameLanguageName, hasItemNameDictionary } from "@/lib/game-languages";
import { itemLangForLocale } from "@/components/item-icon";
import { toUiRemaps, filterRemapsForContext, type RemapContext } from "@/lib/remap-utils";
import { decodePresetConfig, parseFingerAssignments } from "@/lib/preset-read";
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
import { getMinefolioEloRank } from "@/lib/rankings-query.server";
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
import { YouTubeClickEmbed } from "@/components/youtube-click-embed";
import type { YouTubeChannelStats } from "@/lib/youtube";
import type { TwitchChannelStats } from "@/lib/twitch";
import { resolvePlayerSlugFallback } from "@/lib/player-slug-fallback.server";
import { getGuideTranslations, getUserBioTranslation } from "@/lib/content-translation.server";
import { applyGuideTranslation } from "@/lib/guide-translation-list";
import { AutoTranslateNotice } from "@/components/auto-translate-notice";
import { LinkifiedText } from "@/components/profile/linkified-text";

// スキン静止画の表示寸法は CSS で出し分ける（sm 未満 206×240 / sm 以上 240×280。どちらも縦横比 0.857）。
// useMediaQuery で決めると SSR はデスクトップ寸法で描かれ、モバイルでハイドレーション後に変わって跳ねる（CLS）。
// モバイルは縦を使いすぎない（スキンの下の最初の情報が下端ドックより上に入る）高さに抑える。
// 描画解像度は 320×380 に固定し、表示は MinecraftFullBody の fluid で箱に収める（縮小表示）
const SKIN_VIEW_RENDER_SIZE = { width: 320, height: 380 } as const;
// md 未満は身元帯の顔と重なり最初の画面を占めるので 128px に抑える（縦横比は 206:240 のまま）
const SKIN_VIEW_BOX_CLASS = "h-32 w-[110px] md:h-[280px] md:w-[240px]";

// 記録タブの外部統計は到着が遅いので、読み込み中の欄に、届いたあとの中身に近い最小の高さを確保する
// （初期表示のフッターが到着で押し下げられる CLS を抑える。確保は読み込み中だけで、到着後は外れる）。
// 値は実測の目安（Ranked: 統計＋推移グラフ＋直近5試合、SRC: PB カード最大6件。モバイルは1列で縦に長い）
const STATS_RANKED_LOADING_CLASS = "min-h-[32rem] md:min-h-[28rem]";
const STATS_SPEEDRUNCOM_LOADING_CLASS = "min-h-[48rem] md:min-h-[36rem]";

// OGPメタタグ
export function meta({ loaderData, matches }: Route.MetaArgs) {
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
  // 現行の骨格（身元帯 → ホットバー → タブ名 h2 → 欄）と同じ配置。細部は再現しない
  return (
    <div aria-hidden="true" className="flex flex-col gap-4 md:gap-6 animate-in fade-in duration-200">
      {/* 身元帯（アバター 40px / md 以上 64px、名前、操作ボタン） */}
      <div className="space-y-3 rounded-2xl border border-border/70 bg-card/70 px-4 py-3 md:space-y-4 md:p-5">
        <div className="flex items-center justify-between gap-3 md:gap-6">
          <div className="flex min-w-0 items-center gap-3 md:gap-4">
            <Skeleton className="size-10 shrink-0 rounded md:size-16" />
            <div className="space-y-2">
              <Skeleton className="h-8 w-40 md:h-9" />
              <Skeleton className="h-4 w-24" />
            </div>
          </div>
          <div className="flex shrink-0 gap-1 md:gap-2">
            <Skeleton className="size-9 md:w-20" />
            <Skeleton className="size-9 md:w-20" />
          </div>
        </div>
      </div>

      {/* ホットバー */}
      <Skeleton className="h-12 w-full rounded-xl md:h-14" />

      {/* タブ名 h2 → 欄 */}
      <div className="space-y-7 sm:space-y-8">
        <Skeleton className="h-8 w-40" />
        <div className="space-y-3 border-t border-foreground/15 pt-6">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
        <div className="space-y-3 border-t border-foreground/15 pt-6">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-32 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}
import { getActionLabel, getKeyLabel, isTklLayout, normalizeKeyCode, parseKeyCombination, MODIFIER_LABELS, UNBOUND_KEY, type KeyboardLayout } from "@/lib/keybindings";
import { HorizontalScrollArea } from "@/components/horizontal-scroll-area";
import { ProfileHotbarTabs, type ProfileHotbarItem } from "@/components/profile-hotbar-tabs";
import { VirtualKeyboard, VirtualMouse, VirtualNumpad, FingerLegend, keybindingsToMap } from "@/components/virtual-keyboard";
import { KeyboardExportDialog } from "@/components/keybindings/keyboard-export-dialog";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
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
  ExternalLink,
  Pencil,
  Calendar,
  History,
  Package,
  Search,
  BarChart3,
  GitCompare,
  Users,
  Save,
  User,
  Loader2,
  BookOpen,
  Maximize2,
  Info,
  Languages,
  Pin,
  Gamepad2,
  Speech,
  CircleHelp,
  ChevronRight,
} from "lucide-react";
import { Youtube, Twitch, Twitter } from "@/components/brand-icons";
import { ShareButton } from "@/components/share-button";
import { FavoriteButton } from "@/components/favorite-button";
import { ProfileReactionBar } from "@/components/profile-reaction-bar";
import { EmptyState } from "@/components/empty-state";
import type { loader as layoutLoader } from "../_layout";
import { PageSection } from "@/components/page-section";
import { KeyboardScaledPreview } from "@/components/keyboard-scaled-preview";
import { EmptyValue, OwnerEditAction } from "@/components/player-profile-bits";
import { NoticeBanner } from "@/components/notice-banner";
import { RecordCard, type RecordCardRecord } from "@/components/record-card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { getNetherEnterCount, getRecentPacesForPlayer, type GroupedPaceEntry } from "@/lib/paceman-cache";
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
import { fetchMCSRRankedStatsCached } from "@/lib/ranked-stats-cache";
import { fetchSpeedrunComStatsCached } from "@/lib/speedruncom-stats-cache";
import { ProfileHighlights } from "@/components/profile-highlights";
import { pickRepresentativePb, rankedBestTimeMs } from "@/lib/profile-highlights";
import { orderStatsSections, type StatsSectionKey } from "@/lib/profile-stats-order";
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
// 審査中記録のトグル（`srcPending`）も表示だけの指定で loader は読まないので同じ扱いにする
// （切り替えるたびに重い loader を走らせない。スイッチ自体はローカル状態で即時に切り替わる）。
/** 表示だけを切り替える（loader が読まない）検索パラメータ。これだけが変わったときは loader を再実行しない */
const PROFILE_VIEW_ONLY_PARAMS = ["tab", "srcPending"] as const;

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
    for (const key of PROFILE_VIEW_ONLY_PARAMS) {
      cur.delete(key);
      next.delete(key);
    }
    if (cur.toString() === next.toString()) return false;
  }
  return defaultShouldRevalidate;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const viewerLocale = resolveLocale(request);
  const t = createTranslator(viewerLocale);
  const env = getEnv();
  const db = createDb();
  const auth = createAuth(db, env);

  const { slug } = params;
  const url = new URL(request.url);
  const presetId = url.searchParams.get("preset");
  const normalizedSlug = slug?.toLowerCase();

  // 非公開プロフィールへのアクセスは、重い with クエリを実行する前に判定する（パフォーマンス）。
  // session の取得と軽量ゲートクエリを並列化し、404となるアクセスでは12リレーション付きの
  // 重いクエリを走らせない
  const [session, gate] = await Promise.all([
    getOptionalSession(request, auth),
    db.query.users.findFirst({
      where: normalizedSlug
        ? sql`lower(${users.slug}) = ${normalizedSlug}`
        : sql`0 = 1`,
      columns: { id: true, discordId: true, profileVisibility: true, mcid: true, showRankedStats: true },
    }),
  ]);

  if (!gate) {
    if (slug) {
      const target = await resolvePlayerSlugFallback(db, slug);
      if (target) {
        throw redirect(`/player/${encodeURIComponent(target)}${url.search}`);
      }
    }
    throw new Response(t("playerProfile.notFound"), { status: 404 });
  }

  // プライベートプロフィールは本人以外に404を返す
  if (
    gate.profileVisibility === "private" &&
    session?.user?.id !== gate.discordId
  ) {
    throw new Response(t("playerProfile.notFound"), { status: 404 });
  }

  // 本人判定（上の非公開プロフィール判定と同じ discordId 比較）
  const isOwner = session?.user?.id === gate.discordId;

  // プリセット一覧を取得（メインを先頭に）。重量JSON列（*Data）はここでは取得せず、
  // 選択されたプリセットが非アクティブな場合のみ後段で1件だけ取得する（2段フェッチ）。
  // gate.id だけで引けるため、重い player クエリと並列に走らせる
  const presetsPromise = db.query.configPresets.findMany({
    where: eq(configPresets.userId, gate.id),
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

  // Fetch player with all related data（ゲートを通過した場合のみ、内部IDで重いクエリを実行）
  const playerPromise = db.query.users.findFirst({
    where: eq(users.id, gate.id),
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

  // プレイヤーの公開ガイドを取得（gate.id だけで引けるため player クエリと並列）
  const guidesPromise = db.query.guides.findMany({
    where: (g, { and, eq }) => and(eq(g.authorId, gate.id), eq(g.isPublished, true)),
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
  }).then(async (rows) => {
    // ガイドの自動翻訳（docs/translation.md）。title / summary を訳文へ差し替える（使えない行は原文のまま）
    const translations = await getGuideTranslations(db, rows.map((g) => g.id), viewerLocale);
    return rows.map((g) => applyGuideTranslation(g, translations));
  });

  // プロフィール絵文字リアクション（docs/profile-reactions.md）。
  const reactionsPromise = (async (): Promise<{
    counts: ProfileReactionCount[];
    viewerReactions: string[];
    viewerHasAccount: boolean;
  }> => {
    // 本人なら gate.id をそのまま使う（追加クエリなし）。他人がログイン中の場合のみ
    // discordId → 内部 userId を1回引く（session.user.id は Discord ID）
    const viewerUserId = isOwner
      ? gate.id
      : session
        ? ((await db.query.users.findFirst({
            where: eq(users.discordId, session.user.id),
            columns: { id: true },
          }))?.id ?? null)
        : null;
    const [counts, viewerReactions] = await Promise.all([
      getProfileReactionCounts(db, gate.id),
      getViewerProfileReactions(db, gate.id, viewerUserId),
    ]);
    return { counts, viewerReactions, viewerHasAccount: viewerUserId !== null };
  })();

  // PaceManの統計情報を取得（MCIDがある場合のみ）
  const pacemanPromise = (async () => {
    if (!gate.mcid) return null;
    try {
      const [netherEnterCount, mainPaces] = await Promise.all([
        getNetherEnterCount(gate.mcid),
        getRecentPacesForPlayer(gate.mcid, 10),
      ]);
      return { netherEnterCount, mainPaces };
    } catch (error) {
      console.error("Failed to fetch PaceMan stats:", error);
      return null;
    }
  })();

  // Minefolio内 Elo 順位（rankings-query.server.ts の cron キャッシュ基準）。
  // 公開プロフィール かつ Ranked統計を非表示にしていない場合のみ取得する
  // （/rankings ranked_elo タブと同じ絞り込み条件 = getMinefolioEloRank 内で判定）
  const eloRankPromise =
    gate.profileVisibility !== "public" || gate.showRankedStats === false
      ? Promise.resolve(null)
      : getMinefolioEloRank(db, gate.id);

  // 表示プリセットの解決: `?preset=` が有効ならそのプリセット、
  // 無指定・不正・削除済みの場合はメイン（公開用）プリセットへフォールバック。
  // メインが無い場合（移行前データ等）は編集中プリセットへさらにフォールバック
  const resolveSelectedPreset = (presets: Awaited<typeof presetsPromise>) => {
    const requestedPreset = presetId
      ? presets.find((p) => p.id === presetId)
      : undefined;
    return (
      requestedPreset ??
      presets.find((p) => p.isMain) ??
      presets.find((p) => p.isActive) ??
      null
    );
  };

  // アクティブプリセットはライブ設定と同内容（不変条件）のため、
  // 非アクティブなプリセットを選択した場合のみスナップショットを適用する。
  // 重量JSON列（*Data）はここで初めて1件だけ取得する（2段フェッチ）。
  // デコードは共通ヘルパー（preset-read.ts）に委譲: null の種別は「空」として表示し、
  // ライブ（編集中）データへはフォールバックしない（正準解釈。漏出防止）
  const presetOverridePromise = presetsPromise.then(async (presets) => {
    const selected = resolveSelectedPreset(presets);
    if (!selected || selected.isActive) return null;
    const presetSnapshot = await db.query.configPresets.findFirst({
      where: eq(configPresets.id, selected.id),
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
    return decodePresetConfig(presetSnapshot ?? {}, gate.id);
  });

  // gate 通過後に必要なクエリはすべて互いに独立（gate.id・session だけで引ける）ため、
  // 重い player クエリと一緒に1つの Promise.all で並列実行する
  // （Turso は HTTP のため RTT を1つでも減らす。browse-query.server.ts と同じ方針）。
  const [player, presets, presetOverride, profileReactions, playerGuides, pacemanStats, minefolioEloRank, bioTranslation] = await Promise.all([
    playerPromise,
    presetsPromise,
    presetOverridePromise,
    reactionsPromise,
    guidesPromise,
    pacemanPromise,
    eloRankPromise,
    // bio / shortBio の自動翻訳（docs/translation.md）。訳文が使えない（機能無効・opt-out・失効・
    // 原文と閲覧ロケールが同じ）ときは null で、原文をそのまま表示する。player 取得後に続けて走る
    playerPromise.then((p) => (p ? getUserBioTranslation(db, p, viewerLocale) : null)),
  ]);

  // クエリ間のレース対策（ゲート通過直後に対象ユーザーが削除された場合等）
  if (!player) {
    throw new Response(t("playerProfile.notFound"), { status: 404 });
  }

  const selectedPreset = resolveSelectedPreset(presets);

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

  // 審査中の speedrun.com 記録（cron が保存済みの player_rankings から。外部APIは叩かない）。
  // 非公開プロフィールは上のゲートで本人以外を弾き済み
  const pendingSpeedrunRecords = await loadPendingSpeedrunRecords(db, gate.id, new Set(hiddenSpeedrunRecords));

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
    pendingSpeedrunRecords,
    pacemanStats,
    minefolioEloRank,
    bioTranslation,
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
  const { player, isOwner, profileReactions, hiddenSpeedrunRecords, pinnedSpeedrunRecords, pendingSpeedrunRecords, pacemanStats, minefolioEloRank, bioTranslation, presets, selectedPresetId, playerGuides, now } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const location = useLocation();
  const [skin3dOpen, setSkin3dOpen] = useState(false);
  // 初期設定（/onboarding）が終わっていない本人。ページはまだ公開されていない
  const setupIncomplete = isOwner && !player.onboardingCompleted;
  // 自己紹介（bio / shortBio）の自動翻訳。訳文があれば既定で訳文を出し、原文へ切り替えられる。
  // 切替はクライアント状態のみ（ローダーは訳文と原文の両方を返す）
  const [showBioOriginal, setShowBioOriginal] = useState(false);
  const showTranslatedBio = bioTranslation !== null && !showBioOriginal;
  const displayShortBio =
    (showTranslatedBio ? bioTranslation.shortBio : null) ?? player.shortBio;
  const displayBio = (showTranslatedBio ? bioTranslation.bio : null) ?? player.bio;
  // 注記は「実際に訳文が存在する欄」の近くにだけ出す（空の欄に出さない）
  const hasTranslatedShortBio = Boolean(bioTranslation?.shortBio && player.shortBio);
  const hasTranslatedBio = Boolean(bioTranslation?.bio && player.bio);
  const toggleBioOriginal = () => setShowBioOriginal((prev) => !prev);
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
    actions: string[];
  };
  const keybindingDisplayGroups: KeybindingDisplayGroup[] = [
    {
      key: "movement",
      label: t("playerProfile.movement"),
      actions: ["forward", "back", "left", "right", "jump", "sneak", "sprint"],
    },
    {
      key: "inventory",
      label: t("playerProfile.inventory"),
      actions: [
        "hotbar1", "hotbar2", "hotbar3", "hotbar4", "hotbar5",
        "hotbar6", "hotbar7", "hotbar8", "hotbar9",
        "swapHands", "inventory", "pickBlock", "drop",
      ],
    },
    {
      key: "combat-ui",
      label: t("playerProfile.combatAndUi"),
      actions: ["attack", "use", "togglePerspective", "chat", "command", "fullscreen"],
    },
  ];

  // キーボードレイアウト判定（サーチクラフトのキー入力順ダイアログでも使うため、
  // 参照箇所より前で定義する）
  const keyboardLayout = (player.playerConfig?.keyboardLayout || "US") as KeyboardLayout;

  // ユーザーの指割り当てをパース（不正な JSON でも描画を壊さない）
  const userFingerAssignments = useMemo(
    () => parseFingerAssignments(player.playerConfig?.fingerAssignments),
    [player.playerConfig?.fingerAssignments],
  );
  // 指色の割り当てが1つでもあるか（無い走者ではキーが指色で塗られないので、指色の凡例を出さない）
  const hasFingerAssignments = Object.values(userFingerAssignments).some((fingers) => fingers.length > 0);

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
        keyboardLayout,
      }),
    [player.searchCraftLoops, parsedSearchCrafts, player.keyRemaps, userFingerAssignments, keyboardLayout],
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

  const isTKL = isTklLayout(keyboardLayout);


  const [guidesViewMode, setGuidesViewMode] = useState<"card" | "list">("card");

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
  const mainCategoryKey = playstyleMainCategory;
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

  const playstyleControlsRows: { label: ReactNode; value: ReactNode }[] = [];
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
      label: (
        <span className="inline-flex items-center gap-1">
          {t("playerProfile.playstyleHalfShift")}
          <HintTip message={t("playerProfile.halfShiftHint")} className="text-muted-foreground">
            <CircleHelp className="h-3.5 w-3.5" aria-hidden />
          </HintTip>
        </span>
      ),
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
      value: <LinkifiedText text={player.playstyle.dragTapeType} />,
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
      value: <LinkifiedText text={player.playstyle.mousepadType} />,
    });
  }

  const playstyleTechniqueRows: { label: string; value: ReactNode; plain?: boolean }[] = [];
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
      plain: true,
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

  // ゲーム言語だけではテクニックの欄を作らない（言語はデバイスタブに出る。プレイスタイルの項目が無いのに「テクニック」見出しだけが立つのを避ける）
  if (showPlaystyleGameLanguage && playstyleTechniqueRows.length === 1) playstyleTechniqueRows.length = 0;

  const hasPlaystylePlayContent = playstylePlayContentRows.length > 0;
  const hasPlaystyleControls = playstyleControlsRows.length > 0;
  const hasPlaystyleTechnique = playstyleTechniqueRows.length > 0;
  // プレイスタイルの欄は lg で2列。1行目（表示される最初の2欄）は罫線なし、1列の間は最初の1欄だけ罫線なし
  const playstyleVisible = [hasPlaystylePlayContent, hasPlaystyleControls, hasPlaystyleTechnique];
  const playstyleSectionFirst = playstyleVisible.map((shown, i) => shown && playstyleVisible.slice(0, i).every((v) => !v));
  const playstyleSectionClass = playstyleVisible.map((shown, i) =>
    shown && playstyleVisible.slice(0, i).filter(Boolean).length === 1 ? "lg:border-t-0 lg:pt-0" : undefined,
  );
  const hasPlaystyleData = hasPlaystylePlayContent || hasPlaystyleControls || hasPlaystyleTechnique;

  // デバイスタブ: 中身のあるカードだけ出す（閲覧者に空カードを見せない）
  const pc = player.playerConfig;
  const hasKeyboardInfo = !!(pc?.keyboardModel || pc?.keyboardLayout);
  // 感度だけ登録している人もマウスカードを出す（各行は値が無ければ行ごと省くか「-」を表示する）
  const hasMouseInfo = !!(
    pc?.mouseModel ||
    pc?.mouseDpi ||
    pc?.gameSensitivity != null ||
    pc?.windowsSpeed != null ||
    pc?.windowsSpeedMultiplier != null
  );
  const hasInGameSettings =
    pc != null &&
    (pc.toggleSprint != null ||
      pc.toggleSneak != null ||
      pc.autoJump != null ||
      !!pc.gameLanguage ||
      pc.fov != null ||
      pc.guiScale != null ||
      !!pc.notes);
  const hasDevicesData = hasKeyboardInfo || hasMouseInfo || hasInGameSettings;

  // 各タブの「中身あり」。パネルが EmptyState を出す条件と同じ真偽値を使い、ホットバーの空スロット表示と一致させる
  const hasKeybindingsData = player.keybindings.length > 0;
  const hasItemLayoutsData = player.itemLayouts.length > 0;
  const hasSearchCraftData = player.searchCrafts.length > 0;
  const hasGuidesData = playerGuides.length > 0;
  const hasDevicesPanelData = !!player.playerConfig && hasDevicesData;
  // 記録タブはクライアント側で外部統計（Ranked / PaceMan / speedrun.com）を取得するため、取得前は空と断定できない。
  // MCID も speedrun.com ユーザー名も無ければ外部統計は未登録相当で確定するので、その場合のみ手入力記録・審査中記録で判定する
  const hasStatsDataKnown =
    !!player.mcid ||
    !!player.speedruncomUsername ||
    player.categoryRecords.length > 0 ||
    pendingSpeedrunRecords.length > 0;

  // タブ項目の定義（/me のメニュー順と同じ。人物系 → セットアップ系の 2 群）。
  // サーチクラフトタブは「しない」設定時のみ非表示にする（null=未回答は表示する）
  const hideSearchCraftTab = hidesSearchCraft(player.playstyle?.searchCraft);
  const tabItems: ProfileHotbarItem[] = [
    { value: "profile", icon: User, shortLabel: t("playerProfile.hotbarOverview"), label: t("playerProfile.hotbarOverview"), empty: false, group: "person" },
    { value: "stats", icon: BarChart3, shortLabel: t("playerProfile.hotbarRecords"), label: t("playerProfile.activityAndStats"), empty: !hasStatsDataKnown, group: "person" },
    { value: "guides", icon: BookOpen, shortLabel: t("playerProfile.hotbarGuides"), label: t("playerProfile.guidesTab"), empty: !hasGuidesData, group: "person" },
    { value: "playstyle", icon: Gamepad2, shortLabel: t("playerProfile.hotbarStyle"), label: t("playerProfile.playstyleTab"), empty: !hasPlaystyleData, group: "setup" },
    { value: "keybindings", icon: Keyboard, shortLabel: t("playerProfile.hotbarKeys"), label: t("playerProfile.keybindingsTab"), empty: !hasKeybindingsData, group: "setup" },
    { value: "devices", icon: Mouse, shortLabel: t("playerProfile.hotbarDevices"), label: t("playerProfile.devicesTab"), empty: !hasDevicesPanelData, group: "setup" },
    { value: "items", icon: Package, shortLabel: t("playerProfile.hotbarItems"), label: t("playerProfile.itemLayoutsTab"), empty: !hasItemLayoutsData, group: "setup" },
    ...(hideSearchCraftTab
      ? []
      : [{ value: "searchcraft", icon: Search, shortLabel: t("playerProfile.hotbarSearch"), label: t("playerProfile.searchCraftTab"), empty: !hasSearchCraftData, group: "setup" as const }]),
  ];

  // 有効なタブ値のリスト
  const validTabs = tabItems.map((i) => i.value);

  // 現在のタブ名（タブパネルのアクセシブルネーム用）。ホットバーのトリガー名は「未登録」が付くことがあるため、パネルには素のタブ名を明示する
  const tabLabelOf = (value: string) => tabItems.find((i) => i.value === value)?.label ?? "";
  // パネルの名前はタブタイトル（h2）を参照する
  const panelA11yProps = (value: string) => ({ "aria-labelledby": `profile-tab-title-${value}` });

  // ログイン中の自分の slug（共通レイアウトのローダーが既に返している。追加の取得なし）。未ログイン・未オンボーディングは null
  const viewerSlug = useRouteLoaderData<typeof layoutLoader>("routes/_layout")?.user?.slug ?? null;
  const compareToViewerHref =
    viewerSlug && viewerSlug !== player.slug
      ? `/compare?p1=${player.slug}&p2=${viewerSlug}`
      : null;

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
  // タブ切替時だけ新しい中身を 150ms フェードインさせる。初回表示（SSR・ハイドレーション・`?tab=` 直開き）は
  // false のままで動かさない。パネルは hidden 属性で隠れており、表示に戻るたびに CSS アニメーションが再生される
  const [tabFade, setTabFade] = useState(false);
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  useEffect(() => {
    // 初回マウント時は activeTab === resolvedTab なので何もしない。戻る/進むで URL 由来の値が変わったときだけ切替扱いにする
    if (resolvedTab !== activeTabRef.current) setTabFade(true);
    setActiveTab(resolvedTab);
  }, [resolvedTab]);

  // タブ変更ハンドラー: 即時にローカル反映し、URL の `tab` パラメータも更新する。
  // （`shouldRevalidate` により loader は再実行されない）
  const handleTabChange = (tab: string) => {
    if (tab !== activeTab) setTabFade(true);
    setActiveTab(tab);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("tab", tab);
        return next;
      },
      { preventScrollReset: true },
    );
  };

  // 訪問者向けの空状態の案内: この走者で中身のある他のタブ（最大3つ。概要は最後）へ切り替えるボタン。
  // 本人には出さない（登録への導線 OwnerEditAction を出す）。中身のあるタブが無ければ何も出さない
  const visitorSuggestTabs = [
    ...tabItems.filter((i) => !i.empty && i.value !== activeTab && i.value !== "profile"),
    ...tabItems.filter((i) => !i.empty && i.value !== activeTab && i.value === "profile"),
  ].slice(0, 3);
  const visitorEmptyAction =
    !isOwner && visitorSuggestTabs.length > 0 ? (
      <div className="flex flex-wrap items-center justify-center gap-2 px-4">
        <span className="w-full text-xs text-muted-foreground">{t("playerProfile.emptySuggestTabs")}</span>
        {visitorSuggestTabs.map((item) => (
          <Button key={item.value} type="button" size="sm" variant="outline" onClick={() => handleTabChange(item.value)}>
            <item.icon className="h-4 w-4" aria-hidden />
            {item.shortLabel}
          </Button>
        ))}
      </div>
    ) : undefined;

  // 審査中記録のトグル: URL の `srcPending=1` が指定元（共有・再訪に対応）。履歴は汚さない。
  // スイッチはタブと同じくローカル状態で即時に切り替え、URL の変化（「審査中の記録を見る」リンク等）に追従させる。
  // URL だけを読むと、ナビゲーションが終わる（root / _layout の loader が返る）まで切り替わって見えないため
  // （profile の loader は shouldRevalidate で再実行しない）
  const pendingFromUrl = searchParams.get("srcPending") === "1";
  const [showPending, setShowPending] = useState(pendingFromUrl);
  useEffect(() => {
    setShowPending(pendingFromUrl);
  }, [pendingFromUrl]);
  const handleShowPendingChange = (show: boolean) => {
    setShowPending(show);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (show) next.set("srcPending", "1");
        else next.delete("srcPending");
        return next;
      },
      { preventScrollReset: true, replace: true },
    );
  };

  // プリセット選択を表示するタブ（プリセットが1件も無い場合はセレクタ自体を出さない）
  // アイテム配置・サーチクラフトは、表示中が空でどのプリセットにも中身が無いときは選択自体が無意味なので出さない
  // （プリセット一覧が種別ごとの有無フラグを持つ。他プリセットに中身があれば切替先として残す）
  const presetTabs = ["keybindings", "devices", "items", "searchcraft"];
  const presetTabHasNothing =
    (activeTab === "items" && !hasItemLayoutsData && !presets.some((p) => p.hasItemLayouts)) ||
    (activeTab === "searchcraft" && !hasSearchCraftData && !presets.some((p) => p.hasSearchCrafts));
  const showPresetSelector = presets.length > 0 && presetTabs.includes(activeTab) && !presetTabHasNothing;

  // アイテム配置タブのホットバー下に出す「押すキー」（hotbar1〜9 の割り当て。キー配置タブと同じ解決）。
  // キー配置が未登録なら渡さず、番号表示のままにする
  const hotbarKeyLabels: Partial<Record<number, string>> | undefined = hasKeybindingsData
    ? Object.fromEntries(
        Array.from({ length: 9 }, (_, i) => {
          const kb = keybindingsByAction.get(`hotbar${i + 1}`);
          return [i + 1, kb && kb.keyCode !== UNBOUND_KEY ? resolveKeyLabel(kb.keyCode) : undefined] as const;
        }),
      )
    : undefined;

  // メイン以外のプリセットを表示中か（「プリセット表示中」バッジ用)。
  // メインプリセットは既定表示そのものなのでバッジは出さない。
  const selectedPreset = presets.find((p) => p.id === selectedPresetId);
  const isViewingPresetSnapshot = !!selectedPreset && !selectedPreset.isMain;

  // プリセット選択（箱にせず、タブパネルの一番上・右寄せに1行で置く小さなセレクト。
  // キー配置・デバイス・アイテム・サーチクラフトで同じ位置、空状態のタブでも同じ）。表示条件は showPresetSelector
  // lg 以上はホットバーの行の右端（ProfileHotbarTabs の trailing）、lg 未満はパネル上端の右に1行（下端ドックには入れない）。
  // 同じ部品を2か所に描き、表示側を CSS（max-lg:hidden / lg:hidden）で切り替える
  // メインの印（「 (メイン)」）。名前がメインの表示そのもの（「メイン」）なら重ねて付けない（「メイン (メイン)」を避ける）
  const presetMainLabel = t("playerProfile.presetMainLabel").toLowerCase();
  const presetOptionLabel = (preset: { name: string; isMain: boolean }) =>
    preset.isMain && preset.name.trim().toLowerCase() !== presetMainLabel
      ? `${preset.name}${t("playerProfile.presetMainSuffix")}`
      : preset.name;
  const presetSelectorNode = showPresetSelector ? (
    <div className="flex min-w-0 items-center justify-end gap-2">
      <Select value={selectedPresetId ?? ""} onValueChange={handlePresetChange}>
        <SelectTrigger size="sm" aria-label={t("playerProfile.preset")} className="w-auto min-w-0 max-w-[min(100%,16rem)] sm:max-w-56">
          <SelectValue placeholder={t("playerProfile.currentSetting")}>
            {/* SSR の最初の描画から名前を出す（children なしだと選択項目の描画がハイドレーション後になり空のピルになる） */}
            {selectedPreset ? presetOptionLabel(selectedPreset) : undefined}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {presets.map((preset) => (
            <SelectItem key={preset.id} value={preset.id}>
              {presetOptionLabel(preset)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {isViewingPresetSnapshot && (
        <Badge variant="secondary" className="text-xs max-md:hidden">
          {t("playerProfile.presetViewing")}
        </Badge>
      )}
    </div>
  ) : null;
  const presetSelector = presetSelectorNode ? <div className="lg:hidden">{presetSelectorNode}</div> : null;

  // サーチクラフトのアイテム名を閲覧者の言語で表示するトグル（状態はこの state だけ。保存しない）。
  // 既定は走者のゲーム言語（未設定は日本語）のまま。サーチ文字列・キー列は言語に依らず不変。
  // 走者の言語が閲覧者の言語と同じときはボタン自体を出さない
  const [searchCraftViewerLang, setSearchCraftViewerLang] = useState(false);
  useEffect(() => {
    setSearchCraftViewerLang(false);
  }, [player.id]);
  const viewerItemLang = itemLangForLocale(locale);
  const runnerItemLang = player.playerConfig?.gameLanguage || "ja_jp";
  const canToggleSearchCraftLang = runnerItemLang !== viewerItemLang;

  // キー配置タブの仮想キーボード共通 props（デスクトップ版・モバイル版・拡大 Dialog で共有）
  const vkCommon = {
    fingerAssignments: userFingerAssignments,
    remaps: remapsForKeyboard,
    customActions: player.customActions,
    showActionLabels: true,
    showFingerAssignments: true,
    showRemaps: true,
  } as const;
  const keyboardMainProps = { ...vkCommon, layout: keyboardLayout, keybindings: keybindingsMap, customKeys: customKeyboardKeys };
  // 下の段（ナビは「下の段にナビ」版のときだけ）: ナビ → テンキー → マウス
  const keyboardLowerRow = (showNav: boolean, navClassName?: string) => (
    <div className="flex items-start gap-6">
      {showNav && (
        <div className={navClassName}>
          <VirtualKeyboard {...keyboardMainProps} section="nav" />
        </div>
      )}
      {!isTKL && (
        <VirtualNumpad keybindings={keybindingsMap} {...vkCommon} />
      )}
      <VirtualMouse keybindings={keybindingsMap} {...vkCommon} customButtons={customButtons} />
    </div>
  );
  // モバイル版の中身（縮小表示・拡大 Dialog 用。実寸固定で container query は使わない）
  const keyboardMobileLayout = (
    <div className="flex flex-col items-start gap-4">
      <VirtualKeyboard {...keyboardMainProps} section="main" hideNumpad />
      {keyboardLowerRow(true)}
    </div>
  );
  const skipToKeyList = () => {
    const heading = document.getElementById("profile-keylist-heading");
    if (!heading) return;
    heading.setAttribute("tabindex", "-1");
    heading.focus();
  };

  return (
    <>
    {/* ホットバー型タブ（activationMode="manual": 矢印キーはフォーカス移動のみ、Enter/Space で切替）。
        身元帯・ホットバー・パネルの縦並び。フォルダ型ではないので間隔は gap で取る */}
    <Tabs value={activeTab} onValueChange={handleTabChange} activationMode="manual" className="flex flex-col gap-4 md:gap-6 overflow-visible rounded-none border-0 bg-transparent [&_[id]]:scroll-mt-0">

      {/* 初期設定が未完了の本人だけに出す。このページはまだ公開されていない */}
      {setupIncomplete && (
        <NoticeBanner tone="warning" icon={Info}>
          <p>{t("playerProfile.setupIncompleteNotice")}</p>
          <Link to="/onboarding" className="mt-1 inline-block min-h-6 font-medium text-primary underline-offset-4 hover:underline">
            {t("playerProfile.setupIncompleteLink")}
          </Link>
        </NoticeBanner>
      )}

      {/* 身元帯（全タブ共通。h1 はここだけ） */}
      <div className="space-y-3 rounded-2xl border border-border/70 bg-card/70 px-4 py-3 md:space-y-4 md:p-5">
        {/* md 未満は操作ボタン（アイコンのみ）を名前の右に置き、名前に十分な幅（アバター 40px＋gap 12px＋
            名前 約 124px ＝ 11rem）を取れないときだけ操作ボタンを次の行へ折り返す。
            basis にアバターぶんを含めるので、7.5rem だと名前が約 50px しか取れず切れていた。
            それでも収まらない長い名前は切らずに折り返す（h1 の break-words） */}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 md:gap-6">
          <div className="flex min-w-0 flex-1 basis-[11rem] items-center gap-3 md:basis-auto md:gap-4">
            {/* MCID未登録（uuid も customSkinUrl も無し）は MinecraftAvatar 側でプレースホルダーを描く。
                size は描画解像度を決める数値 prop なので、md 未満 40px / 以上 64px を CSS で出し分ける
                （useMediaQuery だと SSR は 64px で描かれ、モバイルでハイドレーション後に縮んで跳ねる） */}
            <MinecraftAvatar
              uuid={player.uuid}
              skinUrl={player.customSkinUrl}
              mcid={player.mcid}
              size={40}
              alt=""
              className="shrink-0 rounded md:hidden"
            />
            <MinecraftAvatar
              uuid={player.uuid}
              skinUrl={player.customSkinUrl}
              mcid={player.mcid}
              size={64}
              alt=""
              className="shrink-0 rounded max-md:hidden"
            />
            <div className="min-w-0">
              <h1 className="break-words text-2xl font-bold md:text-3xl">{playerName}</h1>
              {/* アルファベット表記はロケールを問わず併記する（見出しと同一なら省く） */}
              {player.displayNameAlphabet && player.displayNameAlphabet !== playerName && (
                <p className="truncate text-sm text-muted-foreground">{player.displayNameAlphabet}</p>
              )}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                {player.mcid && <span className="truncate">@{player.mcid}</span>}
                {mainCategoryKey && (
                  <button
                    type="button"
                    onClick={() => handleTabChange("playstyle")}
                    className="inline-flex min-h-6 items-center rounded-full border border-border/70 bg-background/75 px-2.5 py-0.5 text-xs transition-colors hover:border-primary/40 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {categoryLabel(t, mainCategoryKey)}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* 操作（md 未満はアイコンのみ。タップ領域は 44px 以上、ラベルは sr-only で残す） */}
          <div className="flex shrink-0 gap-1 max-md:[&_a]:min-h-11 max-md:[&_a]:min-w-11 max-md:[&_button]:min-h-11 max-md:[&_button]:min-w-11 md:flex-wrap md:gap-2">
            {isOwner && (
              <Button asChild size="sm">
                <Link to="/me/edit">
                  <Pencil className="h-4 w-4 md:mr-2" aria-hidden />
                  <span className="max-md:sr-only">{t("playerProfile.edit")}</span>
                </Link>
              </Button>
            )}
            {/* 自分自身はお気に入りに入れない。初期設定が未完了のページは未公開なので共有も出さない */}
            {!isOwner && <FavoriteButton slug={player.slug} />}
            {!setupIncomplete && (
              <ShareButton
                title={`${playerName} - Minefolio`}
                description={displayShortBio ?? undefined}
                includeTab={true}
                compactOnMobile
              />
            )}
          </div>
        </div>

        <ProfileHighlights
          mcid={player.mcid}
          showRankedStats={player.showRankedStats !== false}
          mainCategory={player.playstyle?.mainCategory}
          records={player.categoryRecords}
          config={player.playerConfig}
          speedruncomUsername={player.speedruncomUsername}
          searchCraftLevel={player.playstyle?.searchCraft}
          searchCraftCount={player.searchCrafts.length}
          gameLanguage={player.playerConfig?.gameLanguage}
          hiddenSpeedrunRecords={hiddenSpeedrunRecords}
          pinnedSpeedrunRecords={pinnedSpeedrunRecords}
          rankedRegisteredKnown={!!minefolioEloRank}
          onSelectTab={handleTabChange}
        />
      </div>

      <ProfileHotbarTabs
        items={tabItems}
        activeValue={activeTab}
        onSelect={handleTabChange}
        trailing={presetSelectorNode}
        leading={
          <>
            <MinecraftAvatar uuid={player.uuid} skinUrl={player.customSkinUrl} mcid={player.mcid} size={28} alt="" className="shrink-0 rounded" />
            {/* 名前は xl 以上だけ（1024px 前後は8スロット＋プリセットでバー幅が埋まるためアバターだけ）。1行で切る */}
            <span className="hidden max-w-40 truncate text-sm font-semibold xl:block">{playerName}</span>
          </>
        }
      />

      {/* Main Content。切替後だけ、表示に戻ったパネルを opacity でフェードする（パネルは hidden 属性で隠れており、
          display:none から表示に戻るときに CSS アニメーションが再生される。退場なし・reduced-motion は app.css の全体ルールで即時） */}
      <div
        className={cn(
          "flex-1 min-w-0 space-y-6 relative",
          tabFade &&
            "[&>[role=tabpanel]]:animate-in [&>[role=tabpanel]]:fade-in [&>[role=tabpanel]]:duration-150 [&>[role=tabpanel]]:ease-out",
        )}
      >
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

        {/* Profile Tab */}
        <TabsContent value="profile" {...panelA11yProps("profile")} className={PANEL_CLASS}>
          <ProfileTabTitle value="profile" label={tabLabelOf("profile")} />
          {/* Header: Skin + Basic Info（箱にせず欄の先頭にそのまま置く） */}
          <div>
              <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
                {/* Info */}
                <div className="contents sm:block sm:flex-1 sm:space-y-4">
                  <div className="text-center sm:text-left">
                    {player.bedrockMcid && (
                      <p className="text-muted-foreground">
                        {t("playerProfile.bedrockMcidLine", { id: player.bedrockMcid })}
                      </p>
                    )}
                    {displayShortBio && (
                      <p className="text-sm text-muted-foreground mt-2">{displayShortBio}</p>
                    )}
                    {hasTranslatedShortBio && (
                      <AutoTranslateNotice
                        showOriginal={showBioOriginal}
                        onToggle={toggleBioOriginal}
                        className="mt-1 justify-center sm:justify-start"
                      />
                    )}
                  </div>

                  <div className="order-2 space-y-4">
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
                        {/* 入力方法の表示名は設定画面（/me/playstyle）の選択肢と同じキーを使う */}
                        {player.inputMethod === "keyboard_mouse" && t("mePlaystyle.inputMethodKeyboardMouse")}
                        {player.inputMethod === "controller" && t("mePlaystyle.inputMethodController")}
                        {player.inputMethod === "touch" && t("mePlaystyle.inputMethodTouch")}
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

                  {/* 絵文字リアクション */}
                  <ProfileReactionBar
                    pills={reactionPills}
                    toggle={toggleReaction}
                    isLoggedIn={profileReactions.viewerHasAccount}
                  />
                  </div>
                </div>

                {/* Skin - uuid か customSkinUrl があれば従来どおり。どちらも無い（MCID未登録）なら
                    黒スキンのプレースホルダーを静止画で出し、直下に注釈を添える（3D 閲覧は無し） */}
                {player.uuid || player.customSkinUrl ? (() => {
                  // 静止画と interactive で共通の MinecraftFullBody プロパティ
                  const skinProps = {
                    // customSkinUrl だけのユーザーもここに来るので uuid は null を許容する
                    uuid: player.uuid ?? undefined,
                    skinUrl: player.customSkinUrl ?? undefined,
                    mcid: player.mcid ?? undefined,
                    pose: (player.profilePose as PoseName) ?? "waving",
                    slim:
                      player.customSkinModel === "slim" || player.slimSkin || false,
                    angle: -35,
                    elevation: 5,
                    zoom: 0.9,
                    // カスタムマント → Mojang のマント → なし。capeDisplay が hidden なら {}
                    ...resolveCapeProps({
                      uuid: player.uuid,
                      customCapeUrl: player.customCapeUrl,
                      capeDisplay: player.capeDisplay,
                    }),
                  };
                  const modalSize = { width: 360, height: 480 };
                  return (
                    <div className="order-1 flex justify-center sm:order-first sm:justify-start shrink-0">
                      <Dialog open={skin3dOpen} onOpenChange={setSkin3dOpen}>
                        <DialogTrigger asChild>
                          <button
                            type="button"
                            aria-label={t("playerProfile.viewSkin3d")}
                            className="group relative rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {/* ページ上は静止画。WebGL を常駐させない（仕様 3.3） */}
                            <div className={SKIN_VIEW_BOX_CLASS}>
                              <MinecraftFullBody
                                {...skinProps}
                                width={SKIN_VIEW_RENDER_SIZE.width}
                                height={SKIN_VIEW_RENDER_SIZE.height}
                                asImage
                                fluid
                              />
                            </div>
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
                })() : null /* MCID もスキンも無い走者には、「?」の大きな枠を出さない */}
              </div>
          </div>

          {/* Social Links（YouTube/Twitch は統計付きリッチカード） */}
          {player.socialLinks.length > 0 && (
            <SocialLinksCard links={player.socialLinks} slug={player.slug} />
          )}

          {/* Bio */}
          {displayBio && (
            <PageSection headingLevel="h3" id="profile-bio" title={t("playerProfile.bio")}>
                {hasTranslatedBio && (
                  <AutoTranslateNotice showOriginal={showBioOriginal} onToggle={toggleBioOriginal} />
                )}
                <Suspense
                  fallback={
                    <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                      {displayBio}
                    </p>
                  }
                >
                  <BioMarkdown bio={displayBio} />
                </Suspense>
            </PageSection>
          )}

          {/* Videos（複数動画欄。行が無い場合は旧 featuredVideoUrl にフォールバック） */}
          {displayVideos.length > 0 && (
            <PageSection headingLevel="h3" id="profile-videos" title={t("playerProfile.videos")}>
              <div className="space-y-4">
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
              </div>
            </PageSection>
          )}
        </TabsContent>

        {/* Keybindings Tab */}
        <TabsContent value="keybindings" {...panelA11yProps("keybindings")} className={PANEL_CLASS}>
          <ProfileTabTitle value="keybindings" label={tabLabelOf("keybindings")} trailing={presetSelector} />
          {hasKeybindingsData ? (
            <>
              <PageSection
                headingLevel="h3"
                id="profile-keyboard"
                title={t("playerProfile.keyboardView")}
              >
                {/* ツールバー: 凡例・Trigger/Chat 切替・案内・画像保存 */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  {hasFingerAssignments && <FingerLegend />}
                  <HintTip message={t("playerProfile.keyAbbrHint")} className="text-xs text-muted-foreground">
                    <span className="underline decoration-dotted underline-offset-4">OH / HB</span>
                    <CircleHelp className="h-3.5 w-3.5" aria-hidden />
                  </HintTip>
                  {/* Trigger/Chat 表示切替（種別付きリマップがある場合のみ） */}
                  {hasTypedRemaps && (
                    <span className="inline-flex items-center gap-1">
                      <RemapViewToggle value={remapView} onChange={setRemapView} />
                      <HintTip message={t("playerProfile.remapViewHint")} className="text-muted-foreground">
                        <CircleHelp className="h-4 w-4" aria-hidden />
                      </HintTip>
                    </span>
                  )}
                  <p className="text-xs text-muted-foreground">
                    <span className="md:hidden">{t("playerProfile.keyboardTapHintMobile")}</span>
                    <span className="max-md:hidden">{t("playerProfile.keyboardTapHint")}</span>
                  </p>
                  <div className="ml-auto">
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
                <button
                  type="button"
                  onClick={skipToKeyList}
                  className="sr-only rounded-md bg-background px-3 py-1.5 text-sm font-medium focus:not-sr-only focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t("playerProfile.skipToKeyList")}
                </button>
                {/* モバイル: 縮小表示＋タップで全画面（レイアウトは「下の段にナビ」固定の実寸） */}
                <div className="md:hidden">
                  <KeyboardScaledPreview dialogTitle={t("playerProfile.keyboardView")}>
                    {keyboardMobileLayout}
                  </KeyboardScaledPreview>
                </div>
                {/* デスクトップ: コンテナ幅 70rem（=1120px）以上で「右にナビ」、未満で「下の段にナビ」。
                    @container は幅いっぱいのブロック要素に置く（flex 子・w-max・スクロール内容に置くと幅 0 で潰れる）。
                    両方描いて display:none で片方を隠すので、隠れた側のキーは Tab 順から外れる */}
                <div className="@container max-md:hidden">
                  <div className="flex flex-col items-start gap-4">
                    <div className="hidden w-full @min-[70rem]:block">
                      <HorizontalScrollArea showHint surface="background">
                        <VirtualKeyboard {...keyboardMainProps} hideNumpad />
                      </HorizontalScrollArea>
                    </div>
                    <div className="w-full @min-[70rem]:hidden">
                      <HorizontalScrollArea showHint surface="background">
                        <VirtualKeyboard {...keyboardMainProps} section="main" hideNumpad />
                      </HorizontalScrollArea>
                    </div>
                    <HorizontalScrollArea surface="background">
                      {keyboardLowerRow(true, "@min-[70rem]:hidden")}
                    </HorizontalScrollArea>
                  </div>
                </div>
              </PageSection>

              {/* 割り当て一覧 */}
              <PageSection headingLevel="h3" id="profile-keylist" title={t("playerProfile.keyListTitle")}>
                <div className="gap-x-8 lg:columns-2">
                  {keybindingDisplayGroups.map((group) => {
                    const bindings = group.actions
                      .map((action) => keybindingsByAction.get(action))
                      .filter((kb): kb is NonNullable<typeof kb> => kb !== undefined);
                    if (bindings.length === 0) return null;

                    return (
                      <div key={group.key} className="mb-6 space-y-2 break-inside-avoid">
                        <h4 className="text-base font-semibold">{group.label}</h4>
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
                      </div>
                    );
                  })}

                  {/* カスタムアクション（登録されている場合のみ） */}
                  {player.customActions.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-base font-semibold">{t("playerProfile.customActions")}</h4>
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
                    </div>
                  )}

                  {/* リマップ（登録されている場合のみ。既定は閉じる） */}
                  {player.keyRemaps.length > 0 && (
                    <details className="group space-y-2 lg:col-span-2">
                      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden />
                        <h4 className="text-base font-semibold">{t("playerProfile.remaps")}</h4>
                        <Badge variant="secondary" className="rounded-full px-2 py-0.5 text-[11px]">
                          {player.keyRemaps.length}
                        </Badge>
                      </summary>
                      <div className="divide-y">
                        {player.keyRemaps.map((remap) => {
                          const sourceChips = resolveKeyCombinationChips(remap.sourceKey);
                          const targetChips =
                            remap.outputMode === "character" && remap.outputCharacter
                              ? [remap.outputCharacter]
                              : remap.targetKey
                              ? resolveKeyCombinationChips(remap.targetKey)
                              : [];
                          const renderChipGroup = (
                            chips: string[],
                            justify: "start" | "end",
                          ) => (
                            <div
                              className={`flex items-center gap-1 ${
                                justify === "start" ? "justify-start" : "justify-end"
                              }`}
                            >
                              {chips.length === 0 && (
                                <kbd className="px-2.5 py-1 bg-secondary/80 rounded text-sm font-mono min-w-16 text-center">
                                  <EmptyValue />
                                </kbd>
                              )}
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
                    </details>
                  )}
                </div>
              </PageSection>
            </>
          ) : (
            <EmptyState
              icon={<Keyboard className="h-12 w-12" />}
              title={t("playerProfile.noKeybindingsTitle")}
              description={t(isOwner ? "playerProfile.noKeybindingsOwner" : "playerProfile.noKeybindings")}
              action={isOwner ? <OwnerEditAction to="/me/keybindings" label={t("playerProfile.editLinkKeybindings")} /> : visitorEmptyAction}
            />
          )}
        </TabsContent>

        {/* Stats Tab */}
        <TabsContent value="stats" {...panelA11yProps("stats")} className={PANEL_CLASS}>
          <ProfileTabTitle value="stats" label={tabLabelOf("stats")} />
          <StatsTabContent
            player={player}
            hiddenSpeedrunRecords={hiddenSpeedrunRecords}
            pinnedSpeedrunRecords={pinnedSpeedrunRecords}
            pendingSpeedrunRecords={pendingSpeedrunRecords}
            showPending={showPending}
            onShowPendingChange={handleShowPendingChange}
            pacemanStats={pacemanStats}
            minefolioEloRank={minefolioEloRank}
            isOwner={isOwner}
            mainCategory={player.playstyle?.mainCategory}
            visitorEmptyAction={visitorEmptyAction}
          />
        </TabsContent>

        {/* Playstyle Tab */}
        <TabsContent value="playstyle" {...panelA11yProps("playstyle")} className={PANEL_CLASS}>
          <ProfileTabTitle value="playstyle" label={tabLabelOf("playstyle")} />
          {hasPlaystyleData ? (
            <div className="grid grid-cols-1 gap-x-8 gap-y-7 sm:gap-y-8 lg:grid-cols-2">
              {/* プレイ内容 */}
              {hasPlaystylePlayContent && (
                <PageSection headingLevel="h3" id="profile-playstyle-play" className={playstyleSectionClass[0]} first={playstyleSectionFirst[0]} title={t("playerProfile.playstylePlayContent")}>
                    {playstylePlayContentRows.map((row, i) => (
                      <div key={i} className="space-y-2">
                        <p className="text-sm text-muted-foreground">{row.label}</p>
                        {row.value}
                      </div>
                    ))}
                </PageSection>
              )}

              {/* 操作 */}
              {hasPlaystyleControls && (
                <PageSection headingLevel="h3" id="profile-playstyle-controls" className={playstyleSectionClass[1]} first={playstyleSectionFirst[1]} title={t("playerProfile.playstyleControls")}>
                    <div className="divide-y">
                      {playstyleControlsRows.map((row, i) => (
                        <DeviceRow key={i} label={row.label} value={row.value} plain />
                      ))}
                    </div>
                </PageSection>
              )}

              {/* テクニック */}
              {hasPlaystyleTechnique && (
                <PageSection headingLevel="h3" id="profile-playstyle-technique" className={playstyleSectionClass[2]} first={playstyleSectionFirst[2]} title={t("playerProfile.playstyleTechnique")}>
                    <div className="divide-y">
                      {playstyleTechniqueRows.map((row, i) => (
                        <DeviceRow key={i} label={row.label} value={row.value} plain={row.plain} />
                      ))}
                    </div>
                </PageSection>
              )}
            </div>
          ) : (
            <EmptyState
              icon={<Gamepad2 className="h-12 w-12" />}
              title={t("playerProfile.noPlaystyleTitle")}
              description={t(isOwner ? "playerProfile.noPlaystyleOwner" : "playerProfile.noPlaystyle")}
              action={
                isOwner ? (
                  <Button asChild size="sm" variant="outline" className="mt-4">
                    <Link to="/me/playstyle">{t("playerProfile.noPlaystyleEditLink")}</Link>
                  </Button>
                ) : visitorEmptyAction
              }
            />
          )}
        </TabsContent>

        {/* Item Layouts Tab */}
        <TabsContent value="items" {...panelA11yProps("items")} className={PANEL_CLASS}>
          <ProfileTabTitle value="items" label={tabLabelOf("items")} trailing={presetSelector} />
          {hasItemLayoutsData ? (
            // xl 以上は区間を2列の格子に並べる（DOM 順＝左→右・上→下の読み順）。メモは各ホットバーの下のまま。
            // lg（1024px）では列幅約457px に9スロットのホットバー（約535px）が収まらず、列ごとに横スクロールが出て
            // ページ幅もはみ出すため、収まる xl から2列にする。
            // 欄の上罫線は、先頭（全幅で最初）だけ外し、2列のとき最上段の右の欄も外す（プレイスタイルの2列と同じ）
            <div className="grid grid-cols-1 gap-x-8 gap-y-7 sm:gap-y-8 xl:grid-cols-2">
              {player.itemLayouts.map((layout, index) => (
                <ItemLayoutRow
                  key={layout.id}
                  layout={layout}
                  slotKeyLabels={hotbarKeyLabels}
                  first={index === 0}
                  className={index === 1 ? "xl:border-t-0 xl:pt-0" : undefined}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<Package className="h-12 w-12" />}
              title={t("playerProfile.noItemLayoutsTitle")}
              description={t(isOwner ? "playerProfile.noItemLayoutsOwner" : "playerProfile.noItemLayouts")}
              action={isOwner ? <OwnerEditAction to="/me/items" label={t("playerProfile.editLinkItems")} /> : visitorEmptyAction}
            />
          )}
        </TabsContent>

        {/* Search Craft Tab */}
        <TabsContent value="searchcraft" {...panelA11yProps("searchcraft")} className={PANEL_CLASS}>
          <ProfileTabTitle
            value="searchcraft"
            label={tabLabelOf("searchcraft")}
            badge={
              hasSearchCraftData ? (
                <HintTip message={t("playerProfile.searchCraftTabHint")} className="text-muted-foreground">
                  <CircleHelp className="h-4 w-4" aria-hidden />
                </HintTip>
              ) : undefined
            }
            trailing={
              (hasSearchCraftData && canToggleSearchCraftLang) || presetSelector ? (
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {hasSearchCraftData && canToggleSearchCraftLang && (
                    // スイッチ＋ラベル（label で結ぶ。min-h-8 で押せる範囲を 24px 以上に）。折り返しは親の flex-wrap に任せる
                    <label className="flex min-h-8 max-w-full cursor-pointer items-center gap-2 text-sm">
                      <Switch
                        checked={searchCraftViewerLang}
                        onCheckedChange={setSearchCraftViewerLang}
                      />
                      <span className="min-w-0">
                        {t("playerProfile.searchCraftItemNamesIn", { language: t("playerProfile.searchCraftViewerLangName") })}
                      </span>
                    </label>
                  )}
                  {presetSelector}
                </div>
              ) : null
            }
          />
          {hasSearchCraftData ? (
            // 欄が1つだけのタブなので欄見出しは目に見えない（sr-only）h3 にする（見出しの並びを h2 → h3 → h4 にそろえる）。
            // グループの名前もこの h3 を参照する。サーチクラフトのグループ名は h4
            <div id="profile-searchcraft" role="group" aria-labelledby="profile-searchcraft-heading" className="space-y-4">
              <h3 id="profile-searchcraft-heading" className="sr-only">{t("playerProfile.searchCraftListHeading")}</h3>
              {/* ゲーム言語・件数・凡例（箱にせず欄の先頭に置く） */}
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                  {player.playerConfig?.gameLanguage && (
                    // 長い言語名（Norsk Bokmål（ノルウェー語（ブークモール））等）が 320px でページを横に押し広げないよう、
                    // 行は折り返し可・バッジは whitespace-normal で折り返せるようにする
                    <div className="flex min-w-0 max-w-full flex-wrap items-center gap-x-1.5 gap-y-1 text-muted-foreground">
                      <Languages className="h-4 w-4 shrink-0" />
                      <span>{t("playerProfile.gameLanguage")}:</span>
                      <Badge variant="secondary" className="max-w-full whitespace-normal text-left">
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
                {player.playerConfig?.gameLanguage &&
                  !searchCraftViewerLang &&
                  !hasItemNameDictionary(player.playerConfig.gameLanguage) && (
                    // 辞書が無い言語は英語表示になる。走者の言語で表示中（スイッチ OFF）のときだけ理由を添える
                    <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                      <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                      <span className="min-w-0">{t("playerProfile.searchCraftNoItemDictionary")}</span>
                    </p>
                  )}
                <KeyBadgeLegend
                  showFingers={Object.keys(userFingerAssignments).length > 0}
                  showCraftMarker={player.searchCraftLoops.length > 0}
                />
              </div>
              <SearchCraftGroupedList
                framed={false}
                collapsible
                stickyHeaders
                // ヘッダー（md 未満）・ホットバー（md 以上、64+57=121 が下端）の下に 1px もぐらせて貼り付く。
                // ちょうど接すると表示倍率 125% 等で境目が小数の画素位置になり、下のコンテンツが透けるため
                stickyTopClassName="top-[64px] md:top-[120px]"
                crafts={parsedSearchCrafts}
                remaps={player.keyRemaps}
                fingerAssignments={userFingerAssignments}
                gameLanguage={searchCraftViewerLang ? viewerItemLang : player.playerConfig?.gameLanguage}
                keyboardLayout={keyboardLayout}
                extraTimings={searchCraftLoopTimings}
                renderGroupExtra={renderSearchCraftLoopExtra}
                groupHeadingLevel="h4"
              />
            </div>
          ) : (
            <EmptyState
              icon={<Search className="h-12 w-12" />}
              title={t("playerProfile.searchCraftNoneTitle")}
              description={t(isOwner ? "playerProfile.noSearchCraftOwner" : "playerProfile.noSearchCraft")}
              action={isOwner ? <OwnerEditAction to="/me/search-craft" label={t("playerProfile.editLinkSearchCraft")} /> : visitorEmptyAction}
            />
          )}
        </TabsContent>

        {/* Devices Tab (merged with settings) */}
        <TabsContent value="devices" {...panelA11yProps("devices")} className={PANEL_CLASS}>
          <ProfileTabTitle value="devices" label={tabLabelOf("devices")} trailing={presetSelector} />
          {hasDevicesPanelData && player.playerConfig ? (
            <>
              {(hasKeyboardInfo || hasMouseInfo) && (
              <div className="grid grid-cols-1 gap-x-8 gap-y-7 sm:gap-y-8 md:grid-cols-2">
                {/* Keyboard */}
                {hasKeyboardInfo && (
                <PageSection headingLevel="h3" id="profile-devices-keyboard" first title={t("playerProfile.keyboard")}>
                    {player.playerConfig.keyboardModel || player.playerConfig.keyboardLayout ? (
                      <div className="divide-y">
                        {player.playerConfig.keyboardModel && (
                          <DeviceRow
                            label={t("playerProfile.model")}
                            value={player.playerConfig.keyboardModel}
                            plain
                          />
                        )}
                        {player.playerConfig.keyboardLayout && (
                          <DeviceRow
                            label={t("playerProfile.layout")}
                            value={keyboardLayoutLabel(player.playerConfig.keyboardLayout)}
                            plain
                          />
                        )}
                      </div>
                    ) : null}
                </PageSection>
                )}

                {/* Mouse */}
                {hasMouseInfo && (
                <PageSection headingLevel="h3" id="profile-mouse" first={!hasKeyboardInfo} className={hasKeyboardInfo ? "md:border-t-0 md:pt-0" : undefined} title={t("playerProfile.mouse")}>
                    {hasMouseInfo ? (
                      <div className="divide-y">
                        {/* モデル */}
                        {player.playerConfig.mouseModel && (
                          <DeviceRow
                            label={t("playerProfile.model")}
                            value={player.playerConfig.mouseModel}
                            plain
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
                            value={<EmptyValue />}
                          />
                        )}
                        {/* マウス加速 */}
                        {player.playerConfig.mouseAcceleration != null && (
                          <DeviceRow
                            label={t("playerProfile.mouseAcceleration")}
                            value={player.playerConfig.mouseAcceleration ? t("common.on") : t("common.off")}
                          plain
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
                          plain
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
                    ) : null}
                </PageSection>
                )}
              </div>
              )}

              {/* Game Settings */}
              {hasInGameSettings && (
              <PageSection headingLevel="h3" id="profile-ingame" title={t("playerProfile.inGameSettings")}>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
                    <div className="divide-y">
                      {player.playerConfig.toggleSprint != null && (
                        <DeviceRow
                          label={t("playerProfile.toggleSprint")}
                          value={player.playerConfig.toggleSprint ? t("common.on") : t("common.off")}
                        plain
                        />
                      )}
                      {player.playerConfig.toggleSneak != null && (
                        <DeviceRow
                          label={t("playerProfile.toggleSneak")}
                          value={player.playerConfig.toggleSneak ? t("common.on") : t("common.off")}
                        plain
                        />
                      )}
                      {player.playerConfig.autoJump != null && (
                        <DeviceRow
                          label={t("playerProfile.autoJump")}
                          value={player.playerConfig.autoJump ? t("common.on") : t("common.off")}
                        plain
                        />
                      )}
                      {player.playerConfig.gameLanguage && (
                        <DeviceRow
                          label={t("playerProfile.gameLanguage")}
                          value={getGameLanguageName(t, locale, player.playerConfig.gameLanguage)}
                          plain
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
              </PageSection>
              )}
            </>
          ) : (
            <EmptyState
              icon={<Mouse className="h-12 w-12" />}
              title={t("playerProfile.noDevicesTitle")}
              description={t(isOwner ? "playerProfile.noDevicesOwner" : "playerProfile.noDevices")}
              action={isOwner ? <OwnerEditAction to="/me/devices" label={t("playerProfile.editLinkDevices")} /> : visitorEmptyAction}
            />
          )}
        </TabsContent>

        {/* Guides Tab */}
        <TabsContent value="guides" {...panelA11yProps("guides")} className={PANEL_CLASS}>
          <ProfileTabTitle
            value="guides"
            label={tabLabelOf("guides")}
            trailing={hasGuidesData ? <ViewToggle viewMode={guidesViewMode} onChange={setGuidesViewMode} /> : null}
          />
          {hasGuidesData ? (
            // 欄が1つだけのタブなので欄見出しは目に見えない（sr-only）h3 にする。グループの名前もこの h3 を参照し、カードのタイトルは h4
            <div id="profile-guides" role="group" aria-labelledby="profile-guides-heading">
              <h3 id="profile-guides-heading" className="sr-only">{t("playerProfile.guidesListHeading")}</h3>
              {guidesViewMode === "card" ? (
                <GuideCardGrid
                  guides={playerGuides}
                  linkFn={(guide) => `/guides/${player.slug}/${guide.slug}`}
                  gridCols="sm:grid-cols-2"
                  titleLevel="h4"
                />
              ) : (
                <GuideListView
                  guides={playerGuides}
                  linkFn={(guide) => `/guides/${player.slug}/${guide.slug}`}
                  titleLevel="h4"
                />
              )}
            </div>
          ) : (
            <EmptyState
              icon={<BookOpen className="h-12 w-12" />}
              title={t("playerProfile.noGuidesTitle")}
              description={t(isOwner ? "playerProfile.noGuidesDescriptionOwner" : "playerProfile.noGuidesDescription")}
              action={isOwner ? <OwnerEditAction to="/my-guides" label={t("playerProfile.editLinkGuides")} /> : visitorEmptyAction}
            />
          )}
        </TabsContent>

        {/* 各タブの末尾の導線（全タブ共通。TabsContent の外・後ろに1つだけ置く） */}
        <div className="mt-7 sm:mt-8">
          <PageSection id="profile-explore" title={t("playerProfile.exploreTitle")}>
            <div className="flex flex-wrap gap-2 max-md:[&_a]:min-h-11">
              <Button asChild variant="outline" size="sm">
                <Link to={`/compare?p1=${player.slug}`}>
                  <GitCompare className="h-4 w-4 mr-2" />
                  {t("playerProfile.exploreCompare")}
                </Link>
              </Button>
              {compareToViewerHref && (
                <Button asChild variant="outline" size="sm">
                  <Link to={compareToViewerHref}>
                    <GitCompare className="h-4 w-4 mr-2" />
                    {t("playerProfile.exploreCompareWithMe")}
                  </Link>
                </Button>
              )}
              <Button asChild variant="outline" size="sm">
                <Link to="/browse">
                  <Users className="h-4 w-4 mr-2" />
                  {t("playerProfile.exploreBrowse")}
                </Link>
              </Button>
            </div>
          </PageSection>
        </div>

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

/**
 * 走者画面のタブパネルの共通クラス。タイトル（`data-tab-title`）の直下の最初の欄は上罫線と上余白を外す
 * （2つ目以降は罫線あり）。欄がパネル直下の section のとき、記録タブの審査中の欄（id 付き div で包む）に効く。
 * 2列グリッドの1行目は PageSection の `className` で個別に外す。
 */
const PANEL_CLASS =
  "rounded-none border-0 bg-transparent p-0 sm:p-0 space-y-7 sm:space-y-8 [&>[data-tab-title]+section]:border-t-0 [&>[data-tab-title]+section]:pt-0 [&>[data-tab-title]+#pending-speedruncom-records>section]:border-t-0 [&>[data-tab-title]+#pending-speedruncom-records>section]:pt-0";

/**
 * 各タブの先頭のタイトル（h2 `text-xl md:text-2xl`。走者名は h1 `text-2xl md:text-3xl`、欄は h3 `text-lg`、欄内の小見出しは h4）。
 * 欄が1つだけのタブ（ガイド・サーチクラフト）は欄見出しを出さず、その右の操作を `trailing`、HintTip を `badge` に置く。タブ名はホットバーのツールチップと同じ。
 * md 未満のプリセット選択（trailing）は同じ行の右端（狭いと折り返す）。タイトルと最初の欄の間は欄どうしより詰める。
 */
function ProfileTabTitle({
  value,
  label,
  badge,
  trailing,
}: {
  value: string;
  label: string;
  /** タイトルの直後（HintTip など） */
  badge?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div data-tab-title className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 sm:mb-4">
      <div className="flex min-w-0 items-center gap-2">
        <h2 id={`profile-tab-title-${value}`} className="min-w-0 text-xl font-bold md:text-2xl">
          {label}
        </h2>
        {badge && <div className="shrink-0">{badge}</div>}
      </div>
      {trailing}
    </div>
  );
}

/** アイテム配置タブの1セグメント分の欄（見出し + ホットバー + メモ）。アイテム名はホットバーのヒント（ホバー・フォーカス・タップ）で提示する */
function ItemLayoutRow({
  layout,
  slotKeyLabels,
  first,
  className,
}: {
  layout: {
    id: string;
    segment: string;
    slots: string;
    offhand: string | null;
    notes: string | null;
  };
  slotKeyLabels?: Partial<Record<number, string>>;
  /** 欄の上罫線と上余白を外す（タブタイトル直下の最初の欄） */
  first?: boolean;
  className?: string;
}) {
  const t = useT();
  const slots = JSON.parse(layout.slots) as Slot[];
  const offhand = layout.offhand ? (JSON.parse(layout.offhand) as string[]) : [];
  const dotClass = ITEM_LAYOUT_SEGMENT_DOT_CLASSES[layout.segment] ?? "bg-muted-foreground";

  return (
    <PageSection
      headingLevel="h3"
      id={`profile-items-${layout.id}`}
      first={first}
      className={className}
      icon={<span aria-hidden className={cn("block h-2.5 w-2.5 rounded-full", dotClass)} />}
      title={layout.segment}
    >
      <ItemHotbar
        slots={slots}
        offhand={offhand}
        offhandLabel={t("playerProfile.offhandShort")}
        slotKeyLabels={slotKeyLabels}
        fitMobile
        itemNameTips
      />
      {layout.notes && (
        <p className="mt-3 text-sm text-muted-foreground">{layout.notes}</p>
      )}
    </PageSection>
  );
}

// KeyBadge / SearchCraftLegend / SearchCraftList 系は @/components/search-craft-template-view に共通化済み

function SocialIcon({
  platform,
  className = "h-5 w-5",
}: {
  platform: string;
  /** Button の中では基底の svg サイズ指定に負けるため `size-5` を渡す */
  className?: string;
}) {
  switch (platform) {
    case "youtube":
      return <Youtube className={className} />;
    case "twitch":
      return <Twitch className={className} />;
    case "twitter":
      return <Twitter className={className} />;
    case "speedruncom":
      return <Trophy className={className} />;
    default:
      return <ExternalLink className={className} />;
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
    <PageSection headingLevel="h3" id="profile-links" title={t("playerProfile.links")}>
      <div className="space-y-2">
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
                  <SocialIcon platform={link.platform} className="size-5" />
                  <span className="font-medium">{getSocialPlatformName(link.platform, link.customLabel)}</span>
                  <span className="text-muted-foreground">{link.identifier}</span>
                </a>
              </Button>
            ))}
          </div>
        )}
      </div>
    </PageSection>
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
      // 本物の 0（新規チャンネル等）は「登録者 0人」と出さない（取得失敗は元から null で非表示）
      if (yt.subscriberCount != null && yt.subscriberCount > 0) {
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
      // フォロワー 0 も同じく出さない（リンクと配信の情報は残す）
      if (tw.followerCount != null && tw.followerCount > 0) {
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

/** plain: 値が数値ではなく名前（ゲーム言語・機種名など）のとき等幅フォントにしない */
/** キーボードレイアウトの生の値（US_TKL 等）を設定画面の選択肢と同じ表示名（US TKL）にする */
function keyboardLayoutLabel(layout: string): string {
  return layout.replace(/[_-]/g, " ");
}

function DeviceRow({ label, value, unit, plain }: { label: ReactNode; value: ReactNode; unit?: string; plain?: boolean }) {
  return (
    <div className="flex justify-between items-center py-2.5">
      <span className="text-sm">{label}</span>
      <span className={cn("font-medium text-sm", !plain && "font-mono")}>
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
      {/* calculateCm360 は半回転（180°）の距離を返す。身元帯のハイライト・ホームと同じ小数1桁＋cm/180° */}
      {/* 数値と単位の間は余白ではなく空白文字で区切る（コピー・読み上げでも「1.5 cm/180°」になり、身元帯と表記がそろう） */}
      {cm360.toFixed(1)}{" "}
      <span className="text-muted-foreground">cm/180°</span>
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
  const t = useT();
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
      {/* 押してから読み込む（記録タブの SRC 動画と同じ YouTubeClickEmbed）。名前は動画のタイトル（無ければ URL）で一意にする */}
      <YouTubeClickEmbed
        embedUrl={embedUrl}
        title={t("playerStatsCards.videoTitle", { label: video.title || video.url })}
        playLabel={t("playerStatsCards.playVideo", { label: video.title || video.url })}
      />
    </div>
  );
}

// Stats タブで参照するプレイヤー情報の型（categoryRecords は RecordCard の型に揃える）
type StatsPlayer = {
  mcid: string | null;
  speedruncomUsername: string | null;
  showRankedStats: boolean | null;
  showPacemanStats: boolean | null;
  categoryRecords: RecordCardRecord[];
};

type StatsService = "ranked" | "paceman" | "speedruncom";
type StatsLoadState = Record<StatsService, "loading" | "done" | "error">;
const STATS_SERVICE_KEYS: readonly StatsService[] = ["ranked", "paceman", "speedruncom"];
const PACEMAN_REGISTERED = { isRegistered: true } as const;

// サービスごとの取得キー（無ければ取得しない）と取得関数。PaceMan の取得関数は差し替えやすいよう単独の関数にしている。
// force は再試行用（キャッシュを迂回する。キャッシュの無い PaceMan では無視）
const STATS_SERVICES: Record<
  StatsService,
  { key: (player: StatsPlayer) => string | null; fetch: (id: string, force: boolean) => Promise<unknown> }
> = {
  ranked: { key: (p) => p.mcid, fetch: (id, force) => fetchMCSRRankedStatsCached(id, { force }) },
  paceman: { key: (p) => p.mcid, fetch: (id) => fetchPaceManRegistration(id) },
  speedruncom: { key: (p) => p.speedruncomUsername, fetch: (id, force) => fetchSpeedrunComStatsCached(id, { force }) },
};

/** MCID / speedrun.com ユーザー名が無いサービス（と、登録済みが自明な PaceMan）は取得しないので最初から "done" */
function initialLoadState(player: StatsPlayer, pacemanRegisteredKnown: boolean): StatsLoadState {
  return {
    ranked: STATS_SERVICES.ranked.key(player) ? "loading" : "done",
    paceman: STATS_SERVICES.paceman.key(player) && !pacemanRegisteredKnown ? "loading" : "done",
    speedruncom: STATS_SERVICES.speedruncom.key(player) ? "loading" : "done",
  };
}

// Stats タブのコンテナ（クライアント側でデータ取得）
function StatsTabContent({
  player,
  hiddenSpeedrunRecords,
  pinnedSpeedrunRecords,
  pendingSpeedrunRecords,
  showPending,
  onShowPendingChange,
  pacemanStats,
  minefolioEloRank,
  isOwner,
  mainCategory,
  visitorEmptyAction,
}: {
  player: StatsPlayer;
  hiddenSpeedrunRecords: string[];
  pinnedSpeedrunRecords: string[];
  pendingSpeedrunRecords: PendingSpeedrunRecord[];
  showPending: boolean;
  onShowPendingChange: (show: boolean) => void;
  pacemanStats: { netherEnterCount: number; mainPaces: GroupedPaceEntry[] } | null;
  minefolioEloRank: { rank: number; total: number } | null;
  isOwner: boolean;
  mainCategory: string | null | undefined;
  /** 空のときに訪問者へ出す案内（他の中身あるタブへのボタン） */
  visitorEmptyAction?: ReactNode;
}) {
  // loader 由来の週間統計があれば PaceMan 登録済みは自明なので、登録確認の取得は行わず最初から取得済みとして扱う
  const pacemanRegisteredKnown = hasWeeklyPacemanStats(pacemanStats, player);
  const [externalStats, setExternalStats] = useState<Awaited<ReturnType<typeof fetchAllExternalStats>>>(
    pacemanRegisteredKnown ? { paceman: PACEMAN_REGISTERED } : {},
  );
  const [loadState, setLoadState] = useState(() => initialLoadState(player, pacemanRegisteredKnown));

  // 走者切替・アンマウントで破棄する取得セッション。各サービスの取得は、開始時点のセッションが
  // まだ有効なときだけ結果を反映する（再試行も同じ仕組みを通る）
  const sessionRef = useRef({ cancelled: false });

  // サービスごとの取得（失敗は結果の `error` か reject）。取得キーが無い走者（mcid / speedrun.com ユーザー名なし）は
  // 取得せず終える（"null" を名前に外部 API を呼ぶと偽の取得失敗になる。身元帯 profile-highlights も止めている）。
  // 取得関数は失敗を throw せず { error } で返す。error があれば取得失敗（再試行カード）、
  // error なしの未登録・データなしは従来どおり「done」で欄ごと出さない。force は再試行用でキャッシュを迂回する
  const load = useCallback(
    async (service: StatsService, force = false) => {
      const target = STATS_SERVICES[service];
      const id = target.key(player);
      if (!id) return;
      const session = sessionRef.current;
      setLoadState((prev) => ({ ...prev, [service]: "loading" }));
      try {
        const result = await target.fetch(id, force);
        if (session.cancelled) return;
        setExternalStats((prev) => ({ ...prev, [service]: result }));
        setLoadState((prev) => ({ ...prev, [service]: (result as { error?: unknown } | undefined)?.error ? "error" : "done" }));
      } catch (error) {
        console.error(`Failed to fetch ${service} stats:`, error);
        if (session.cancelled) return;
        setLoadState((prev) => ({ ...prev, [service]: "error" }));
      }
    },
    [player.mcid, player.speedruncomUsername], // eslint-disable-line react-hooks/exhaustive-deps
  );

  useEffect(() => {
    const session = { cancelled: false };
    sessionRef.current = session;
    setLoadState(initialLoadState(player, pacemanRegisteredKnown));
    void load("ranked");
    if (pacemanRegisteredKnown) setExternalStats((prev) => (prev.paceman === PACEMAN_REGISTERED ? prev : { ...prev, paceman: PACEMAN_REGISTERED }));
    else void load("paceman");
    void load("speedruncom");
    return () => {
      session.cancelled = true;
    };
  }, [load, pacemanRegisteredKnown, player.mcid, player.speedruncomUsername]); // eslint-disable-line react-hooks/exhaustive-deps

  // 「再試行」を押したサービスは、成功して失敗カードが消えたら、その欄の見出しへフォーカスを移す
  // （押したボタンが消えてフォーカスが BODY に落ちるのを防ぐ。失敗のままならボタンにフォーカスが残る）。
  // 欄の見出し id は PageSection の `${id}-heading`（player-stats-cards.tsx の stats-ranked / stats-paceman / stats-speedruncom）
  const retryFocusRef = useRef<Partial<Record<StatsService, true>>>({});
  const retry = (service: StatsService) => {
    retryFocusRef.current[service] = true;
    void load(service, true);
  };
  useEffect(() => {
    for (const service of STATS_SERVICE_KEYS) {
      if (!retryFocusRef.current[service] || loadState[service] === "loading") continue;
      delete retryFocusRef.current[service];
      if (loadState[service] === "done") document.getElementById(`stats-${service}-heading`)?.focus();
    }
  }, [loadState]);

  return (
    <StatsContent
      externalStats={externalStats}
      player={player}
      hiddenSpeedrunRecords={hiddenSpeedrunRecords}
      pinnedSpeedrunRecords={pinnedSpeedrunRecords}
      pendingSpeedrunRecords={pendingSpeedrunRecords}
      showPending={showPending}
      onShowPendingChange={onShowPendingChange}
      pacemanStats={pacemanStats}
      minefolioEloRank={minefolioEloRank}
      isOwner={isOwner}
      loadState={loadState}
      onRetry={retry}
      mainCategory={mainCategory}
      visitorEmptyAction={visitorEmptyAction}
    />
  );
}

function filterWeeklyMainPaces(mainPaces: GroupedPaceEntry[]): GroupedPaceEntry[] {
  const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return mainPaces.filter((pace) => {
    const date = pace?.date ? new Date(pace.date).getTime() : NaN;
    return Number.isFinite(date) && date >= oneWeekAgo;
  });
}

/** PaceMan の週間統計欄を出せる（表示設定がオンで、件数がある）か。あれば PaceMan 登録済みは自明 */
function hasWeeklyPacemanStats(
  pacemanStats: { netherEnterCount: number; mainPaces: GroupedPaceEntry[] } | null,
  player: StatsPlayer,
): boolean {
  return (
    !!pacemanStats &&
    player.showPacemanStats !== false &&
    (pacemanStats.netherEnterCount > 0 || filterWeeklyMainPaces(pacemanStats.mainPaces).length > 0)
  );
}

// Stats タブのコンテンツ
function StatsContent({
  externalStats,
  player,
  hiddenSpeedrunRecords,
  pinnedSpeedrunRecords,
  pendingSpeedrunRecords,
  showPending,
  onShowPendingChange,
  pacemanStats,
  minefolioEloRank,
  isOwner,
  loadState,
  onRetry,
  mainCategory,
  visitorEmptyAction,
}: {
  externalStats: Awaited<ReturnType<typeof fetchAllExternalStats>>;
  /** サービスごとの再取得（取得失敗カードの「再試行」） */
  onRetry: (service: StatsService) => void;
  player: StatsPlayer;
  hiddenSpeedrunRecords: string[];
  pinnedSpeedrunRecords: string[];
  pendingSpeedrunRecords: PendingSpeedrunRecord[];
  showPending: boolean;
  onShowPendingChange: (show: boolean) => void;
  pacemanStats: { netherEnterCount: number; mainPaces: GroupedPaceEntry[] } | null;
  minefolioEloRank: { rank: number; total: number } | null;
  isOwner: boolean;
  visitorEmptyAction?: ReactNode;
  loadState: StatsLoadState;
  /** 本人のメインカテゴリ（playstyle.mainCategory）。欄の並びとハイライト PB の選択に使う */
  mainCategory: string | null | undefined;
}) {
  const t = useT();
  // ?srcPending=1 で開いた直後に、審査中記録カードの位置へ移動する（外部統計の取得完了で上のカードが
  // 伸びてずれるため、最初のレンダー後と取得完了後の2回合わせる）
  const hasPending = pendingSpeedrunRecords.length > 0;
  const externalDone = loadState.ranked !== "loading" && loadState.paceman !== "loading" && loadState.speedruncom !== "loading";
  useEffect(() => {
    if (!showPending || !hasPending) return;
    document.getElementById("pending-speedruncom-records")?.scrollIntoView({ block: "start" });
  }, [externalDone]); // eslint-disable-line react-hooks/exhaustive-deps
  const weeklyMainPaces = pacemanStats ? filterWeeklyMainPaces(pacemanStats.mainPaces) : [];
  const hasWeeklyStats = hasWeeklyPacemanStats(pacemanStats, player);
  const hasPacemanLink = !!externalStats.paceman?.isRegistered && loadState.paceman !== "loading" && !!player.mcid;
  const showPacemanSection = hasWeeklyStats || hasPacemanLink;
  const allExternalResolved = loadState.ranked !== "loading"
    && loadState.paceman !== "loading"
    && loadState.speedruncom !== "loading";
  const hasExternalError = loadState.ranked === "error"
    || loadState.paceman === "error"
    || loadState.speedruncom === "error";
  // Speedrun.com PBの絞り込み・並び替え用（sort比較関数内でのArray.includes連発を避ける）
  const hiddenSet = new Set(hiddenSpeedrunRecords);
  const pinnedSet = new Set(pinnedSpeedrunRecords);

  // 代表 PB（身元帯のハイライト）が speedrun.com の記録になったときは、表示上限に関係なく Speedrun.com 欄へ必ず含める。
  // 選び方は身元帯と同じ pickRepresentativePb（Ranked・カスタム記録が代表になるときは指定しない）。
  // メインカテゴリが Ranked のときは Ranked の取得が済むまで決まらないので、その間は指定しない
  const categoryKey = isCategoryKey(mainCategory) ? mainCategory : null;
  const rankedShown = player.showRankedStats !== false;
  const representativePb =
    externalStats.speedruncom?.personalBests && !(categoryKey === "ranked" && rankedShown && loadState.ranked === "loading")
      ? pickRepresentativePb({
          mainCategory: categoryKey,
          records: player.categoryRecords,
          speedrunComPbs: externalStats.speedruncom.personalBests,
          hiddenRunIds: hiddenSpeedrunRecords,
          pinnedRunIds: pinnedSpeedrunRecords,
          rankedTimeMs: rankedShown ? rankedBestTimeMs(externalStats.ranked) : null,
        })
      : null;
  const highlightSrcRunId = representativePb?.kind === "speedruncom" ? representativePb.pb.run.id : null;

  // 全体が空のとき（下の EmptyState を出すとき）は、サービスごとの「記録なし」は出さない（二重になる）
  const noData =
    !externalStats.ranked?.isRegistered &&
    !externalStats.paceman?.isRegistered &&
    !externalStats.speedruncom?.personalBests?.length &&
    pendingSpeedrunRecords.length === 0 &&
    player.categoryRecords.length === 0;
  const showEmptyState = allExternalResolved && !hasExternalError && noData;
  // 結果が無かったサービスの欄は出さない（ui.md「中身が無い欄は出さない」。/player/:slug/stats と同じ）

  // 取得前に「記録がある見込み」が loader で分からないサービス（Ranked は Minefolio 内順位なし、PaceMan は週間統計なし）は、
  // 読み込み中の欄（約140px）を出さない。取得後に空で消えると下の内容が押し上がるため、1行の確認中表示だけを末尾に出す。失敗時は再試行のため欄で出す
  const rankedExpected = !!minefolioEloRank;
  const rankedCardShown =
    player.showRankedStats !== false && loadState.ranked !== "done" && (loadState.ranked === "error" || rankedExpected);
  const pacemanCardShown = !hasWeeklyStats && loadState.paceman === "error";
  const checkingExternal =
    (player.showRankedStats !== false && loadState.ranked === "loading" && !rankedExpected) ||
    (!hasWeeklyStats && loadState.paceman === "loading");

  const sections: Record<StatsSectionKey, ReactNode> = {
    ranked: (
      <>
        {rankedCardShown && (
          <StatsServiceLoadingCard
            framed={false}
            title="MCSR Ranked"
            description={t("loading.rankedStats")}
            state={loadState.ranked}
            onRetry={() => onRetry("ranked")}
            // 登録済みが loader の時点で分かる（Minefolio 内順位がある）ときだけ、届く中身に近い高さを確保する
            loadingClassName={minefolioEloRank ? STATS_RANKED_LOADING_CLASS : undefined}
          />
        )}
        {externalStats.ranked?.isRegistered && player.showRankedStats !== false && loadState.ranked !== "loading" && (
          <MCSRRankedCard framed={false} ranked={externalStats.ranked} minefolioRank={minefolioEloRank} />
        )}
      </>
    ),
    // PaceMan は欄を 1 つ（「PaceMan」）にまとめる。リンク（クライアント取得）は見出し右、週間統計（loader 取得済み）は中身
    paceman: (
      <>
        {/* 週間統計があるときは欄を 1 つにし、登録判定の状態は見出し右（PaceManStatsCard 側）で出す */}
        {pacemanCardShown && (
          <StatsServiceLoadingCard
            framed={false}
            title="PaceMan"
            description={t("loading.pacemanStats")}
            state={loadState.paceman}
            onRetry={() => onRetry("paceman")}
          />
        )}
        {showPacemanSection &&
          (hasWeeklyStats && pacemanStats ? (
            <PaceManStatsCard
              framed={false}
              netherEnterCount={pacemanStats.netherEnterCount}
              mainPaces={weeklyMainPaces}
              openDetailsMcid={hasPacemanLink ? player.mcid : null}
              registrationState={loadState.paceman}
              onRetryRegistration={() => onRetry("paceman")}
            />
          ) : (
            player.mcid && (
              <PaceManLinkCard
                framed={false}
                mcid={player.mcid}
                weeklyStatsHidden={player.showPacemanStats === false}
              />
            )
          ))}
      </>
    ),
    speedruncom: (
      <>
        {player.speedruncomUsername && loadState.speedruncom !== "done" && (
          <StatsServiceLoadingCard
            framed={false}
            title="Speedrun.com"
            description={t("loading.speedruncomStats")}
            state={loadState.speedruncom}
            onRetry={() => onRetry("speedruncom")}
            loadingClassName={STATS_SPEEDRUNCOM_LOADING_CLASS}
          />
        )}
        {externalStats.speedruncom && !externalStats.speedruncom.error && externalStats.speedruncom.personalBests.length > 0 && loadState.speedruncom !== "loading" && (
          <SpeedrunComCard
            framed={false}
            speedruncom={externalStats.speedruncom}
            hiddenRunIds={hiddenSet}
            pinnedRunIds={pinnedSet}
            showVideoEmbed
            highlightRunId={highlightSrcRunId}
            expandable
          />
        )}

        {/* 審査中の記録（0件なら出さない。?srcPending=1 で最初から開き、その位置へスクロール） */}
        {pendingSpeedrunRecords.length > 0 && (
          <PendingSpeedrunRecordsCard
            framed={false}
            records={pendingSpeedrunRecords}
            show={showPending}
            onShowChange={onShowPendingChange}
          />
        )}
      </>
    ),
  };

  return (
    <>
      {/* メインカテゴリに合う欄を先頭に置く（残りは既定の順） */}
      {orderStatsSections(mainCategory).map((key) => (
        <Fragment key={key}>{sections[key]}</Fragment>
      ))}

      {checkingExternal && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          {t("playerProfile.statsLoadingExternal")}
        </p>
      )}

      {/* カスタム記録（RecordCard は1件ずつの箱のまま） */}
      {player.categoryRecords.length > 0 && (
        <PageSection headingLevel="h3" id="stats-custom-records" title={t("playerProfile.customRecords")}>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {player.categoryRecords.map((record) => (
              <RecordCard key={record.id} record={record} />
            ))}
          </div>
        </PageSection>
      )}

      {/* データがない場合（外部サービスがエラーの場合は各セクションのエラー表示に任せ、ここでは出さない） */}
      {showEmptyState && (
        <EmptyState
          icon={<BarChart3 className="h-12 w-12" />}
          title={t("playerProfile.noStatsTitle")}
          description={t(isOwner ? "playerProfile.noStatsDescriptionOwner" : "playerProfile.noStatsDescription")}
          action={isOwner ? <OwnerEditAction to="/me/records" label={t("playerProfile.editLinkRecords")} /> : visitorEmptyAction}
        />
      )}
    </>
  );
}
