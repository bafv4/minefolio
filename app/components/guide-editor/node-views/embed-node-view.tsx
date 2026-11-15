// リマップ / サーチクラフト埋め込みの共通 NodeView。
// 保存 HTML（data-user-slug / data-preset-name）は各 Extension の renderHTML が担うため、編集中表示を変えても互換性に影響しない。
// 編集中は、公開ページと同じ規則で走者を解決し、表示名と中身の要約（サーチクラフトはグループごとの件数、
// リマップはその件数）を出す。読み込み中・見つからないときもそれと分かる表示にする。
// 右上の「変更」で、保存済みの属性を初期値にしてダイアログを開き、確定したら updateAttributes で書き換える。
import type { LucideIcon } from "lucide-react";
import type { Editor } from "@tiptap/core";
import { NodeViewWrapper } from "@tiptap/react";
import { Keyboard, Package } from "lucide-react";
import { useT } from "@/hooks/use-locale";
import { cn } from "@/lib/utils";
import { useEmbedUser } from "../lib/embed-user-cache";
import { getEmbedEditContext } from "../lib/embed-edit-context";
import { EmbedSummary, type EmbedKind } from "../panels/embed-summary";
import { EmbedNodeActions, EMBED_NODE_CARD_CLASS } from "./embed-node-actions";

interface EmbedNodeViewProps {
  node: { attrs: Record<string, string | null> };
  editor: Editor;
  selected: boolean;
  deleteNode: () => void;
  updateAttributes: (attrs: Record<string, unknown>) => void;
}

function EmbedNodeView({
  node,
  editor,
  selected,
  deleteNode,
  updateAttributes,
  kind,
  icon: Icon,
  label,
}: EmbedNodeViewProps & { kind: EmbedKind; icon: LucideIcon; label: string }) {
  const userSlug = node.attrs.userSlug ?? "";
  const presetName = node.attrs.presetName || null;
  const state = useEmbedUser(userSlug);
  const broken = state.status === "missing";
  // 宿主の注入は NodeView の初回描画より後になることがあるので、押したときに取り出す
  const onEdit = () =>
    getEmbedEditContext(editor)?.editEmbed(kind, { userSlug, presetName }, (nextSlug, nextPreset) =>
      updateAttributes({ userSlug: nextSlug, presetName: nextPreset }),
    );

  return (
    <NodeViewWrapper>
      <div
        className={cn(EMBED_NODE_CARD_CLASS, broken && "border-dashed border-destructive/50")}
        contentEditable={false}
      >
        <div className="flex items-start gap-2 pr-28">
          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="text-xs font-medium text-muted-foreground">{label}</p>
            <EmbedSummary kind={kind} state={state} userQuery={userSlug} presetName={presetName} />
          </div>
        </div>
        <EmbedNodeActions selected={selected} label={label} onEdit={onEdit} onDelete={deleteNode} />
      </div>
    </NodeViewWrapper>
  );
}

export function KeybindEmbedNodeView(props: EmbedNodeViewProps) {
  const t = useT();
  return <EmbedNodeView {...props} kind="keybind" icon={Keyboard} label={t("guideEditor.embedKeybindLabel")} />;
}

export function SearchCraftEmbedNodeView(props: EmbedNodeViewProps) {
  const t = useT();
  return <EmbedNodeView {...props} kind="searchcraft" icon={Package} label={t("guideEditor.embedSearchCraftLabel")} />;
}
