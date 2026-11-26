import { createTranslator } from "@/lib/messages";
import { useLoaderData, useFetcher, data } from "react-router";
import { useEffect, useReducer, useRef, memo, useMemo, useCallback, Fragment, type ReactNode } from "react";
import {
  defaultHomeLayout,
  normalizeHomeLayout,
  parseHomeLayoutFields,
  pickKnownHomeSectionIds,
  serializeHomeLayout,
  HOME_SECTION_IDS,
  type HomeLayout,
  type HomeSectionId,
} from "@/lib/home-sections";
import { HOME_SECTION_ORDER_FETCHER_KEY } from "@/components/home/home-settings-dialog";
import type { Route } from "./+types/home";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getOptionalSession, loadUserByDiscordId } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users, guides, pageViewStats, playstyles } from "@/lib/schema";
import { listedRunnerCondition } from "@/lib/users-filter";
import { eq, desc, and, or, isNotNull, sql } from "drizzle-orm";
import { getHomeSpotlight } from "@/lib/home-featured.server";
import { getHomeOutlooks } from "@/lib/home-live-outlook.server";
import { guideLikeCountSql } from "@/lib/likes.server";
import type { CachedPace } from "@/lib/paceman-cache";
import type { PaceManLiveRun } from "@/lib/paceman";
import type { McidUserMaps } from "@/lib/home-user-data.server";
import { getHiddenPaceMcid, filterOwnPaces } from "@/lib/pace-visibility";
import {
  pickTwitchOnlyStreams,
  liveEntrySplit,
  twitchLoginFromUrl,
  compareLiveEntries,
  insertEndedAtPrevIndex,
  advanceLiveEnded,
  applyRankedResult,
  pruneLiveEnded,
  initialLiveEndedState,
  rankedOpponentUuid,
  livePaceId,
  liveRankedId,
  LIVE_POLL_INTERVAL_MS,
  type HomeTwitchStream,
  type RankedLiveMatch,
  type RankedLiveResult,
  type RankedResultResponse,
  type LiveEndedState,
} from "@/lib/home-live";
import { GuideCardGrid, type GuideItem, type GuideItemWithAuthorSlug } from "@/components/guide-list-views";
import { Skeleton } from "@/components/ui/skeleton";
import { FavoritesFirstNote } from "@/components/favorite-mark";
import { PageSection, SectionHeaderLink } from "@/components/page-section";
import { WelcomeBar } from "@/components/home/welcome-bar";
import { FeaturedRunnerCard } from "@/components/home/featured-runner-card";
import { GuestHero } from "@/components/home/guest-hero";
import { LiveTeaser } from "@/components/home/live-teaser";
import { LiveRail, type LiveRailEntry } from "@/components/home/live-rail";
import { LiveSplitStrip } from "@/components/home/live-split-strip";
import { LiveUpdatedAt } from "@/components/home/live-updated-at";
import { FavoriteActivity } from "@/components/home/favorite-activity";
import { CompactProfileList } from "@/components/home/compact-profiles";
import { HomeVideoCard } from "@/components/home/home-video-card";
import { TwitchRecentList } from "@/components/home/twitch-recent-list";
import { FeedErrorNotice } from "@/components/home/feed-error-notice";
import { filterOwnVideos, feedVideoKey, type FeedVideo } from "@/lib/feed-video";
import { useFavorites } from "@/hooks/use-favorites";
import { useT, useLocale } from "@/hooks/use-locale";
import { localeFromMatches, resolveLocale } from "@/lib/locale";
import { getGuideTranslations } from "@/lib/content-translation.server";
import { applyGuideTranslation } from "@/lib/guide-translation-list";
import { getLocalizedDisplayName, pickDisplayName } from "@/lib/slug";
import { cn } from "@/lib/utils";
import { Youtube, Twitch } from "@/components/brand-icons";
import { UserCheck, BookOpen, Play, Radio } from "lucide-react";

export const meta: Route.MetaFunction = ({ loaderData, matches }) => {
  const t = createTranslator(localeFromMatches(matches));
  const appUrl = loaderData?.appUrl || "https://minefolio.app";
  const title = t("home.title");
  const description = t("home.heroDescription");
  const ogImageUrl = `${appUrl}/og-image?type=home`;

  return [
    { title },
    { name: "description", content: description },

    // Open Graph
    { property: "og:type", content: "website" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:image", content: ogImageUrl },
    { property: "og:image:type", content: "image/png" },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { property: "og:url", content: appUrl },

    // Twitter Card
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: ogImageUrl },
  ];
};

/** ホームのガイド（新着）の表示件数。同じ著者は1件まで */
const HOME_GUIDE_COUNT = 4;
/** 最近の更新・よく見られているの各表示件数 */
const HOME_PROFILE_COUNT = 4;
// ゲストのヒーローの見出しで入れ替えて見せる走者の人数の上限（単一情報源。注目の走者と重なる分は描画側で除く）
const HERO_FACE_POOL = 12;

