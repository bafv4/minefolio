// 比較バスケット用フック。URL の `ids` パラメータをマスターとして slug 配列を管理する。
// 最大 5 件まで。toggle/has/clear/add/remove を提供。
import { useCallback } from "react";
import { useKeybindingsFilters } from "./use-keybindings-filters";

export const COMPARE_BASKET_LIMIT = 5;

export function useCompareBasket() {
  const { params, setIds } = useKeybindingsFilters();
  const ids = params.ids;
  const count = ids.length;
  const isFull = count >= COMPARE_BASKET_LIMIT;

  const has = useCallback((slug: string) => ids.includes(slug), [ids]);

  const add = useCallback(
    (slug: string) => {
      if (ids.includes(slug) || ids.length >= COMPARE_BASKET_LIMIT) return;
      setIds([...ids, slug]);
    },
    [ids, setIds],
  );

  const remove = useCallback(
    (slug: string) => {
      if (!ids.includes(slug)) return;
      setIds(ids.filter((s) => s !== slug));
    },
    [ids, setIds],
  );

  const toggle = useCallback(
    (slug: string) => {
      if (ids.includes(slug)) {
        setIds(ids.filter((s) => s !== slug));
      } else if (ids.length < COMPARE_BASKET_LIMIT) {
        setIds([...ids, slug]);
      }
    },
    [ids, setIds],
  );

  const clear = useCallback(() => setIds([]), [setIds]);

  return { ids, count, isFull, has, add, remove, toggle, clear };
}
