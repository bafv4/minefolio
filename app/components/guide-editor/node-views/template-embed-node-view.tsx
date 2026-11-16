// サーチクラフトテンプレート埋め込みの編集中表示。ID だけ保存されているため、
// タイトル・言語・件数は軽く取得して出す。読み込み中・見つからない（未公開の他人のもの・削除済み・ID 不正）も
// それと分かる表示にする（リマップ / サーチクラフト埋め込みの embed-node-view.tsx と同じ 3 状態）。
// 右上の「変更」で選択ダイアログを開き、選んだテンプレートの ID に updateAttributes で書き換える。
import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/core";
import { NodeViewWrapper } from "@tiptap/react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useT, useLocale } from "@/hooks/use-locale";
import { MinecraftAvatar } from "@/components/minecraft-avatar";
import { getGameLanguageName } from "@/lib/game-languages";
import {
  fetchTemplateEmbedMeta,
  getCachedTemplateEmbedMeta,
  type TemplateEmbedMeta,
} from "../lib/template-embed-meta";
import { getEmbedEditContext } from "../lib/embed-edit-context";
import { EmbedNodeActions, EmbedNodeFrame, deleteEmbedNode } from "./embed-node-actions";

interface Props {
  node: { attrs: Record<string, string> };
  editor: Editor;
  selected: boolean;
  deleteNode: () => void;
  getPos: () => number | undefined;
  updateAttributes: (attrs: Record<string, unknown>) => void;
}

export function SearchCraftTemplateEmbedNodeView({ node, editor, selected, deleteNode, getPos, updateAttributes }: Props) {
  const t = useT();
  const locale = useLocale();
  const templateId = node.attrs.templateId;
  const [meta, setMeta] = useState<TemplateEmbedMeta | null | undefined>(() =>
    getCachedTemplateEmbedMeta(templateId),
  );

  useEffect(() => {
    let cancelled = false;
    if (getCachedTemplateEmbedMeta(templateId) !== undefined) {
      setMeta(getCachedTemplateEmbedMeta(templateId));
      return;
    }
    fetchTemplateEmbedMeta(templateId).then((m) => {
      if (!cancelled) setMeta(m);
    });
    return () => {
      cancelled = true;
    };
  }, [templateId]);

  // ヘッダー帯の文字は公開ページのテンプレート埋め込み（SearchCraftTemplateEmbedView）と同じ
  // 「テンプレート名 — [アバター] 作者名  ゲーム内言語」。取得できるまで（読み込み中・見つからない）は種別だけ
  const header = meta ? (
    <div className="break-words">
      <span>{meta.title}</span>
      <span className="font-normal text-muted-foreground">
        {" — "}
        <span className="inline-flex items-center gap-1.5 align-middle">
          <MinecraftAvatar
            uuid={meta.authorUuid}
            skinUrl={meta.authorSkinUrl}
            size={20}
            alt=""
            className="shrink-0 rounded-md"
          />
          {meta.authorName}
        </span>
      </span>
      {meta.gameLanguage && (
        <span className="ml-2 text-xs font-normal text-muted-foreground">
          {t("guideView.embedTemplateLanguage", { language: getGameLanguageName(t, locale, meta.gameLanguage) })}
        </span>
      )}
    </div>
  ) : (
    <span>{t("guideEditor.embedTemplateLabel")}</span>
  );

  return (
    <NodeViewWrapper>
      <EmbedNodeFrame
        broken={meta === null}
        header={header}
        actions={
          <EmbedNodeActions
            selected={selected}
            label={t("guideEditor.embedTemplateLabel")}
            // 宿主の注入は NodeView の初回描画より後になることがあるので、押したときに取り出す
            onEdit={() =>
              getEmbedEditContext(editor)?.editTemplateEmbed((nextId) => updateAttributes({ templateId: nextId }))
            }
            onDelete={() => deleteEmbedNode(editor, getPos, deleteNode)}
          />
        }
      >
        {meta === undefined ? (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground" role="status">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            {t("guideEditor.embedLoading")}
          </p>
        ) : meta === null ? (
          <p className="flex items-start gap-1.5 text-sm text-destructive" role="status">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            {t("guideEditor.embedTemplateMissing")}
          </p>
        ) : (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span>
              {meta.isOwn ? t("guideEditor.embedTemplateMine") : meta.authorName}
              {"・"}
              {t("guideEditor.embedTemplateCraftCount", { count: meta.craftCount })}
            </span>
            {!meta.isPublished && (
              <Badge variant="outline" className="text-xs text-warning border-warning/50">
                {t("guideEditor.embedTemplateUnpublishedBadge")}
              </Badge>
            )}
          </p>
        )}
      </EmbedNodeFrame>
    </NodeViewWrapper>
  );
}
