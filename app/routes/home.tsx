import { createTranslator } from "@/lib/messages";
import { useLoaderData, Link, useNavigate } from "react-router";
import { useEffect, useReducer, memo, useMemo, useCallback, useState } from "react";
import type { Route } from "./+types/home";
import { createDb } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { getOptionalSession } from "@/lib/session";
import { getEnv } from "@/lib/env.server";
import { users, guides, pageViewStats, playstyles, categoryRecords } from "@/lib/schema";
import { pickHighlightPb, type HighlightPbRecord } from "@/lib/profile-highlights";
import { excludeViewersCondition } from "@/lib/users-filter";
import { PAGE_VIEW_WINDOW_DAYS } from "@/lib/page-view-paths";
import { eq, desc, and, inArray, isNotNull, sql } from "drizzle-orm";
import { countHomeRecordedPaces, getHomeSamplePace } from "@/lib/home-pace-sample.server";
import { guideLikeCountSql } from "@/lib/likes.server";
import type { CachedPace } from "@/lib/paceman-cache";
import type { PaceManLiveRun } from "@/lib/paceman";
import { LivePaceList } from "@/components/live-pace-list";
import { cn } from "@/lib/utils";
import { ProfileFeedCard } from "@/components/profile-feed-card";
import { Button } from "@/components/ui/button";
import { GuideCardGrid, type GuideItem, type GuideItemWithAuthorSlug } from "@/components/guide-list-views";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { PaceFeedCard } from "@/components/pace-feed-card";
import { FeedVideoCard } from "@/components/feed-video-card";
import { feedVideoKey, filterOwnVideos, type FeedVideo } from "@/lib/feed-video";
import { useFavorites } from "@/hooks/use-favorites";
import { useT, useLocale } from "@/hooks/use-locale";
import { localeFromMatches, resolveLocale } from "@/lib/locale";
import { getGuideTranslations } from "@/lib/content-translation.server";
import { applyGuideTranslation } from "@/lib/guide-translation-list";
import { pickDisplayName } from "@/lib/slug";
import { pickMcidDisplayName } from "@/lib/mcid-display-name";
import {
  ArrowRight,
  Play,
  Compass,
  UserCheck,
  History,
  Sparkles,
  Users,
  BookOpen,
  Shuffle,
  Timer,
  RefreshCw,
  AlertCircle,
  User,
  Pencil,
  Heart,
} from "lucide-react";

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

