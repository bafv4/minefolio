// 仮想キーボード（VirtualKeyboard / VirtualMouse / VirtualNumpad）の矢印キー移動の行き先を求める。
// DOM に依存しない純粋関数。呼び出し側は keydown 時に各キーの getBoundingClientRect を集めて渡す。

export type KeyRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type KeyGridItem = {
  id: string;
  rect: KeyRect;
};

export type KeyGridDirection = "left" | "right" | "up" | "down" | "home" | "end";

/** keydown の `event.key` から移動方向を引く（対象外のキーは undefined） */
export function keyGridDirectionForKey(key: string): KeyGridDirection | undefined {
  switch (key) {
    case "ArrowLeft":
      return "left";
    case "ArrowRight":
      return "right";
    case "ArrowUp":
      return "up";
    case "ArrowDown":
      return "down";
    case "Home":
      return "home";
    case "End":
      return "end";
    default:
      return undefined;
  }
}

const centerX = (r: KeyRect) => r.left + r.width / 2;
const centerY = (r: KeyRect) => r.top + r.height / 2;

/**
 * 2つのキーが同じ段か。片方の中心 y が相手の縦の範囲に入れば同じ段とする
 * （2段ぶんの高さのキー〔JIS Enter・テンキーの + / Enter・マウスの左中右〕は、両方の段に属する）。
 */
function sameRow(a: KeyRect, b: KeyRect): boolean {
  const ay = centerY(a);
  const by = centerY(b);
  return (ay >= b.top && ay <= b.top + b.height) || (by >= a.top && by <= a.top + a.height);
}

// 横方向の中心がほぼ同じとみなす許容量（px）
const EPSILON = 0.5;

/**
 * 現在のキーから、指定方向の行き先のキー id を返す。行き先が無ければ null。
 *
 * - left / right: 同じ段で、その方向にある中心 x がいちばん近いキー（同距離なら中心 y が近い方）
 * - up / down: その方向にある（同じ段でない）キーのうち、いちばん近い段の、中心 x がいちばん近いキー。
 *   キーがまばらでも届くよう、隣の段だけを見ずに「キーがある最も近い段」を選ぶ
 * - home / end: 同じ段の最初／最後のキー（すでにそこなら null）
 */
export function findNextKeyInGrid(
  items: readonly KeyGridItem[],
  currentId: string,
  direction: KeyGridDirection,
): string | null {
  const current = items.find((i) => i.id === currentId);
  if (!current) return null;
  const cr = current.rect;
  const cx = centerX(cr);
  const cy = centerY(cr);
  const others = items.filter((i) => i.id !== currentId);

  const pickClosest = (
    candidates: KeyGridItem[],
    primary: (r: KeyRect) => number,
    secondary: (r: KeyRect) => number,
  ): KeyGridItem | undefined => {
    let best: KeyGridItem | undefined;
    for (const c of candidates) {
      if (!best) {
        best = c;
        continue;
      }
      const p = primary(c.rect) - primary(best.rect);
      if (p < -EPSILON || (Math.abs(p) <= EPSILON && secondary(c.rect) < secondary(best.rect))) {
        best = c;
      }
    }
    return best;
  };

  const dx = (r: KeyRect) => Math.abs(centerX(r) - cx);
  const dy = (r: KeyRect) => Math.abs(centerY(r) - cy);

  if (direction === "left" || direction === "right") {
    const sign = direction === "right" ? 1 : -1;
    const candidates = others.filter(
      (o) => sameRow(cr, o.rect) && (centerX(o.rect) - cx) * sign > EPSILON,
    );
    return pickClosest(candidates, dx, dy)?.id ?? null;
  }

  if (direction === "home" || direction === "end") {
    const row = items.filter((o) => o.id === currentId || sameRow(cr, o.rect));
    const sign = direction === "end" ? -1 : 1;
    const target = pickClosest(row, (r) => centerX(r) * sign, dy);
    if (!target || target.id === currentId) return null;
    return target.id;
  }

  const sign = direction === "down" ? 1 : -1;
  const candidates = others.filter(
    (o) => !sameRow(cr, o.rect) && (centerY(o.rect) - cy) * sign > 0,
  );
  if (candidates.length === 0) return null;
  // いちばん近い段の代表（縦の距離が最小のキー）を決め、その段に属する候補から x が近いキーを選ぶ
  const nearest = pickClosest(candidates, dy, dx)!;
  const row = candidates.filter((o) => o.id === nearest.id || sameRow(nearest.rect, o.rect));
  return pickClosest(row, dx, dy)?.id ?? null;
}
