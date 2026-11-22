import { useT } from "@/hooks/use-locale";
import { Button } from "@/components/ui/button";
import { LayoutGrid, List } from "lucide-react";
import { cn } from "@/lib/utils";

type ViewMode = "card" | "list";

/** カード/リスト表示切替トグル。ドメイン非依存の共有コンポーネント */
export function ViewToggle({
  viewMode,
  onChange,
  comfortable = false,
}: {
  viewMode: ViewMode;
  onChange: (mode: ViewMode) => void;
  /** true で sm 以上のボタンを 36px にする（隣の入力欄・ボタンが 36px の操作行向け）。既定は 32px */
  comfortable?: boolean;
}) {
  const t = useT();
  return (
    <div className="flex border rounded-md">
      <Button
        variant={viewMode === "card" ? "default" : "ghost"}
        size="icon"
        className={cn("size-11 rounded-r-none", comfortable ? "sm:size-9" : "sm:size-8")}
        onClick={() => onChange("card")}
        aria-label={t("viewToggle.card")}
        aria-pressed={viewMode === "card"}
      >
        <LayoutGrid className="h-4 w-4" />
      </Button>
      <Button
        variant={viewMode === "list" ? "default" : "ghost"}
        size="icon"
        className={cn("size-11 rounded-l-none", comfortable ? "sm:size-9" : "sm:size-8")}
        onClick={() => onChange("list")}
        aria-label={t("viewToggle.list")}
        aria-pressed={viewMode === "list"}
      >
        <List className="h-4 w-4" />
      </Button>
    </div>
  );
}
