// /me の初回ツアーの手順定義と、対象要素の解決（DOM に触る部分はここに集めて単体で試せるようにする）。
//
// 対象は `data-me-tour="<名前>"` 属性で示す。見つからない・見えていない対象の手順は飛ばす
// （allowHidden の手順は、DOM にさえあれば見えていなくても指す）。

export type MeTourStepId = "sidebar" | "edit" | "save" | "player";

export interface MeTourStepDef {
  id: MeTourStepId;
  /** 優先順に探す data-me-tour の値。最初に「見えている」ものを使う */
  targets: readonly string[];
  /** DOM に存在すれば、aria-hidden / 非表示でも指す（変更が無いあいだ隠れている保存バー用）。無ければ手順ごと飛ばす。
   * 指している間は app.css の `[data-me-tour-active]` が保存バーを見える状態にする（透明のまま指して吹き出しが空所を指すのを防ぐ） */
  allowHidden?: boolean;
}

export const ME_TOUR_STEPS: readonly MeTourStepDef[] = [
  // lg 以上はサイドバーの一覧、lg 未満は一覧が畳まれているので開閉ボタンを指す
  { id: "sidebar", targets: ["sidebar", "sidebar-toggle"] },
  // 各ページが付ける。付いていない画面（/me/edit 以外）では飛ばす
  { id: "edit", targets: ["edit-form"] },
  // 保存バー（FloatingSaveBar）がある画面だけ。変更が無いあいだは aria-hidden だが、DOM にあれば指す
  { id: "save", targets: ["save-bar"], allowHidden: true },
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
  /** 実際に指す要素 */
  element: HTMLElement;
  /** 使われた data-me-tour の値 */
  target: string;
}

export function resolveTourSteps(root: ParentNode = document): ResolvedTourStep[] {
  const resolved: ResolvedTourStep[] = [];
  for (const def of ME_TOUR_STEPS) {
    let found: ResolvedTourStep | null = null;
    for (const target of def.targets) {
      const el = root.querySelector<HTMLElement>(`[data-me-tour="${target}"]`);
      if (el && (def.allowHidden || isTourTargetVisible(el))) {
        found = { def, element: el, target };
        break;
      }
    }
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
