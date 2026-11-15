// キー配置 / サーチクラフト埋め込みの共通 NodeView。
// 保存 HTML（data-user-slug / data-preset-name）は各 Extension の renderHTML が担うため、編集中表示を変えても互換性に影響しない。
// 編集中は、公開ページと同じ規則で走者を解決し、表示名と中身の要約（サーチクラフトはグループごとの件数、
// キー配置はリマップの件数）を出す。読み込み中・見つからないときもそれと分かる表示にする。
import type { LucideIcon } from "lucide-react";
import { NodeViewWrapper } from "@tiptap/react";
import { Keyboard, Package, Trash2 } from "lucide-react";
import { useT } from "@/hooks/use-locale";
import { cn } from "@/lib/utils";
import { useEmbedUser } from "../lib/embed-user-cache";
import { EmbedSummary, type EmbedKind } from "../panels/embed-summary";

interface EmbedNodeViewProps {
  node: { attrs: Record<string, string | null> };
  deleteNode: () => void;
}

function EmbedNodeView({
  node,
  deleteNode,
  kind,
  icon: Icon,
  label,
}: EmbedNodeViewProps & { kind: EmbedKind; icon: LucideIcon; label: string }) {
  const t = useT();
  const userSlug = node.attrs.userSlug ?? "";
  const presetName = node.attrs.presetName || null;
  const state = useEmbedUser(userSlug);
  const broken = state.status === "missing";

  return (
    <NodeViewWrapper>
      <div
        className={cn(
          "relative group my-2 rounded-lg border bg-card p-4",
          broken && "border-dashed border-destructive/50",
        )}
        contentEditable={false}
      >
        <div className="flex items-start gap-2 pr-8">
          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="text-xs font-medium text-muted-foreground">{label}</p>
            <EmbedSummary kind={kind} state={state} userQuery={userSlug} presetName={presetName} />
          </div>
        </div>
        <button
          type="button"
          aria-label={t("guideEditor.embedTemplateRemove")}
          onMouseDown={(e) => { e.preventDefault(); deleteNode(); }}
          className="absolute top-2 right-2 h-6 w-6 flex items-center justify-center bg-black/60 text-white rounded-md opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
        >
          <Trash2 className="h-3 w-3" />
        </button>
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
