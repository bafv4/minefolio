/**
 * ハイコントラスト（html の data-contrast 属性）の判定と初回描画前スクリプト。
 * テーマ（light / dark / ultra-dark）とは別軸のオン・オフで、保存先は localStorage（キー `contrast`）だけ。
 * キーなし（または不正値）＝ OS の `prefers-contrast: more` に従う。サーバーへは送らない。
 */

export const CONTRAST_STORAGE_KEY = "contrast";
export const CONTRAST_ATTRIBUTE = "data-contrast";
/** 同一タブ内の変更を購読側へ知らせるイベント名（storage イベントは他タブにしか飛ばないため） */
export const CONTRAST_CHANGE_EVENT = "minefolio:contrast-change";

export type ContrastValue = "more" | "normal";

/** 保存値（無い・不正なら null）と OS の設定から、ハイコントラストを使うかを決める。明示の選択が OS より優先 */
export function resolveContrast(stored: string | null | undefined, osPrefersMore: boolean): boolean {
  if (stored === "more") return true;
  if (stored === "normal") return false;
  return osPrefersMore;
}

/** localStorage が使えない環境（プライベートモード等）でも例外にしない */
export function readStoredContrast(): string | null {
  try {
    return localStorage.getItem(CONTRAST_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeStoredContrast(value: ContrastValue): void {
  try {
    localStorage.setItem(CONTRAST_STORAGE_KEY, value);
  } catch {
    // 保存できなくてもこのタブでは反映する
  }
}

/**
 * 描画前に html へ属性を付けるインラインスクリプト（next-themes がテーマでやっているのと同じ考え方）。
 * resolveContrast と同じ判定を ES5 で書き直している。CSP は使っていないので nonce は不要。
 */
export const CONTRAST_INIT_SCRIPT = `(function(){try{var s=null;try{s=localStorage.getItem(${JSON.stringify(CONTRAST_STORAGE_KEY)})}catch(e){}var m=s==="more"?true:s==="normal"?false:window.matchMedia("(prefers-contrast: more)").matches;if(m)document.documentElement.setAttribute(${JSON.stringify(CONTRAST_ATTRIBUTE)},"more")}catch(e){}})();`;