// おかえりバーで「ようこそ」と出す、アカウント作成からの期間
const NEW_ACCOUNT_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function loader({ request }: Route.LoaderArgs) {
  const env = getEnv();
  const db = createDb();
  const auth = createAuth(db, env);

  // プロフィール一覧の select 列（更新順・PV順で共通）
  const profileFeedColumns = {
    inputMethod: users.inputMethod,
    mcid: users.mcid,
    uuid: users.uuid,
    slug: users.slug,
    displayName: users.displayName,
    displayNameAlphabet: users.displayNameAlphabet,
    pronouns: users.pronouns,
    role: users.role,
    mainEdition: users.mainEdition,
    mainPlatform: users.mainPlatform,
    updatedAt: users.updatedAt,
    shortBio: users.shortBio,
    customSkinUrl: users.customSkinUrl,
    // カードのタグ用（メインカテゴリ）。playstyles.userId は一意なので leftJoin しても行は増えない
    mainCategory: playstyles.mainCategory,
  };

  // ガイド一覧の select 列
  const guideListColumns = {
    id: guides.id,
    slug: guides.slug,
    title: guides.title,
    summary: guides.summary,
    tags: guides.tags,
    coverImageUrl: guides.coverImageUrl,
    viewCount: guides.viewCount,
    likeCount: guideLikeCountSql(),
    updatedAt: guides.updatedAt,
    authorSlug: users.slug,
    authorDisplayName: users.displayName,
    authorDisplayNameAlphabet: users.displayNameAlphabet,
    authorMcid: users.mcid,
    // 著者の顔（GuideCardGrid の著者名の左）。同じ users との JOIN で取れるので追加クエリは無い
    authorUuid: users.uuid,
    authorCustomSkinUrl: users.customSkinUrl,
  };

  // セッション確認（→登録ユーザー判定）。他の取得と並列に走らせる
  const accountPromise = (async () => {
    const session = await getOptionalSession(request, auth);
    if (!session) return null;
    // 同じ Request で users 行（全列）を1回だけ読む（共通レイアウトなどと共有）。全列なので、クライアントへ渡す列は明示的に選ぶ
    const existingUser = await loadUserByDiscordId(request, db, session.user.id);
    if (!existingUser) return null;
    const { homeSectionOrder, createdAt } = existingUser;
    const profile = {
      mcid: existingUser.mcid,
      uuid: existingUser.uuid,
      slug: existingUser.slug,
      displayName: existingUser.displayName,
      displayNameAlphabet: existingUser.displayNameAlphabet,
      customSkinUrl: existingUser.customSkinUrl,
    };
    return {
      layout: normalizeHomeLayout(homeSectionOrder),
      // クライアントへそのまま渡す部分
      user: {
        ...profile,
        showPacemanOnHome: existingUser.showPacemanOnHome ?? true,
        showYoutubeOnHome: existingUser.showYoutubeOnHome ?? true,
        showTwitchOnHome: existingUser.showTwitchOnHome ?? true,
        // 作成から24時間以内は「おかえりなさい」ではなく「ようこそ」にする（サーバーで判定し、時計差による hydration のずれを避ける）
        isNewAccount: Date.now() - createdAt.getTime() < NEW_ACCOUNT_WINDOW_MS,
      },
    };
  })();

  const locale = resolveLocale(request);
  const [
    account,
    recentlyUpdatedUsers,
    popularUsersRaw,
    guidesWithTranslations,
    [profileCounts],
    spotlight,
    heroFaces,
    outlooks,
  ] = await Promise.all([
    accountPromise,
    // 最近更新されたプロフィール（公開設定のみ、視聴者ロール除外）
    db
      .select(profileFeedColumns)
      .from(users)
      .leftJoin(playstyles, eq(playstyles.userId, users.id))
      .where(listedRunnerCondition)
      .orderBy(desc(users.updatedAt))
      .limit(HOME_PROFILE_COUNT),
    // よく見られているプロフィール（直近7日PV順）。「最近の更新」との重複を除くため多めに取る。
    // page_view_stats のスナップショット行を直接引くため、集計未稼働の環境では自然に0件になる
    db
      .select({ ...profileFeedColumns, pageViews7d: pageViewStats.pageviews })
      .from(pageViewStats)
      .innerJoin(users, eq(pageViewStats.targetId, users.id))
      .leftJoin(playstyles, eq(playstyles.userId, users.id))
      .where(and(eq(pageViewStats.targetType, "profile"), listedRunnerCondition))
      .orderBy(desc(pageViewStats.pageviews))
      .limit(HOME_PROFILE_COUNT * 3),
    // 新着ガイド（公開済み・更新日時順）。同じ著者は1件までにするため多めに取って絞る
    db
      .select(guideListColumns)
      .from(guides)
      .innerJoin(users, eq(guides.authorId, users.id))
      // 非公開・限定公開の著者のガイドはホームの一覧（discovery）に出さない（視聴者ロールの著者は除外しない）
      .where(and(eq(guides.isPublished, true), eq(users.profileVisibility, "public")))
      .orderBy(desc(guides.updatedAt))
      .limit(HOME_GUIDE_COUNT * 6)
      .then((newGuidesRaw) => {
        // 同じ著者は1件まで
        const seenAuthors = new Set<string>();
        const newGuides = newGuidesRaw
          .filter((g) => {
            if (seenAuthors.has(g.authorSlug)) return false;
            seenAuthors.add(g.authorSlug);
            return true;
          })
          .slice(0, HOME_GUIDE_COUNT);
        // 自動翻訳（docs/translation.md）。newGuides が決まった時点で、他の取得を待たずに引き始める。
        // 機能無効・opt-out・失効・原文と同じロケールでは空の Map（原文のまま）
        return getGuideTranslations(db, newGuides.map((g) => g.id), locale).then((guideTranslations) => ({
          newGuides,
          guideTranslations,
        }));
      }),
    db.select({ total: sql<number>`count(*)` }).from(users).where(listedRunnerCondition),
    // 注目の走者（ゲストはヒーロー右、ログイン時は「プロフィール」欄の上。10分キャッシュ）。失敗してもホーム全体は落とさない
    getHomeSpotlight(db).catch((error) => {
      console.error("Failed to build home spotlight:", error);
      return null;
    }),
    // ゲストのヒーローの「顔ぶれ」の帯用。ログイン時は DB に行かない。公開一覧に出ている項目のうち表示に要る列だけ
    accountPromise.then((acct) =>
      acct
        ? []
        : db
            .select({
              slug: users.slug,
              mcid: users.mcid,
              uuid: users.uuid,
              customSkinUrl: users.customSkinUrl,
              displayName: users.displayName,
              displayNameAlphabet: users.displayNameAlphabet,
            })
            .from(users)
            .where(and(listedRunnerCondition, or(isNotNull(users.uuid), isNotNull(users.customSkinUrl))))
            .orderBy(desc(users.updatedAt))
            .limit(HERO_FACE_POOL),
    ),
    // ライブ欄・動画欄の読み込み中の骨組みの形を選ぶ見込み（キャッシュと DB の1行確認だけ。上流は呼ばない）
    getHomeOutlooks(db),
  ]);
  const currentUser = account?.user ?? null;
  const isRegistered = currentUser != null;
  const totalPublicProfiles = profileCounts?.total ?? 0;

  // 「最近の更新」と「よく見られている」の重複は除く
  const recentSlugs = new Set(recentlyUpdatedUsers.map((u) => u.slug));
  const popularUsers = popularUsersRaw.filter((u) => !recentSlugs.has(u.slug)).slice(0, HOME_PROFILE_COUNT);

  const { newGuides, guideTranslations } = guidesWithTranslations;
  const popular = popularUsers;
  const recent = recentlyUpdatedUsers;
  // お気に入り 0 人のときに勧める走者（3人）。自分自身は勧めない。下のプロフィール欄（最近の更新・よく見られている）と
  // 同じ顔ぶれにならないよう、よく見られている人のうち欄に出ていない人を先に選び、足りなければ欄に出ている人で埋める
  const shownSlugs = new Set([...recent, ...popular].map((u) => u.slug));
  const notSelf = <T extends { slug: string }>(u: T) => u.slug !== currentUser?.slug;
  const recommended = [
    ...popularUsersRaw.filter((u) => notSelf(u) && !shownSlugs.has(u.slug)),
    ...popular.filter(notSelf),
    ...recent.filter(notSelf),
  ]
    .filter((u, i, list) => list.findIndex((v) => v.slug === u.slug) === i)
    .slice(0, 3);

  return {
    appUrl: env.APP_URL || "https://minefolio.app",
    isRegistered,
    // 欄の並び・表示（ゲストは既定）。SSR の時点でこの内容で描画する
    layout: account?.layout ?? defaultHomeLayout(),
    currentUser,
    recentlyUpdatedUsers: recent,
    popularUsers: popular,
    recommended,
    newGuides: newGuides.map((g) => applyGuideTranslation(g, guideTranslations)),
    totalPublicProfiles,
    spotlight,
    heroFaces,
    outlooks,
  };
}

