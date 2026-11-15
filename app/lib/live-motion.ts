/** ライブ欄の動き（区間到達・並べ替え）の純粋な計算部分。DOM には触れない */

export interface LivePoint {
  x: number;
  y: number;
}

/** 区間が増えたとき、新しく到達した段（1始まりの段 n）を返す。増えていなければ空 */
export function reachedStages(prev: number, next: number, total: number): number[] {
  const from = Math.max(prev, 0) + 1;
  const to = Math.min(next, total);
  const out: number[] = [];
  for (let n = from; n <= to; n++) out.push(n);
  return out;
}

/**
 * 今回の更新で「完走に到達した」か。最後の段（Finish）へ増えたとき、または finished が false→true になったとき。
 * PaceMan のランは credits が Finish（最後の段）に対応する（isFinishedRun と liveSortKey の深さは一致する）ので
 * 通常は両方が同時に成り立つが、どちらか一方だけ先に変わる更新でも取りこぼさないよう OR にしている
 */
export function reachedFinish(
  prev: { stage: number; finished: boolean },
  next: { stage: number; finished: boolean },
  total: number,
): boolean {
  return (next.stage >= total && prev.stage < total) || (next.finished && !prev.finished);
}

export interface LiveFlipResult {
  /** 前回と位置がずれたカード（dx/dy は「前回 − 今回」。transform の開始値にそのまま使う） */
  moves: { id: string; dx: number; dy: number }[];
  /** 今回新しく現れたカード */
  entered: string[];
}

/**
 * 前回と今回の描画位置から FLIP の差を出す。前回が空（初回表示・0件からの切り替え）は何も動かさない。
 * 前回の位置が無い id は新規、差が minPx 未満の id は動かさない
 */
export function computeLiveFlip(
  prev: ReadonlyMap<string, LivePoint>,
  next: ReadonlyMap<string, LivePoint>,
  minPx = 1,
): LiveFlipResult {
  const moves: LiveFlipResult["moves"] = [];
  const entered: string[] = [];
  if (prev.size === 0) return { moves, entered };
  for (const [id, to] of next) {
    const from = prev.get(id);
    if (!from) {
      entered.push(id);
      continue;
    }
    const dx = from.x - to.x;
    const dy = from.y - to.y;
    if (Math.abs(dx) >= minPx || Math.abs(dy) >= minPx) moves.push({ id, dx, dy });
  }
  return { moves, entered };
}

/** 動きの共通値（帯の伸び・並べ替えの滑りは同じイージング） */
export const LIVE_EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

/** reduced-motion の設定か。WAAPI には app.css の全体ルールが効かないため JS 側で見る（SSR では false） */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
