import { useCallback, useState } from "react";
import { Link } from "react-router";
import { PaceTimelineModal } from "@/components/pace-timeline-modal";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import { useT, useLocale } from "@/hooks/use-locale";
import { pickDisplayName } from "@/lib/slug";
import { formatClock } from "@/lib/home-format";
import { formatRelativeTimeInMinutes } from "@/lib/relative-time";
import type { FavoriteActivityItem } from "@/lib/home-favorite-activity.server";
import { BookOpen, History, Keyboard, Layers, Mouse, Package, Play, Send, TrendingUp, Trophy, UserRound } from "lucide-react";

const KIND_ICON = {
  pace: History,
  video: Play,
  guide: BookOpen,
  profile: UserRound,
  rankTierUp: TrendingUp,
  rankedPb: Trophy,
  srcSubmit: Send,
  settings: Keyboard,
} as const;

/** 操作設定の変更は変更の種類でアイコンを分ける */
const SETTINGS_ICON = {
  device: Mouse,
  game_setting: Package,
  preset_switch: Layers,
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/** 日付だけの出来事の相対表記（UTC 日単位: 今日 / 昨日 / N日前） */
function dateOnlyRelative(t: ReturnType<typeof useT>, at: number): string {
  const days = Math.max(0, Math.floor(Date.now() / DAY_MS) - Math.floor(at / DAY_MS));
  if (days === 0) return t("relativeDate.today");
  if (days === 1) return t("relativeDate.yesterday");
  return t("relativeDate.daysAgo", { count: days });
}

/** 動き 1 件の文（ホームの欄と /favorites/activity で共用） */
export function useFavoriteActivitySentence() {
  const t = useT();
  const locale = useLocale();
  return useCallback(
    (item: FavoriteActivityItem): string => {
      const name = pickDisplayName(item, locale) || item.mcid || item.slug;
      switch (item.kind) {
        case "pace":
          // 区間名（英語の PaceMan 語彙）を日本語の文に埋め込むと不自然なので、ラベル: 値 の形にする。完走だけは文で言う
          return item.label === "Finish"
            ? t("home.favPaceFinish", { name, time: formatClock(item.timeMs ?? 0) })
            : t("home.favPace", { name, split: item.label ?? "", time: formatClock(item.timeMs ?? 0) });
        case "video":
          return t("home.favVideo", { name, title: item.label ?? "" });
        case "guide":
          return t("home.favGuide", { name, title: item.label ?? "" });
        case "profile":
          return t("home.favProfile", { name });
        case "rankTierUp":
          return t("home.favTierUp", { name, tier: item.label ?? "" });
        case "rankedPb":
          return t("home.favRankedPb", { name, time: formatClock(item.timeMs ?? 0) });
        case "srcSubmit":
          return item.label
            ? t("home.favSrcSubmit", { name, category: item.label, time: formatClock(item.timeMs ?? 0) })
            : t("home.favSrcSubmitNoCategory", { name, time: formatClock(item.timeMs ?? 0) });
        case "settings":
          switch (item.label) {
            case "device":
              return t("home.favSettingsDevice", { name });
            case "game_setting":
              return t("home.favSettingsGame", { name });
            case "remap":
              return t("home.favSettingsRemap", { name });
            case "preset_switch":
              return t("home.favSettingsPreset", { name });
            default:
              return t("home.favSettingsKeybinding", { name });
          }
      }
    },
    [t, locale],
  );
}

/** タイムラインの 1 行（アバター・種別アイコン・文・時刻。行全体が該当ページへのリンク。PaceMan のペースだけはタイムラインモーダルを開くボタンで、プロフィールへはアバターがリンクになる） */
export function FavoriteActivityRow({
  item,
  time = "relative",
}: {
  item: FavoriteActivityItem;
  /** relative: 「N分前」/ clock: 時刻（日付見出しの下に並べる一覧向け） */
  time?: "relative" | "clock";
}) {
  const t = useT();
  const locale = useLocale();
  const sentence = useFavoriteActivitySentence();
  const [open, setOpen] = useState(false);
  const Icon =
    item.kind === "settings"
      ? (SETTINGS_ICON[item.label as keyof typeof SETTINGS_ICON] ?? KIND_ICON.settings)
      : KIND_ICON[item.kind];
  const at = new Date(item.at);
  const timeEl = (
    <span className="ml-auto shrink-0 pr-1 text-xs text-muted-foreground" suppressHydrationWarning>
      {item.dateOnly
        ? time === "clock"
          ? " " // 日付のみの出来事は時刻を出さない（行の高さ・揃えは保つ）
          : dateOnlyRelative(t, item.at)
        : time === "clock"
          ? at.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
          : formatRelativeTimeInMinutes(t, at)}
    </span>
  );
  const avatar = (
    <MinecraftAvatar uuid={item.uuid} skinUrl={item.customSkinUrl} mcid={item.mcid} size={36} className="rounded-lg" />
  );

  if (item.kind === "pace" && item.runId != null && item.mcid) {
    // 行全体のクリックでタイムラインモーダルを開く（オーバーレイボタン）。アバターは z-10 でプロフィールへのリンク
    return (
      <div className="relative flex min-h-11 items-center gap-3 rounded-lg px-0 py-1.5 transition-colors hover:bg-muted/50">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-label={`${sentence(item)}: ${t("home.viewTimeline")}`}
          className="absolute inset-0 z-0 cursor-pointer rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Link
          to={item.href}
          prefetch="intent"
          aria-label={pickDisplayName(item, locale) || item.mcid}
          className="relative z-10 shrink-0 rounded-lg bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {avatar}
        </Link>
        <Icon className="pointer-events-none relative h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="pointer-events-none relative min-w-0 flex-1 text-sm leading-snug max-sm:line-clamp-2 sm:truncate">{sentence(item)}</span>
        <span className="pointer-events-none relative ml-auto shrink-0">{timeEl}</span>
        <PaceTimelineModal
          open={open}
          onOpenChange={setOpen}
          mcid={item.mcid}
          runId={item.runId}
          title={pickDisplayName(item, locale) || item.mcid}
        />
      </div>
    );
  }

  return (
    <Link
      to={item.href}
      prefetch="intent"
      className="relative flex min-h-11 items-center gap-3 rounded-lg px-0 py-1.5 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="relative z-10 shrink-0 rounded-lg bg-card">{avatar}</span>
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1 text-sm leading-snug max-sm:line-clamp-2 sm:truncate">{sentence(item)}</span>
      {timeEl}
    </Link>
  );
}

/** 縦タイムラインの枠（アバター列を縦線でつなぐ） */
export const ACTIVITY_TIMELINE_CLASS =
  "relative space-y-1 before:absolute before:bottom-4 before:left-[17px] before:top-4 before:w-px before:bg-border/60";
