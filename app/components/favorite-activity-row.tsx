import { useState } from "react";
import { Link } from "react-router";
import { PaceTimelineModal } from "@/components/pace-timeline-modal";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import { useT, useLocale } from "@/hooks/use-locale";
import { getLocalizedDisplayName } from "@/lib/slug";
import { DAY_MS } from "@/lib/home-favorite-activity-shared";
import { cn } from "@/lib/utils";
import type { Translator } from "@/lib/messages";
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

/** 日付だけの出来事の相対表記（UTC 日単位: 今日 / 昨日 / N日前） */
function dateOnlyRelative(t: Translator, at: number): string {
  const days = Math.max(0, Math.floor(Date.now() / DAY_MS) - Math.floor(at / DAY_MS));
  if (days === 0) return t("relativeDate.today");
  if (days === 1) return t("relativeDate.yesterday");
  return t("relativeDate.daysAgo", { count: days });
}

/**
 * 動き 1 件の文（ホームの欄と /favorites/activity で共用）。name は表示名（解決済み）。
 * mark は結果の値（タイム・ティア）を包む関数。モバイルで値だけを切り詰めから守るため、値の前後を分けて描画する際に使う
 */
function buildSentence(t: Translator, name: string, item: FavoriteActivityItem, mark: (value: string) => string): string {
  const time = () => mark(formatClock(item.timeMs ?? 0));
  switch (item.kind) {
    case "pace":
      // 区間名（英語の PaceMan 語彙）を日本語の文に埋め込むと不自然なので、ラベル: 値 の形にする。完走だけは文で言う
      return item.label === "Finish"
        ? t("home.favPaceFinish", { name, time: time() })
        : t("home.favPace", { name, split: item.label ?? "", time: time() });
    case "video":
      return t("home.favVideo", { name, title: item.label ?? "" });
    case "guide":
      return t("home.favGuide", { name, title: item.label ?? "" });
    case "profile":
      return t("home.favProfile", { name });
    case "rankTierUp":
      return t("home.favTierUp", { name, tier: mark(item.label ?? "") });
    case "rankedPb":
      return t("home.favRankedPb", { name, time: time() });
    case "srcSubmit":
      return item.label
        ? t("home.favSrcSubmit", { name, category: item.label, time: time() })
        : t("home.favSrcSubmitNoCategory", { name, time: time() });
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
}

const VALUE_MARK = "";

/** 文を「値の前 / 値 / 値の後」に分ける。値の無い種別は before のみ */
function favoriteActivityParts(t: Translator, name: string, item: FavoriteActivityItem) {
  const [before, value, after] = buildSentence(t, name, item, (v) => `${VALUE_MARK}${v}${VALUE_MARK}`).split(VALUE_MARK);
  return {
    before: (before ?? "").trim(),
    value: value?.trim() || null,
    after: (after ?? "").trim(),
  };
}

/** 記録系の出来事（Ranked PB・speedrun.com 申請・完走・ティア昇格）は強調し、アイコンも色付けする */
function recordTone(item: FavoriteActivityItem): { icon: string } | null {
  switch (item.kind) {
    case "rankedPb":
      return { icon: "text-gold" };
    case "pace":
      return item.label === "Finish" ? { icon: "text-gold" } : null;
    case "rankTierUp":
      return { icon: "text-success" };
    case "srcSubmit":
      return { icon: "text-info" };
    default:
      return null;
  }
}

/** 行の共通クラス（クリック領域になる行全体。リンク行・ペース行で共用） */
const ROW_CLASS = "relative flex min-h-11 items-center gap-3 rounded-lg py-1.5 transition-colors hover:bg-muted/50";
/** 時刻（右端） */
const TIME_CLASS = "ml-auto shrink-0 pr-1 text-xs text-muted-foreground";

/**
 * 文。値（タイム・ティア）は切り詰めない。モバイルは2行（1行目＝名前と文脈、2行目＝値と述語）、
 * sm 以上は1行で、前（名前・カテゴリ）だけを省略する。
 * 見た目は部品に分けるとアクセシブルネームで語がつながるため、読み上げは sr-only の全文に任せる
 */
function ActivitySentence({
  parts,
  sentence,
  emphasized,
  muted,
  className,
}: {
  parts: ReturnType<typeof favoriteActivityParts>;
  sentence: string;
  emphasized: boolean;
  muted: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex min-w-0 flex-1 flex-col text-sm leading-snug sm:flex-row sm:items-baseline sm:gap-x-1",
        emphasized && "font-medium text-foreground",
        muted && "text-muted-foreground",
        className,
      )}
    >
      <span className="sr-only">{sentence}</span>
      {parts.before && (
        <span aria-hidden="true" className="min-w-0 truncate">
          {parts.before}
        </span>
      )}
      {(parts.value || parts.after) && (
        <span aria-hidden="true" className="flex min-w-0 items-baseline gap-x-1 sm:shrink-0">
          {parts.value && <span className="shrink-0 whitespace-nowrap">{parts.value}</span>}
          {parts.after && <span className="min-w-0 truncate">{parts.after}</span>}
        </span>
      )}
    </span>
  );
}

