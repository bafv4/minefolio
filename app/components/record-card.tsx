import { formatTime } from "@/lib/time-utils";
import { isHttpUrl } from "@/lib/safe-url";
import { cn } from "@/lib/utils";
import { useT } from "@/hooks/use-locale";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, ExternalLink, Pin, Target } from "lucide-react";

export type RecordCardRecord = {
  id: string;
  category: string;
  categoryDisplayName: string;
  subcategory: string | null;
  personalBest: number | null;
  targetTime: number | null;
  achieved: boolean;
  pbVideoUrl: string | null;
  pbNotes: string | null;
  isPinned?: boolean;
};

/**
 * 手入力のカスタム記録1件のカード（走者画面の記録タブと /player/:slug/stats で共有）。
 * 見出しは h4 相当（欄見出し h3 の下に並べる前提）
 */
export function RecordCard({
  record,
}: {
  record: RecordCardRecord;
}) {
  const t = useT();
  return (
    // ピン留め記録はグリッド2列分に拡大し、枠線で強調する
    <Card className={cn("gap-3 py-5", record.isPinned && "md:col-span-2 border-primary/40")}>
      <CardHeader className="px-5">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle role="heading" aria-level={4} className="text-base flex items-center gap-1.5">
              {record.isPinned && <Pin className="h-4 w-4 text-primary shrink-0" />}
              {record.categoryDisplayName}
            </CardTitle>
            {record.subcategory && (
              <CardDescription>{record.subcategory}</CardDescription>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-5 space-y-2">
        {record.personalBest && (
          <div className="flex items-baseline gap-2">
            <span className={cn("font-mono font-bold", record.isPinned ? "text-3xl" : "text-2xl")}>
              {formatTime(record.personalBest)}
            </span>
            <span className="text-sm text-muted-foreground">{t("playerProfile.pb")}</span>
          </div>
        )}
        {record.targetTime && (
          <div className="flex items-center gap-2 text-sm">
            <Target className="h-4 w-4 text-muted-foreground" />
            <span>{t("playerProfile.target")}: {formatTime(record.targetTime)}</span>
            {record.achieved && (
              <CheckCircle2 className="h-4 w-4 text-success" />
            )}
          </div>
        )}
        {record.pbVideoUrl && isHttpUrl(record.pbVideoUrl) && (
          <Button variant="outline" size="sm" asChild className="w-full mt-2">
            <a
              href={record.pbVideoUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink className="mr-2 h-4 w-4" />
              {t("playerProfile.watchVideo")}
            </a>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
