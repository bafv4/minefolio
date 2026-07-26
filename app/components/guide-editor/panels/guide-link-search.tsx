// ガイドリンク検索ダイアログ。タイトルで検索し、選択したガイドをカードとして挿入。
// 旧 index.tsx の手動ポップオーバー + debounce 検索を shadcn Dialog に再構成。
import { useT } from "@/hooks/use-locale";
import { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Search, Loader2, FileText } from "lucide-react";

export interface GuideSearchResult {
  url: string;
  title: string;
  authorName: string;
  coverImageUrl: string | null;
}

interface GuideLinkSearchProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInsert: (guide: GuideSearchResult) => void;
}

const SEARCH_DEBOUNCE_MS = 300;

export function GuideLinkSearch({ open, onOpenChange, onInsert }: GuideLinkSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GuideSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // 開閉でリセット
  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
    }
  }, [open]);

  // debounce 検索
  useEffect(() => {
    clearTimeout(timer.current);
    if (!query.trim()) {
      setResults([]);
      return;
    }
    setLoading(true);
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/guides/search?q=${encodeURIComponent(query.trim())}`);
        if (res.ok) {
          const data = await res.json();
          setResults(data.guides);
        }
      } catch {
        /* ignore */
      }
      setLoading(false);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer.current);
  }, [query]);

  const t = useT();
  const select = (guide: GuideSearchResult) => {
    onInsert(guide);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("guideEditor.ui.insertGuideLink")}</DialogTitle>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("guideEditor.ui.searchByTitle")}
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
            results.map((guide) => (
              <button
                key={guide.url}
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => select(guide)}
                className="w-full flex items-center gap-3 px-2 py-2 rounded-md text-left hover:bg-muted transition-colors"
              >
                {guide.coverImageUrl ? (
                  <img
                    src={guide.coverImageUrl}
                    alt=""
                    className="h-10 w-16 rounded object-cover shrink-0"
                  />
                ) : (
                  <span className="h-10 w-16 rounded bg-muted flex items-center justify-center shrink-0">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                  </span>
                )}
                <span className="min-w-0">
                  <span className="block text-sm font-medium truncate">{guide.title}</span>
                  {guide.authorName && (
                    <span className="block text-xs text-muted-foreground truncate">{guide.authorName}</span>
                  )}
                </span>
              </button>
            ))
          ) : query.trim() ? (
            <p className="text-sm text-muted-foreground text-center py-6">{t("guideEditor.ui.noGuidesFound")}</p>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-6">{t("guideEditor.ui.searchByTitle")}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
