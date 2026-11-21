import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import { PageViews7dMeta } from "@/components/page-views-meta";
import { FavoriteMark } from "@/components/favorite-mark";
import { FavoriteButton } from "@/components/favorite-button";
import { Clock3 } from "lucide-react";
import { RelativeTime } from "@/components/relative-time";
import { useT, useLocale } from "@/hooks/use-locale";
import { getLocalizedDisplayName } from "@/lib/slug";
import { platformLabel } from "@/lib/platform-label";
import { categoryLabel, isCategoryKey } from "@/lib/playstyle";
import {
  DEFAULT_PROFILE_EDITION,
  DEFAULT_PROFILE_INPUT_METHOD,
  DEFAULT_PROFILE_PLATFORM,
  DEFAULT_PROFILE_ROLE,
} from "@/lib/profile-defaults";
import { cn } from "@/lib/utils";

export interface ProfileFeedCardPlayer {
  mcid: string | null;
  uuid: string | null;
  slug: string;
  displayName: string | null;
  displayNameAlphabet?: string | null;
  pronouns: string | null;
  role: "runner" | "viewer" | null;
  mainEdition: "java" | "bedrock" | null;
  mainPlatform: "pc_windows" | "pc_mac" | "pc_linux" | "switch" | "mobile" | "other" | null;
  customSkinUrl?: string | null;
  updatedAt: Date;
  shortBio: string | null;
  /**
   * 直近7日のページビュー（page_view_stats）。人気順で並べたときの根拠数値。
   * 任意（渡した一覧だけが表示する。ホームの「よく見られているプロフィール」専用）。
   */
  pageViews7d?: number;
  /** 走者を見分ける表示用（任意。渡した一覧だけが表示する。/browse が渡す） */
  inputMethod?: "keyboard_mouse" | "controller" | "touch" | null;
  /** playstyle.mainCategory（CategoryKey）。未知の値は無視する */
  mainCategory?: string | null;
}

/** 既定値（Java / Windows / KBM / 走者）は全員同じで識別情報にならないため、カードには出さない */
function FeedCardTags({ player, mobileMax = 3 }: { player: ProfileFeedCardPlayer; mobileMax?: number }) {
  const t = useT();
  const tags: { key: string; label: string; variant: "secondary" | "outline" }[] = [];
  if (isCategoryKey(player.mainCategory)) {
    tags.push({ key: "category", label: categoryLabel(t, player.mainCategory), variant: "secondary" });
  }
  if (player.role && player.role !== DEFAULT_PROFILE_ROLE) tags.push({ key: "role", label: t("common.viewer"), variant: "secondary" });
  if (player.mainEdition && player.mainEdition !== DEFAULT_PROFILE_EDITION) {
    tags.push({ key: "edition", label: "Bedrock", variant: "outline" });
  }
  const platformText =
    player.mainPlatform && player.mainPlatform !== DEFAULT_PROFILE_PLATFORM
      ? platformLabel(t, player.mainPlatform, "short")
      : null;
  if (platformText) tags.push({ key: "platform", label: platformText, variant: "outline" });
  if (player.inputMethod && player.inputMethod !== DEFAULT_PROFILE_INPUT_METHOD) {
    tags.push({
      key: "input",
      label: player.inputMethod === "controller" ? t("browse.inputController") : t("browse.inputTouch"),
      variant: "outline",
    });
  }
  return (
    <>
      {tags.slice(0, 3).map((tag, i) => (
        <Badge
          key={tag.key}
          variant={tag.variant}
          // md 未満は mobileMax 個まで（幅が狭い行で名前を押し出さない。残りは md 以上で出る）
          className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px]", i >= mobileMax && "max-md:hidden")}
        >
          {tag.label}
        </Badge>
      ))}
    </>
  );
}

