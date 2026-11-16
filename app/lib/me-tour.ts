// /me の初回ツアーの手順定義と、対象要素の解決（DOM に触る部分はここに集めて単体で試せるようにする）。
//
// 対象は `data-me-tour="<名前>"` 属性で示す。見つからない・見えていない対象の手順は飛ばす
// （ただし fallback: "bottom" の手順は、対象が無くても画面下の中央に吹き出しを出す）。

export type MeTourStepId = "sidebar" | "edit" | "save" | "player";

export interface MeTourStepDef {
  id: MeTourStepId;
  /** 優先順に探す data-me-tour の値。最初に「見えている」ものを使う */
  targets: readonly string[];
  /** 対象が見つからなくても出す（画面下の中央に置く） */
  fallback?: "bottom";
}

export const ME_TOUR_STEPS: readonly MeTourStepDef[] = [
  // lg 以上はサイドバーの一覧、lg 未満は一覧が畳まれているので開閉ボタンを指す
  { id: "sidebar", targets: ["sidebar", "sidebar-toggle"] },
  // 各ページが付ける。付いていない画面（/me/edit 以外）では飛ばす
  { id: "edit", targets: ["edit-form"] },
  // 保存バーは変更が無いあいだ aria-hidden なので、通常は画面下の中央を指す
  { id: "save", targets: ["save-bar"], fallback: "bottom" },
  { id: "player", targets: ["identity"] },
];

/** 要素が画面に見えていて、読み上げからも隠れていないか */
export function isTourTargetVisible(el: Element): boolean {
  if (el.getClientRects().length === 0) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  return el.closest('[aria-hidden="true"]') === null;
}

export interface ResolvedTourStep {
  def: MeTourStepDef;
  /** 実際に指す要素（null は画面下の中央） */
  element: HTMLElement | null;
  /** 使われた data-me-tour の値（null は fallback） */
  target: string | null;
}

export function resolveTourSteps(root: ParentNode = document): ResolvedTourStep[] {
  const resolved: ResolvedTourStep[] = [];
  for (const def of ME_TOUR_STEPS) {
    let found: ResolvedTourStep | null = null;
    for (const target of def.targets) {
      const el = root.querySelector<HTMLElement>(`[data-me-tour="${target}"]`);
      if (el && isTourTargetVisible(el)) {
        found = { def, element: el, target };
        break;
      }
    }
    if (!found && def.fallback === "bottom") found = { def, element: null, target: null };
    if (found) resolved.push(found);
  }
  return resolved;
}

/**
 * 吹き出しの基準にする矩形。対象がビューポートより大きいとき（ページ全体を指す場合など）は、
 * 見えている範囲の上端付近だけを基準にして、吹き出しが画面外へ追い出されないようにする。
 */
export function anchorRect(
  rect: { top: number; left: number; width: number; height: number },
  viewport: { width: number; height: number },
): { top: number; left: number; width: number; height: number } {
  const top = Math.max(rect.top, 0);
  const bottom = Math.min(rect.top + rect.height, viewport.height);
  const visibleHeight = Math.max(bottom - top, 0);
  if (visibleHeight > viewport.height * 0.6) {
    return { top, left: rect.left, width: rect.width, height: 48 };
  }
  return { top, left: rect.left, width: rect.width, height: visibleHeight };
}
