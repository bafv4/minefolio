import { useMemo } from "react";
import { PaceManSplitMark } from "@/components/paceman-split-mark";
import { useT } from "@/hooks/use-locale";
import { cn } from "@/lib/utils";
import { LIVE_STAGES, LIVE_STAGE_SPLIT_MARKS, countLiveStages, type LiveSplitEntry } from "@/lib/home-live";

/**
 * ライブ中の走者が「いまどの区間に何人いるか」を示す帯（7段 = 区間進行バーと同じ並び）。
 * 見た目は aria-hidden、読み上げは sr-only の1文（人数の読み上げはライブ欄の件数側が担うので aria-live は付けない）。
 * 誰もいなくても7段を描く（高さを常に確保し、人が来た瞬間に下が押し下がらない）。0人の段は人数なし・`bg-muted` のバー。
 * loading（初回取得中）は枠だけで要約を出さない（「0人」と読み上げさせない）。0人のときも要約を出さない（0件の文言は欄の本文が
 * 出し、終了カードが残っているときはカード側が状態を伝えるため、ここで重ねて読ませない）。段数・高さは固定なので更新でレイアウトは跳ねない。
 */
export function LiveSplitStrip({ entries, loading = false }: { entries: LiveSplitEntry[]; loading?: boolean }) {
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
                <span className={cn("inline-flex shrink-0 rounded bg-foreground/15 p-0.5", n === 0 && "opacity-40")}>
                  <PaceManSplitMark timeline={LIVE_STAGE_SPLIT_MARKS[i]} size={16} withLabel={false} className="shrink-0" />
                </span>
                {n > 0 && <span className="text-xs font-semibold tabular-nums">×{n}</span>}
              </div>
              <span className={cn("h-1.5 rounded-full", n > 0 ? "bg-brand" : "bg-muted")} />
              <span className={cn("truncate text-[11px] text-muted-foreground", n === 0 && "hidden sm:block")}>{name}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
