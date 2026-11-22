// /keybindings の 0 件表示（表・ビジュアル共通）。
// フィルタで 0 件になった場合は理由が伝わる文言に切り替え、その場で解除できる導線を出す。
import { Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { useKeybindingsFilters } from "@/hooks/use-keybindings-filters";
import { useT } from "@/hooks/use-locale";

/**
 * @param noTabData 絞り込み後の走者は居るが、このタブのデータを持つ人が居ない（表のタブ用）。
 *   フィルタに一致する走者が居ないのとは原因が違うので、文言を分ける
 */
export function KeybindingsEmptyState({ noTabData = false }: { noTabData?: boolean } = {}) {
  const t = useT();
  const { hasActiveFilters, clearFilters } = useKeybindingsFilters();
  const filteredButNoTabData = hasActiveFilters && noTabData;

  return (
    <div className="p-4">
      <EmptyState
        icon={<Users className="h-12 w-12" />}
        title={
          filteredButNoTabData
            ? t("keybindings.emptyNoTabData")
            : hasActiveFilters
              ? t("keybindings.emptyFiltered")
              : t("keybindings.noPlayers")
        }
        description={
          filteredButNoTabData
            ? t("keybindings.emptyNoTabDataHint")
            : hasActiveFilters
              ? t("keybindings.emptyFilteredHint")
              : t("keybindings.emptyHint")
        }
        action={
          hasActiveFilters ? (
            <Button variant="outline" size="sm" onClick={clearFilters}>
              <X className="h-4 w-4" />
              {t("keybindings.clearFilter")}
            </Button>
          ) : undefined
        }
      />
    </div>
  );
}
