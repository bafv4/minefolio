// リマップ / サーチクラフト埋め込みの共通 NodeView。
// 保存 HTML（data-user-slug / data-preset-name）は各 Extension の renderHTML が担うため、編集中表示を変えても互換性に影響しない。
// 編集中は、公開ページと同じ規則で走者を解決し、表示名と中身の要約（サーチクラフトはグループごとの件数、
// リマップはその件数）を出す。読み込み中・見つからないときもそれと分かる表示にする。
// 右上の「変更」で、保存済みの属性を初期値にしてダイアログを開き、確定したら updateAttributes で書き換える。
import type { Editor } from "@tiptap/core";
import { NodeViewWrapper } from "@tiptap/react";
import { useT, useLocale } from "@/hooks/use-locale";
import { getLocalizedDisplayName } from "@/lib/slug";
import { useEmbedUser } from "../lib/embed-user-cache";
import { getEmbedEditContext } from "../lib/embed-edit-context";
import { EmbedSummary, type EmbedKind } from "../panels/embed-summary";
import { EmbedNodeActions, EmbedNodeFrame, deleteEmbedNode } from "./embed-node-actions";

interface EmbedNodeViewProps {
  node: { attrs: Record<string, string | null> };
  editor: Editor;
  selected: boolean;
  deleteNode: () => void;
  getPos: () => number | undefined;
  updateAttributes: (attrs: Record<string, unknown>) => void;
}

function EmbedNodeView({
  node,
  editor,
  selected,
  deleteNode,
  getPos,
  updateAttributes,
  kind,
  label,
}: EmbedNodeViewProps & { kind: EmbedKind; label: string }) {
  const locale = useLocale();
  const userSlug = node.attrs.userSlug ?? "";
  const presetName = node.attrs.presetName || null;
  const state = useEmbedUser(userSlug);
  const broken = state.status === "missing";
  // 宿主の注入は NodeView の初回描画より後になることがあるので、押したときに取り出す
  const onEdit = () =>
    getEmbedEditContext(editor)?.editEmbed(kind, { userSlug, presetName }, (nextSlug, nextPreset) =>
      updateAttributes({ userSlug: nextSlug, presetName: nextPreset }),
    );

  // ヘッダー帯の文字は公開ページの UserEmbedHeader と同じ「走者名（プリセット名）— 種別」。
  // 解決できるまで（読み込み中・失敗・見つからない）は走者名が無いので種別だけ
  const found = state.status === "found";
  const header = (
    <p className="flex min-w-0 items-center">
      {found && (
        <span className="min-w-0 truncate">
          {getLocalizedDisplayName(state.user, locale)}
          {presetName && <span className="ml-2 text-muted-foreground">({presetName})</span>}
        </span>
      )}
      <span className={found ? "ml-1 shrink-0 whitespace-nowrap" : "shrink-0 whitespace-nowrap"}>
        {found ? "— " : ""}
        {label}
      </span>
    </p>
  );

  return (
    <NodeViewWrapper>
      <EmbedNodeFrame
        broken={broken}
        header={header}
        actions={
          <EmbedNodeActions selected={selected} label={label} onEdit={onEdit}
            onDelete={() => deleteEmbedNode(editor, getPos, deleteNode)}
          />
        }
      >
        <EmbedSummary kind={kind} state={state} userQuery={userSlug} presetName={presetName} showIdentity={false} />
      </EmbedNodeFrame>
    </NodeViewWrapper>
  );
}

export function KeybindEmbedNodeView(props: EmbedNodeViewProps) {
  const t = useT();
  return <EmbedNodeView {...props} kind="keybind" label={t("guideEditor.embedKeybindLabel")} />;
}

export function SearchCraftEmbedNodeView(props: EmbedNodeViewProps) {
  const t = useT();
  return <EmbedNodeView {...props} kind="searchcraft" label={t("guideEditor.embedSearchCraftLabel")} />;
}
