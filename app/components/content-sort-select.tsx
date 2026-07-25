import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowUpDown } from "lucide-react";
import { t } from "@/lib/messages";

/**
 * ガイド一覧・テンプレート一覧の並び替え。
 * URLクエリ `?sort=` を唯一の指定元にする（共有・ブックマーク可）。
 */
export type ContentSort = "new" | "popular";

/** URLクエリ文字列から並び順を解釈する（不正値・未指定は "new"）。 */
export function parseContentSort(value: string | null): ContentSort {
  return value === "popular" ? "popular" : "new";
}

export function ContentSortSelect({
  value,
  onChange,
  newestLabel,
}: {
  value: ContentSort;
  onChange: (value: ContentSort) => void;
  /** 既定順のラベル。ガイドは updatedAt 基準で「更新順」、テンプレートは createdAt 基準で「新着順」 */
  newestLabel: string;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <ArrowUpDown className="h-4 w-4 text-muted-foreground" aria-hidden />
      <Select value={value} onValueChange={(next) => onChange(next as ContentSort)}>
        <SelectTrigger className="w-[130px]" aria-label={t("contentSort.label")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="new">{newestLabel}</SelectItem>
          <SelectItem value="popular">{t("contentSort.popular")}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
