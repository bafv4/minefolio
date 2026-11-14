import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import { useT, useLocale } from "@/hooks/use-locale";
import type { Translator } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { getLocalizedDisplayName } from "@/lib/slug";
import { categoryLabel, isCategoryKey } from "@/lib/playstyle";
import { getActionLabel, getKeyLabel } from "@/lib/keybindings";
import { formatClock } from "@/lib/home-format";
import type { FeaturedReason, FeaturedRunner } from "@/lib/home-featured";
import { ArrowRight, Sparkles, Shuffle, Trophy, Video, TrendingUp } from "lucide-react";

/** 主要操作・ホットバーのキーチップの見た目（クラス共通化はしない。見た目は ui.md「キーバッジ」と同系統） */
const KEY_CHIP_CLASS =
  "inline-flex h-7 min-w-7 max-w-full items-center justify-center rounded border-2 border-border/50 bg-secondary/50 px-1.5 font-mono text-sm font-semibold text-muted-foreground @[35rem]:px-1 @[35rem]:text-xs";
const HOTBAR_CHIP_CLASS =
  "inline-flex h-7 min-w-7 max-w-full items-center justify-center rounded border-2 border-border/50 bg-secondary/50 px-1 font-mono text-sm @[35rem]:text-xs font-semibold text-muted-foreground";

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
      {/* 仮想キーボード用の省略名（ｲﾝﾍﾞﾝﾄﾘ / OH 等）ではなく通常の操作名を使う。列幅に収まらなければ切らずに折り返す */}
      <span className="max-w-full break-words text-center text-[10px] leading-tight text-muted-foreground">
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
      <p className="mb-1 text-[10px] text-muted-foreground">{t("home.featuredHotbarLabel")}</p>
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
 * ゲスト向けヒーロー右側の「注目の走者」カード。
 * 候補（直近7日の出来事・点数順）を「別の走者」で順に切り替え、出し切った後・候補が無い日は
 * /api/home-featured から揃った公開プロフィールをランダムに1人取得する（表示中と直前の人は除外）。
 * SSR の初期表示は常に「候補の1位、または日替わりの人」。クライアント乱数は初期描画に使わない。
 */
export function FeaturedRunnerCard({
  candidates,
  initial,
  wide = false,
}: {
  candidates: FeaturedRunner[];
  initial: FeaturedRunner | null;
  /** ページ幅いっぱいに置くとき（ログイン時）。lg 以上で走者情報とキーを横並びにし、キーが間延びしないようにする */
  wide?: boolean;
}) {
  const t = useT();
  const locale = useLocale();
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

  const navigate = useNavigate();

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
      }
    } catch (error) {
      console.error("Failed to fetch featured runner:", error);
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

  const nextButton = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleClick}
      disabled={loading}
      className="relative z-10 min-h-11 shrink-0 sm:min-h-8"
    >
      <Shuffle className="mr-1.5 h-4 w-4" aria-hidden="true" />
      {t("home.featuredNext")}
    </Button>
  );

  if (!current) {
    // 候補も日替わりも無い（揃った公開プロフィールが無い）: プロフィールで見られるものの静的な説明
    return (
      <section aria-labelledby="home-featured-heading" className="rounded-2xl border border-border/70 bg-background/80 p-5">
        <h2 id="home-featured-heading" className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
          {t("home.featuredEmptyTitle")}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">{t("home.featuredEmptyDescription")}</p>
        {nextButton}
      </section>
    );
  }

  const name = getLocalizedDisplayName(current, locale);
  const sensitivity =
    current.sensitivityPercent != null
      ? current.cm180 != null
        ? `${current.sensitivityPercent}% · ${current.cm180.toFixed(1)} cm/180°`
        : `${current.sensitivityPercent}%`
      : null;

  return (
    <section
      aria-labelledby="home-featured-heading"
      className="group relative rounded-2xl border border-border/70 bg-background/80 p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    >
      <div className="flex items-center justify-between gap-3">
        {wide ? (
          // ログイン時（ページ幅いっぱい）は他の欄（HomeSection）と同じ見出し: アイコンチップ + h2 text-xl font-bold
          <div className="flex min-w-0 items-center gap-3">
            <div className="rounded-xl bg-primary/10 p-2">
              <Sparkles className="h-5 w-5 text-primary" aria-hidden="true" />
            </div>
            <h2 id="home-featured-heading" className="text-xl font-bold">
              {t("home.featuredTitle")}
            </h2>
          </div>
        ) : (
          // ゲストのヒーロー内は小見出しのまま
          <h2 id="home-featured-heading" className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
            {t("home.featuredTitle")}
          </h2>
        )}
        {nextButton}
      </div>

      {/* 高さを保つため、取得中は中身を薄くするだけで差し替えない */}
      <div aria-busy={loading} className={cn("mt-3 space-y-3 transition-opacity", loading && "opacity-50")}>
        {/* 注目の理由（日替わり・ランダムの人は出さないが、行の高さは保つ） */}
        <div className="flex min-h-5 flex-wrap items-start gap-x-3 gap-y-1 text-xs font-medium text-primary">
          {current.reason && (
            <>
              {/* 何の記録か（カテゴリ・タイム）が切れないよう、1行で切らず2行まで折り返す。リンクは収まらなければ下段へ回る */}
              <p className="flex min-w-0 items-start gap-1.5">
                <ReasonIcon reason={current.reason} />
                <span className="line-clamp-2">{reasonText(t, current.reason)}</span>
              </p>
              {/* 審査中の申請は記録タブに出ないため、審査中の記録を表示した状態のプロフィールへ誘導する。
                  カード全面のオーバーレイリンクより手前（z-10）。縦に余白を足してタップ領域を約44pxにする */}
              {current.reason.type === "speedruncom" && current.reason.status === "new" && (
                <Link
                  to={`/player/${current.slug}?tab=stats&srcPending=1`}
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

        <div className={cn(wide && "lg:grid lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-8")}>
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
                {isCategoryKey(current.mainCategory) && (
                  <Badge variant="secondary" className="shrink-0 rounded-full px-2 py-0.5 text-[11px]">
                    {categoryLabel(t, current.mainCategory)}
                  </Badge>
                )}
                {current.pbMs != null && (
                  <span className="font-mono text-sm font-semibold tabular-nums">
                    <span className="mr-1 text-[11px] font-normal text-muted-foreground">PB</span>
                    {formatClock(current.pbMs)}
                  </span>
                )}
                {sensitivity && (
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">{sensitivity}</span>
                )}
              </div>
            </div>
          </div>

          {/* 主要9操作とホットバー1〜9のキー。キー配置が無い人はそれぞれ行ごと出さない */}
          {(current.keys.length > 0 || current.hotbar.length > 0) && (
            <div
              className={cn(
                "@container mt-3 space-y-3 border-t border-border/60 pt-3",
                wide && "lg:mt-0 lg:w-[38rem] lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8",
              )}
            >
              {current.keys.length > 0 && (
                <ul
                  aria-label={t("home.featuredKeysLabel")}
                  // 列数はカード（キー領域）の幅で決める。9列（ホットバーと列を揃える）には約35rem 要る
                  className="grid grid-cols-3 gap-x-1 gap-y-2.5 @[26rem]:grid-cols-5 @[35rem]:grid-cols-9"
                >
                  {current.keys.map((k) => (
                    <KeyChip key={k.action} k={k} />
                  ))}
                </ul>
              )}
              {current.hotbar.length > 0 && <HotbarRow hotbar={current.hotbar} />}
            </div>
          )}
        </div>
      </div>

      {/* 切り替え後に新しい走者の名前を読み上げる */}
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
    </section>
  );
}
