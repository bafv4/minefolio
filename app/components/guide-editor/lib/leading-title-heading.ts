// 本文の先頭の見出しがタイトルと同じかの判定と、その見出しの削除（エディタ側）。
// 公開ページ・プレビューは、本文の最初のブロックがタイトルと同じ文の見出しなら出さない
// （guides/view.tsx の loader。判定は lib/guide-view-html.ts の leadingHeadingMatchesTitle）。
// エディタではその見出しが見えたままなので、同じ判定で注記を出し、削除の操作を添える
// （panels/leading-title-heading-note.tsx）。
import { getHTMLFromFragment, type Editor } from "@tiptap/core";
import { Fragment, type Node as PMNode, type Schema } from "@tiptap/pm/model";
import { leadingHeadingMatchesTitle } from "@/lib/guide-view-html";

/**
 * 本文の最初のブロック（doc.firstChild）が、タイトルと同じ文の見出しか。
 * 見出しでなければ直列化せずに false を返す。見出しのときもそのノード1つだけを HTML にして、
 * 公開ページと同じ leadingHeadingMatchesTitle で比べる（本文全体は直列化しない）。
 */
export function leadingBlockMatchesTitle(
  firstBlock: PMNode | null,
  schema: Schema,
  title: string,
): boolean {
  if (!firstBlock || firstBlock.type.name !== "heading") return false;
  return leadingHeadingMatchesTitle(getHTMLFromFragment(Fragment.from(firstBlock), schema), title);
}

/**
 * 本文の最初のブロックが見出しなら、1つのトランザクションで取り除く（Undo で戻せる）。
 * 本文がその見出しだけのときは空の段落に置き換える（doc は空にできない）。
 * 押したボタンは注記ごと消えるので、エディタの先頭へフォーカスを移す（Ctrl+Z ですぐ取り消せる）。
 * 最初のブロックが見出しでなければ何もせず false。
 */
export function deleteLeadingHeading(editor: Editor): boolean {
  const first = editor.state.doc.firstChild;
  if (!first || first.type.name !== "heading") return false;
  return editor
    .chain()
    .command(({ tr, state }) => {
      const block = tr.doc.firstChild;
      if (!block || block.type.name !== "heading") return false;
      if (tr.doc.childCount === 1) {
        tr.replaceWith(0, block.nodeSize, state.schema.nodes.paragraph.create());
      } else {
        tr.delete(0, block.nodeSize);
      }
      return true;
    })
    // 位置は変更後の文書から決める（null だと変更前の選択を当て直してしまう）
    .focus("start")
    .run();
}
