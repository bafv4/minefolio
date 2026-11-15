// 埋め込み NodeView（リマップ / サーチクラフト / テンプレート）の右上の操作（変更・削除）。
// ノードを選択しているとき・ホバーしているとき・中にフォーカスがあるときに見せる。
// 押した処理は onClick で行い、onMouseDown では preventDefault だけする（エディタのフォーカスと選択を奪わない）。
// ボタン要素なので Enter / Space でも押せる（Tiptap の NodeView は BUTTON 上のイベントを ProseMirror に渡さない）。
import { useT } from "@/hooks/use-locale";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2 } from "lucide-react";

/** 埋め込み NodeView の外枠（EmbedNodeActions の表示条件に使う group を含む） */
export const EMBED_NODE_CARD_CLASS = "relative group my-2 rounded-lg border bg-card p-4";

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
        "absolute top-2 right-2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100",
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