// ログイン状態・表示設定など閲覧者依存のデータを SSR に含むため、ブラウザ/CDN にキャッシュさせない
// （共有キャッシュに載ると他人のログイン状態の表示が配信される。`.data` サブリクエストにも適用される）
export function headers(_: Route.HeadersArgs) {
  return { "Cache-Control": "private, no-store" };
}

/**
 * ホームの欄の並び・表示を保存する（_action=saveHomeSectionOrder、order / hidden = 欄 ID の JSON 配列）。
 * 全欄を非表示にする保存は拒否する。既定（既定順かつ全欄表示）なら null を保存して既定に戻す。users.updatedAt は更新しない
 * （「お気に入り走者の動き」に「プロフィールを更新」と誤って出るため）。
 */
export async function action({ request }: Route.ActionArgs) {
  const t = createTranslator(resolveLocale(request));
  const env = getEnv();
  const db = createDb();
  const auth = createAuth(db, env);
  const session = await getOptionalSession(request, auth);
  const actionType = "saveHomeSectionOrder";
  if (!session) {
    return data({ error: t("home.settingsUnauthorized"), action: actionType }, { status: 401 });
  }
  const formData = await request.formData();
  if (formData.get("_action") !== actionType) {
    return data({ error: t("home.settingsInvalid"), action: actionType }, { status: 400 });
  }
  const fields = parseHomeLayoutFields(formData.get("order"), formData.get("hidden"));
  if (!fields) {
    return data({ error: t("home.settingsInvalid"), action: actionType }, { status: 400 });
  }
  const { order: parsedOrder, hidden: parsedHidden } = fields;
  if (pickKnownHomeSectionIds(parsedHidden).length >= HOME_SECTION_IDS.length) {
    return data({ error: t("home.settingsAllHidden"), action: actionType }, { status: 400 });
  }
  const stored = serializeHomeLayout(normalizeHomeLayout({ order: parsedOrder, hidden: parsedHidden }));
  const updated = await db
    .update(users)
    .set({ homeSectionOrder: stored })
    .where(eq(users.discordId, session.user.id))
    .returning({ id: users.id });
  if (updated.length === 0) {
    return data({ error: t("home.settingsUnauthorized"), action: actionType }, { status: 401 });
  }
  return { success: true, action: actionType };
}

// APIレスポンスの型定義（動画系はどちらも FeedVideo 形式で返る）
interface YouTubeVideosResponse {
  recentVideos: FeedVideo[];
}

interface TwitchVodsResponse {
  recentVods: FeedVideo[];
}

interface TwitchStreamsResponse {
  liveStreams: HomeTwitchStream[];
}

// ライブ・過去ペースの応答に含まれる mcid（小文字）→ユーザー情報マップ。応答のアイテムに出てくる mcid の分のみ
type McidMapsResponse = McidUserMaps;

interface RecentPacesResponse extends McidMapsResponse {
  recentPaces: CachedPace[];
}

interface LiveRunsResponse extends McidMapsResponse {
  liveRuns: PaceManLiveRun[];
  splitBests?: Record<string, Record<string, number>>;
}

// Feed状態管理用のReducer
interface FeedState {
  recentVideos: FeedVideo[];
  twitchVods: FeedVideo[];
  twitchStreams: HomeTwitchStream[];
  recentPaces: CachedPace[];
  liveRuns: PaceManLiveRun[];
  rankedMatches: RankedLiveMatch[];
  /** 一覧から消えたカードを「終了」として少しの間残すための状態（docs/home-live.md） */
  liveEnded: LiveEndedState;
  splitBests: Record<string, Record<string, number>>;
  mcidToUuid: Record<string, string>;
  mcidToSlug: Record<string, string>;
  mcidToDisplayName: Record<string, string>;
  mcidToDisplayNameAlphabet: Record<string, string>;
  mcidToSkinUrl: Record<string, string>;
  loading: {
    videos: boolean;
    twitchVods: boolean;
    paces: boolean;
    liveRuns: boolean;
  };
  errors: {
    videos: boolean;
    twitchVods: boolean;
    paces: boolean;
    liveRuns: boolean;
  };
  // ライブペースを最後に正常取得した時刻（ms。未取得は null）
  liveRunsCheckedAt: number | null;
}

type FeedAction =
  | { type: "SET_VIDEOS"; payload: FeedVideo[] }
  | { type: "SET_TWITCH_VODS"; payload: FeedVideo[] }
  | { type: "SET_PACES"; payload: Partial<McidMapsResponse> & { recentPaces: CachedPace[] } }
  | {
      type: "SET_LIVE_RUNS";
      payload: Partial<McidMapsResponse> & {
        liveRuns: PaceManLiveRun[];
        splitBests: Record<string, Record<string, number>>;
        rankedMatches: RankedLiveMatch[] | null;
        /** ranked-live 応答のサーバー取得時刻（ms）。試合開始の推定に使う */
        rankedFetchedAt: number;
        twitchStreams: HomeTwitchStream[] | null;
        /** この取得を受け取った時刻（ms。reducer は純粋に保つため呼び出し側で渡す） */
        now: number;
      };
    }
  | { type: "PRUNE_LIVE_ENDED"; payload: { now: number } }
  | { type: "SET_RANKED_RESULT"; payload: { id: string; endedAt: number; result: RankedLiveResult } }
  | { type: "SET_ERROR"; payload: keyof FeedState["errors"] }
  | { type: "RETRY"; payload: keyof FeedState["errors"] };