export async function loader({ request }: Route.LoaderArgs) {
  const env = getEnv();
  const db = createDb();
  const auth = createAuth(db, env);

  // プロフィール一覧の select 列（更新順・PV順で共通。ProfileFeedCard が使わない
  // inputMethod は含めない）
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

  // ガイド一覧の select 列（更新順・PV順で共通）
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

  // セッション確認（→登録ユーザー判定）とコンテンツ5クエリは互いに独立なので並行して走らせる。
  // mcid→ユーザー情報のマップはローダーでは返さない（全公開ユーザー分を SSR に載せない）。
  // ライブ・過去ペースの各 API 応答（/api/home-feed）が表示する mcid の分だけ運ぶ
  const [
    currentUser,
    [recentlyUpdatedUsers, popularUsers, recentlyUpdatedGuides, popularGuides, [profileCounts]],
    samplePace,
    recordedPaceTotal,
  ] = await Promise.all([
      // セッションをチェックしてユーザーが登録済みか確認
      (async () => {
        const session = await getOptionalSession(request, auth);
        if (!session) return null;
        const existingUser = await db.query.users.findFirst({
          where: eq(users.discordId, session.user.id),
          columns: {
            id: true,
            mcid: true,
            slug: true,
            displayName: true,
            displayNameAlphabet: true,
            showPacemanOnHome: true,
            showYoutubeOnHome: true,
            showTwitchOnHome: true,
          },
        });
        if (!existingUser) return null;
        return {
          mcid: existingUser.mcid,
          slug: existingUser.slug,
          displayName: existingUser.displayName,
          displayNameAlphabet: existingUser.displayNameAlphabet,
          showPacemanOnHome: existingUser.showPacemanOnHome ?? true,
          showYoutubeOnHome: existingUser.showYoutubeOnHome ?? true,
          showTwitchOnHome: existingUser.showTwitchOnHome ?? true,
        };
      })(),
      Promise.all([
        // 最近更新されたプロフィール（公開設定のみ、視聴者ロール除外、最新4件）
        db
          .select(profileFeedColumns)
          .from(users)
          .where(and(eq(users.profileVisibility, "public"), excludeViewersCondition))
          .orderBy(desc(users.updatedAt))
          .limit(4),
        // よく見られているプロフィール（直近7日PV順、最新4件）。page_view_stats のスナップショット行を
        // 直接引くため、集計未稼働（cron未稼働）の環境では自然に0件になる（UI側はその場合PV欄を出さない）。
        // pageViews7d はカードの根拠数値表示用（ProfileFeedCard に渡す）
        db
          .select({ ...profileFeedColumns, pageViews7d: pageViewStats.pageviews })
          .from(pageViewStats)
          .innerJoin(users, eq(pageViewStats.targetId, users.id))
          .where(
            and(
              eq(pageViewStats.targetType, "profile"),
              eq(users.profileVisibility, "public"),
              excludeViewersCondition,
            ),
          )
          .orderBy(desc(pageViewStats.pageviews))
          .limit(4),
        // 最近更新されたガイド（公開済み、更新日時順、最新4件）
        db
          .select(guideListColumns)
          .from(guides)
          .innerJoin(users, eq(guides.authorId, users.id))
          // 非公開・限定公開の著者のガイドはホームの一覧（discovery）に出さない
          .where(and(eq(guides.isPublished, true), eq(users.profileVisibility, "public")))
          .orderBy(desc(guides.updatedAt))
          .limit(4),
        // よく読まれているガイド（直近7日PV順、最新4件）。プロフィールと同様に page_view_stats
        // のスナップショット行を起点に join するため、集計が無い環境では自然に0件になる。
        // pageViews7d はカードの表示に使う（このセクションのみ累計View数を7日間PVに置き換える）
        db
          .select({ ...guideListColumns, pageViews7d: pageViewStats.pageviews })
          .from(pageViewStats)
          .innerJoin(guides, eq(pageViewStats.targetId, guides.id))
          .innerJoin(users, eq(guides.authorId, users.id))
          .where(
            and(
              eq(pageViewStats.targetType, "guide"),
              eq(guides.isPublished, true),
              eq(users.profileVisibility, "public"),
            ),
          )
          .orderBy(desc(pageViewStats.pageviews))
          .limit(4),
        db
          .select({ total: sql<number>`count(*)` })
          .from(users)
          .where(and(eq(users.profileVisibility, "public"), excludeViewersCondition)),
      ]),
      // ヒーローの実データ見本（最深区間のペース1件）と記録ペース総数。失敗してもホーム全体は落とさない
      getHomeSamplePace(db).catch(() => null),
      countHomeRecordedPaces(db).catch(() => null),
    ]);
  const isRegistered = currentUser != null;
  const totalPublicProfiles = profileCounts?.total ?? 0;

  // 自動翻訳（docs/translation.md）。更新順・PV順の両セクションのガイド id をまとめて 1 回で引き、
  // title / summary を差し替える。ホームのローダーにはガイド一覧のキャッシュ（ローダー内・Cache-Control）が無いため、
  // 閲覧ロケールごとの結果はここで毎回決まる。
  // 機能無効・opt-out・失効・原文と同じロケールでは空の Map（原文のまま）
  const feedUserIds = [...new Set([...recentlyUpdatedUsers, ...popularUsers].map((u) => u.id))];
  const [guideTranslations, feedPlaystyles, feedRecords] = await Promise.all([
    getGuideTranslations(
      db,
      [...recentlyUpdatedGuides, ...popularGuides].map((g) => g.id),
      resolveLocale(request),
    ),
    // カードのタグ用（メインカテゴリ + その PB）。2つの一覧の全員分を各1クエリで取得し N+1 にしない
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
  const recordsById = new Map<string, (HighlightPbRecord & { userId: string })[]>();
  for (const r of feedRecords) {
    const list = recordsById.get(r.userId);
    if (list) list.push(r);
    else recordsById.set(r.userId, [r]);
  }
  // id はクライアントに不要なので外し、カード用に mainCategory / mainCategoryPb を付ける
  const withHighlights = <T extends { id: string }>(list: T[]) =>
    list.map(({ id, ...rest }) => {
      const mainCategory = mainCategoryById.get(id) ?? null;
      const pb = pickHighlightPb(mainCategory, recordsById.get(id) ?? []);
      return { ...rest, mainCategory, mainCategoryPb: pb?.record.personalBest ?? null };
    });

  return {
    appUrl: env.APP_URL || "https://minefolio.app",
    isRegistered,
    currentUser,
    recentlyUpdatedUsers: withHighlights(recentlyUpdatedUsers),
    popularUsers: withHighlights(popularUsers),
    recentlyUpdatedGuides: recentlyUpdatedGuides.map((g) => applyGuideTranslation(g, guideTranslations)),
    popularGuides: popularGuides.map((g) => applyGuideTranslation(g, guideTranslations)),
    totalPublicProfiles,
    samplePace,
    recordedPaceTotal,
  };
}

// APIレスポンスの型定義（動画系はどちらも FeedVideo 形式で返る）
interface YouTubeVideosResponse {
  recentVideos: FeedVideo[];
}

interface TwitchVodsResponse {
  recentVods: FeedVideo[];
}

// ライブ・過去ペースの応答に含まれる mcid（小文字）→ユーザー情報マップ。応答のアイテムに出てくる mcid の分のみ
interface McidMapsResponse {
  mcidToUuid: Record<string, string>;
  mcidToSlug: Record<string, string>;
  mcidToDisplayName: Record<string, string>;
  mcidToDisplayNameAlphabet: Record<string, string>;
  mcidToSkinUrl: Record<string, string>;
}

interface RecentPacesResponse extends McidMapsResponse {
  recentPaces: CachedPace[];
}

interface LiveRunsResponse extends McidMapsResponse {
  liveRuns: PaceManLiveRun[];
}

// Feed状態管理用のReducer
interface FeedState {
  recentVideos: FeedVideo[];
  twitchVods: FeedVideo[];
  recentPaces: CachedPace[];
  liveRuns: PaceManLiveRun[];
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
  | { type: "SET_LIVE_RUNS"; payload: Partial<McidMapsResponse> & { liveRuns: PaceManLiveRun[] } }
  | { type: "SET_ERROR"; payload: keyof FeedState["errors"] }
  | { type: "RETRY"; payload: keyof FeedState["errors"] };

const initialFeedState: FeedState = {
  recentVideos: [],
  twitchVods: [],
  recentPaces: [],
  liveRuns: [],
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

// 取得失敗時の文言 + 再試行ボタン（ペース・動画セクション共通）
function FeedErrorNotice({ message, onRetry }: { message: string; onRetry: () => void }) {
  const t = useT();
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
    >
      <AlertCircle className="h-4 w-4 shrink-0" />
      <span className="min-w-0">{message}</span>
      <Button variant="outline" size="sm" className="ml-auto shrink-0" onClick={onRetry}>
        <RefreshCw className="mr-1 h-3.5 w-3.5" />
        {t("home.feedRetry")}
      </Button>
    </div>
  );
}

// ホームの動画フィードに表示する新着件数（全件は /videos 照会ページ）
const HOME_VIDEO_DISPLAY_COUNT = 6;

// セクション全体のローディングスケルトン（memo化）
const SectionSkeleton = memo(function SectionSkeleton({ columns = 4 }: { columns?: number }) {
  // 実セクションと同じグリッド段階に揃える（4カラムは xl 以上、3カラムは lg 以上）
  const gridColsClass = columns === 3 ? "sm:grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-2 xl:grid-cols-4";

  return (
    <section className="space-y-5 rounded-2xl border border-border/70 bg-card/70 p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <Skeleton className="h-9 w-9 rounded-xl" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-24 rounded" />
          <Skeleton className="h-6 w-40 rounded" />
        </div>
      </div>
      <div className={`grid grid-cols-1 gap-4 ${gridColsClass}`}>
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
    </section>
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
    recentlyUpdatedGuides,
    popularGuides,
    totalPublicProfiles,
    samplePace,
    recordedPaceTotal,
  } =
    useLoaderData<typeof loader>();

  const [feed, dispatch] = useReducer(feedReducer, initialFeedState);
  const [isRefreshingLiveRuns, setIsRefreshingLiveRuns] = useState(false);
  const navigate = useNavigate();

  // お気に入りの並べ替えはクライアント側で適用する
  // （/api/home-feed のレスポンスはユーザー非依存でCDNキャッシュされるため）
  const { favorites } = useFavorites();
  const favoriteSlugSet = useMemo(() => new Set(favorites), [favorites]);

  // お気に入りのプレイヤーを先頭へ（安定ソートなので同グループ内はサーバーの時間順を維持）
  const sortFavoritesFirst = useCallback(
    <T,>(items: T[], getSlug: (item: T) => string | null | undefined): T[] => {
      if (favoriteSlugSet.size === 0) return items;
      return [...items].sort((a, b) => {
        const aFav = favoriteSlugSet.has(getSlug(a) ?? "");
        const bFav = favoriteSlugSet.has(getSlug(b) ?? "");
        if (aFav === bFav) return 0;
        return aFav ? -1 : 1;
      });
    },
    [favoriteSlugSet]
  );

  // ライブペースを取得する関数（初回・15秒間隔の自動更新・手動の更新ボタンで共用）
  const fetchLiveRuns = useCallback(() => {
    return fetchFeedJson<LiveRunsResponse>("/api/home-feed?type=live-runs")
      .then((data) => {
        dispatch({
          type: "SET_LIVE_RUNS",
          payload: { ...data, liveRuns: data.liveRuns || [] },
        });
      })
      .catch((err) => {
        console.error("Failed to fetch live runs:", err);
        dispatch({ type: "SET_ERROR", payload: "liveRuns" });
      });
  }, []);

  const handleRefreshLiveRuns = useCallback(() => {
    setIsRefreshingLiveRuns(true);
    fetchLiveRuns().finally(() => setIsRefreshingLiveRuns(false));
  }, [fetchLiveRuns]);

  // ライブペースの自動更新（15秒間隔）。タブが非表示の間は止め、表示に戻ったら即更新して再開する
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

  // 「ランダムで見る」をAlt(Option)キー押下中にクリックすると隠しページへ。
  // Shift(新規ウィンドウ)/Ctrl・Cmd(新規タブ)やテキスト選択と競合しないAltを使用。
  const handleRandomClick = (e: React.MouseEvent) => {
    if (e.altKey) {
      e.preventDefault();
      navigate("/secret-grid");
    }
  };

  // フィルタリング
  const filteredRecentPaces = useMemo(() =>
    currentUser?.showPacemanOnHome === false && currentUser?.mcid
      ? feed.recentPaces.filter(run => run.mcid.toLowerCase() !== currentUser.mcid!.toLowerCase())
      : feed.recentPaces,
    [feed.recentPaces, currentUser?.showPacemanOnHome, currentUser?.mcid]
  );

  const filteredLiveRuns = useMemo(() =>
    currentUser?.showPacemanOnHome === false && currentUser?.mcid
      ? feed.liveRuns.filter(run => run.nickname.toLowerCase() !== currentUser.mcid!.toLowerCase())
      : feed.liveRuns,
    [feed.liveRuns, currentUser?.showPacemanOnHome, currentUser?.mcid]
  );

  // YouTube動画とTwitch VOD（どちらも FeedVideo 形式）をマージし、新しい順にソート
  const mergedFeedVideos = useMemo<FeedVideo[]>(
    () =>
      [...feed.recentVideos, ...feed.twitchVods].sort(
        (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
      ),
    [feed.recentVideos, feed.twitchVods]
  );

  // 自分の動画/VODを非表示にするユーザー設定を適用（プラットフォームごとのフラグ。/videos と共通）
  const filteredRecentVideos = useMemo(
    () =>
      currentUser
        ? filterOwnVideos(mergedFeedVideos, currentUser)
        : mergedFeedVideos,
    [mergedFeedVideos, currentUser]
  );

  // お気に入りを先頭に並べ替え（表示用）
  const sortedRecentPaces = useMemo(
    () => sortFavoritesFirst(filteredRecentPaces, (run) => feed.mcidToSlug[run.mcid.toLowerCase()]),
    [filteredRecentPaces, sortFavoritesFirst, feed.mcidToSlug]
  );
  const sortedLiveRuns = useMemo(
    () => sortFavoritesFirst(filteredLiveRuns, (run) => feed.mcidToSlug[run.nickname.toLowerCase()]),
    [filteredLiveRuns, sortFavoritesFirst, feed.mcidToSlug]
  );
  // ホームは新着数件のみ表示（全件は /videos 照会ページへ）。
  // 新着順で切り出してから、その中でお気に入りを先頭に並べ替える
  const sortedRecentVideos = useMemo(
    () =>
      sortFavoritesFirst(
        filteredRecentVideos.slice(0, HOME_VIDEO_DISPLAY_COUNT),
        (video) => video.slug
      ),
    [filteredRecentVideos, sortFavoritesFirst]
  );

  const fetchYouTubeVideos = useCallback(
    () =>
      fetchFeedJson<YouTubeVideosResponse>("/api/home-feed?type=youtube-videos")
        .then((data) => {
          dispatch({ type: "SET_VIDEOS", payload: data.recentVideos || [] });
        })
        .catch((err) => {
          console.error("Failed to fetch YouTube videos:", err);
          dispatch({ type: "SET_ERROR", payload: "videos" });
        }),
    []
  );
  const fetchTwitchVods = useCallback(
    () =>
      fetchFeedJson<TwitchVodsResponse>("/api/home-feed?type=twitch-vods")
        .then((data) => {
          dispatch({ type: "SET_TWITCH_VODS", payload: data.recentVods || [] });
        })
        .catch((err) => {
          console.error("Failed to fetch Twitch VODs:", err);
          dispatch({ type: "SET_ERROR", payload: "twitchVods" });
        }),
    []
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
    []
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

  // ガイド一覧行（更新順・PV順で共通の select 形。PV順のみ pageViews7d を追加で持つ）を
  // GuideCardGrid 用の型へ変換
  const toGuideItem = useCallback(
    (g: (typeof recentlyUpdatedGuides)[number] | (typeof popularGuides)[number]): GuideItemWithAuthorSlug => ({
      ...g,
      likeCount: Number(g.likeCount),
      authorName:
        pickDisplayName(
          { displayName: g.authorDisplayName, displayNameAlphabet: g.authorDisplayNameAlphabet },
          locale,
        ) || g.authorMcid || g.authorSlug,
      _authorSlug: g.authorSlug,
    }),
    [locale]
  );
  const guideLinkFn = useCallback(
    (guide: GuideItem) => {
      const item = guide as GuideItemWithAuthorSlug;
      return `/guides/${item._authorSlug}/${guide.slug}`;
    },
    []
  );

  return (
    <div className="relative flex-1 space-y-7 sm:space-y-8">
      <section className="relative overflow-hidden rounded-2xl border border-border/70 bg-card/80 p-6 shadow-sm sm:p-8">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,color-mix(in_oklch,var(--border)_40%,transparent)_1px,transparent_1px),linear-gradient(to_bottom,color-mix(in_oklch,var(--border)_35%,transparent)_1px,transparent_1px)] bg-[size:26px_26px] opacity-25" />
        <div className="relative grid gap-7 lg:grid-cols-[1.3fr_1fr] lg:items-end">
          <div className="space-y-5">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background/75 px-2.5 py-1 text-xs text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              {t("home.heroBadge")}
            </span>
            <div className="space-y-3">
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl lg:text-4xl">
                {t("home.heroTitle")}
              </h1>
              <p className="max-w-xl text-base text-muted-foreground sm:text-lg">
                {t("home.heroDescription")}
              </p>
            </div>
            {isRegistered && currentUser && (
              <div className="space-y-2 rounded-xl border border-border/70 bg-background/80 px-4 py-3">
                <p className="text-sm font-semibold">
                  {t("home.welcomeBack", {
                    name:
                      pickDisplayName(
                        { displayName: currentUser.displayName, displayNameAlphabet: currentUser.displayNameAlphabet },
                        locale,
                      ) ||
                      currentUser.mcid ||
                      currentUser.slug,
                  })}
                </p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  <Link to={`/player/${currentUser.slug}`} className="inline-flex items-center gap-1.5 text-primary hover:underline">
                    <User className="h-4 w-4" />
                    {t("home.welcomeMyProfile")}
                  </Link>
                  <Link to="/me/edit" className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
                    <Pencil className="h-4 w-4" />
                    {t("home.welcomeEditProfile")}
                  </Link>
                  <Link to="/favorites" className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
                    <Heart className="h-4 w-4" />
                    {t("home.welcomeFavorites")}
                  </Link>
                </div>
              </div>
            )}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              {!isRegistered && (
                <Button asChild size="lg" className="w-full sm:w-auto">
                  <Link to="/login">
                    {t("home.ctaStart")}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              )}
              <Button asChild size="lg" variant="outline" className="w-full sm:w-auto">
                <Link to="/browse">
                  <Compass className="mr-2 h-4 w-4" />
                  {t("home.ctaBrowse")}
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="w-full sm:w-auto">
                <Link to="/random-player" onClick={handleRandomClick}>
                  <Shuffle className="mr-2 h-4 w-4" />
                  {t("home.ctaRandom")}
                </Link>
              </Button>
            </div>
          </div>

          <div className="space-y-3">
            {samplePace && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">{t("home.heroSampleLabel")}</p>
                <PaceFeedCard
                  run={samplePace.run}
                  uuid={samplePace.uuid}
                  displayName={
                    (locale !== "ja" ? samplePace.displayNameAlphabet : null) ||
                    samplePace.displayName ||
                    undefined
                  }
                  skinUrl={samplePace.skinUrl ?? undefined}
                />
              </div>
            )}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div className="flex items-baseline gap-2.5 rounded-xl border border-border/70 bg-background/80 px-3 py-2 sm:block sm:py-2.5">
                <div className="text-xl font-bold tabular-nums">{totalPublicProfiles.toLocaleString(locale)}</div>
                <p className="text-xs leading-tight text-muted-foreground sm:mt-0.5 sm:text-[11px]">{t("home.statProfiles")}</p>
              </div>
              <div className="flex items-baseline gap-2.5 rounded-xl border border-border/70 bg-background/80 px-3 py-2 sm:block sm:py-2.5">
                <div className="text-xl font-bold tabular-nums">{recordedPaceTotal === null ? <span className="text-muted-foreground">-</span> : recordedPaceTotal.toLocaleString(locale)}</div>
                <p className="text-xs leading-tight text-muted-foreground sm:mt-0.5 sm:text-[11px]">{t("home.statPaces")}</p>
              </div>
              <div className="flex items-baseline gap-2.5 rounded-xl border border-border/70 bg-background/80 px-3 py-2 sm:block sm:py-2.5">
                <div className="text-xl font-bold tabular-nums">
                  {feed.loading.liveRuns ? (
                    <Skeleton className="h-7 w-8 rounded" />
                  ) : feed.errors.liveRuns && feed.liveRunsCheckedAt === null ? (
                    <span className="text-muted-foreground">-</span>
                  ) : (
                    sortedLiveRuns.length
                  )}
                </div>
                <p className="text-xs leading-tight text-muted-foreground sm:mt-0.5 sm:text-[11px]">{t("home.statLive")}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-5 rounded-2xl border border-border/70 bg-card/70 p-5 sm:p-6">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-primary/10 p-2">
            <UserCheck className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{t("home.profilesLabel")}</p>
            <h2 className="text-xl font-bold">{t("home.sectionProfiles")}</h2>
          </div>
          <Button variant="ghost" size="sm" asChild className="ml-auto">
            <Link to="/browse">
              {t("home.viewAll")}
              <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
        {recentlyUpdatedUsers.length > 0 ? (
          <div className="space-y-5">
            <div className="space-y-3">
              <p className="text-sm font-medium text-muted-foreground">{t("home.sectionRecentlyUpdated")}</p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {recentlyUpdatedUsers.map((user) => (
                  <ProfileFeedCard key={user.slug} player={user} />
                ))}
              </div>
            </div>
            {popularUsers.length > 0 && (
              <>
                <div className="border-t border-border/60" />
                <div className="space-y-3">
                  <p className="text-sm font-medium text-muted-foreground">
                    {t("home.sectionPopular", { days: PAGE_VIEW_WINDOW_DAYS })}
                  </p>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    {popularUsers.map((user) => (
                      <ProfileFeedCard key={user.slug} player={user} />
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        ) : (
          <EmptyState
            icon={<Users className="h-12 w-12" />}
            title={t("home.noProfiles")}
            description={t("home.noProfilesDescription")}
          />
        )}
      </section>

      {(recentlyUpdatedGuides.length > 0 || popularGuides.length > 0) && (
        <section className="space-y-5 rounded-2xl border border-border/70 bg-card/70 p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-primary/10 p-2">
              <BookOpen className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{t("home.guideFeedLabel")}</p>
              <h2 className="text-xl font-bold">{t("home.sectionGuides")}</h2>
            </div>
            <Button variant="ghost" size="sm" asChild className="ml-auto">
              <Link to="/guides">
                {t("home.viewAll")}
                <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
          <div className="space-y-5">
            {recentlyUpdatedGuides.length > 0 && (
              <div className="space-y-3">
                <p className="text-sm font-medium text-muted-foreground">{t("home.sectionRecentlyUpdated")}</p>
                <GuideCardGrid
                  guides={recentlyUpdatedGuides.map(toGuideItem)}
                  linkFn={guideLinkFn}
                  gridCols="sm:grid-cols-2 xl:grid-cols-4"
                />
              </div>
            )}
            {recentlyUpdatedGuides.length > 0 && popularGuides.length > 0 && (
              <div className="border-t border-border/60" />
            )}
            {popularGuides.length > 0 && (
              <div className="space-y-3">
                <p className="text-sm font-medium text-muted-foreground">
                  {t("home.sectionPopular", { days: PAGE_VIEW_WINDOW_DAYS })}
                </p>
                <GuideCardGrid
                  guides={popularGuides.map(toGuideItem)}
                  linkFn={guideLinkFn}
                  gridCols="sm:grid-cols-2 xl:grid-cols-4"
                  pageViewsMode="replace"
                />
              </div>
            )}
          </div>
        </section>
      )}

      {/* ペースセクション: ライブ（外部API）と過去のペース（DBキャッシュ）でロードを分離し、
          片方の遅延がもう片方の表示をブロックしないようにする */}
      {feed.loading.paces && feed.loading.liveRuns ? (
        <SectionSkeleton columns={4} />
      ) : (
        <section className="space-y-5 rounded-2xl border border-border/70 bg-card/70 p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-primary/10 p-2">
              <History className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{t("home.paceFeedLabel")}</p>
              <h2 className="text-xl font-bold">{t("home.sectionPaces")}</h2>
            </div>
          </div>

          {/* ライブペース（旧 /live から移設。15秒自動更新 + 手動更新ボタン） */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Timer className="h-4 w-4 text-primary" />
              <h3 className="font-semibold">{t("home.livePacesTitle")}</h3>
              {!feed.loading.liveRuns && (
                <span className="text-sm text-muted-foreground">({sortedLiveRuns.length})</span>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto"
                onClick={handleRefreshLiveRuns}
                disabled={isRefreshingLiveRuns || feed.loading.liveRuns}
              >
                <RefreshCw className={cn("mr-1 h-3.5 w-3.5", isRefreshingLiveRuns && "animate-spin")} />
                {t("home.refreshLivePaces")}
              </Button>
            </div>
            {/* 状態行のみ aria-live（表のライブリージョン化は読み上げが過多になる）。時刻は読み上げ対象外 */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <p aria-live="polite" className={cn(feed.errors.liveRuns && "text-destructive")}>
                {feed.errors.liveRuns
                  ? feed.liveRunsCheckedAt === null
                    ? t("home.liveFetchFailed")
                    : t("home.liveStaleNote")
                  : !feed.loading.liveRuns && sortedLiveRuns.length === 0
                    ? t("home.noLivePaces")
                    : null}
              </p>
              {feed.liveRunsCheckedAt !== null && (
                <span aria-hidden="true">
                  {t("home.liveLastChecked", {
                    time: new Date(feed.liveRunsCheckedAt).toLocaleTimeString(locale, {
                      hour: "2-digit",
                      minute: "2-digit",
                    }),
                  })}
                </span>
              )}
              {feed.errors.liveRuns && (
                <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={retryLiveRuns}>
                  <RefreshCw className="mr-1 h-3 w-3" />
                  {t("home.feedRetry")}
                </Button>
              )}
            </div>
            {feed.loading.liveRuns ? (
              <div className="space-y-2">
                <Skeleton className="h-10 rounded-xl" />
                <Skeleton className="h-10 rounded-xl" />
              </div>
            ) : sortedLiveRuns.length > 0 ? (
              <LivePaceList
                runs={sortedLiveRuns}
                mcidToSlug={feed.mcidToSlug}
                mcidToUuid={feed.mcidToUuid}
                mcidToDisplayName={feed.mcidToDisplayName}
                mcidToDisplayNameAlphabet={feed.mcidToDisplayNameAlphabet}
                mcidToSkinUrl={feed.mcidToSkinUrl}
              />
            ) : null}
          </div>

          {/* 過去のペース（最新12件） */}
          {feed.loading.paces ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-muted-foreground" />
                <h3 className="font-semibold">{t("home.pastPacesTitle")}</h3>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-24 rounded-xl" />
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-muted-foreground" />
                <h3 className="font-semibold">{t("home.pastPacesTitle")}</h3>
                <Button variant="ghost" size="sm" className="ml-auto" asChild>
                  <Link to="/paces">
                    {t("home.viewAll")}
                    <ArrowRight className="ml-1 h-3.5 w-3.5" />
                  </Link>
                </Button>
              </div>
              {feed.errors.paces ? (
                <FeedErrorNotice message={t("home.pacesFetchFailed")} onRetry={retryPaces} />
              ) : sortedRecentPaces.length === 0 ? (
                <EmptyState
                  icon={<History className="h-12 w-12" />}
                  title={t("home.noRecentPaces")}
                  description={t("home.noRecentPacesDescription")}
                />
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  {sortedRecentPaces.map((run) => (
                    <PaceFeedCard
                      key={`${run.mcid}-${run.time}-${run.timeline}`}
                      run={run}
                      uuid={feed.mcidToUuid[run.mcid.toLowerCase()]}
                      displayName={pickMcidDisplayName(feed, run.mcid, locale)}
                      skinUrl={feed.mcidToSkinUrl[run.mcid.toLowerCase()]}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {feed.loading.videos || feed.loading.twitchVods ? (
        <SectionSkeleton columns={3} />
      ) : (
        <section className="space-y-5 rounded-2xl border border-border/70 bg-card/70 p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-primary/10 p-2">
              <Play className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{t("home.videoFeedLabel")}</p>
              <h2 className="text-xl font-bold">{t("home.sectionVideos")}</h2>
            </div>
            <Button variant="ghost" size="sm" asChild className="ml-auto">
              <Link to="/videos">
                {t("home.viewAll")}
                <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
          {(feed.errors.videos || feed.errors.twitchVods) && sortedRecentVideos.length === 0 ? (
            <FeedErrorNotice message={t("home.videosFetchFailed")} onRetry={retryVideos} />
          ) : sortedRecentVideos.length === 0 ? (
            <EmptyState
              icon={<Play className="h-12 w-12" />}
              title={t("home.noVideos")}
              description={t("home.noVideosDescription")}
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {sortedRecentVideos.map((video) => (
                <FeedVideoCard key={feedVideoKey(video)} video={video} />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
