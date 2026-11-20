import { createTranslator } from "@/lib/messages";
import { localeFromMatches } from "@/lib/locale";
import { useLoaderData, useSearchParams, useNavigation } from "react-router";
import type { ReactNode } from "react";
import type { Route } from "./+types/rankings";
import { createDb } from "@/lib/db";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/status-pill";
import { Trophy, Timer, Swords, Video, ExternalLink, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT, useLocale } from "@/hooks/use-locale";
import { pickDisplayName } from "@/lib/slug";
import { Link } from "react-router";
import { getEnv } from "@/lib/env.server";
import { createAuth } from "@/lib/auth";
import { getOptionalSession } from "@/lib/session";
import { getCached, setCached } from "@/lib/cache";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import {
  loadRankingCategories,
  loadRankings,
  parseRankingsParams,
  type RankingEntry,
} from "@/lib/rankings-query.server";
import { ScrollUpStickyHeader } from "@/components/scroll-up-sticky-header";
import { EmptyState } from "@/components/empty-state";

// 1・3位のメダル色（3テーブルで共通）。2位（銀）の色トークンは無く、muted だと4位以下（前景色）より
// 淡く見えて順位が下がったように読めるため、2位は前景色のまま（4位以下と同じ）にする
function rankMedalClass(rank: number): string {
  if (rank === 1) return "text-gold";
  if (rank === 3) return "text-bronze";
  return "";
}

type RankingsTableKind = "speedruncom" | "rankedPb" | "rankedElo";

/** 表の種類ごとの列数（スケルトンを表示中・遷移先の表と同じ列数で描くため） */
const TABLE_COLUMN_COUNT: Record<RankingsTableKind, number> = {
  speedruncom: 5,
  rankedPb: 3,
  rankedElo: 5,
};

/**
 * URL の検索条件（tab / rankedType）から表の種類を決める（loader の parseRankingsParams と同じ既定: speedruncom。
 * ただし tab 無しでカテゴリが0件のときは loader が Ranked へ落とすので、hasCategories=false なら Ranked 扱い）
 */
function tableKindFromSearch(search: string, hasCategories: boolean): RankingsTableKind {
  const params = new URLSearchParams(search);
  const tab = params.get("tab");
  if (tab === "speedruncom" || (tab === null && hasCategories)) return "speedruncom";
  return params.get("rankedType") === "elo" ? "rankedElo" : "rankedPb";
}

/** カテゴリ切替のボタン（選択中は aria-pressed で伝える。モバイルは 44px） */
function CategoryButton({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      variant={selected ? "default" : "outline"}
      size="sm"
      aria-pressed={selected}
      onClick={onClick}
      className={cn("min-h-11 transition-all sm:min-h-8", selected && "shadow-sm")}
    >
      {children}
    </Button>
  );
}

/** 表の外枠（角丸で切る枠。横スクロールは ScrollUpStickyHeader の内側の器が持つ） */
const TABLE_FRAME_CLASS = "relative border rounded-xl overflow-hidden";

/**
 * 表のクラス。sm 未満は table-fixed で、列幅をヘッダ行の w-* だけで決める
 * （名前の長さで列が広がらず、ヘッダだけの固定ヘッダの複製と本体の列が一致する）。
 * プレイヤー列は幅を持たず残りを取る。横に流す表は min-w で、プレイヤー列に 160px 残るようにする。
 * sm 以上は従来どおり自動レイアウト
 */
const PB_TABLE_CLASS = "w-full caption-bottom text-sm table-fixed sm:table-auto";
// # 48 + プレイヤー 160 + タイム 112 + 日付 96 + リンク 96
const SPEEDRUNCOM_TABLE_CLASS =
  "w-full caption-bottom text-sm table-fixed min-w-[512px] sm:table-auto sm:min-w-0";
// # 48 + プレイヤー 160 + Elo 64 + 勝敗 112 + 勝率 80
const ELO_TABLE_CLASS =
  "w-full caption-bottom text-sm table-fixed min-w-[464px] sm:table-auto sm:min-w-0";