export function ProfileFeedCard({
  player,
  isFavorite = false,
  showFavoriteButton = false,
  className,
  surface = "background",
}: {
  player: ProfileFeedCardPlayer;
  /** true のとき名前行の右端（カードの右側）にハートを出す（/browse でお気に入りが先頭に来る理由の表示） */
  isFavorite?: boolean;
  /** true のときヘッダー右端にお気に入りの追加/解除ボタンを出す（isFavorite のピルは出さない。ホームの推薦用） */
  showFavoriteButton?: boolean;
  /** 外枠への追加クラス（例: 親が flex-col のとき `flex-1` で高さを揃える） */
  className?: string;
  /** カードの面。既定は `bg-background/80`、欄の中でページ背景に直接並べるとき（ホーム）は "card"（不透明の `bg-card`） */
  surface?: "background" | "card";
}) {
  const locale = useLocale();
  const displayName = getLocalizedDisplayName(player, locale);
  return (
    // オーバーレイリンク構成（ui.md）。hover の transform は外枠に置く。ボタンは relative z-10 でリンクより手前
    <div
      className={cn(
        "group relative flex flex-col rounded-xl border border-border/70 p-4 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        surface === "card" ? "bg-card" : "bg-background/80",
        className,
      )}
    >
      <Link
        to={`/player/${player.slug}`}
        prefetch="intent"
        aria-label={displayName}
        className="absolute inset-0 z-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      {/* flex-1 でヘッダー側が余白を吸収し、フッターの水平線位置を兄弟カード間で下端に揃える */}
      <div className="flex flex-1 items-start gap-3">
        <div className="h-12 w-12 shrink-0 rounded-xl">
          {/* MCID未登録（uuid も customSkinUrl も無し）は MinecraftAvatar 側でプレースホルダーを描く */}
          <MinecraftAvatar uuid={player.uuid} skinUrl={player.customSkinUrl} size={48} />
        </div>
        {/* min-h-12 keeps header block height == avatar height, so rows stay aligned across cards
            even when optional fields (@mcid / bio) are missing */}
        <div className="flex min-h-12 min-w-0 flex-1 flex-col justify-center">
          {isFavorite && !showFavoriteButton ? (
            <div className="flex min-w-0 items-center gap-2">
              <p className="min-w-0 flex-1 truncate font-semibold">{displayName}</p>
              <FavoriteMark />
            </div>
          ) : (
            <p className="truncate font-semibold">{displayName}</p>
          )}
          {player.mcid && (
            <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              <p className="min-w-0 truncate">@{player.mcid}</p>
              {player.pronouns && (
                <span className="shrink-0 rounded-full border border-border/70 bg-background px-2 py-0.5 text-[11px] leading-none">
                  {player.pronouns}
                </span>
              )}
            </div>
          )}
          <p className="mt-1 min-h-4 line-clamp-1 text-xs text-muted-foreground">
            {player.shortBio ?? "\u00A0"}
          </p>
        </div>
        {showFavoriteButton && (
          <div className="relative z-10 -my-1 -mr-2 shrink-0 self-start">
            <FavoriteButton slug={player.slug} name={displayName} variant="ghost" size="icon" className="size-11" />
          </div>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-border/60 pt-3 text-xs text-muted-foreground">
        {/* min-h-5: バッジ（約20px）の有無でフッター高が変わり、罫線位置が兄弟カードとずれるのを防ぐ */}
        <div className="flex min-h-5 min-w-0 flex-wrap items-center gap-1.5">
          <FeedCardTags player={player} />
          {player.pageViews7d !== undefined && <PageViews7dMeta count={player.pageViews7d} />}
        </div>
        <span className="ml-auto inline-flex shrink-0 items-center gap-1">
          <Clock3 className="h-3 w-3" aria-hidden />
          <RelativeTime date={player.updatedAt} unit="date" />
        </span>
      </div>
    </div>
  );
}

/** Compact list row for players */
export function ProfileFeedListItem({
  player,
  isFavorite = false,
}: {
  player: ProfileFeedCardPlayer;
  isFavorite?: boolean;
}) {
  const locale = useLocale();
  const displayName = getLocalizedDisplayName(player, locale);

  return (
    <Link
      to={`/player/${player.slug}`}
      prefetch="intent"
      className="group -mx-1 flex min-h-14 items-center gap-3 rounded px-1 py-2 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <div className="h-8 w-8 shrink-0 rounded-lg overflow-hidden">
        <MinecraftAvatar uuid={player.uuid} skinUrl={player.customSkinUrl} size={32} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-sm font-medium group-hover:text-primary transition-colors">
            {displayName}
          </span>
          {player.mcid && (
            <span className="max-w-[40%] truncate text-xs text-muted-foreground shrink-0">@{player.mcid}</span>
          )}
        </div>
        {/* md 未満は右側に時刻を置く幅が無いので、2行目へ下ろす */}
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          {player.shortBio && <p className="min-w-0 flex-1 truncate">{player.shortBio}</p>}
          <span className="inline-flex shrink-0 items-center gap-1 md:hidden">
            <Clock3 className="h-3 w-3" aria-hidden />
            <RelativeTime date={player.updatedAt} unit="date" />
          </span>
        </div>
      </div>
      <div className="flex min-w-0 shrink items-center gap-1.5">
        {isFavorite && <FavoriteMark />}
        {/* カードと同じ規則（既定値は出さず、識別に効くタグだけ。md 未満は1個、md 以上は最大3個） */}
        <FeedCardTags player={player} mobileMax={1} />
        <span className="ml-1 inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground max-md:hidden">
          <Clock3 className="h-3 w-3" aria-hidden />
          <RelativeTime date={player.updatedAt} unit="date" />
        </span>
      </div>
    </Link>
  );
}

// ProfileFeedCard と同寸のスケルトン（rounded-xl / p-4 / アバター12x12 / フッター行）。
// 中身の高さは実物（名前 24px + @mcid 16px + ひとこと mt-1 + 16px = 60px、フッター min-h-5 = 20px）に合わせる
export function ProfileFeedCardSkeleton({ surface = "background" }: { surface?: "background" | "card" } = {}) {
  return (
    <div className={cn("rounded-xl border border-border/70 p-4", surface === "card" ? "bg-card" : "bg-background/80")}>
      <div className="flex items-start gap-3">
        <Skeleton className="h-12 w-12 shrink-0 rounded-xl" />
        <div className="flex min-h-12 flex-1 flex-col justify-center">
          <div className="flex h-6 items-center">
            <Skeleton className="h-4 w-32" />
          </div>
          <div className="flex h-4 items-center">
            <Skeleton className="h-3 w-24" />
          </div>
          <div className="mt-1 flex h-4 items-center">
            <Skeleton className="h-3 w-40" />
          </div>
        </div>
      </div>
      <div className="mt-3 flex min-h-5 items-center justify-between gap-2 border-t border-border/60 pt-3">
        <Skeleton className="h-5 w-16 rounded-full" />
        <Skeleton className="h-3 w-12" />
      </div>
    </div>
  );
}
