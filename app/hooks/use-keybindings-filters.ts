// /keybindings 配下の URL ↔ state を統合管理する facade フック。
// nuqs の useQueryStates をラップし、フィルタの派生値とプレイヤー適用ヘルパーを提供する。
import { useMemo } from "react";
import { useQueryStates } from "nuqs";
import {
  keybindingsParsers,
  parseSort,
  formatSort,
  type View,
  type Tab,
} from "@/lib/keybindings-search-params";
import { calculateCm360 } from "@/lib/mouse-settings";

/** プレイヤー型（applyToPlayers が読み取る最小集合） */
export type FilterablePlayer = {
  slug: string;
  playerConfig?: {
    mouseDpi: number | null;
    gameSensitivity: number | null;
    rawInput: boolean | null;
    windowsSpeed: number | null;
    windowsSpeedMultiplier: number | null;
  } | null;
};

export function useKeybindingsFilters() {
  // `q` だけは loader を再走させる必要があるため shallow: false。
  // それ以外の URL パラメータはクライアント側で完結する（デフォルト shallow: true）。
  const [params, setParams] = useQueryStates(keybindingsParsers);

  const setView = (view: View) => setParams({ view });
  const setTab = (tab: Tab) => setParams({ tab });
  const setQ = (q: string) =>
    setParams({ q: q || null }, { shallow: false });
  const setRange = (
    range: Partial<{
      dpiMin: number | null;
      dpiMax: number | null;
      sensMin: number | null;
      sensMax: number | null;
      cm360Min: number | null;
      cm360Max: number | null;
    }>,
  ) => setParams(range);
  const setSort = (key: string | null, direction: "asc" | "desc" | null) =>
    setParams({ sort: key && direction ? formatSort(key, direction) : null });
  const setIds = (ids: string[]) => setParams({ ids });
  const clearAll = () =>
    setParams({
      q: null,
      dpiMin: null,
      dpiMax: null,
      sensMin: null,
      sensMax: null,
      cm360Min: null,
      cm360Max: null,
      sort: null,
    });

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (params.q) count += 1;
    if (params.dpiMin != null || params.dpiMax != null) count += 1;
    if (params.sensMin != null || params.sensMax != null) count += 1;
    if (params.cm360Min != null || params.cm360Max != null) count += 1;
    return count;
  }, [
    params.q,
    params.dpiMin,
    params.dpiMax,
    params.sensMin,
    params.sensMax,
    params.cm360Min,
    params.cm360Max,
  ]);

  const sort = useMemo(() => parseSort(params.sort), [params.sort]);

  /**
   * 数値範囲フィルタをプレイヤーリストに適用。
   * 検索（q）はサーバー側で適用済み前提。ここではマウス系のみ。
   */
  function applyToPlayers<P extends FilterablePlayer>(players: P[]): P[] {
    const {
      dpiMin,
      dpiMax,
      sensMin,
      sensMax,
      cm360Min,
      cm360Max,
    } = params;

    const hasMouseFilter =
      dpiMin != null ||
      dpiMax != null ||
      sensMin != null ||
      sensMax != null ||
      cm360Min != null ||
      cm360Max != null;

    if (!hasMouseFilter) return players;

    return players.filter((p) => {
      const config = p.playerConfig;
      const dpi = config?.mouseDpi ?? null;
      const sens = config?.gameSensitivity ?? null;
      const cm360 =
        config != null
          ? calculateCm360(
              config.mouseDpi,
              config.gameSensitivity,
              config.rawInput,
              config.windowsSpeed,
              config.windowsSpeedMultiplier,
            )
          : null;

      if (dpiMin != null && (dpi == null || dpi < dpiMin)) return false;
      if (dpiMax != null && (dpi == null || dpi > dpiMax)) return false;
      // 感度は内部 0-1 値。UI 入力は % 想定なので比較も % で行う。
      const sensPercent = sens != null ? sens * 100 : null;
      if (sensMin != null && (sensPercent == null || sensPercent < sensMin)) {
        return false;
      }
      if (sensMax != null && (sensPercent == null || sensPercent > sensMax)) {
        return false;
      }
      if (cm360Min != null && (cm360 == null || cm360 < cm360Min)) return false;
      if (cm360Max != null && (cm360 == null || cm360 > cm360Max)) return false;
      return true;
    });
  }

  return {
    params,
    setParams,
    setView,
    setTab,
    setQ,
    setRange,
    setSort,
    setIds,
    clearAll,
    activeFilterCount,
    sort,
    applyToPlayers,
  };
}