/** タイムラインの 1 行（アバター・種別アイコン・文・時刻。行全体が該当ページへのリンク。PaceMan のペースだけはどこを押してもタイムラインモーダルを開くボタンで、プロフィールへのリンクはモーダル内に置く） */
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
  const [open, setOpen] = useState(false);
  const name = getLocalizedDisplayName(item, locale);
  const parts = favoriteActivityParts(t, name, item);
  const sentence = buildSentence(t, name, item, (v) => v);
  const record = recordTone(item);
  const muted = item.kind === "profile" || item.kind === "settings";
  const iconClass = cn("h-4 w-4 shrink-0", record ? record.icon : "text-muted-foreground");
  const Icon =
    item.kind === "settings"
      ? (SETTINGS_ICON[item.label as keyof typeof SETTINGS_ICON] ?? KIND_ICON.settings)
      : KIND_ICON[item.kind];
  const at = new Date(item.at);
  const timeText = item.dateOnly
    ? time === "clock"
      ? " " // 日付のみの出来事は時刻を出さない（行の高さ・揃えは保つ）
      : dateOnlyRelative(t, item.at)
    : time === "clock"
      ? at.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
      : formatRelativeTimeInMinutes(t, at);
  const avatar = (
    <MinecraftAvatar uuid={item.uuid} skinUrl={item.customSkinUrl} mcid={item.mcid} size={36} className="rounded-lg" />
  );

  if (item.kind === "pace" && item.runId != null && item.mcid) {
    // 行全体のクリックでタイムラインモーダルを開く（オーバーレイボタン）。アバターは z-10 でプロフィールへのリンク
    return (
      <div className={ROW_CLASS}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-label={`${sentence}: ${t("home.viewTimeline")}`}
          className="absolute inset-0 z-0 cursor-pointer rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <span aria-hidden="true" className="pointer-events-none relative shrink-0 rounded-lg">
          {avatar}
        </span>
        <Icon className={cn(iconClass, "pointer-events-none relative")} aria-hidden="true" />
        <ActivitySentence parts={parts} sentence={sentence} emphasized={!!record} muted={muted} className="pointer-events-none relative" />
        <span className={cn(TIME_CLASS, "pointer-events-none relative")} suppressHydrationWarning>
          {timeText}
        </span>
        <PaceTimelineModal open={open} onOpenChange={setOpen} mcid={item.mcid} runId={item.runId} title={name} profileHref={item.href} />
      </div>
    );
  }

  return (
    <Link
      to={item.href}
      className={cn(ROW_CLASS, "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
    >
      <span className="relative z-10 shrink-0 rounded-lg bg-card">{avatar}</span>
      <Icon className={iconClass} aria-hidden="true" />
      <ActivitySentence parts={parts} sentence={sentence} emphasized={!!record} muted={muted} />
      <span className={TIME_CLASS} suppressHydrationWarning>
        {timeText}
      </span>
    </Link>
  );
}

/** 縦タイムラインの枠（アバター列を縦線でつなぐ） */
export const ACTIVITY_TIMELINE_CLASS =
  "relative space-y-1 before:absolute before:bottom-4 before:left-[17px] before:top-4 before:w-px before:bg-border/60";
