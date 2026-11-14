import { createTranslator } from "@/lib/messages";
import { useLoaderData, useFetcher, Link, data } from "react-router";
import { useEffect, useReducer, memo, useMemo, useCallback, Fragment, type ReactNode } from "react";
import {
  defaultHomeLayout,
  normalizeHomeLayout,
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
import { getOptionalSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users, guides, pageViewStats, playstyles, categoryRecords } from "@/lib/schema";
import { pickHighlightPb, type HighlightPbRecord } from "@/lib/profile-highlights";
import { listedRunnerCondition } from "@/lib/users-filter";
import { eq, desc, and, inArray, isNotNull, sql } from "drizzle-orm";
import { getHomeSpotlight } from "@/lib/home-featured.server";
import { guideLikeCountSql } from "@/lib/likes.server";
import type { CachedPace } from "@/lib/paceman-cache";
import type { PaceManLiveRun } from "@/lib/paceman";
import type { McidUserMaps } from "@/lib/home-user-data.server";
import { getHiddenPaceMcid, filterOwnPaces } from "@/lib/pace-visibility";
import { groupByUserId } from "@/lib/group-by-user";
import { pickTwitchOnlyStreams, twitchLoginFromUrl, type HomeTwitchStream, type RankedLiveMatch } from "@/lib/home-live";
import { Button } from "@/components/ui/button";
import { GuideCardGrid, type GuideItem, type GuideItemWithAuthorSlug } from "@/components/guide-list-views";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { HomeSection } from "@/components/home/home-section";
import { WelcomeBar } from "@/components/home/welcome-bar";
import { FeaturedRunnerCard } from "@/components/home/featured-runner-card";
import { LiveRail, type LiveRailEntry } from "@/components/home/live-rail";
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
import { Youtube, Twitch } from "@/components/brand-icons";
import { ArrowRight, Search, UserCheck, BookOpen, Play, Radio } from "lucide-react";

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

// おかえりバーで「ようこそ」と出す、アカウント作成からの期間
const NEW_ACCOUNT_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function loader({ request }: Route.LoaderArgs) {
  const env = getEnv();
  const db = createDb();
  const auth = createAuth(db, env);

  // プロフィール一覧の select 列（更新順・PV順で共通）
  const profileFeedColumns = {
    id: users.id,
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
  };

  const [account, recentlyUpdatedUsers, popularUsersRaw, newGuidesRaw, [profileCounts], spotlight] = await Promise.all([
    // セッション確認（→登録ユーザー判定）。他の取得と並列に走らせる
    (async () => {
      const session = await getOptionalSession(request, auth);
      if (!session) return null;
      const existingUser = await db.query.users.findFirst({
        where: eq(users.discordId, session.user.id),
        columns: {
          mcid: true,
          uuid: true,
          slug: true,
          displayName: true,
          displayNameAlphabet: true,
          customSkinUrl: true,
          showPacemanOnHome: true,
          showYoutubeOnHome: true,
          showTwitchOnHome: true,
          homeSectionOrder: true,
          createdAt: true,
        },
      });
      if (!existingUser) return null;
      const { homeSectionOrder, createdAt, ...profile } = existingUser;
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
    })(),
    // 最近更新されたプロフィール（公開設定のみ、視聴者ロール除外）
    db
      .select(profileFeedColumns)
      .from(users)
      .where(listedRunnerCondition)
      .orderBy(desc(users.updatedAt))
      .limit(HOME_PROFILE_COUNT),
    // よく見られているプロフィール（直近7日PV順）。「最近の更新」との重複を除くため多めに取る。
    // page_view_stats のスナップショット行を直接引くため、集計未稼働の環境では自然に0件になる
    db
      .select({ ...profileFeedColumns, pageViews7d: pageViewStats.pageviews })
      .from(pageViewStats)
      .innerJoin(users, eq(pageViewStats.targetId, users.id))
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
      .limit(HOME_GUIDE_COUNT * 6),
    db.select({ total: sql<number>`count(*)` }).from(users).where(listedRunnerCondition),
    // 注目の走者（ゲストはヒーロー右、ログイン時は「プロフィール」欄の上。10分キャッシュ）。失敗してもホーム全体は落とさない
    getHomeSpotlight(db).catch((error) => {
      console.error("Failed to build home spotlight:", error);
      return null;
    }),
  ]);
  const currentUser = account?.user ?? null;
  const isRegistered = currentUser != null;
  const totalPublicProfiles = profileCounts?.total ?? 0;

  // 「最近の更新」と「よく見られている」の重複は除く
  const recentSlugs = new Set(recentlyUpdatedUsers.map((u) => u.slug));
  const popularUsers = popularUsersRaw.filter((u) => !recentSlugs.has(u.slug)).slice(0, HOME_PROFILE_COUNT);

  // 同じ著者は1件まで
  const seenAuthors = new Set<string>();
  const newGuides = newGuidesRaw
    .filter((g) => {
      if (seenAuthors.has(g.authorSlug)) return false;
      seenAuthors.add(g.authorSlug);
      return true;
    })
    .slice(0, HOME_GUIDE_COUNT);

  // 自動翻訳（docs/translation.md）。ガイド id をまとめて 1 回で引き、title / summary を差し替える。
  // 機能無効・opt-out・失効・原文と同じロケールでは空の Map（原文のまま）
  // 表示する人（最近の更新・よく見られている）の分だけ引く
  const feedUserIds = [...new Set([...recentlyUpdatedUsers, ...popularUsers].map((u) => u.id))];
  const [guideTranslations, feedPlaystyles, feedRecords] = await Promise.all([
    getGuideTranslations(db, newGuides.map((g) => g.id), resolveLocale(request)),
    // カードのタグ用（メインカテゴリ + その PB）。全員分を各1クエリで取得し N+1 にしない
    feedUserIds.length === 0
      ? []
      : db
          .select({ userId: playstyles.userId, mainCategory: playstyles.mainCategory })
          .from(playstyles)
          .where(inArray(playstyles.userId, feedUserIds)),
    feedUserIds.length === 0
      ? []
      : db
          .select({
            userId: categoryRecords.userId,
            category: categoryRecords.category,
            categoryDisplayName: categoryRecords.categoryDisplayName,
            personalBest: categoryRecords.personalBest,
          })
          .from(categoryRecords)
          .where(
            and(
              inArray(categoryRecords.userId, feedUserIds),
              eq(categoryRecords.isVisible, true),
              isNotNull(categoryRecords.personalBest),
            ),
          ),
  ]);
  const mainCategoryById = new Map(feedPlaystyles.map((p) => [p.userId, p.mainCategory]));
  const recordsById = groupByUserId<HighlightPbRecord & { userId: string }>(feedRecords);
  // id はクライアントに不要なので外し、カード用に mainCategory / mainCategoryPb を付ける
  const withHighlights = <T extends { id: string }>(list: T[]) =>
    list.map(({ id, ...rest }) => {
      const mainCategory = mainCategoryById.get(id) ?? null;
      const pb = pickHighlightPb(mainCategory, recordsById.get(id) ?? []);
      return { ...rest, mainCategory, mainCategoryPb: pb?.record.personalBest ?? null };
    });

  const popular = withHighlights(popularUsers);
  const recent = withHighlights(recentlyUpdatedUsers);
  // お気に入り 0 人のときに勧める走者（よく見られている → 無ければ最近の更新）。表示する人の中から3人
  const recommended = (popular.length > 0 ? popular : recent).slice(0, 3);

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
  const rawOrder = formData.get("order");
  const rawHidden = formData.get("hidden") ?? "[]";
  if (typeof rawOrder !== "string" || typeof rawHidden !== "string") {
    return data({ error: t("home.settingsInvalid"), action: actionType }, { status: 400 });
  }
  let parsedOrder: unknown;
  let parsedHidden: unknown;
  try {
    parsedOrder = JSON.parse(rawOrder);
    parsedHidden = JSON.parse(rawHidden);
  } catch {
    return data({ error: t("home.settingsInvalid"), action: actionType }, { status: 400 });
  }
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
        twitchStreams: HomeTwitchStream[] | null;
      };
    }
  | { type: "SET_ERROR"; payload: keyof FeedState["errors"] }
  | { type: "RETRY"; payload: keyof FeedState["errors"] };

