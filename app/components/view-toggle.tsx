import { useT } from "@/hooks/use-locale";
import { Button } from "@/components/ui/button";
import { LayoutGrid, List } from "lucide-react";

type ViewMode = "card" | "list";

/** カード/リスト表示切替トグル。ドメイン非依存の共有コンポーネント */
export function ViewToggle({
  viewMode,
  onChange,
}: {
  viewMode: ViewMode;
  onChange: (mode: ViewMode) => void;
}) {
  const t = useT();
  return (
    <div className="flex border rounded-md">
      <Button
        variant={viewMode === "card" ? "default" : "ghost"}
        size="icon"
        className="size-11 rounded-r-none sm:size-8"
        onClick={() => onChange("card")}
        aria-label={t("viewToggle.card")}
        aria-pressed={viewMode === "card"}
      >
        <LayoutGrid className="h-4 w-4" />
      </Button>
      <Button
        variant={viewMode === "list" ? "default" : "ghost"}
        size="icon"
        className="size-11 rounded-l-none sm:size-8"
        onClick={() => onChange("list")}
        aria-label={t("viewToggle.list")}
        aria-pressed={viewMode === "list"}
      >
        <List className="h-4 w-4" />
      </Button>
    </div>
  );
}
