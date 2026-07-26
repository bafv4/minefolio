import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowUpDown } from "lucide-react";
import { t } from "@/lib/messages";
import type { ContentSort } from "@/lib/content-sort";

// 並び順の型・選択肢・パースは React 非依存の @/lib/content-sort にある
// （ローダー側の guideListOrderBy と定義を共有するため）。
export {
  parseContentSort,
  GUIDE_SORTS,
  TEMPLATE_SORTS,
  type ContentSort,
} from "@/lib/content-sort";

export function ContentSortSelect({
  value,
  onChange,
  options,
  newestLabel,
}: {
  value: ContentSort;
  onChange: (value: ContentSort) => void;
  /** 表示する選択肢（一覧ごとに異なる。GUIDE_SORTS / TEMPLATE_SORTS） */
  options: readonly ContentSort[];
  /** 既定順のラベル。ガイドは updatedAt 基準で「更新順」、テンプレートは createdAt 基準で「新着順」 */
  newestLabel: string;
}) {
  const label = (sort: ContentSort) => {
    if (sort === "new") return newestLabel;
    if (sort === "recommended") return t("contentSort.recommended");
    return t("contentSort.popular");
  };

  return (
    <div className="flex shrink-0 items-center gap-2">
      <ArrowUpDown className="h-4 w-4 text-muted-foreground" aria-hidden />
      <Select value={value} onValueChange={(next) => onChange(next as ContentSort)}>
        <SelectTrigger className="w-[130px]" aria-label={t("contentSort.label")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((sort) => (
            <SelectItem key={sort} value={sort}>
              {label(sort)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
