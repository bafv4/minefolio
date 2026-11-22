// トリガー（DialogTrigger）を持たないダイアログで、閉じたあとフォーカスが body に落ちないようにするためのハンドラ。
// Radix の Dialog は閉じるとき既定でトリガーへフォーカスを戻すが、トリガーが無いと body に落ちる
// （ツールバー・スラッシュメニュー・NodeView のボタンから state で開くエディタのダイアログはすべてこれ）。
//
// - 戻し先: 開く前にフォーカスを持っていた要素（まだ DOM にあれば）。無ければ、またはそれがエディタ本体ならエディタ
//   （editor.view.focus() で選択位置ごと戻す）
// - 戻すのは、閉じた時点で activeElement が body か DOM から外れた要素のときだけ。挿入などの確定で
//   エディタへ置いたフォーカス（editor.chain().focus() の rAF）は奪わない
import { createContext, useContext, useLayoutEffect, useRef } from "react";
import type { Editor } from "@tiptap/react";

/**
 * 戻し先が無いときにフォーカスするエディタ。GuideEditor（index.tsx）が配下全体に配る。
 * NodeView（image-node-view 等）は EditorContent のポータルで描かれるので、ここからも届く
 */
export const DialogReturnFocusEditorContext = createContext<Editor | null>(null);

function isFocusLost(active: Element | null): boolean {
  return !active || active === document.body || !active.isConnected;
}

/**
 * `<DialogContent {...useDialogReturnFocus(open)}>` のように展開して使う。
 * `editor` を渡さなければ DialogReturnFocusEditorContext のエディタを使う。
 */
export function useDialogReturnFocus(open: boolean, editor?: Editor | null) {
  const contextEditor = useContext(DialogReturnFocusEditorContext);
  const targetEditor = editor ?? contextEditor;
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const openRef = useRef(open);

  // 開いた時点（中身のマウント前）で、フォーカスを持っている要素を覚える。
  // onOpenAutoFocus では取らない: 中の Input に autoFocus があると、FocusScope の mount 時には既に
  // ダイアログ内にフォーカスがあり、onOpenAutoFocus 自体が呼ばれない（Radix FocusScope の仕様）。
  // 中身は Portal（初回は mounted=false で何も描かない）の次の描画で出るので、ここではまだ開く前の要素にある
  useLayoutEffect(() => {
    openRef.current = open;
    if (!open) return;
    const active = document.activeElement;
    returnFocusRef.current =
      active instanceof HTMLElement && active !== document.body && !active.closest("[role='dialog']") ? active : null;
  }, [open]);

  return {
    onCloseAutoFocus: (event: Event) => {
      // 開いている間に届いたもの（開発時の StrictMode による effect の二重実行で FocusScope が出す）は無視する。
      // ここで覚えた要素を捨てると、本当に閉じたときに戻し先を失う
      if (openRef.current) return;
      const el = returnFocusRef.current;
      returnFocusRef.current = null;
      if (!isFocusLost(document.activeElement)) return;
      event.preventDefault();
      const liveEditor = targetEditor && !targetEditor.isDestroyed ? targetEditor : null;
      if (el && el.isConnected && el !== liveEditor?.view.dom) {
        el.focus();
        // DOM にあってもフォーカスできない（非表示・disabled になった）ときは何も起きないので、エディタへ戻す
        if (document.activeElement === el) return;
      }
      liveEditor?.view.focus();
    },
  };
}
