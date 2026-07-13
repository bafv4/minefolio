// テーブル UI 間の排他制御。行・列ハンドルのメニューとセル選択バブルメニューは
// どちらも CellSelection 上に出るため、ハンドルメニュー表示中はバブルを抑制する。
// React ツリー上は兄弟（TableHandles / TableCellBubbleMenu）で状態を共有できないため、
// editor インスタンスをキーにしたモジュールレベルの WeakSet で持つ。
import type { Editor } from "@tiptap/core";

const openHandleMenus = new WeakSet<Editor>();

/** 行・列ハンドルメニューの開閉を記録する（TableHandles が呼ぶ） */
export function setTableHandleMenuOpen(editor: Editor, open: boolean): void {
  if (open) {
    openHandleMenus.add(editor);
  } else {
    openHandleMenus.delete(editor);
  }
}

/** 行・列ハンドルメニューが開いているか（セルバブルメニューの抑制判定に使う） */
export function isTableHandleMenuOpen(editor: Editor): boolean {
  return openHandleMenus.has(editor);
}