const initialFeedState: FeedState = {
  recentVideos: [],
  twitchVods: [],
  twitchStreams: [],
  recentPaces: [],
  liveRuns: [],
  rankedMatches: [],
  liveEnded: initialLiveEndedState,
  splitBests: {},
  mcidToUuid: {},
  mcidToSlug: {},
  mcidToDisplayName: {},
  mcidToDisplayNameAlphabet: {},
  mcidToSkinUrl: {},
  loading: {
    videos: true,
    twitchVods: true,
    paces: true,
    liveRuns: true,
  },
  errors: {
    videos: false,
    twitchVods: false,
    paces: false,
    liveRuns: false,
  },
  liveRunsCheckedAt: null,
};

const MCID_MAP_KEYS = [
  "mcidToUuid",
  "mcidToSlug",
  "mcidToDisplayName",
  "mcidToDisplayNameAlphabet",
  "mcidToSkinUrl",
] as const;

// 応答の mcid マップを既存の state にマージする（ライブとペースで別 mcid が来るため蓄積する。
// 応答に無い（古いキャッシュ等）キーは触らない）
function mergeMcidMaps(state: FeedState, payload: Partial<McidMapsResponse>): Pick<FeedState, (typeof MCID_MAP_KEYS)[number]> {
  const merged = {} as Pick<FeedState, (typeof MCID_MAP_KEYS)[number]>;
  for (const key of MCID_MAP_KEYS) {
    merged[key] = payload[key] ? { ...state[key], ...payload[key] } : state[key];
  }
  return merged;
}

function feedReducer(state: FeedState, action: FeedAction): FeedState {
  switch (action.type) {
    case "SET_VIDEOS":
      return {
        ...state,
        recentVideos: action.payload,
        errors: { ...state.errors, videos: false },
        loading: { ...state.loading, videos: false },
      };
    case "SET_TWITCH_VODS":
      return {
        ...state,
        twitchVods: action.payload,
        errors: { ...state.errors, twitchVods: false },
        loading: { ...state.loading, twitchVods: false },
      };
    case "SET_PACES":
      return {
        ...state,
        recentPaces: action.payload.recentPaces,
        ...mergeMcidMaps(state, action.payload),
        errors: { ...state.errors, paces: false },
        loading: { ...state.loading, paces: false },
      };
    case "SET_LIVE_RUNS":
      return {
        ...state,
        liveRuns: action.payload.liveRuns,
        splitBests: action.payload.splitBests,
        // Ranked・Twitch の取得に失敗したときは直前の値を保つ（ライブ欄全体のエラーにはしない）
        rankedMatches: action.payload.rankedMatches ?? state.rankedMatches,
        twitchStreams: action.payload.twitchStreams ?? state.twitchStreams,
        ...mergeMcidMaps(state, action.payload),
        errors: { ...state.errors, liveRuns: false },
        loading: { ...state.loading, liveRuns: false },
        liveRunsCheckedAt: action.payload.now,
        // 成功した取得同士の差分で「終了」を決める（失敗した取得ではここへ来ない）
        liveEnded: advanceLiveEnded(state.liveEnded, {
          now: action.payload.now,
          runs: action.payload.liveRuns,
          matches: action.payload.rankedMatches
            ? { list: action.payload.rankedMatches, fetchedAt: action.payload.rankedFetchedAt }
            : null,
        }),
      };
    case "PRUNE_LIVE_ENDED":
      return { ...state, liveEnded: pruneLiveEnded(state.liveEnded, action.payload.now) };
    case "SET_RANKED_RESULT":
      return {
        ...state,
        liveEnded: applyRankedResult(state.liveEnded, action.payload.id, action.payload.endedAt, action.payload.result),
      };
    case "SET_ERROR":
      return {
        ...state,
        errors: { ...state.errors, [action.payload]: true },
        loading: { ...state.loading, [action.payload]: false },
      };
    case "RETRY":
      return {
        ...state,
        errors: { ...state.errors, [action.payload]: false },
        loading: { ...state.loading, [action.payload]: true },
      };
    default:
      return state;
  }
}

// 取得失敗（HTTPエラー含む）を例外にして .catch へ流す
async function fetchFeedJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

// ホームの YouTube 動画の表示本数（全件は /videos）
const HOME_YOUTUBE_COUNT = 3;

// 動画0件の1文（本物と、見込み「動画0件」の骨組みで共有。placeholder のときは invisible で同じ <p> を置く）
function NoVideosNote({ placeholder = false }: { placeholder?: boolean }) {
  const t = useT();
  return (
    // 面を重ねず muted の1文（導線は欄見出しの「すべて見る」が担う）
    <p className={cn("text-sm", placeholder ? "invisible" : "text-muted-foreground")}>
      {t("home.noVideos")}
      {t("home.noVideosSeparator")}
      {t("home.noVideosDescription")}
    </p>
  );
}

