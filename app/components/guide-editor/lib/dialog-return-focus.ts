// トリガー（DialogTrigger）を持たないダイアログで、閉じたあとのフォーカスを開く前の要素へ戻すためのハンドラ。
// Radix の Dialog は閉じるとき既定でトリガーへフォーカスを戻すが、トリガーが無いと body に落ちる。
// 埋め込み NodeView の「変更」から開いたときは、そのボタン（またはエディタ本体）へ戻す。
// 挿入のときは使わない（挿入はエディタへフォーカスを移すので、それを奪わない）。
import { useRef } from "react";

export function useDialogReturnFocus(enabled: boolean) {
  const returnFocusRef = useRef<HTMLElement | null>(null);
  return {
    // FocusScope がダイアログ内へフォーカスを移す直前に呼ばれる（このときはまだ開く前の要素にある）
    onOpenAutoFocus: () => {
      const active = document.activeElement;
      returnFocusRef.current = enabled && active instanceof HTMLElement && active !== document.body ? active : null;
    },
    onCloseAutoFocus: (event: Event) => {
      const el = returnFocusRef.current;
      returnFocusRef.current = null;
      if (!el || !el.isConnected) return;
      event.preventDefault();
      el.focus();
    },
  };
}
