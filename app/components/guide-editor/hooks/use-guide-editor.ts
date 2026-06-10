// エディタインスタンス生成フック。buildExtensions() + 共通 editorProps を集約。
// 旧 index.tsx の useEditor({...}) 設定を逐語移植し、再利用可能な形に切り出す。
import { useEditor } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import { buildExtensions } from "../editor-config";
import { SlashCommand } from "../extensions/slash-command";
import { t } from "@/lib/messages";

interface UseGuideEditorOptions {
  /** 初期 HTML 本文 */
  initialContent: string;
  /** 本文更新時のコールバック（HTML 文字列） */
  onUpdate: (html: string) => void;
  /** 画像ペースト時のアップロード処理（File を受け取る） */
  onImagePaste: (file: File) => void;
}

/** ガイドエディタの Tiptap インスタンスを生成する */
export function useGuideEditor({
  initialContent,
  onUpdate,
  onImagePaste,
}: UseGuideEditorOptions): Editor | null {
  return useEditor({
    // buildExtensions（HTML スキーマ = round-trip 担保）+ 編集 UX 専用の slash を合成
    extensions: [...buildExtensions(t("guideEditor.contentPlaceholder")), SlashCommand],
    immediatelyRender: false,
    content: initialContent,
    onUpdate: ({ editor }) => {
      onUpdate(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class: "outline-none min-h-100",
        spellcheck: "false",
        autocorrect: "off",
        autocapitalize: "off",
      },
      handlePaste: (_view, event) => {
        const items = event.clipboardData?.items;
        if (!items) return false;
        for (const item of items) {
          if (item.type.startsWith("image/")) {
            const file = item.getAsFile();
            if (file) {
              event.preventDefault();
              onImagePaste(file);
              return true;
            }
          }
        }
        return false;
      },
    },
  });
}
