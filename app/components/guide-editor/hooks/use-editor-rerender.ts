// エディタのトランザクション（選択移動含む）ごとにコンポーネントを再描画させる。
// Tiptap v3 の useEditor は選択変更だけでは宿主を再レンダリングしないため、
// ツールバー等の isActive 表示が編集位置に追従するよう明示的に購読する。
import { useReducer, useEffect } from "react";
import type { Editor } from "@tiptap/core";

export function useEditorRerender(editor: Editor | null): void {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (!editor) return;
    const handler = () => force();
    editor.on("transaction", handler);
    return () => {
      editor.off("transaction", handler);
    };
  }, [editor]);
}
