import { useMemo } from "react";
import { PaceManSplitMark } from "@/components/paceman-split-mark";
import { useT } from "@/hooks/use-locale";
import { cn } from "@/lib/utils";
import { LIVE_STAGES, LIVE_STAGE_SPLIT_MARKS, countLiveStages, type LiveSplitEntry } from "@/lib/home-live";

/** sm 未満（375px で 44px 幅）で収まらない区間名だけ短くする。読み上げは sr-only の要約が全名で担う */
const SHORT_NAMES: Partial<Record<(typeof LIVE_STAGES)[number], string>> = {
  Stronghold: "SH",
};

/**
 * ライブ中の走者が「いまどの区間に何人いるか」を示す帯（7段 = 区間進行バーと同じ並び）。
 * 見た目は aria-hidden、読み上げは sr-only の1文（人数の読み上げはライブ欄の件数側が担うので aria-live は付けない）。
 * 誰もいなくても7段を描く。0人の段は人数なし・`bg-muted` のバー。`muted`（欄全体が0人）のときはアイコンとバーだけを弱め、
 * 区間名は muted の文字色のまま残す（帯全体を薄めると文字が 4.5:1 を割るため）。
 * loading（初回取得中）は枠だけで要約を出さない（「0人」と読み上げさせない）。0人のときも要約を出さない（0件の文言は欄の本文が
 * 出し、終了カードが残っているときはカード側が状態を伝えるため、ここで重ねて読ませない）。段数・高さは固定なので更新でレイアウトは跳ねない。
 */
export function LiveSplitStrip({
  entries,
  loading = false,
  muted = false,
}: {
  entries: LiveSplitEntry[];
  loading?: boolean;
  /** 誰もいないときに帯を弱める（7段は残す）。人が来たら呼び出し側が外す */
  muted?: boolean;
}) {
  const t = useT();
  const counts = useMemo(() => countLiveStages(entries), [entries]);
  const total = counts.reduce((a, b) => a + b, 0);

  const summary = LIVE_STAGES.flatMap((name, i) =>
    counts[i] > 0 ? [t("home.liveSplitsItem", { name, count: counts[i] })] : [],
  ).join(t("home.liveSplitsSeparator"));

  return (
    <div>
      {!loading && total > 0 && <p className="sr-only">{t("home.liveSplitsAria", { list: summary })}</p>}
      <div className="grid grid-cols-7 gap-1.5" aria-hidden="true">
        {LIVE_STAGES.map((name, i) => {
          const n = counts[i];
          return (
            <div key={name} className="flex min-w-0 flex-col gap-1.5">
              <div className="flex h-5 items-center gap-0.5">
                {/* ネザーラック系の暗い区間アイコンが dark / ultra-dark の背景に沈むため、淡い地を敷く */}
                <span className={cn("inline-flex shrink-0 rounded bg-foreground/25 p-0.5", n === 0 && (muted ? "opacity-30" : "opacity-50"))}>
                  <PaceManSplitMark timeline={LIVE_STAGE_SPLIT_MARKS[i]} size={16} withLabel={false} className="shrink-0" />
                </span>
                {n > 0 && <span className="text-xs font-semibold tabular-nums">×{n}</span>}
              </div>
              <span className={cn("h-1.5 rounded-full", n > 0 ? "bg-brand" : "bg-muted", muted && "opacity-60")} />
              <span className="truncate text-[11px] text-muted-foreground">
                {SHORT_NAMES[name] ? (
                  <>
                    <span className="sm:hidden">{SHORT_NAMES[name]}</span>
                    <span className="hidden sm:inline">{name}</span>
                  </>
                ) : (
                  name
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