/** スクロールアウト → 上スクロール時に表示する sticky ヘッダ用テーブルラッパ（本体と同じ表のクラスを渡す） */
function StickyHeaderShell({ children, className }: { children: ReactNode; className: string }) {
  return (
    <table className={className}>
      <TableHeader>{children}</TableHeader>
    </table>
  );
}

export const meta: Route.MetaFunction = ({ matches, loaderData }) => {
  const t = createTranslator(localeFromMatches(matches));
  const title = t("rankings.title");
  const description = t("rankings.description");
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

// 60秒: プロフィール非公開化・showRankedStats OFF を即時反映したいため短く保つ（getUserData の60秒と同じ前例）
const RANKINGS_CACHE_TTL = 60 * 1000;
const CATEGORIES_CACHE_KEY = "rankings:categories";
type Categories = Awaited<ReturnType<typeof loadRankingCategories>>;
type LoadedRankings = Awaited<ReturnType<typeof loadRankings>>;

export async function loader({ request }: Route.LoaderArgs) {
  const env = getEnv();
  const db = createDb();
  // 空状態に「自分の Ranked 統計の公開設定」への導線を出すかどうか（ログイン時のみ）
  const session = await getOptionalSession(request, createAuth(db, env));
  const url = new URL(request.url);
  let args = parseRankingsParams(url.searchParams);
  // ランキングは12時間ごとの cron でしか変わらないため、短い TTL でモジュールキャッシュする
  const loadCategories = async () => {
    const cached = await getCached<Categories>(CATEGORIES_CACHE_KEY);
    if (cached) return cached;
    const fresh = await loadRankingCategories(db);
    await setCached(CATEGORIES_CACHE_KEY, fresh, RANKINGS_CACHE_TTL);
    return fresh;
  };

  let speedruncomCategories: Categories;
  let rankings: LoadedRankings["rankings"];
  let selectedCategory: LoadedRankings["selectedCategory"];

  let loadedCategories: Categories | undefined;
  if (args.tab === "speedruncom") {
    // 選択カテゴリの id が要るのでカテゴリ一覧が先（キャッシュ済みなら往復なし）
    loadedCategories = await loadCategories();
    // Speedrun.com のカテゴリが1件も無く、タブの指定も無い（既定）ときは、データのある Ranked PB を既定にする
    if (loadedCategories.length === 0 && !url.searchParams.has("tab")) {
      args = { ...args, tab: "ranked", rankedType: "pb" };
    }
  }

  if (args.tab === "speedruncom") {
    speedruncomCategories = loadedCategories ?? (await loadCategories());
    const target = args.categorySlug
      ? speedruncomCategories.find((c) => c.slug === args.categorySlug)
      : speedruncomCategories[0];
    const key = `rankings:speedruncom:${target?.id ?? "none"}`;
    const cached = await getCached<LoadedRankings>(key);
    const loaded =
      cached ?? (await loadRankings(db, args, speedruncomCategories));
    if (!cached) await setCached(key, loaded, RANKINGS_CACHE_TTL);
    ({ rankings, selectedCategory } = loaded);
  } else {
    // ranked タブはカテゴリ不要（nav 用の一覧だけ必要）なので並列に取得する
    const key = `rankings:ranked:${args.rankedType === "pb" ? "pb" : "elo"}`;
    const cached = await getCached<LoadedRankings>(key);
    const [cats, loaded] = await Promise.all([
      loadedCategories ?? loadCategories(),
      cached ?? loadRankings(db, args, []),
    ]);
    if (!cached) await setCached(key, loaded, RANKINGS_CACHE_TTL);
    speedruncomCategories = cats;
    ({ rankings, selectedCategory } = loaded);
  }

  return {
    tab: args.tab,
    categories: speedruncomCategories,
    selectedCategory,
    rankings,
    rankedType: args.rankedType,
    isSignedIn: !!session,
    appUrl: env.APP_URL || "https://minefolio.app",
  };
}

export default function RankingsPage() {
  const t = useT();
  const data = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  // /rankings 内の切替（カテゴリ・タブ）だけを再取得として扱う（走者のページへ移るときは表を薄くしない）
  const isLoading = navigation.state === "loading" && navigation.location?.pathname === "/rankings";
  const currentKind: RankingsTableKind =
    data.tab === "speedruncom" ? "speedruncom" : data.rankedType === "elo" ? "rankedElo" : "rankedPb";
  // 読み込み中に表が無い（空状態から切り替えた）ときのスケルトンは、遷移先の表の列数で描く
  const pendingKind =
    isLoading && navigation.location
      ? tableKindFromSearch(navigation.location.search, data.categories.length > 0)
      : currentKind;

  // /rankings は遅延読み込み無効。loader が全件返す。
  const items = data.rankings;

  const handleCategoryClick = (category: {
    type: "speedruncom" | "ranked";
    slug: string;
    subType?: "pb" | "elo";
  }) => {
    const params = new URLSearchParams(searchParams);
    if (category.type === "speedruncom") {
      params.set("tab", "speedruncom");
      params.set("category", category.slug);
      params.delete("rankedType");
    } else {
      params.set("tab", "ranked");
      params.set("rankedType", category.subType ?? "pb");
      params.delete("category");
    }
    setSearchParams(params);
  };

  return (
    <div className="flex-1 flex flex-col space-y-6">
      <div>
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-primary/10 p-2">
            <Trophy className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold">{t("rankings.pageTitle")}</h1>
          </div>
          {items.length > 0 && (
            <StatusPill icon={Trophy} className="ml-auto">
              {t("rankings.count", { count: items.length })}
            </StatusPill>
          )}
        </div>
        <p className="text-muted-foreground mt-1 text-sm">
          {t("rankings.publicityNote")}
        </p>
      </div>

      {/* カテゴリ選択 */}
      <div className="space-y-3">
        {/* Speedrun.com カテゴリ（登録が無ければ見出しごと出さない） */}
        {data.categories.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Timer className="h-4 w-4" aria-hidden />
              <span id="rankings-group-speedruncom">Speedrun.com</span>
            </div>
            <div role="group" aria-labelledby="rankings-group-speedruncom" className="flex flex-wrap gap-2">
              {data.categories.map((cat) => (
                <CategoryButton
                  key={cat.id}
                  selected={data.tab === "speedruncom" && data.selectedCategory?.slug === cat.slug}
                  onClick={() => handleCategoryClick({ type: "speedruncom", slug: cat.slug })}
                >
                  {cat.name}
                </CategoryButton>
              ))}
            </div>
          </div>
        )}

        {/* MCSR Ranked カテゴリ */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Swords className="h-4 w-4" aria-hidden />
            <span id="rankings-group-ranked">MCSR Ranked</span>
          </div>
          <div role="group" aria-labelledby="rankings-group-ranked" className="flex flex-wrap gap-2">
            <CategoryButton
              selected={data.tab === "ranked" && data.rankedType === "pb"}
              onClick={() => handleCategoryClick({ type: "ranked", slug: "ranked-pb", subType: "pb" })}
            >
              {t("rankings.pbRanking")}
            </CategoryButton>
            <CategoryButton
              selected={data.tab === "ranked" && data.rankedType === "elo"}
              onClick={() => handleCategoryClick({ type: "ranked", slug: "ranked-elo", subType: "elo" })}
            >
              {t("rankings.eloRanking")}
            </CategoryButton>
          </div>
        </div>
      </div>

      {/* ランキングテーブル。再取得中は表を差し替えず薄くして残す（表が無いときだけスケルトン）。
          記録の公開設定の注記は見出しの下に1回だけ出す（空状態では繰り返さない） */}
      {isLoading && items.length === 0 ? (
        <RankingsTableSkeleton columns={TABLE_COLUMN_COUNT[pendingKind]} />
      ) : (
        <div
          aria-busy={isLoading || undefined}
          className={cn("transition-opacity motion-reduce:transition-none", isLoading && "opacity-50")}
        >
          {items.length === 0 ? (
            data.tab === "speedruncom" && data.categories.length === 0 ? (
              <EmptyState
                icon={<Trophy className="h-12 w-12" />}
                title={t("rankings.noCategories")}
                description={t("rankings.noCategoriesHint")}
                action={
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleCategoryClick({ type: "ranked", slug: "ranked-pb", subType: "pb" })}
                  >
                    {t("rankings.openPbRanking")}
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={<Trophy className="h-12 w-12" />}
                title={t("rankings.noRankingData")}
                description={
                  data.tab === "ranked" ? t("rankings.noRankingDataRankedHint") : t("rankings.noRankingDataHint")
                }
                action={
                  data.isSignedIn && data.tab === "ranked" ? (
                    <Button asChild variant="outline" size="sm">
                      <Link to="/me/account">{t("rankings.openRankedSettings")}</Link>
                    </Button>
                  ) : undefined
                }
              />
            )
          ) : currentKind === "speedruncom" ? (
            <SpeedruncomRankingsTable rankings={items} />
          ) : currentKind === "rankedPb" ? (
            <RankedPbTable rankings={items} />
          ) : (
            <RankedEloTable rankings={items} />
          )}
        </div>
      )}
    </div>
  );
}

// Speedrun.com ランキングテーブル
function SpeedruncomRankingsTable({ rankings }: { rankings: RankingEntry[] }) {
  const t = useT();
  const locale = useLocale();
  const headerRow = (
    <TableRow>
      <TableHead className="sticky top-0 left-0 bg-muted z-30 w-12 sm:w-15 text-center border-r border-b-2">#</TableHead>
      <TableHead className="sticky top-0 bg-muted z-20 border-b-2">{t("rankings.player")}</TableHead>
      <TableHead className="sticky top-0 bg-muted z-20 w-28 sm:w-30 text-right border-b-2">{t("rankings.time")}</TableHead>
      <TableHead className="sticky top-0 bg-muted z-20 w-24 sm:w-25 border-b-2">{t("rankings.date")}</TableHead>
      <TableHead className="sticky top-0 bg-muted z-20 w-24 sm:w-25 text-center border-b-2">{t("rankings.links")}</TableHead>
    </TableRow>
  );
  return (
    <ScrollUpStickyHeader
      className={TABLE_FRAME_CLASS}
      scrollRegionLabel={t("common.tableScrollRegion")}
      stickyHeader={<StickyHeaderShell className={SPEEDRUNCOM_TABLE_CLASS}>{headerRow}</StickyHeaderShell>}
    >
      <table className={SPEEDRUNCOM_TABLE_CLASS}>
        <TableHeader>{headerRow}</TableHeader>
        <TableBody>
          {rankings.map((entry, index) => {
            const isPending = entry.verificationStatus === "new";
            return (
              <TableRow
                key={`${entry.userId}-${entry.verificationStatus}-${index}`}
                className={cn(isPending ? "bg-muted/30 hover:bg-muted/40" : "hover:bg-muted/30")}
              >
                <TableCell className={cn("sticky left-0 z-10 text-center font-medium", isPending ? "bg-[color-mix(in_oklab,var(--background),var(--muted)_30%)] [tr:hover_&]:bg-[color-mix(in_oklab,var(--background),var(--muted)_40%)]" : "bg-background [tr:hover_&]:bg-[color-mix(in_oklab,var(--background),var(--muted)_30%)]")}>
                  {isPending ? (
                    // 意味は名前の下の「審査待ち」の行が伝える（タッチでも読める）。時計は飾りとして読み上げない
                    <Clock className="h-4 w-4 inline text-muted-foreground" aria-hidden="true" />
                  ) : entry.rank !== null && entry.rank <= 3 ? (
                    <span className={rankMedalClass(entry.rank)}>
                      {entry.rank}
                    </span>
                  ) : entry.rank}
                </TableCell>
                <TableCell>
                  <Link
                    to={`/player/${entry.slug}`}
                    className="-my-2 flex min-h-11 items-center gap-2 transition-opacity hover:opacity-80 sm:my-0 sm:min-h-0"
                  >
                    <MinecraftAvatar
                      uuid={entry.uuid}
                      skinUrl={entry.customSkinUrl}
                      size={32}
                      className={`rounded-lg shrink-0 ${isPending ? "opacity-70" : ""}`}
                    />
                    <div className="min-w-0">
                      <p className={`font-medium text-sm truncate ${isPending ? "text-muted-foreground" : ""}`}>
                        {pickDisplayName(entry, locale) ?? entry.mcid ?? t("rankings.unknownPlayer")}
                      </p>
                      {/* 名前と別の行に置き、名前が省略されても切れずに読めるようにする */}
                      {isPending && (
                        <p className="text-xs text-warning">{t("rankings.pendingVerification")}</p>
                      )}
                    </div>
                  </Link>
                </TableCell>
                <TableCell className={`font-mono text-right ${isPending ? "text-muted-foreground" : ""}`}>
                  {entry.timeFormatted ?? "-"}
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {entry.recordDate ?? "-"}
                </TableCell>
                <TableCell className="text-center">
                  <div className="flex items-center justify-center gap-0 sm:gap-1">
                    {entry.videoUrl && (
                      <a
                        href={entry.videoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={t("rankings.watchVideo")}
                        className="-my-2.5 inline-flex h-11 w-9 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors sm:my-0 sm:size-8"
                      >
                        <Video className="h-4 w-4" />
                      </a>
                    )}
                    {entry.runWeblink && (
                      <a
                        href={entry.runWeblink}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={t("rankings.viewExternal")}
                        className="-my-2.5 inline-flex h-11 w-9 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors sm:my-0 sm:size-8"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </table>
    </ScrollUpStickyHeader>
  );
}

// Ranked PB テーブル
function RankedPbTable({ rankings }: { rankings: RankingEntry[] }) {
  const t = useT();
  const locale = useLocale();
  const headerRow = (
    <TableRow>
      <TableHead className="sticky top-0 left-0 bg-muted z-30 w-12 sm:w-15 text-center border-r border-b-2">#</TableHead>
      <TableHead className="sticky top-0 bg-muted z-20 border-b-2">{t("rankings.player")}</TableHead>
      <TableHead className="sticky top-0 bg-muted z-20 w-28 sm:w-30 text-right border-b-2">{t("rankings.bestTime")}</TableHead>
    </TableRow>
  );
  return (
    <ScrollUpStickyHeader
      className={TABLE_FRAME_CLASS}
      scrollRegionLabel={t("common.tableScrollRegion")}
      stickyHeader={<StickyHeaderShell className={PB_TABLE_CLASS}>{headerRow}</StickyHeaderShell>}
    >
      <table className={PB_TABLE_CLASS}>
        <TableHeader>{headerRow}</TableHeader>
        <TableBody>
          {rankings.map((entry) => (
            <TableRow key={entry.userId} className="hover:bg-muted/30">
              <TableCell className="sticky left-0 z-10 bg-background text-center font-medium [tr:hover_&]:bg-[color-mix(in_oklab,var(--background),var(--muted)_30%)]">
                {entry.rank !== null && entry.rank <= 3 ? (
                  <span className={rankMedalClass(entry.rank)}>
                    {entry.rank}
                  </span>
                ) : entry.rank ?? "-"}
              </TableCell>
              <TableCell>
                <Link
                  to={`/player/${entry.slug}`}
                  className="-my-2 flex min-h-11 items-center gap-2 transition-opacity hover:opacity-80 sm:my-0 sm:min-h-0"
                >
                  <MinecraftAvatar
                    uuid={entry.uuid}
                    skinUrl={entry.customSkinUrl}
                    size={32}
                    className="rounded-lg shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">
                      {pickDisplayName(entry, locale) ?? entry.mcid ?? t("rankings.unknownPlayer")}
                    </p>
                  </div>
                </Link>
              </TableCell>
              <TableCell className="font-mono text-right">{entry.timeFormatted ?? "-"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </table>
    </ScrollUpStickyHeader>
  );
}

// Ranked Elo テーブル
function RankedEloTable({ rankings }: { rankings: RankingEntry[] }) {
  const t = useT();
  const locale = useLocale();
  const headerRow = (
    <TableRow>
      <TableHead className="sticky top-0 left-0 bg-muted z-30 w-12 sm:w-15 text-center border-r border-b-2">#</TableHead>
      <TableHead className="sticky top-0 bg-muted z-20 border-b-2">{t("rankings.player")}</TableHead>
      <TableHead className="sticky top-0 bg-muted z-20 w-16 sm:w-25 text-right border-b-2">Elo</TableHead>
      <TableHead className="sticky top-0 bg-muted z-20 w-28 sm:w-25 text-right border-b-2">{t("rankings.winLoss")}</TableHead>
      <TableHead className="sticky top-0 bg-muted z-20 w-20 text-right border-b-2">{t("rankings.winRate")}</TableHead>
    </TableRow>
  );
  return (
    <ScrollUpStickyHeader
      className={TABLE_FRAME_CLASS}
      scrollRegionLabel={t("common.tableScrollRegion")}
      stickyHeader={<StickyHeaderShell className={ELO_TABLE_CLASS}>{headerRow}</StickyHeaderShell>}
    >
      <table className={ELO_TABLE_CLASS}>
        <TableHeader>{headerRow}</TableHeader>
        <TableBody>
          {rankings.map((entry) => (
            <TableRow key={entry.userId} className="hover:bg-muted/30">
              <TableCell className="sticky left-0 z-10 bg-background text-center font-medium [tr:hover_&]:bg-[color-mix(in_oklab,var(--background),var(--muted)_30%)]">
                {entry.rank !== null && entry.rank <= 3 ? (
                  <span className={rankMedalClass(entry.rank)}>
                    {entry.rank}
                  </span>
                ) : entry.rank ?? "-"}
              </TableCell>
              <TableCell>
                <Link
                  to={`/player/${entry.slug}`}
                  className="-my-2 flex min-h-11 items-center gap-2 transition-opacity hover:opacity-80 sm:my-0 sm:min-h-0"
                >
                  <MinecraftAvatar
                    uuid={entry.uuid}
                    skinUrl={entry.customSkinUrl}
                    size={32}
                    className="rounded-lg shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">
                      {pickDisplayName(entry, locale) ?? entry.mcid ?? t("rankings.unknownPlayer")}
                    </p>
                  </div>
                </Link>
              </TableCell>
              <TableCell className="text-right font-mono">{entry.eloRate ?? "-"}</TableCell>
              <TableCell className="text-right text-sm">
                <span className="text-success">{entry.wins ?? 0}W</span>
                {" / "}
                <span className="text-destructive">{entry.losses ?? 0}L</span>
              </TableCell>
              <TableCell className="text-right">{entry.winRate ?? 0}%</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </table>
    </ScrollUpStickyHeader>
  );
}

// スケルトンローダー（列数は表示する表に合わせる。1列目は順位、2列目は走者、残りは数値・リンク）
function RankingsTableSkeleton({ columns }: { columns: number }) {
  const t = useT();
  const restColumns = Math.max(0, columns - 2);
  return (
    <div className="relative border rounded-xl overflow-hidden" aria-hidden="true">
      <table className="w-full caption-bottom text-sm">
        <TableHeader>
          <TableRow>
            <TableHead className="sticky top-0 left-0 bg-muted z-30 w-15 border-r border-b-2">#</TableHead>
            <TableHead className="sticky top-0 bg-muted z-20 border-b-2">{t("rankings.player")}</TableHead>
            {Array.from({ length: restColumns }).map((_, i) => (
              <TableHead key={i} className="sticky top-0 bg-muted z-20 w-25 border-b-2" />
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 10 }).map((_, i) => (
            <TableRow key={i}>
              <TableCell className="sticky left-0 bg-background z-10"><Skeleton className="h-4 w-8" /></TableCell>
              <TableCell><Skeleton className="h-4 w-32" /></TableCell>
              {Array.from({ length: restColumns }).map((_, j) => (
                <TableCell key={j}><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </table>
    </div>
  );
}
