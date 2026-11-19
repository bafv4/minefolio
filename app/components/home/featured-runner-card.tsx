import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import { PageSection } from "@/components/page-section";
import { useT, useLocale } from "@/hooks/use-locale";
import type { Translator } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { getLocalizedDisplayName } from "@/lib/slug";
import { categoryLabel, isCategoryKey, isVersionKey, versionLabel } from "@/lib/playstyle";
import { getActionLabel, getKeyLabel } from "@/lib/keybindings";
import { formatClock } from "@/lib/home-format";
import type { FeaturedReason, FeaturedRunner } from "@/lib/home-featured";
import { toast } from "sonner";
import { ArrowRight, Search, Sparkles, Shuffle, Trophy, Video, TrendingUp } from "lucide-react";

/** 主要操作・ホットバーのキーチップの見た目（クラス共通化はしない。見た目は ui.md「キーバッジ」と同系統） */
const KEY_CHIP_CLASS =
  "inline-flex h-7 min-w-7 max-w-full items-center justify-center rounded border-2 border-border/50 bg-secondary/50 px-1 font-mono text-xs font-semibold text-muted-foreground @[24rem]:px-1.5 @[24rem]:text-sm @[35rem]:px-1 @[35rem]:text-xs";
const HOTBAR_CHIP_CLASS =
  "inline-flex h-7 min-w-7 max-w-full items-center justify-center rounded border-2 border-border/50 bg-secondary/50 px-1 font-mono text-sm @[35rem]:text-xs font-semibold text-muted-foreground";

/** 感度の行（「感度 40% · 振り向き 31.5 cm/180°」。ラベルは sans の muted、値は mono。感度が無ければ何も出さない） */
export function FeaturedSensitivity({ runner, className }: { runner: FeaturedRunner; className?: string }) {
  const t = useT();
  if (runner.sensitivityPercent == null) return null;
  return (
    <p className={cn("text-xs text-muted-foreground", className)}>
      <span>{t("home.featuredSensitivityLabel")}</span>{" "}
      <span className="font-mono tabular-nums">{runner.sensitivityPercent}%</span>
      {runner.cm180 != null && (
        <>
          <span aria-hidden="true"> · </span>
          <span>{t("home.featuredTurnLabel")}</span>{" "}
          <span className="font-mono tabular-nums">{runner.cm180.toFixed(1)} cm/180°</span>
        </>
      )}
    </p>
  );
}

/**
 * メインカテゴリの自己ベスト（公式記録のみ。出どころは home-featured.server.ts の hydrateRunners）。
 * PB があれば「{カテゴリ}の自己ベスト」＋時刻（ranked 以外はバージョンを添える）。
 * PB が無くカテゴリだけなら「メイン: カテゴリ」（バージョンがあれば括弧書き）、どちらも無ければ何も出さない。
 * flex の子として置く1要素
 */
export function FeaturedCategoryPb({ runner }: { runner: FeaturedRunner }) {
  const t = useT();
  const category = isCategoryKey(runner.mainCategory) ? categoryLabel(t, runner.mainCategory) : null;
  const version =
    runner.mainCategory !== "ranked" && isVersionKey(runner.mainVersion) ? versionLabel(runner.mainVersion) : null;
  if (runner.pbMs != null && category) {
    return (
      <p className="flex flex-wrap items-baseline gap-x-1.5">
        <span className="text-xs text-muted-foreground">
          {t("home.featuredPb", { category: version ? `${category} ${version}` : category })}
        </span>
        <span className="font-mono text-sm font-semibold tabular-nums">{formatClock(runner.pbMs)}</span>
      </p>
    );
  }
  if (category) {
    return (
      <p className="text-xs text-muted-foreground">
        {t("home.featuredMainCategory", { category: version ? `${category} (${version})` : category })}
      </p>
    );
  }
  return null;
}

function reasonText(t: Translator, reason: FeaturedReason): string {
  switch (reason.type) {
    case "speedruncom":
    {
      const time = formatClock(reason.timeMs);
      const verified = reason.status === "verified";
      if (reason.categoryName) {
        const key = verified ? "home.featuredReasonSpeedruncomVerifiedCategory" : "home.featuredReasonSpeedruncomCategory";
        return t(key, { category: reason.categoryName, time });
      }
      return t(verified ? "home.featuredReasonSpeedruncomVerified" : "home.featuredReasonSpeedruncom", { time });
    }
    case "rankedPb":
      return t("home.featuredReasonRankedPb", { time: formatClock(reason.timeMs) });
    case "eloGain":
      return t("home.featuredReasonEloGain", { gain: reason.gain });
    case "video":
      return t("home.featuredReasonVideo");
  }
}

