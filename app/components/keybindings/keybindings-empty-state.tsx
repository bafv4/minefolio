// /keybindings の 0 件表示（表・ビジュアル共通）。
// フィルタで 0 件になった場合は理由が伝わる文言に切り替え、その場で解除できる導線を出す。
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useKeybindingsFilters } from "@/hooks/use-keybindings-filters";
import { useT } from "@/hooks/use-locale";
import { cn } from "@/lib/utils";

export function KeybindingsEmptyState({ className }: { className?: string }) {
  const t = useT();
  const { hasActiveFilters, clearFilters } = useKeybindingsFilters();

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 py-12 text-sm text-muted-foreground",
        className,
      )}
    >
      <p>
        {hasActiveFilters
          ? t("keybindings.emptyFiltered")
          : t("keybindings.noPlayers")}
      </p>
      {hasActiveFilters && (
        <Button variant="outline" size="sm" onClick={clearFilters}>
          <X className="h-4 w-4 mr-1" />
          {t("keybindings.clearFilter")}
        </Button>
      )}
    </div>
  );
}
