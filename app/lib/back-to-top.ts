// 「トップへ戻る」ボタンの表示判定（純粋関数）。
// 下へ読み進めている間は隠し、上へスクロールし始めたとき・ページ末尾付近で出す。

/** 向きが変わったと見なす移動量（px）。小さな揺れで出入りしないための遊び */
export const BACK_TO_TOP_DIRECTION_DELTA = 40;
/** 末尾付近と見なす、ページ下端までの残り（px） */
export const BACK_TO_TOP_END_MARGIN = 160;

export interface BackToTopState {
  visible: boolean;
  /** 現在の向きで極値を追う基準位置（下向き中は最大、上向き中は最小の scrollY） */
  anchorY: number;
}

export interface BackToTopInput {
  /** 現在の scrollY */
  y: number;
  /** ページ全体の高さ（document.documentElement.scrollHeight） */
  docHeight: number;
  /** ビューポートの高さ */
  viewportHeight: number;
  /** これ以下では常に隠す scrollY */
  threshold: number;
}

export const INITIAL_BACK_TO_TOP_STATE: BackToTopState = {
  visible: false,
  anchorY: 0,
};

export function nextBackToTopState(
  prev: BackToTopState,
  { y, docHeight, viewportHeight, threshold }: BackToTopInput,
  delta: number = BACK_TO_TOP_DIRECTION_DELTA,
  endMargin: number = BACK_TO_TOP_END_MARGIN,
): BackToTopState {
  // 閾値より上（iOS のバウンスで負になる値も含む）は常に隠す
  if (y <= threshold) return { visible: false, anchorY: y };

  // 末尾付近は読み終わりなので出す（向きに関わらず）
  if (docHeight - (y + viewportHeight) <= endMargin) {
    return { visible: true, anchorY: y };
  }

  const diff = y - prev.anchorY;
  if (diff >= delta) return { visible: false, anchorY: y };
  if (diff <= -delta) return { visible: true, anchorY: y };

  // 向きが確定していない間は、現在の状態を保ったまま極値を追う
  if (prev.visible ? y < prev.anchorY : y > prev.anchorY) {
    return { visible: prev.visible, anchorY: y };
  }
  return prev;
}
