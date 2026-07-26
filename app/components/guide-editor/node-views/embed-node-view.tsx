// キーバインド / サーチクラフト埋め込みの共通 NodeView。
// 旧 index.tsx KeybindEmbedNodeView / SearchCraftEmbedNodeView を 1 コンポーネントに統合
// （保存 HTML は各 Extension の renderHTML が担うため、編集中表示の共通化は互換性に影響しない）。
import type { LucideIcon } from "lucide-react";
import { NodeViewWrapper } from "@tiptap/react";
import { Keyboard, Package, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useT } from "@/hooks/use-locale";

interface EmbedNodeViewProps {
  node: { attrs: Record<string, string> };
  deleteNode: () => void;
}

/** 埋め込み種別ごとのアイコンとラベル */
function EmbedNodeView({
  node,
  deleteNode,
  icon: Icon,
  label,
}: EmbedNodeViewProps & { icon: LucideIcon; label: string }) {
  return (
    <NodeViewWrapper>
      <div className="relative group my-2 rounded-lg border bg-card p-4" contentEditable={false}>
        <div className="flex items-center gap-2 text-sm">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">{label}</span>
          <span className="text-muted-foreground">— {node.attrs.userSlug}</span>
          {node.attrs.presetName && (
            <Badge variant="outline" className="text-xs">{node.attrs.presetName}</Badge>
          )}
        </div>
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); deleteNode(); }}
          className="absolute top-2 right-2 h-6 w-6 flex items-center justify-center bg-black/60 text-white rounded-md opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </NodeViewWrapper>
  );
}

export function KeybindEmbedNodeView(props: EmbedNodeViewProps) {
  const t = useT();
  return <EmbedNodeView {...props} icon={Keyboard} label={t("guideEditor.embedKeybindLabel")} />;
}

export function SearchCraftEmbedNodeView(props: EmbedNodeViewProps) {
  const t = useT();
  return <EmbedNodeView {...props} icon={Package} label={t("guideEditor.embedSearchCraftLabel")} />;
}
