// ポップオーバー内の見本・選択肢（色・文字サイズ）をキーボードで使うための共通部品。
// - Tab の停止点は 1 つ（選択中、無ければ先頭）。矢印キー・Home / End で移動する（roving tabindex）。
// - キーボードで開いたときだけ、パネルの中へフォーカスを移す（マウスで開いたときはエディタに残し、選択範囲を保つ）。
import { useRef, useState, type KeyboardEvent } from "react";

export function useRovingItems(count: number, selectedIndex: number) {
  const [focused, setFocused] = useState<number | null>(null);
  const refs = useRef<(HTMLElement | null)[]>([]);
  const tabbable = focused !== null && focused < count ? focused : selectedIndex >= 0 ? selectedIndex : 0;

  const move = (to: number) => {
    const next = (to + count) % count;
    setFocused(next);
    refs.current[next]?.focus();
  };

  /** 各項目（button）へ spread する props。key は呼び出し側で付ける */
  const itemProps = (index: number) => ({
    ref: (el: HTMLElement | null) => {
      refs.current[index] = el;
    },
    tabIndex: index === tabbable ? 0 : -1,
    "data-roving-item": "",
    onFocus: () => setFocused(index),
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") move(index + 1);
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") move(index - 1);
      else if (e.key === "Home") move(0);
      else if (e.key === "End") move(count - 1);
      else return;
      e.preventDefault();
    },
  });

  return { itemProps };
}

/**
 * PopoverContent の onOpenAutoFocus に渡す。
 * - トリガーにフォーカスがある（＝キーボードで開いた）: パネル内の選択中の項目（無ければ先頭の操作部品）へフォーカスを移す。
 *   Esc で閉じれば Radix の既定でトリガーへ戻る
 * - それ以外（マウス）: エディタからフォーカスを奪わない（選択範囲を保持し、バブルメニューを閉じさせない）
 */
export function focusPanelOnKeyboardOpen(e: Event) {
  e.preventDefault();
  const active = document.activeElement;
  const openedByKeyboard =
    active instanceof HTMLElement &&
    active.getAttribute("aria-haspopup") === "dialog" &&
    active.getAttribute("aria-expanded") === "true";
  if (!openedByKeyboard) return;
  const panel = e.currentTarget as HTMLElement | null;
  const target =
    panel?.querySelector<HTMLElement>('[data-roving-item][tabindex="0"]') ??
    panel?.querySelector<HTMLElement>("button:not([disabled])");
  target?.focus();
}
