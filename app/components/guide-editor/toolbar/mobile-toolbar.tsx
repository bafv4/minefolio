// モバイル下部固定ツールバー。バブルメニューが無効なタッチ環境で整形 + ブロック挿入を提供。
import { useT } from "@/hooks/use-locale";
import type { Editor } from "@tiptap/core";
import { Bold, Italic, Underline as UnderlineIcon, Strikethrough, Code, Link as LinkIcon, Plus } from "lucide-react";
import { ToolbarButton, ToolbarSeparator } from "./toolbar-button";
import { InlineColorPicker } from "../panels/color-picker";
import { FontSizePicker } from "../panels/font-size-picker";
import { useEditorRerender } from "../hooks/use-editor-rerender";
import { EDITOR_Z } from "../constants";

interface MobileToolbarProps {
  editor: Editor;
  onLink: () => void;
}

export function MobileToolbar({ editor, onLink }: MobileToolbarProps) {
  const t = useT();
  useEditorRerender(editor);
  // "/" を挿入してスラッシュメニューを起動
  const insertSlash = () => editor.chain().focus().insertContent("/").run();

  return (
    <div
      className="fixed bottom-0 left-0 right-0 flex items-center gap-0.5 border-t bg-background/95 backdrop-blur px-2 py-1.5"
      style={{
        zIndex: EDITOR_Z.toolbar,
        paddingBottom: "calc(0.375rem + env(safe-area-inset-bottom))",
      }}
      role="toolbar"
      aria-label={t("guideEditor.ui.formatToolbar")}
    >
      <ToolbarButton sm label={t("guideEditor.slash.menuLabel")} onClick={insertSlash}>
        <Plus className="h-4 w-4" />
      </ToolbarButton>

      <ToolbarSeparator />

      <ToolbarButton sm label={t("guideEditor.bold")} active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton sm label={t("guideEditor.italic")} active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton sm label={t("guideEditor.toolbar.underline")} active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <UnderlineIcon className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton sm label={t("guideEditor.ui.strikethrough")} active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}>
        <Strikethrough className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton sm label={t("guideEditor.ui.inlineCode")} active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()}>
        <Code className="h-4 w-4" />
      </ToolbarButton>

      <ToolbarSeparator />

      <ToolbarButton sm label={t("guideEditor.link")} active={editor.isActive("link")} onClick={onLink}>
        <LinkIcon className="h-4 w-4" />
      </ToolbarButton>
      <FontSizePicker editor={editor} />
      <InlineColorPicker editor={editor} />
    </div>
  );
}
