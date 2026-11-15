// サーチクラフトテンプレート埋め込みの編集中表示。ID だけ保存されているため、
// タイトル・言語・件数は軽く取得して出す。読み込み中・見つからない（未公開の他人のもの・削除済み・ID 不正）も
// それと分かる表示にする（キー配置 / サーチクラフト埋め込みの embed-node-view.tsx と同じ 3 状態）。
import { useEffect, useState } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import { AlertTriangle, LayoutTemplate, Loader2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
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
      <div
        className={cn("relative group my-2 rounded-lg border bg-card p-4", meta === null && "border-dashed border-destructive/50")}
        contentEditable={false}
      >
        <div className="flex items-start gap-2 pr-8">
          <LayoutTemplate className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="text-xs font-medium text-muted-foreground">{t("guideEditor.embedTemplateLabel")}</p>
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
              <>
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <span className="min-w-0 break-words font-medium">{meta.title}</span>
                  {meta.gameLanguage && (
                    <Badge variant="outline" className="text-xs">
                      {getGameLanguageName(t, locale, meta.gameLanguage)}
                    </Badge>
                  )}
                  {!meta.isPublished && (
                    <Badge variant="outline" className="text-xs text-warning border-warning/50">
                      {t("guideEditor.embedTemplateUnpublishedBadge")}
                    </Badge>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {meta.isOwn ? t("guideEditor.embedTemplateMine") : meta.authorName}
                  {"・"}
                  {t("guideEditor.embedTemplateCraftCount", { count: meta.craftCount })}
                </p>
              </>
            )}
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