function ReasonIcon({ reason }: { reason: FeaturedReason }) {
  const cls = "mt-px h-3.5 w-3.5 shrink-0 text-primary"; // mt-px: 2行に折り返す理由文の1行目（text-xs = 16px）に揃える
  if (reason.type === "eloGain") return <TrendingUp className={cls} aria-hidden="true" />;
  if (reason.type === "video") return <Video className={cls} aria-hidden="true" />;
  return <Trophy className={cls} aria-hidden="true" />;
}

/**
 * 主要操作のキーチップ。見た目は既存の KeyBadge 系（`.claude/rules/ui.md`「キーバッジ」）と同じクラスだが、
 * KeyBadge の import が item-icon（アイテム名辞書チャンク）と virtual-keyboard をホームの初期表示へ
 * 引き込むため、指割り当て色・ツールチップを省いたホーム専用の軽量版にしている。
 * 物理キーの位置のみを示す（リマップの有無による強調はしない）。
 */
function KeyChip({ k }: { k: FeaturedRunner["keys"][number] }) {
  const t = useT();
  const label = getKeyLabel(t, k.keyCode);
  return (
    <li className="flex min-w-0 flex-col items-center gap-1">
      {/* 仮想キーボード用の省略名（ｲﾝﾍﾞﾝﾄﾘ / OH 等）ではなく通常の操作名を使う。日本語は語の途中で折らず（break-keep）、列から少しはみ出しても1行のまま中央に置く。英語は空白で折り返す */}
      <span className="break-keep text-center text-[11px] leading-tight text-muted-foreground">
        {getActionLabel(t, k.action)}
      </span>
      <span title={label} className={KEY_CHIP_CLASS}>
        <span className="truncate">{label}</span>
      </span>
    </li>
  );
}

/**
 * ホットバー1〜9のキー行。狭い幅（モバイル・ゲストヒーロー右側）でも1行に収めるため、
 * 9列の等幅グリッド＋チップは min-w-0 で truncate（全文は title）にしている。割り当ての無いスロットは「-」。
 */
