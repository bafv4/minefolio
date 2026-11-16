// 埋め込み NodeView（リマップ / サーチクラフト / テンプレート）の右上の操作（変更・削除）。
// ノードを選択しているとき・ホバーしているとき・中にフォーカスがあるときに見せる。
// 押した処理は onClick で行い、onMouseDown では preventDefault だけする（エディタのフォーカスと選択を奪わない）。
// ボタン要素なので Enter / Space でも押せる（Tiptap の NodeView は BUTTON 上のイベントを ProseMirror に渡さない）。
import type { ReactNode } from "react";
import type { Editor } from "@tiptap/core";
import { useT } from "@/hooks/use-locale";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2 } from "lucide-react";

/**
 * 削除ボタンの処理。消したあとはエディタの、消えたノードの位置にフォーカスを戻す。
 * キーボード（Enter / Space）で押すと、ボタンごとノードが消えてフォーカスが body に落ち、
 * 続く Ctrl+Z もエディタに届かなくなるため（マウスは onMouseDown の preventDefault でエディタに残る）
 */
export function deleteEmbedNode(editor: Editor, getPos: () => number | undefined, deleteNode: () => void) {
  const pos = getPos();
  deleteNode();
  if (typeof pos === "number") {
    editor.commands.setTextSelection(Math.min(pos, editor.state.doc.content.size));
  }
  // Tiptap の focus コマンドは requestAnimationFrame で遅らせるので、ボタンが DOM から外れた直後に
  // body へ落ちたフォーカスを、同期で view に戻す
  editor.view.focus();
}

/**
 * 埋め込み NodeView の外枠。公開ページの埋め込み（guide-embeds.tsx）と同じ「外の余白＋カード＋ヘッダー帯」の形で、
 * ヘッダー帯の右に操作（EmbedNodeActions。公開ページでは「プロフィールを見る」等のリンクがある位置）を置く。
 * 中身（children）は要約などで、公開ページの表・鍵盤の代わり。壊れた参照（見つからない）は破線の枠にする。
 * 外側は group（操作の表示条件）かつ not-prose（本文の段落・リンク・画像の規則を当てない。公開ページと同じ）
 */
export function EmbedNodeFrame({
  header,
  actions,
  broken,
  children,
}: {
  /** ヘッダー帯の左（公開ページの UserEmbedHeader / テンプレートのヘッダーと同じ文字の組み立て） */
  header: ReactNode;
  actions: ReactNode;
  broken?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="group my-6 not-prose" contentEditable={false}>
      <div
        className={cn(
          "overflow-hidden rounded-xl border bg-card",
          broken ? "border-dashed border-destructive/50" : "border-border/70",
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b bg-muted/30 px-4 py-2">
          <div className="min-w-0 text-sm font-medium">{header}</div>
          {actions}
        </div>
        <div className="px-4 py-3">{children}</div>
      </div>
    </div>
  );
}

export function EmbedNodeActions({
  selected,
  label,
  onEdit,
  onDelete,
}: {
  /** ノードが選択されているか（NodeView の selected） */
  selected: boolean;
  /** 埋め込みの種別名（削除ボタンの名前に添える） */
  label: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  return (
    <div
      className={cn(
        // 高さ 28px のボタンを、ヘッダー帯の高さ（文字の行＋上下の padding）を変えずに収めるため上下の負マージンで逃がす
        "-my-1 flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100",
        selected && "opacity-100",
      )}
    >
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="h-7 px-2 text-xs"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onEdit}
      >
        <Pencil className="size-3.5" aria-hidden />
        {t("guideEditor.embedEdit")}
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="icon-sm"
        className="size-7"
        aria-label={t("guideEditor.embedRemoveNamed", { label })}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onDelete}
      >
        <Trash2 className="size-3.5" aria-hidden />
      </Button>
    </div>
  );
}
