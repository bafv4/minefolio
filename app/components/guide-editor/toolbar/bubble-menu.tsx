// インライン整形のバブルメニュー（太字 / 斜体 / 取り消し線 / コード / リンク / 文字色）。
// 旧実装の手動 position:fixed フローティングメニューを @tiptap/extension-bubble-menu に置換。
// 空選択時・画像/コードブロック選択時・モバイル時は非表示。
import { useCallback } from "react";
import { BubbleMenu } from "@tiptap/react/menus";
import type { Editor } from "@tiptap/core";
import { Bold, Italic, Underline as UnderlineIcon, Strikethrough, Code, Link as LinkIcon } from "lucide-react";
import { ToolbarButton, ToolbarSeparator } from "./toolbar-button";
import { useEditorRerender } from "../hooks/use-editor-rerender";
import { EDITOR_Z } from "../constants";

// 参照を安定させ、BubbleMenu のプラグイン再登録ループを防ぐ（毎レンダリングで
// 新しい options/shouldShow を渡すと再登録→transaction→再描画の無限ループになる）。
const BUBBLE_OPTIONS = { placement: "top" } as const;

interface EditorBubbleMenuProps {
  editor: Editor;
  /** リンク挿入ハンドラ（親が URL 入力 UI を担当） */
  onLink: () => void;
  /** false でバブルを無効化（モバイル下部バーに整形を委譲） */
  enabled?: boolean;
}

export function EditorBubbleMenu({ editor, onLink, enabled = true }: EditorBubbleMenuProps) {
  useEditorRerender(editor);

  // 安定参照（編集位置の判定は呼び出し時に live state を読むため問題ない）
  const shouldShow = useCallback(() => {
    if (!enabled) return false;
    const { empty } = editor.state.selection;
    if (empty) return false;
    // ノード選択（画像）やコードブロックでは整形を出さない
    if (editor.isActive("image") || editor.isActive("codeBlock")) return false;
    return true;
  }, [editor, enabled]);

  return (
    <BubbleMenu
      editor={editor}
      shouldShow={shouldShow}
      options={BUBBLE_OPTIONS}
      role="toolbar"
      aria-label="テキスト整形"
      className="flex items-center gap-0.5 rounded-lg border bg-popover p-1 shadow-xl"
      style={{ zIndex: EDITOR_Z.bubble }}
    >
      <ToolbarButton
        sm
        label="太字"
        shortcut="Ctrl B"
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        sm
        label="斜体"
        shortcut="Ctrl I"
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        sm
        label="下線"
        shortcut="Ctrl U"
        active={editor.isActive("underline")}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <UnderlineIcon className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        sm
        label="取り消し線"
        shortcut="Ctrl Shift S"
        active={editor.isActive("strike")}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <Strikethrough className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        sm
        label="インラインコード"
        shortcut="Ctrl E"
        active={editor.isActive("code")}
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        <Code className="h-4 w-4" />
      </ToolbarButton>

      <ToolbarSeparator />

      <ToolbarButton sm label="リンク" active={editor.isActive("link")} onClick={onLink}>
        <LinkIcon className="h-4 w-4" />
      </ToolbarButton>
    </BubbleMenu>
  );
}