function HotbarRow({ hotbar }: { hotbar: FeaturedRunner["hotbar"] }) {
  const t = useT();
  const bySlot = new Map(hotbar.map((k) => [k.action, k]));
  return (
    <div>
      <p className="mb-1 text-[11px] text-muted-foreground">{t("home.featuredHotbarLabel")}</p>
      <ul aria-label={t("home.featuredHotbarLabel")} className="grid grid-cols-9 gap-1">
        {Array.from({ length: 9 }, (_, i) => {
          const k = bySlot.get(`hotbar${i + 1}` as FeaturedRunner["hotbar"][number]["action"]);
          const label = k ? getKeyLabel(t, k.keyCode) : "-";
          const title = k ? label : undefined;
          return (
            <li key={i} className="flex min-w-0 flex-col items-center">
              <span title={title} className={cn(HOTBAR_CHIP_CLASS, !k && "opacity-50")}>
                <span className="truncate">{label}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * 注目の走者を回す処理（ログイン時のワイド版 FeaturedRunnerCard とゲストヒーロー GuestHero で共有）。
 * 候補（直近7日の出来事・点数順）を「別の走者」で順に切り替え、出し切った後・候補が無い日は
 * /api/home-featured から揃った公開プロフィールをランダムに1人取得する（表示中と直前の人は除外）。
 * SSR の初期表示は常に「候補の1位、または日替わりの人」。クライアント乱数は初期描画に使わない。
 * 読み上げ文は `announce`（呼び出し側が sr-only の aria-live 要素に入れる）。
 */
export function useFeaturedRotation(candidates: FeaturedRunner[], initial: FeaturedRunner | null) {
  const t = useT();
  const locale = useLocale();
  const navigate = useNavigate();
  const [current, setCurrent] = useState<FeaturedRunner | null>(candidates[0] ?? initial);
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [announce, setAnnounce] = useState("");
  const prevSlugRef = useRef<string | null>(null);

  const show = (runner: FeaturedRunner) => {
    prevSlugRef.current = current?.slug ?? null;
    setCurrent(runner);
    setAnnounce(t("home.featuredAnnounce", { name: getLocalizedDisplayName(runner, locale) }));
  };

  const handleNext = async () => {
    if (loading) return;
    // 1) 直近7日の出来事の候補を点数順に順番に出す
    if (candidateIndex + 1 < candidates.length) {
      setCandidateIndex(candidateIndex + 1);
      show(candidates[candidateIndex + 1]);
      return;
    }
    // 2) 出し切った後・候補が無い日は、揃った公開プロフィールからランダムに別の人を取得する
    setLoading(true);
    try {
      const exclude = [current?.slug, prevSlugRef.current].filter((s): s is string => !!s);
      const res = await fetch(`/api/home-featured?exclude=${encodeURIComponent(exclude.join(","))}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { runner: FeaturedRunner | null };
      // 母集団が尽きた場合は表示を据え置く
      if (data.runner) {
        setCandidateIndex(candidates.length); // 候補は出し切った扱い（以降は常にランダム）
        show(data.runner);
      } else {
        toast(t("home.featuredNoMore"));
      }
    } catch (error) {
      console.error("Failed to fetch featured runner:", error);
      toast.error(t("home.featuredFetchFailed"));
    } finally {
      setLoading(false);
    }
  };

  // 「別の走者」を Alt(Option) キー押下中にクリックすると隠しページへ（旧「ランダムで見る」から移設）。
  // Shift(新規ウィンドウ)/Ctrl・Cmd(新規タブ)やテキスト選択と競合しない Alt を使う
  const handleClick = (e: React.MouseEvent) => {
    if (e.altKey) {
      e.preventDefault();
      navigate("/secret-grid");
      return;
    }
    void handleNext();
  };

  return { current, loading, announce, handleClick };
}

/** 「別の走者」ボタン */
export function FeaturedNextButton({
  onClick,
  loading,
}: {
  onClick: (e: React.MouseEvent) => void;
  loading: boolean;
}) {
  const t = useT();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={loading}
      className="relative z-10 min-h-11 shrink-0 sm:min-h-8"
    >
      <Shuffle className="mr-1.5 h-4 w-4" aria-hidden="true" />
      {t("home.featuredNext")}
    </Button>
  );
}

/** 注目の理由の行（日替わり・ランダムの人は理由が無いので行ごと出さない）。審査中の申請へのリンクを含む */
export function FeaturedReasonRow({ runner }: { runner: FeaturedRunner }) {
  const t = useT();
  if (!runner.reason) return null;
  return (
    <div className="flex flex-wrap items-start gap-x-3 gap-y-1 text-xs font-medium text-primary">
      {runner.reason && (
        <>
          {/* 何の記録か（カテゴリ・タイム）が切れないよう、1行で切らず2行まで折り返す。リンクは収まらなければ下段へ回る */}
          <p className="flex min-w-0 items-start gap-1.5">
            <ReasonIcon reason={runner.reason} />
            <span className="line-clamp-2">
              <span className="mr-1.5 font-normal text-muted-foreground">{t("home.featuredReasonLabel")}</span>
              {reasonText(t, runner.reason)}
            </span>
          </p>
          {/* 審査中の申請は記録タブに出ないため、審査中の記録を表示した状態のプロフィールへ誘導する。
              カード全面のオーバーレイリンクより手前（z-10）。縦に余白を足してタップ領域を約44pxにする */}
          {runner.reason.type === "speedruncom" && runner.reason.status === "new" && (
            <Link
              to={`/player/${runner.slug}?tab=stats&srcPending=1`}
              prefetch="intent"
              className="relative z-10 -my-3.5 ml-auto inline-flex shrink-0 items-center gap-0.5 rounded-sm py-3.5 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("home.featuredPendingLink")}
              <ArrowRight className="h-3 w-3" aria-hidden="true" />
            </Link>
          )}
        </>
      )}
    </div>
  );
}

/**
 * 主要9操作とホットバー1〜9のキー。キー配置が無い人はそれぞれ行ごと出さない。
 * 列数は自身の幅（@container）で決まる。余白・罫線などの外側の指定は className で渡す
 */
export function FeaturedKeys({ runner, className }: { runner: FeaturedRunner; className?: string }) {
  const t = useT();
  if (runner.keys.length === 0 && runner.hotbar.length === 0) return null;
  return (
    <div className={cn("@container space-y-3", className)}>
      {runner.keys.length > 0 && (
        <ul
          aria-label={t("home.featuredKeysLabel")}
          // 列数はキー領域の幅で決める。モバイル（約19rem＝310px）も4列で 4+4 に揃える（チップは @[24rem] 未満で px-1・text-xs にして「左Shift」等を収める）。9列（ホットバーと列を揃える）には約35rem 要る
          className="grid grid-cols-4 gap-x-1 gap-y-2.5 @[35rem]:grid-cols-9"
        >
          {runner.keys.map((k) => (
            <KeyChip key={k.action} k={k} />
          ))}
        </ul>
      )}
      {/* ホットバーが無い走者も9スロット（未割り当ては「-」）で描き、切り替え時にカードの高さが跳ねないようにする */}
      <HotbarRow hotbar={runner.hotbar} />
      {/* 操作設定一覧への動線。ワイドカードではカード全面のオーバーレイリンクより手前（z-10）。縦に余白を足してタップ領域を約44pxにする */}
      <div className="flex justify-end">
        <Link
          to="/keybindings"
          prefetch="intent"
          className="relative z-10 -my-3 inline-flex items-center gap-0.5 rounded-sm py-3.5 text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("home.featuredSeeAllKeybindings")}
          <ArrowRight className="h-3 w-3" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}

/**
 * ログイン時の「注目の走者」（ページ幅の大型パネル。ホームの「プロフィール」欄の上）。
 * ゲストのヒーローは GuestHero が同じ hook・部品を使って描く。
 */
export function FeaturedRunnerCard({
  candidates,
  initial,
}: {
  candidates: FeaturedRunner[];
  initial: FeaturedRunner | null;
}) {
  const t = useT();
  const locale = useLocale();
  const { current, loading, announce, handleClick } = useFeaturedRotation(candidates, initial);
  const nextButton = <FeaturedNextButton onClick={handleClick} loading={loading} />;

  if (!current) {
    // 候補も日替わりも無い（揃った公開プロフィールが無い）: 大型パネルにせず、ほかの欄と同じ欄枠＋控えめな空状態。
    // 「別の走者」は取得できる人がいないので出さず、走者を探す（/browse）への導線にする。
    // 見出しはカスタマイズのダイアログ（home-sections の featured）と同じ「注目の走者」
    return (
      <PageSection
        id="home-featured"
        icon={<Sparkles className="h-5 w-5 text-primary" aria-hidden="true" />}
        title={t("home.featuredTitle")}
      >
        {/* EmptyState の compact は横並び固定で、375px では見出しが詰まる。sm 未満は default（縦積み）に切り替え、
            両方を描いて CSS で出し分ける */}
        {(["default", "compact"] as const).map((size) => (
          <div key={size} className={size === "compact" ? "max-sm:hidden" : "sm:hidden"}>
            <EmptyState
              size={size}
              icon={<Sparkles className={size === "compact" ? "h-5 w-5" : "h-8 w-8"} />}
              title={t("home.featuredEmptyTitle")}
              description={t("home.featuredEmptyDescription")}
              action={
                <Button asChild variant="outline" size="sm" className="min-h-11 sm:min-h-8">
                  <Link to="/browse" prefetch="intent">
                    <Search className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    {t("home.ctaBrowse")}
                  </Link>
                </Button>
              }
            />
          </div>
        ))}
      </PageSection>
    );
  }

  const name = getLocalizedDisplayName(current, locale);

  return (
    <section
      aria-labelledby="home-featured-heading"
      // ページ幅の大型パネル（おかえりバーと同じ系統）。浮かせず、ホバーは枠色だけ
      className="group relative rounded-2xl border border-border/70 bg-card/70 p-5 transition-all hover:border-primary/40 motion-reduce:transition-none sm:p-6"
    >
      <div className="flex items-center justify-between gap-3">
        {/* 他の欄（PageSection）と同じ見出し: アイコン（丸背景チップ無し） + h2 text-xl font-bold */}
        <div className="flex min-w-0 items-center gap-x-2 sm:gap-x-3">
          <Sparkles className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <h2 id="home-featured-heading" className="min-w-0 truncate text-xl font-bold">
            {t("home.featuredTitle")}
          </h2>
        </div>
        {nextButton}
      </div>

      {/* 高さを保つため、取得中は中身を薄くするだけで差し替えない */}
      <div aria-busy={loading} className={cn("mt-3 space-y-3 transition-opacity", loading && "opacity-50")}>
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-8">
          {/* 人のブロック: アバター＋名前の下に理由行（名前より後に読ませる）。lg 未満ではこの直下にキーが続く */}
          <div className="min-w-0 space-y-3">
            <div className="flex items-center gap-4">
              <MinecraftAvatar
                uuid={current.uuid}
                skinUrl={current.customSkinUrl}
                mcid={current.mcid}
                size={64}
                className="shrink-0 rounded-xl"
              />
              <div className="min-w-0 flex-1 space-y-2">
                <p className="truncate text-lg font-bold leading-snug">
                  <Link
                    to={`/player/${current.slug}`}
                    prefetch="intent"
                    className="rounded-sm after:absolute after:inset-0 after:z-0 after:rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {name}
                  </Link>
                </p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <FeaturedCategoryPb runner={current} />
                  <FeaturedSensitivity runner={current} />
                </div>
              </div>
            </div>
            <FeaturedReasonRow runner={current} />
          </div>

          <FeaturedKeys
            runner={current}
            className="mt-3 border-t border-border/60 pt-3 lg:mt-0 lg:w-[38rem] lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8"
          />
        </div>
      </div>

      {/* 切り替え後に新しい走者の名前を読み上げる */}
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
    </section>
  );
}
