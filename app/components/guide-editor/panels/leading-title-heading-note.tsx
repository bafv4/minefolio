import { useEffect, useMemo, useState } from "react";
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/use-locale";
import { deleteLeadingHeading, leadingBlockMatchesTitle } from "../lib/leading-title-heading";

/**
 * 本文の先頭の見出しがタイトルと同じ間だけ、タイトル・概要の下に出す1行の注記と「この見出しを削除」。
 * 公開ページ・プレビューはその見出しを出さない（guides/view.tsx）ので、エディタで見えたままの理由を作者に伝える。
 *
 * - 判定は公開ページと同じ leadingHeadingMatchesTitle（lib/leading-title-heading.ts）
 * - title は設定モーダルで「適用」した未保存の値（宿主の state）
 * - 購読はこの小さな部品に閉じ込める（宿主の GuideEditor を毎キー再描画しない）。保持するのは最初のブロックの
 *   ノードだけで、ProseMirror のノードは不変なので、先頭以外を編集している間は同じ参照のまま再描画も判定もしない
 * - 読み上げの live region は付けない（先頭の見出しを打っている間に一致が出入りするたびに読み上げが割り込むため）。
 *   注記は本文の直前に置くので、読み順でそのまま届く
 * - editor はクライアントでだけ作られる（immediatelyRender: false）ので SSR では描かれず、ハイドレーションは食い違わない
 */
export function LeadingTitleHeadingNote({ editor, title }: { editor: Editor; title: string }) {
  const t = useT();
  const [firstBlock, setFirstBlock] = useState<PMNode | null>(() => editor.state.doc.firstChild);

  useEffect(() => {
    // setContent（公開版へ戻す）も含め、文書が変わるトランザクションの後に最初のブロックを取り直す
    const sync = () => setFirstBlock(editor.state.doc.firstChild);
    sync();
    editor.on("transaction", sync);
    return () => {
      editor.off("transaction", sync);
    };
  }, [editor]);

  const matches = useMemo(
    () => leadingBlockMatchesTitle(firstBlock, editor.schema, title),
    [firstBlock, editor, title],
  );

  if (!matches) return null;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
      <p className="text-sm text-muted-foreground">{t("guideEditor.ui.leadingTitleHeadingNote")}</p>
      <Button type="button" variant="outline" size="sm" onClick={() => deleteLeadingHeading(editor)}>
        {t("guideEditor.ui.removeLeadingTitleHeading")}
      </Button>
    </div>
  );
}
