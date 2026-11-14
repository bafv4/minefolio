import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/use-locale";
import { AlertCircle, RefreshCw } from "lucide-react";

/** 取得失敗時の文言 + 再試行ボタン（ホームの各欄・お気に入りの動き一覧で共用） */
export function FeedErrorNotice({ message, note, onRetry }: { message: string; note?: string; onRetry: () => void }) {
  const t = useT();
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-foreground"
    >
      <AlertCircle className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
      <span className="min-w-0">
        {message}
        {note && <span className="block text-xs text-muted-foreground">{note}</span>}
      </span>
      <Button variant="outline" size="sm" className="ml-auto min-h-11 shrink-0 sm:min-h-8" onClick={onRetry}>
        <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
        {t("home.feedRetry")}
      </Button>
    </div>
  );
}
