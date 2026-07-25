// エディタインスタンス生成フック。buildExtensions() + 共通 editorProps を集約。
// 旧 index.tsx の useEditor({...}) 設定を逐語移植し、再利用可能な形に切り出す。
import { useEditor } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import { buildExtensions } from "../editor-config";
import { SlashCommand } from "../extensions/slash-command";
import { stripNonPaletteColorsFromHtml } from "@/lib/guide-colors";
import { stripDisallowedFontSizesFromHtml } from "@/lib/guide-font-sizes";
import { t } from "@/lib/messages";

interface UseGuideEditorOptions {
  /** 初期 HTML 本文 */
  initialContent: string;
  /**
   * 本文が変更されたときの通知（ダーティ判定用）。
   * パフォーマンスのため HTML はここで渡さない（毎キー入力の getHTML を避ける）。
   * 保存時に editor.getHTML() を呼ぶこと。
   */
  onUpdate: () => void;
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
    // 保存済み HTML の再ロード時に ProseMirror の空白正規化でインライン code 内の
    // 先頭末尾・連続スペースが消え、次回保存で DB に焼き付くのを防ぐ。
    // 保存 HTML は editor.getHTML() の出力（整形空白なし）なので副作用はない。
    parseOptions: { preserveWhitespace: "full" },
    onUpdate: () => {
      onUpdate();
    },
    editorProps: {
      attributes: {
        class: "outline-none min-h-100",
        spellcheck: "false",
        autocorrect: "off",
        autocapitalize: "off",
      },
      // 外部リッチテキストのペーストでは、コピー元の算出スタイル
      // （閲覧テーマの文字色 = rgb(...) や Word/Docs の #000000、font-size: 14px 等）が
      // インライン style として取り込まれ、保存 HTML に焼き付いてテーマ非追従・
      // サイズばらつきの原因になる。ピッカーから設定できない値をここで除去する
      // （パレット色・許可サイズは保持 — エディタ内コピーや他ガイドからのコピーを保全）。
      // 表示時サニタイズ（guide-sanitize.server.ts）と同じ判定を共有している。
      transformPastedHTML: (html) =>
        stripDisallowedFontSizesFromHtml(stripNonPaletteColorsFromHtml(html)),
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
