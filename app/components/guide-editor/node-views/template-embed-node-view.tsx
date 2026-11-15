// サーチクラフトテンプレート埋め込みの編集中表示。ID だけ保存されているため、
// タイトル・言語は軽く取得して出す（取れなければ ID の表示）。
import { useEffect, useState } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import { LayoutTemplate, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useT, useLocale } from "@/hooks/use-locale";
import { getGameLanguageName } from "@/lib/game-languages";
import {
  fetchTemplateEmbedMeta,
  getCachedTemplateEmbedMeta,
  type TemplateEmbedMeta,
} from "../lib/template-embed-meta";

interface Props {
  node: { attrs: Record<string, string> };
  deleteNode: () => void;
}

export function SearchCraftTemplateEmbedNodeView({ node, deleteNode }: Props) {
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

  return (
    <NodeViewWrapper>
      <div className="relative group my-2 rounded-lg border bg-card p-4" contentEditable={false}>
        <div className="flex flex-wrap items-center gap-2 pr-8 text-sm">
          <LayoutTemplate className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">{t("guideEditor.embedTemplateLabel")}</span>
          <span className="min-w-0 break-all text-muted-foreground">
            — {meta ? meta.title : templateId}
          </span>
          {meta?.gameLanguage && (
            <Badge variant="outline" className="text-xs">
              {getGameLanguageName(t, locale, meta.gameLanguage)}
            </Badge>
          )}
          {meta && !meta.isPublished && (
            <Badge variant="outline" className="text-xs text-warning border-warning/50">
              {t("guideEditor.embedTemplateUnpublishedBadge")}
            </Badge>
          )}
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
