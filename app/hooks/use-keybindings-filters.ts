// /keybindings 配下の URL ↔ state を統合管理する facade フック。
// nuqs の useQueryStates をラップし、フィルタの派生値とプレイヤー適用ヘルパーを提供する。
import { useMemo } from "react";
import { useQueryStates } from "nuqs";
import {
  keybindingsParsers,
  parseSort,
  formatSort,
  type Tab,
} from "@/lib/keybindings-search-params";
import { calculateCm360, toSensitivityPercent } from "@/lib/mouse-settings";

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
  // フィルタ（数値範囲・ユーザー絞り込み）・サブタブはクライアント側で完結する。
  const [params, setParams] = useQueryStates(keybindingsParsers);

  const setTab = (tab: Tab) => setParams({ tab });
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

  // 表示ユーザー絞り込み（slug 一覧）。表・ビジュアル横断でクライアント適用。
  const setUsers = (users: string[]) =>
    setParams({ users: users.length > 0 ? users : null });
  const toggleUser = (slug: string) => {
    const next = params.users.includes(slug)
      ? params.users.filter((s) => s !== slug)
      : [...params.users, slug];
    setUsers(next);
  };
  const clearUsers = () => setUsers([]);

  /**
   * 表示に効いているフィルタ（数値範囲 + ユーザー絞り込み）を一括解除する。
   * 0件の空状態からの復帰用。ソート・タブは表示件数に影響しないので残す。
   */
  const clearFilters = () =>
    setParams({
      dpiMin: null,
      dpiMax: null,
      sensMin: null,
      sensMax: null,
      cm360Min: null,
      cm360Max: null,
      users: null,
    });

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (params.dpiMin != null || params.dpiMax != null) count += 1;
    if (params.sensMin != null || params.sensMax != null) count += 1;
    if (params.cm360Min != null || params.cm360Max != null) count += 1;
    return count;
  }, [
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
      users,
    } = params;

    // 表示ユーザー絞り込み（指定があれば、その slug のみ表示）
    if (users.length > 0) {
      const set = new Set(users);
      players = players.filter((p) => set.has(p.slug));
    }

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
      // 感度は内部 0-1 値。UI 入力は一覧の表示と同じ 0〜200%（Minecraft 準拠）想定なので、
      // 比較も一覧表示と同じ toSensitivityPercent（*200 + floor）のパーセント値で行う。
      const sensPercent = toSensitivityPercent(sens);
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

  /** 表示件数に効くフィルタが1つでも有効か（空状態の文言・クリア導線の出し分け用） */
  const hasActiveFilters = activeFilterCount > 0 || params.users.length > 0;

  return {
    params,
    setParams,
    setTab,
    setRange,
    setSort,
    setUsers,
    toggleUser,
    clearUsers,
    clearFilters,
    activeFilterCount,
    hasActiveFilters,
    sort,
    applyToPlayers,
  };
}
