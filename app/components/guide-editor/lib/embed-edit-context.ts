// 埋め込み NodeView（リマップ / サーチクラフト / テンプレート）の「変更」から、宿主（index.tsx）のダイアログを開くための注入口。
// NodeView は Tiptap が描画するため props を直接渡せない。editor ごとに WeakMap で持つ
// （拡張の storage に置かないのは、3 つの拡張の定義と保存 HTML に触れずに済ませるため）。
import type { Editor } from "@tiptap/core";
import type { GuideEmbedEditContext } from "../types";

const contexts = new WeakMap<Editor, GuideEmbedEditContext>();

/** 宿主（GuideEditor）から埋め込みの変更操作を注入する */
export function setEmbedEditContext(editor: Editor, ctx: GuideEmbedEditContext): void {
  contexts.set(editor, ctx);
}

/** NodeView から埋め込みの変更操作を取り出す（未注入なら null。そのときは「変更」を出さない） */
export function getEmbedEditContext(editor: Editor): GuideEmbedEditContext | null {
  return contexts.get(editor) ?? null;
}
