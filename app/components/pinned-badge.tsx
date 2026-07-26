import { cn } from "@/lib/utils";
import { useT } from "@/hooks/use-locale";
import { Badge } from "@/components/ui/badge";
import { Pin } from "lucide-react";

/** ピン留め中を示すバッジ（記録・ガイド等の管理画面で共用） */
export function PinnedBadge({ className }: { className?: string }) {
  const t = useT();
  return (
    <Badge variant="outline" className={cn("text-xs border-primary/40 text-primary", className)}>
      <Pin className="h-3 w-3 mr-1" />
      {t("common.pinned")}
    </Badge>
  );
}
