import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowUpDown } from "lucide-react";
import { useT } from "@/hooks/use-locale";
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
  descriptions,
}: {
  value: ContentSort;
  onChange: (value: ContentSort) => void;
  /** 表示する選択肢（一覧ごとに異なる。GUIDE_SORTS / TEMPLATE_SORTS） */
  options: readonly ContentSort[];
  /** 既定順のラベル。ガイドは updatedAt 基準で「更新順」、テンプレートは createdAt 基準で「新着順」 */
  newestLabel: string;
  /**
   * 各選択肢の「何を基準に並ぶか」を補足する説明（翻訳済みの文字列）。
   * 同じキーでも一覧によって基準が変わりうる（likes の母数など）ため、
   * ここでは翻訳キーを固定せず呼び出し側から渡す。未指定のキーは1行のまま。
   */
  descriptions?: Partial<Record<ContentSort, string>>;
}) {
  const t = useT();
  const label = (sort: ContentSort) => {
    if (sort === "new") return newestLabel;
    if (sort === "likes") return t("contentSort.likes");
    if (sort === "views") return t("contentSort.views");
    return t("contentSort.popular");
  };

  return (
    <div className="flex shrink-0 items-center gap-2">
      <ArrowUpDown className="h-4 w-4 text-muted-foreground" aria-hidden />
      <Select value={value} onValueChange={(next) => onChange(next as ContentSort)}>
        <SelectTrigger className="w-[130px]" aria-label={t("contentSort.label")}>
          {/* SelectValue に children を渡して、トリガーの表示を常に1行ラベルに固定する。
              Radix は valueNode に children があると SelectItemText のポータルを行わないため、
              選択中の項目に説明があってもトリガーへは転送されない（2行入ると崩れるため）。 */}
          <SelectValue>{label(value)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((sort) => {
            const description = descriptions?.[sort];
            return (
              // textValue はキーボードのタイプアヘッド用。説明文まで含めると
              // 打鍵での絞り込みが効かなくなるのでラベルだけを渡す
              <SelectItem key={sort} value={sort} textValue={label(sort)}>
                {description ? (
                  // ItemText の中身は span 相当なので div は使わない（不正なHTMLになる）
                  <span className="flex flex-col gap-0.5">
                    <span>{label(sort)}</span>
                    <span className="text-xs text-muted-foreground">{description}</span>
                  </span>
                ) : (
                  label(sort)
                )}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
}
