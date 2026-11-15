// サーチクラフトテンプレート埋め込みの選択ダイアログ。guide-link-search.tsx と同型。
// タイトル検索（自分のテンプレートは非公開を含めて先頭）と、詳細ページ URL / ID の貼り付けに対応する。
import { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useT, useLocale } from "@/hooks/use-locale";
import { getGameLanguageName } from "@/lib/game-languages";
import { parseTemplateIdInput } from "@/lib/guide-embed-attrs";
import type { TemplateEmbedMeta } from "../lib/template-embed-meta";
import { Search, Loader2, LayoutTemplate } from "lucide-react";

interface TemplateEmbedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInsert: (template: TemplateEmbedMeta) => void;
}

const SEARCH_DEBOUNCE_MS = 300;

export function TemplateEmbedDialog({ open, onOpenChange, onInsert }: TemplateEmbedDialogProps) {
  const t = useT();
  const locale = useLocale();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TemplateEmbedMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // 古い応答が新しい結果を上書きしないよう、最新のリクエスト番号だけ反映する
  const requestSeq = useRef(0);

  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  // debounce 検索。空クエリでも自分のテンプレート＋新着を出す。URL / ID は ID 指定で引く
  useEffect(() => {
    if (!open) return;
    clearTimeout(timer.current);
    const seq = ++requestSeq.current;
    setLoading(true);
    timer.current = setTimeout(async () => {
      const trimmed = query.trim();
      const pastedId = parseTemplateIdInput(trimmed);
      const params = pastedId
        ? `id=${encodeURIComponent(pastedId)}`
        : `q=${encodeURIComponent(trimmed)}`;
      try {
        const res = await fetch(`/api/guides/templates-search?${params}`);
        if (res.ok && seq === requestSeq.current) {
          const data = (await res.json()) as { templates: TemplateEmbedMeta[] };
          setResults(data.templates);
        }
      } catch {
        /* ignore */
      }
      if (seq === requestSeq.current) setLoading(false);
    }, query ? SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(timer.current);
  }, [query, open]);

  const select = (template: TemplateEmbedMeta) => {
    onInsert(template);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("guideEditor.embedTemplateTitle")}</DialogTitle>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("guideEditor.embedTemplateSearchPlaceholder")}
            aria-label={t("guideEditor.embedTemplateSearchPlaceholder")}
            className="pl-8"
            autoFocus
          />
        </div>
        <div className="max-h-72 overflow-y-auto -mx-1" role="listbox" aria-label={t("guideEditor.ui.searchResults")}>
          {loading ? (
            <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-6">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("guideEditor.ui.searching")}
            </p>
          ) : results.length > 0 ? (
            results.map((template) => (
              <button
                key={template.id}
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => select(template)}
                className="w-full flex items-start gap-3 px-2 py-2 rounded-md text-left hover:bg-muted transition-colors"
              >
                <span className="mt-0.5 h-8 w-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                  <LayoutTemplate className="h-4 w-4 text-muted-foreground" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium break-words">{template.title}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                    <span>{template.isOwn ? t("guideEditor.embedTemplateMine") : template.authorName}</span>
                    {template.gameLanguage && (
                      <span>{getGameLanguageName(t, locale, template.gameLanguage)}</span>
                    )}
                    <span>{t("guideEditor.embedTemplateCraftCount", { count: template.craftCount })}</span>
                  </span>
                  {!template.isPublished && (
                    <Badge variant="outline" className="mt-1 text-xs text-warning border-warning/50 whitespace-normal">
                      {t("guideEditor.embedTemplateUnpublishedNote")}
                    </Badge>
                  )}
                </span>
              </button>
            ))
          ) : (
            <p className="text-sm text-muted-foreground text-center py-6">
              {t("guideEditor.embedTemplateNone")}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