const initialFeedState: FeedState = {
  recentVideos: [],
  twitchVods: [],
  twitchStreams: [],
  recentPaces: [],
  liveRuns: [],
  rankedMatches: [],
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
        liveRunsCheckedAt: Date.now(),
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

// 動画欄のローディングスケルトン（memo化）
const VideosSkeleton = memo(function VideosSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-56 rounded-xl" />
        ))}
      </div>
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-14 rounded-xl" />
        ))}
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
    layout: savedLayout,
  } = useLoaderData<typeof loader>();

  // 設定モーダルの保存中は、送信した並び・表示を楽観的に反映する（再検証で loader の値が追いつくまで）
  const orderFetcher = useFetcher({ key: HOME_SECTION_ORDER_FETCHER_KEY });
  const submittedOrder = orderFetcher.formData?.get("order");
  const submittedHidden = orderFetcher.formData?.get("hidden");
  const layout = useMemo<HomeLayout>(() => {
    if (typeof submittedOrder !== "string") return savedLayout;
    try {
      return normalizeHomeLayout({
        order: JSON.parse(submittedOrder),
        hidden: typeof submittedHidden === "string" ? JSON.parse(submittedHidden) : [],
      });
    } catch {
      return savedLayout;
    }
  }, [submittedOrder, submittedHidden, savedLayout]);

  const [feed, dispatch] = useReducer(feedReducer, initialFeedState);

  // お気に入りの並べ替え・ハート表示はクライアント側で適用する
  // （/api/home-feed のレスポンスはユーザー非依存でCDNキャッシュされるため）
  const { favorites } = useFavorites();
  const favoriteSlugSet = useMemo(() => new Set(favorites), [favorites]);

  // ライブ欄の更新（初回・15秒間隔の自動更新で共用）。PaceMan のライブラン（必須）と、
  // Ranked 対戦中・Twitch 配信中の印（失敗しても欄全体のエラーにしない）を並行取得する
  const fetchLiveRuns = useCallback(() => {
    return Promise.all([
      fetchFeedJson<LiveRunsResponse>("/api/home-feed?type=live-runs"),
      fetchFeedJson<{ matches: RankedLiveMatch[] }>("/api/home-feed?type=ranked-live").catch(() => null),
      fetchFeedJson<TwitchStreamsResponse>("/api/home-feed?type=twitch-streams").catch(() => null),
    ])
      .then(([live, ranked, streams]) => {
        dispatch({
          type: "SET_LIVE_RUNS",
          payload: {
            ...live,
            liveRuns: live.liveRuns || [],
            splitBests: live.splitBests ?? {},
            rankedMatches: ranked ? ranked.matches || [] : null,
            twitchStreams: streams ? streams.liveStreams || [] : null,
          },
        });
      })
      .catch((err) => {
        console.error("Failed to fetch live runs:", err);
        dispatch({ type: "SET_ERROR", payload: "liveRuns" });
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
      interval = setInterval(fetchLiveRuns, 15000);
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

  // ライブ欄の並び: PaceMan のライブラン → Ranked 対戦 → Twitch 配信（Minecraft のみ）。
  // お気に入りは先頭へ（安定ソートなので各グループ内の順は保つ）
  const liveEntries = useMemo<LiveRailEntry[]>(() => {
    const entries: LiveRailEntry[] = [];
    for (const run of feed.liveRuns) {
      if (hiddenPaceMcid && run.nickname.toLowerCase() === hiddenPaceMcid) continue;
      entries.push({
        kind: "pace",
        id: `pace:${run.worldId}`,
        slug: feed.mcidToSlug[run.nickname.toLowerCase()],
        run,
      });
    }
    for (const match of feed.rankedMatches) {
      entries.push({ kind: "ranked", id: `ranked:${match.key}`, slug: match.slug, match });
    }
    // Twitch は PaceMan・Ranked に出ていない人だけ（slug / Twitch ログイン名で照合）
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
  }, [feed.liveRuns, feed.rankedMatches, feed.mcidToSlug, twitchStreams, favoriteSlugSet, hiddenPaceMcid]);

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

  // 遅延読み込み（Promise.allで並列化）
  useEffect(() => {
    Promise.all([fetchYouTubeVideos(), fetchTwitchVods(), fetchRecentPaces(), fetchLiveRuns()]);
  }, [fetchYouTubeVideos, fetchTwitchVods, fetchRecentPaces, fetchLiveRuns]);

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
      _authorSlug: g.authorSlug,
    }),
    [locale],
  );
  const guideLinkFn = useCallback((guide: GuideItem) => {
    const item = guide as GuideItemWithAuthorSlug;
    return `/guides/${item._authorSlug}/${guide.slug}`;
  }, []);

  const welcomeName = currentUser ? getLocalizedDisplayName(currentUser, locale) : "";

  const liveCount = liveEntries.length;
  const liveSettled = !feed.loading.liveRuns && (!feed.errors.liveRuns || feed.liveRunsCheckedAt !== null);
  const videosLoading = feed.loading.videos || feed.loading.twitchVods;
  const showTwitch = twitchStreams.length > 0 || twitchVods.length > 0;
  const noVideoData = youtubeVideos.length === 0 && !showTwitch;

  const hasProfiles = recentlyUpdatedUsers.length > 0;

  const sections: Record<HomeSectionId, ReactNode> = {
    favoriteActivity: (
      <FavoriteActivity isRegistered={isRegistered} recommended={recommended} />
    ),
    live: (
      <HomeSection
        id="home-live"
        icon={<Radio className="h-5 w-5 text-primary" />}
        title={t("home.liveTitle")}
        action={
          // ライブの有無にかかわらず最近のペース（/paces）へ行けるようにする（0件時のペース3件表示だけに頼らない）
          <Button variant="ghost" size="sm" asChild className="min-h-11 sm:min-h-0">
            <Link to="/paces" prefetch="intent">
              {t("home.recentPacesTitle")}
              <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Link>
          </Button>
        }
        badge={
          // 人数が変わったときだけ読み上げる（15秒ごとの再描画では文字列が変わらない）。時刻など他の変動文字は入れない
          <span aria-live="polite" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            {liveSettled && liveCount > 0 && (
              <>
                <span className="h-2 w-2 rounded-full bg-destructive" aria-hidden="true" />
                {/* 見た目は短く、読み上げは従来どおり「N人がライブ中」 */}
                <span aria-hidden="true">{t("home.liveCount", { count: liveCount })}</span>
                <span className="sr-only">{t("home.liveCountAria", { count: liveCount })}</span>
              </>
            )}
          </span>
        }
      >
        <LiveRail
          entries={liveEntries}
          maps={feed}
          splitBests={feed.splitBests}
          favoriteSlugs={favoriteSlugSet}
          streamingSlugs={streamingSlugs}
          loading={feed.loading.liveRuns}
          error={feed.errors.liveRuns}
          hasData={feed.liveRunsCheckedAt !== null}
          onRetry={retryLiveRuns}
          recentPaces={filteredRecentPaces}
          recentLoading={feed.loading.paces}
          recentError={feed.errors.paces}
          onRetryRecent={retryPaces}
        />
      </HomeSection>
    ),
    videos: (
      <HomeSection
        id="home-videos"
        icon={<Play className="h-5 w-5 text-primary" />}
        title={t("home.sectionVideos")}
        viewAllTo="/videos"
      >
        {videosLoading ? (
          <VideosSkeleton />
        ) : (feed.errors.videos || feed.errors.twitchVods) && noVideoData ? (
          <FeedErrorNotice message={t("home.videosFetchFailed")} onRetry={retryVideos} />
        ) : noVideoData ? (
          <EmptyState
            icon={<Play className="h-12 w-12" />}
            title={t("home.noVideos")}
            description={t("home.noVideosDescription")}
          />
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
                    <div key={feedVideoKey(video)} className="w-[83%] shrink-0 snap-start md:w-auto">
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
      </HomeSection>
    ),
    guides:
      newGuides.length > 0 ? (
        <HomeSection
          id="home-guides"
          icon={<BookOpen className="h-5 w-5 text-primary" />}
          title={t("home.sectionGuides")}
          badge={<span className="text-sm text-muted-foreground">{t("home.guidesOnePerAuthor")}</span>}
          viewAllTo="/guides"
        >
          <GuideCardGrid
            guides={newGuides.map(toGuideItem)}
            linkFn={guideLinkFn}
            gridCols="sm:grid-cols-2 xl:grid-cols-4"
          />
        </HomeSection>
      ) : null,
    // ログイン時の注目の走者（ゲストはヒーロー右に出すので、ここはログイン時のみ）
    featured: isRegistered ? (
      <FeaturedRunnerCard
        candidates={spotlight?.candidates ?? []}
        initial={spotlight?.fallback ?? null}
        wide
      />
    ) : null,
    profiles: (
      <HomeSection
        id="home-profiles"
        icon={<UserCheck className="h-5 w-5 text-primary" />}
        title={t("home.sectionProfiles")}
        badge={
          totalPublicProfiles > 0 ? (
            <span className="text-sm text-muted-foreground">
              {t("home.profileCount", { count: totalPublicProfiles.toLocaleString(locale) })}
            </span>
          ) : undefined
        }
        viewAllTo="/browse"
      >
        {hasProfiles ? (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <CompactProfileList title={t("home.sectionRecentlyUpdated")} players={recentlyUpdatedUsers} mode="recent" />
            {popularUsers.length > 0 && (
              <CompactProfileList title={t("home.sectionPopularShort")} players={popularUsers} mode="popular" />
            )}
          </div>
        ) : (
          <EmptyState
            icon={<UserCheck className="h-12 w-12" />}
            title={t("home.noProfiles")}
            description={t("home.noProfilesDescription")}
          />
        )}
      </HomeSection>
    ),
  };

  return (
    <div className="relative flex-1 space-y-7 sm:space-y-8">
      {isRegistered && currentUser ? (
        <>
          {/* ログイン時は宣伝の見出し・説明を出さない。h1 は視覚的に隠したページ見出し */}
          <h1 className="sr-only">{t("home.title")}</h1>
          <WelcomeBar
            name={welcomeName}
            slug={currentUser.slug}
            uuid={currentUser.uuid}
            skinUrl={currentUser.customSkinUrl}
            isNewAccount={currentUser.isNewAccount}
            layout={layout}
          />
        </>
      ) : (
        <section
          aria-labelledby="home-hero-heading"
          className="rounded-2xl border border-border/70 bg-card/80 p-6 shadow-sm sm:p-8"
        >
          <div className="grid gap-7 lg:grid-cols-[1.05fr_1fr] lg:items-center">
            <div className="space-y-5">
              <div className="space-y-3">
                {/* 文言中の改行（ja: 「…から」の後）で区切る。改行の無い英語は text-balance で行長を揃える */}
                <h1 id="home-hero-heading" className="whitespace-pre-line text-balance text-2xl font-bold tracking-tight sm:text-3xl lg:text-4xl">
                  {t("home.heroTitle")}
                </h1>
                <p className="max-w-xl text-base text-muted-foreground sm:text-lg">{t("home.heroDescription")}</p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <Button asChild size="lg" className="w-full sm:w-auto">
                  <Link to="/login">
                    {t("home.ctaStart")}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline" className="w-full sm:w-auto">
                  <Link to="/browse">
                    <Search className="mr-2 h-4 w-4" />
                    {t("home.ctaBrowse")}
                  </Link>
                </Button>
              </div>
              <p className="-mt-2 text-xs text-muted-foreground">{t("home.ctaLoginNote")}</p>
            </div>
            <FeaturedRunnerCard
              candidates={spotlight?.candidates ?? []}
              initial={spotlight?.fallback ?? null}
            />
          </div>
        </section>
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
