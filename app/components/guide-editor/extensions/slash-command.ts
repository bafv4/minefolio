// スラッシュコマンド拡張。@tiptap/suggestion で "/" 入力を捕捉し、
// 項目選択時にスラッシュ範囲を削除して run を実行する。
// ダイアログ操作のコンテキストは storage.ctx 経由で宿主（index.tsx）が注入する
// （buildExtensions には含めず、編集 UX 専用として use-guide-editor で合成）。
import { Extension } from "@tiptap/core";
import { Suggestion } from "@tiptap/suggestion";
import type { SlashCommandContext, SlashItem } from "../types";
import { t as defaultT, type Translator } from "@/lib/messages";
import { filterSlashItems } from "../slash-command/items";
import { createSlashRenderer } from "../slash-command/renderer";

export interface SlashCommandStorage {
  ctx: SlashCommandContext | null;
  /** 文言解決用。宿主（index.tsx）が useT() の結果を注入する */
  t: Translator;
}

/** ctx 未注入時のフォールバック（即時挿入項目は動作、ダイアログ項目は無効） */
const NOOP_CONTEXT: SlashCommandContext = {
  openImagePicker: () => {},
  insertYoutube: () => {},
  insertLink: () => {},
  openEmbedDialog: () => {},
  openGuideLinkSearch: () => {},
  openVideoToGif: () => {},
};

export const SlashCommand = Extension.create<Record<string, never>, SlashCommandStorage>({
  name: "slashCommand",

  addStorage() {
    return { ctx: null, t: defaultT };
  },

  addProseMirrorPlugins() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const extension = this;
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        char: "/",
        allowSpaces: false,
        startOfLine: false,
        items: ({ query }) => filterSlashItems(query, extension.storage.t),
        render: createSlashRenderer(() => extension.storage.t),
        command: ({ editor, range, props }) => {
          editor.chain().focus().deleteRange(range).run();
          props.run(editor, extension.storage.ctx ?? NOOP_CONTEXT);
        },
      }),
    ];
  },
});