// 動画欄のローディングスケルトン（memo化）
// expectEmpty: サーバーの見込みが「動画0件」のときは、本物の0件の文と同じ <p> を invisible で置く（折り返しの行数が幅・ロケールで変わるため。外れたら本物に合わせて伸びる）
const VideosSkeleton = memo(function VideosSkeleton({ expectEmpty }: { expectEmpty: boolean }) {
  const t = useT();
  if (expectEmpty) {
    return (
      <div className="relative" aria-hidden="true">
        <NoVideosNote placeholder />
        <Skeleton className="absolute top-0 left-0 h-5 w-72 max-w-full" />
      </div>
    );
  }
  return (
    // 本物（YouTube の見出し行 ＋ HomeVideoCard の1段）と同じ形・同じ高さ。モバイルは横レールの見た目。
    // カード: 枠 1px ＋ aspect-video のサムネイル ＋ p-4 の本文（タイトル2行 leading-snug 14px×1.375 = 38.5px ＋ mt-3 / 枠 / pt-3 ＋ 走者行 min-h-11 / sm 以上 min-h-5）
    <div className="space-y-6" aria-hidden="true">
      <div className="space-y-3">
        <Skeleton className="h-5 w-24" />
        <div className="-mx-2 -mt-2 flex gap-4 overflow-hidden px-2 pt-2 pb-3 md:mx-0 md:mt-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0 md:pt-0 md:pb-0">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="w-[calc(100%-4rem)] shrink-0 md:w-auto">
              <div className="flex h-full flex-col overflow-hidden rounded-xl border border-border/70 bg-card">
                <Skeleton className="aspect-video rounded-none" />
                <div className="flex flex-1 flex-col p-4">
                  <Skeleton className="h-[38.5px]" />
                  <div className="mt-3 border-t border-border/60 pt-3">
                    <div className="min-h-11 sm:min-h-5" />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});

export default function HomePage() {
  const t = useT();
  const locale = useLocale();
  const {
    isRegistered,
    currentUser,
    recentlyUpdatedUsers,
    popularUsers,
    recommended,
    newGuides,
    totalPublicProfiles,
    spotlight,
    heroFaces,
    outlooks,
    layout: savedLayout,
  } = useLoaderData<typeof loader>();

  // 設定モーダルの保存中は、送信した並び・表示を楽観的に反映する（再検証で loader の値が追いつくまで）
  const orderFetcher = useFetcher({ key: HOME_SECTION_ORDER_FETCHER_KEY });
  const submittedOrder = orderFetcher.formData?.get("order");
  const submittedHidden = orderFetcher.formData?.get("hidden");
  const layout = useMemo<HomeLayout>(() => {
    const fields = parseHomeLayoutFields(submittedOrder, submittedHidden);
    return fields ? normalizeHomeLayout(fields) : savedLayout;
  }, [submittedOrder, submittedHidden, savedLayout]);

  const [feed, dispatch] = useReducer(feedReducer, initialFeedState);
  // 「0人・最近のペース0件」の見込み。読み込み中の骨組みを0人の形にする（外れたら本物に合わせて伸びる）。
  // 初回の取得が成功する前だけ使う（一度でも取れたあとの再取得・再試行では、実際のカードを骨組みに差し替えない）
  const expectLiveEmpty = outlooks.live === "empty" && feed.liveRunsCheckedAt === null;
  // 読み込み中の骨組みを0人の形にするか（見込みが empty で、初回の取得中）
  const liveSkeletonEmpty = expectLiveEmpty && feed.loading.liveRuns;

  // お気に入りの並べ替え・ハート表示はクライアント側で適用する
  // （/api/home-feed のレスポンスはユーザー非依存でCDNキャッシュされるため）
  const { favorites } = useFavorites();
  const favoriteSlugSet = useMemo(() => new Set(favorites), [favorites]);

  // ライブ欄の更新（初回・15秒間隔の自動更新で共用）。PaceMan のライブラン（必須）と、
  // Ranked 対戦中・Twitch 配信中の印（失敗しても欄全体のエラーにしない）を並行取得する
  const fetchLiveRuns = useCallback(() => {
    return Promise.all([
      fetchFeedJson<LiveRunsResponse>("/api/home-feed?type=live-runs"),
      fetchFeedJson<{ matches: RankedLiveMatch[]; fetchedAt?: number }>("/api/home-feed?type=ranked-live").catch(
        () => null,
      ),
      fetchFeedJson<TwitchStreamsResponse>("/api/home-feed?type=twitch-streams").catch(() => null),
    ])
      .then(([live, ranked, streams]) => {
        const now = Date.now();
        dispatch({
          type: "SET_LIVE_RUNS",
          payload: {
            ...live,
            liveRuns: live.liveRuns || [],
            splitBests: live.splitBests ?? {},
            rankedMatches: ranked ? ranked.matches || [] : null,
            // サーバーの取得時刻（無い旧応答は受信時刻で代用）
            rankedFetchedAt: ranked?.fetchedAt ?? now,
            now,
            twitchStreams: streams ? streams.liveStreams || [] : null,
          },
        });
      })
      .catch((err) => {
        console.error("Failed to fetch live runs:", err);
        dispatch({ type: "SET_ERROR", payload: "liveRuns" });
        // 取得に失敗し続けても、終了カードは保持時間で消す
        dispatch({ type: "PRUNE_LIVE_ENDED", payload: { now: Date.now() } });
      });
  }, []);

  // ライブの自動更新（15秒間隔）。タブが非表示の間は止め、表示に戻ったら即更新して再開する
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    const stop = () => {
      if (interval !== null) {
        clearInterval(interval);
        interval = null;
      }
    };
    const start = () => {
      stop();
      interval = setInterval(fetchLiveRuns, LIVE_POLL_INTERVAL_MS);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        fetchLiveRuns();
        start();
      } else {
        stop();
      }
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [fetchLiveRuns]);

  // 終了した Ranked 試合の結果取得。ライブの自動更新と同じタイミング（成功した取得のたび）に、結果が取れるまで問い合わせる。
  // 自動更新が止まっている（タブ非表示）間は liveRunsCheckedAt が変わらないので、これも止まる。
  // 結果を使うのはライブ欄の終了カードだけなので、ライブ欄が非表示の間は問い合わせない（表示に戻ったら次の取得から再開）
  const liveVisible = !layout.hidden.includes("live");
  const resultInFlight = useRef(new Set<string>());
  useEffect(() => {
    if (!liveVisible || feed.liveRunsCheckedAt === null) return;
    for (const item of feed.liveEnded.ended) {
      if (item.kind !== "ranked" || item.result) continue;
      const opponent = rankedOpponentUuid(item.match);
      if (!opponent) continue;
      const flightKey = `${item.id}@${item.endedAt}`;
      if (resultInFlight.current.has(flightKey)) continue;
      resultInFlight.current.add(flightKey);
      const params = new URLSearchParams({
        type: "ranked-result",
        uuid: item.match.uuid,
        opponent,
        since: String(Math.round(item.startedAtMs)),
      });
      fetchFeedJson<RankedResultResponse>(`/api/home-feed?${params}`)
        .then((res) => {
          if (res.status !== "done") return;
          const { status: _status, ...result } = res;
          dispatch({ type: "SET_RANKED_RESULT", payload: { id: item.id, endedAt: item.endedAt, result } });
        })
        .catch(() => {})
        .finally(() => resultInFlight.current.delete(flightKey));
    }
  }, [liveVisible, feed.liveRunsCheckedAt, feed.liveEnded.ended]);

  // 自分のペースを隠す設定のときの除外対象 mcid（小文字）。無ければ null
  const hiddenPaceMcid = currentUser ? getHiddenPaceMcid(currentUser) : null;

  // 表示設定（showPacemanOnHome / showYoutubeOnHome / showTwitchOnHome）をオフにした人は、サーバー側
  // （/api/home-feed 等）で全員のホームから除外される。ここでの「自分の分の除外」は、設定を変えた直後に
  // キャッシュ TTL を待たず自分の画面で即消すためのもの（Ranked 対戦は PaceMan 設定の対象外）。
  // 自分のペース・配信・動画を隠す設定（showPacemanOnHome）
  const filteredRecentPaces = useMemo(
    () => (currentUser ? filterOwnPaces(feed.recentPaces, currentUser) : feed.recentPaces),
    [feed.recentPaces, currentUser],
  );

  // 配信中の Twitch（自分の Twitch を隠す設定 showTwitchOnHome を適用）。ライブ欄・Twitch 一覧で共用
  const twitchStreams = useMemo(
    () =>
      currentUser?.showTwitchOnHome === false
        ? feed.twitchStreams.filter((s) => s.slug !== currentUser.slug)
        : feed.twitchStreams,
    [feed.twitchStreams, currentUser],
  );

  // ライブ欄の並び: PaceMan のライブラン・Ranked 対戦を混ぜて「区間が深い順 → 同じ深さなら到達タイムが速い順」（PaceMan 本家に倣う）、
  // 消えて保持中の終了カードは直前の位置、最後に Twitch 配信（Minecraft のみ）。お気に入りは先頭へ（安定ソートなので各グループ内の順は保つ）
  const liveEntries = useMemo<LiveRailEntry[]>(() => {
    const live: LiveRailEntry[] = [];
    for (const run of feed.liveRuns) {
      if (hiddenPaceMcid && run.nickname.toLowerCase() === hiddenPaceMcid) continue;
      live.push({
        kind: "pace",
        id: livePaceId(run),
        slug: feed.mcidToSlug[run.nickname.toLowerCase()],
        run,
      });
    }
    for (const match of feed.rankedMatches) {
      live.push({ kind: "ranked", id: liveRankedId(match), slug: match.slug, match });
    }
    live.sort(compareLiveEntries);
    const endedEntries: { item: LiveRailEntry; index: number }[] = [];
    for (const i of feed.liveEnded.ended) {
      if (i.kind === "pace") {
        // 終了カードにもライブカードと同じ除外（自分のペースを隠す設定）をかける
        if (hiddenPaceMcid && i.run.nickname.toLowerCase() === hiddenPaceMcid) continue;
        endedEntries.push({
          index: i.index,
          item: { kind: "pace", id: i.id, slug: feed.mcidToSlug[i.run.nickname.toLowerCase()], run: i.run, ended: true },
        });
      } else {
        endedEntries.push({
          index: i.index,
          item: { kind: "ranked", id: i.id, slug: i.match.slug, match: i.match, ended: true, result: i.result },
        });
      }
    }
    const entries = insertEndedAtPrevIndex(live, endedEntries);
    const twitchOnly = pickTwitchOnlyStreams(twitchStreams, {
      slugs: entries.map((e) => e.slug),
      logins: entries.map((e) =>
        e.kind === "pace" ? e.run.user.liveAccount : e.kind === "ranked" ? twitchLoginFromUrl(e.match.liveUrl) : null,
      ),
    });
    for (const item of twitchOnly) {
      entries.push({ kind: "twitch", id: `twitch:${item.stream.id}`, slug: item.slug || undefined, item });
    }
    const isFav = (e: LiveRailEntry) => (e.slug ? favoriteSlugSet.has(e.slug) : false);
    return favoriteSlugSet.size === 0
      ? entries
      : [...entries].sort((a, b) => Number(isFav(b)) - Number(isFav(a)));
  }, [feed.liveRuns, feed.rankedMatches, feed.liveEnded.ended, feed.mcidToSlug, twitchStreams, favoriteSlugSet, hiddenPaceMcid]);

  // 「配信中」の印: Minefolio に Twitch を登録していて、twitch-streams で配信中と確認できた人だけ
  // （YouTube の配信中は出さない）。自分の Twitch を隠す設定のときは自分を除く（twitchStreams は適用済み）
  const streamingSlugs = useMemo(() => new Set(twitchStreams.map((s) => s.slug).filter(Boolean)), [twitchStreams]);

  // 動画: 自分の動画/VODを隠すユーザー設定を適用（プラットフォームごとのフラグ。/videos と共通）。
  // 「1人1本」の絞り込みはサーバー（/api/home-feed の perRunner=1）で済んでいる
  const youtubeVideos = useMemo(
    () => (currentUser ? filterOwnVideos(feed.recentVideos, currentUser) : feed.recentVideos).slice(0, HOME_YOUTUBE_COUNT),
    [feed.recentVideos, currentUser],
  );
  const twitchVods = useMemo(
    () => (currentUser ? filterOwnVideos(feed.twitchVods, currentUser) : feed.twitchVods),
    [feed.twitchVods, currentUser],
  );

  const fetchYouTubeVideos = useCallback(
    () =>
      fetchFeedJson<YouTubeVideosResponse>("/api/home-feed?type=youtube-videos&perRunner=1")
        .then((data) => {
          dispatch({ type: "SET_VIDEOS", payload: data.recentVideos || [] });
        })
        .catch((err) => {
          console.error("Failed to fetch YouTube videos:", err);
          dispatch({ type: "SET_ERROR", payload: "videos" });
        }),
    [],
  );
  const fetchTwitchVods = useCallback(
    () =>
      fetchFeedJson<TwitchVodsResponse>("/api/home-feed?type=twitch-vods&perRunner=1")
        .then((data) => {
          dispatch({ type: "SET_TWITCH_VODS", payload: data.recentVods || [] });
        })
        .catch((err) => {
          console.error("Failed to fetch Twitch VODs:", err);
          dispatch({ type: "SET_ERROR", payload: "twitchVods" });
        }),
    [],
  );
  const fetchRecentPaces = useCallback(
    () =>
      fetchFeedJson<RecentPacesResponse>("/api/home-feed?type=recent-paces")
        .then((data) => {
          dispatch({
            type: "SET_PACES",
            payload: { ...data, recentPaces: data.recentPaces || [] },
          });
        })
        .catch((err) => {
          console.error("Failed to fetch recent paces:", err);
          dispatch({ type: "SET_ERROR", payload: "paces" });
        }),
    [],
  );

  const retryPaces = useCallback(() => {
    dispatch({ type: "RETRY", payload: "paces" });
    fetchRecentPaces();
  }, [fetchRecentPaces]);
  const retryLiveRuns = useCallback(() => {
    dispatch({ type: "RETRY", payload: "liveRuns" });
    fetchLiveRuns();
  }, [fetchLiveRuns]);
  // 動画は YouTube / Twitch のうち失敗した側だけ再取得する
  const retryVideos = useCallback(() => {
    if (feed.errors.videos) {
      dispatch({ type: "RETRY", payload: "videos" });
      fetchYouTubeVideos();
    }
    if (feed.errors.twitchVods) {
      dispatch({ type: "RETRY", payload: "twitchVods" });
      fetchTwitchVods();
    }
  }, [feed.errors.videos, feed.errors.twitchVods, fetchYouTubeVideos, fetchTwitchVods]);

  // 遅延読み込み。ライブ（live-runs 等）は live 欄が非表示でも常に取る（おかえりバーの走行中チップと動画欄の Twitch 一覧が使う）
  useEffect(() => {
    fetchLiveRuns();
  }, [fetchLiveRuns]);

  // 動画（YouTube / Twitch VOD）は videos 欄、過去のペースは live 欄が表示されているときだけ取る。
  // 非表示 → 表示に切り替えた時点で未取得なら取る（取得済みなら再表示でも取り直さない）
  const videosVisible = !layout.hidden.includes("videos");
  const videosFetched = useRef(false);
  const pacesFetched = useRef(false);
  useEffect(() => {
    if (!videosVisible || videosFetched.current) return;
    videosFetched.current = true;
    fetchYouTubeVideos();
    fetchTwitchVods();
  }, [videosVisible, fetchYouTubeVideos, fetchTwitchVods]);
  useEffect(() => {
    if (!liveVisible || pacesFetched.current) return;
    pacesFetched.current = true;
    fetchRecentPaces();
  }, [liveVisible, fetchRecentPaces]);

  // ガイド一覧行を GuideCardGrid 用の型へ変換
  const toGuideItem = useCallback(
    (g: (typeof newGuides)[number]): GuideItemWithAuthorSlug => ({
      ...g,
      likeCount: Number(g.likeCount),
      authorName:
        pickDisplayName(
          { displayName: g.authorDisplayName, displayNameAlphabet: g.authorDisplayNameAlphabet },
          locale,
        ) || g.authorMcid || g.authorSlug,
      authorAvatar: { uuid: g.authorUuid, skinUrl: g.authorCustomSkinUrl },
      _authorSlug: g.authorSlug,
    }),
    [locale],
  );
  const guideLinkFn = useCallback((guide: GuideItem) => {
    const item = guide as GuideItemWithAuthorSlug;
    return `/guides/${item._authorSlug}/${guide.slug}`;
  }, []);

  const welcomeName = currentUser ? getLocalizedDisplayName(currentUser, locale) : "";

  // 見出しの件数・区間の分布・おかえりバーには、終了カード（保持中）を含めない
  const activeLiveEntries = useMemo(() => liveEntries.filter((e) => !e.ended), [liveEntries]);
  const liveCount = activeLiveEntries.length;
  // ライブ欄にお気に入りの走者のカードがあるときだけ、ハートの意味を補足する（終了カードも含む）
  const hasFavoriteLive = liveEntries.some((e) => !!e.slug && favoriteSlugSet.has(e.slug));
  const liveSettled = !feed.loading.liveRuns && (!feed.errors.liveRuns || feed.liveRunsCheckedAt !== null);
  // おかえりバーの「N人が走行中」に添える区間: いちばん先の区間にいる走者のもの（区間の無い配信だけの項目は判定から外す）
  const leadingLiveSplit = useMemo(() => {
    let best: { stage: number; split: string } | null = null;
    for (const e of activeLiveEntries) {
      const s = liveEntrySplit(e);
      if (s && (!best || s.stage > best.stage)) best = s;
    }
    return best?.split ?? null;
  }, [activeLiveEntries]);
  const videosLoading = feed.loading.videos || feed.loading.twitchVods;
  const showTwitch = twitchStreams.length > 0 || twitchVods.length > 0;
  const noVideoData = youtubeVideos.length === 0 && !showTwitch;
  // 動画0件の見込みも、まだ動画を一度も取れていないあいだだけ使う
  const expectVideosEmpty = outlooks.videos === "empty" && noVideoData;

  const hasProfiles = recentlyUpdatedUsers.length > 0;
  const liveEmptySettled = liveSettled && !feed.loading.liveRuns && liveEntries.length === 0;
  // 注目の走者の候補が無い日（ログイン中は欄ごと出さない。カスタマイズの行には補足を出す）
  const featuredEmpty = !(spotlight?.candidates?.length || spotlight?.fallback);

  const sections: Record<HomeSectionId, ReactNode> = {
    favoriteActivity: (
      <FavoriteActivity isRegistered={isRegistered} recommended={recommended} />
    ),
    live: (
      <PageSection
        id="home-live"
        icon={<Radio className="h-5 w-5 text-primary" aria-hidden="true" />}
        title={t("home.liveTitle")}
        action={
          // ライブの有無にかかわらず最近のペース（/paces）へ行けるようにする（0件時のペース3件表示だけに頼らない）
          <SectionHeaderLink to="/paces" label={t("home.pacesLink")} prefetch="intent" />
        }
        badge={
          // 人数が変わったときだけ読み上げる（15秒ごとの再描画では文字列が変わらない）。時刻など他の変動文字は入れない
          <span aria-live="polite" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            {liveSettled && liveCount > 0 && (
              <>
                <span className="h-2 w-2 rounded-full bg-live" aria-hidden="true" />
                {/* 見た目は短く、読み上げは従来どおり「N人がライブ中」 */}
                <span aria-hidden="true">{t("home.liveCount", { count: liveCount })}</span>
                <span className="sr-only">{t("home.liveCountAria", { count: liveCount })}</span>
              </>
            )}
          </span>
        }
      >
        {hasFavoriteLive && (
          <FavoritesFirstNote>{t("home.liveFavoritesFirstNote")}</FavoritesFirstNote>
        )}
        {/* 0人の見込みで読み込み中のときは、0人の形（文＋右端の更新時刻）に合わせて独立した行を出さない */}
        {!liveEmptySettled && !liveSkeletonEmpty && (
          <LiveUpdatedAt checkedAt={feed.liveRunsCheckedAt} pending={feed.loading.liveRuns} />
        )}
        {/* 誰もいなくても出す（高さを確保）。取得に失敗して一度も成功していないときだけ出さない（空の帯が「誰もいない」と誤読されるため） */}
        {/* 0人のときは帯を弱め、0件の1文と導線の下（LiveRail 内）へ置く。人が居るとき・取得中は従来どおり先頭 */}
        {((feed.loading.liveRuns && !liveSkeletonEmpty) || liveSettled) && !liveEmptySettled && (
          <LiveSplitStrip entries={activeLiveEntries} loading={feed.loading.liveRuns} />
        )}
        <LiveRail
          emptyUpdatedAt={
            liveEmptySettled ? (
              <LiveUpdatedAt checkedAt={feed.liveRunsCheckedAt} pending={feed.loading.liveRuns} />
            ) : undefined
          }
          emptyStrip={
            liveEmptySettled ? <LiveSplitStrip entries={activeLiveEntries} muted /> : undefined
          }
          entries={liveEntries}
          maps={feed}
          splitBests={feed.splitBests}
          favoriteSlugs={favoriteSlugSet}
          streamingSlugs={streamingSlugs}
          loading={feed.loading.liveRuns}
          expectEmpty={liveSkeletonEmpty}
          expectRecentEmpty={outlooks.live === "empty" && filteredRecentPaces.length === 0}
          error={feed.errors.liveRuns}
          hasData={feed.liveRunsCheckedAt !== null}
          onRetry={retryLiveRuns}
          recentPaces={filteredRecentPaces}
          recentLoading={feed.loading.paces}
          recentError={feed.errors.paces}
          onRetryRecent={retryPaces}
        />
      </PageSection>
    ),
    videos: (
      <PageSection
        id="home-videos"
        icon={<Play className="h-5 w-5 text-primary" aria-hidden="true" />}
        title={t("home.sectionVideos")}
        viewAllTo="/videos"
      >
        {videosLoading ? (
          <VideosSkeleton expectEmpty={expectVideosEmpty} />
        ) : (feed.errors.videos || feed.errors.twitchVods) && noVideoData ? (
          <FeedErrorNotice message={t("home.videosFetchFailed")} onRetry={retryVideos} />
        ) : noVideoData ? (
          <NoVideosNote />
        ) : (
          <div className="space-y-6">
            {youtubeVideos.length > 0 && (
              <div className="space-y-3">
                <h3 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Youtube className="h-4 w-4 text-youtube" />
                  YouTube
                </h3>
                {/* モバイルは横レール（scroll-snap）、md 以上は3列グリッド */}
                {/* モバイルの横レールはホバーの浮き上がりと影が切れないよう上下左右に余白を取り、負のマージンで打ち消す */}
                <div className="-mx-2 -mt-2 flex snap-x snap-mandatory scroll-px-2 gap-4 overflow-x-auto px-2 pt-2 pb-3 md:mx-0 md:mt-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0 md:pt-0 md:pb-0">
                  {youtubeVideos.map((video) => (
                    <div key={feedVideoKey(video)} className="w-[calc(100%-4rem)] shrink-0 snap-start md:w-auto">
                      <HomeVideoCard video={video} />
                    </div>
                  ))}
                </div>
              </div>
            )}
            {showTwitch && (
              <div className="space-y-3">
                <h3 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Twitch className="h-4 w-4 text-twitch" />
                  {t("home.twitchRecentTitle")}
                </h3>
                <TwitchRecentList streams={twitchStreams} vods={twitchVods} />
              </div>
            )}
          </div>
        )}
      </PageSection>
    ),
    guides:
      newGuides.length > 0 ? (
        <PageSection
          id="home-guides"
          icon={<BookOpen className="h-5 w-5 text-primary" aria-hidden="true" />}
          title={t("home.sectionGuides")}
          viewAllTo="/guides"
        >
          <GuideCardGrid
            guides={newGuides.map(toGuideItem)}
            linkFn={guideLinkFn}
            gridCols="sm:grid-cols-2 xl:grid-cols-4"
            surface="card"
          />
        </PageSection>
      ) : null,
    // ログイン時の注目の走者（ゲストはヒーロー右に出すので、ここはログイン時のみ）
    featured: isRegistered && !featuredEmpty ? (
      <FeaturedRunnerCard
        candidates={spotlight?.candidates ?? []}
        initial={spotlight?.fallback ?? null}
      />
    ) : null,
    profiles: (
      <PageSection
        id="home-profiles"
        icon={<UserCheck className="h-5 w-5 text-primary" aria-hidden="true" />}
        title={t("home.sectionProfiles")}
        badge={
          totalPublicProfiles > 0 ? (
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {t("home.profileCount", { count: totalPublicProfiles.toLocaleString(locale) })}
            </span>
          ) : undefined
        }
        viewAllTo="/browse"
      >
        {hasProfiles ? (
          // 人気が0件のときは1列で全幅にする（2列のままだと右半分が空く）
          <div className={cn("grid grid-cols-1 gap-5", popularUsers.length > 0 && "md:grid-cols-2")}>
            <CompactProfileList title={t("home.sectionRecentlyUpdated")} players={recentlyUpdatedUsers} mode="recent" />
            {popularUsers.length > 0 && (
              <CompactProfileList title={t("home.sectionPopularShort")} players={popularUsers} mode="popular" />
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("home.noProfiles")}
          </p>
        )}
      </PageSection>
    ),
  };

  return (
    <div className="relative flex-1 space-y-7 sm:space-y-8">
      {isRegistered && currentUser ? (
        <>
          {/* ログイン時は宣伝の見出し・説明を出さない。h1 は視覚的に隠したページ見出し */}
          <h1 className="sr-only">{t("home.pageHeading")}</h1>
          <WelcomeBar
            name={welcomeName}
            slug={currentUser.slug}
            uuid={currentUser.uuid}
            skinUrl={currentUser.customSkinUrl}
            isNewAccount={currentUser.isNewAccount}
            layout={layout}
            liveCount={liveSettled ? liveCount : 0}
            liveSplit={leadingLiveSplit}
            emptySections={[
              ...(featuredEmpty ? (["featured"] as const) : []),
              ...(newGuides.length === 0 ? (["guides"] as const) : []),
            ]}
          />
        </>
      ) : (
        <GuestHero
          candidates={spotlight?.candidates ?? []}
          initial={spotlight?.fallback ?? null}
          faces={heroFaces}
          // CTA の注記の下に人数だけ先に出してライブ欄へ送る（モバイルはヒーローが縦積みでライブ欄が遠いため、デスクトップは左列の下の空きを埋めるため。全幅で表示）
          liveTeaser={
            <LiveTeaser
              count={liveSettled ? liveCount : 0}
              href={layout.hidden.includes("live") ? "/paces" : "#home-live"}
            />
          }
        />
      )}

      {/* ウェルカムバー / ヒーローの下を、ユーザーの並び順（ゲストは既定順）で描画する */}
      {layout.order
        .filter((id) => !layout.hidden.includes(id))
        .map((id) => (
          <Fragment key={id}>{sections[id]}</Fragment>
        ))}
    </div>
  );
}
