// /keybindings 配下の URL ↔ state を統合管理する facade フック。
// nuqs の useQueryStates をラップし、フィルタの派生値とプレイヤー適用ヘルパーを提供する。
import { createContext, useCallback, useContext, useMemo } from "react";
import { useQueryStates } from "nuqs";
import {
  keybindingsParsers,
  parseSort,
  formatSort,
  parseBindConditions,
  resolveKnownUsers,
  upsertBindCondition,
  formatBindCondition,
  type BindCondition,
  sortKeyBelongsToTab,
  type Tab,
} from "@/lib/keybindings-search-params";
import { rowMatchesBind, type BoundKeyRow } from "@/lib/keybindings-filter";
import { calculateCm360, toSensitivityPercent } from "@/lib/mouse-settings";

/** プレイヤー型（applyToPlayers が読み取る最小集合） */
export type FilterablePlayer = {
  slug: string;
  /** 操作＝キーの絞り込み用。持たない行（キー配置の無い走者）は条件を満たさない */
  keybindings?: BoundKeyRow["keybindings"];
  customKeys?: BoundKeyRow["customKeys"];
  playerConfig?: {
    keyboardLayout?: string | null;
    mouseDpi: number | null;
    gameSensitivity: number | null;
    rawInput: boolean | null;
    windowsSpeed: number | null;
    windowsSpeedMultiplier: number | null;
  } | null;
};

/**
 * 一覧に載る走者の slug 集合。layout が提供すると、URL の `users` から実在しない slug を捨てて扱う
 * （チップ・件数・注記・絞り込みがそろう）。提供が無い場所では URL のまま。
 */
export const KnownRunnerSlugsContext = createContext<ReadonlySet<string> | null>(null);

export function useKeybindingsFilters() {
  // フィルタ（数値範囲・ユーザー絞り込み）・サブタブはクライアント側で完結する。
  const [rawParams, setParams] = useQueryStates(keybindingsParsers);
  const knownSlugs = useContext(KnownRunnerSlugsContext);
  const params = useMemo(
    () =>
      knownSlugs
        ? { ...rawParams, users: resolveKnownUsers(rawParams.users, knownSlugs) }
        : rawParams,
    [rawParams, knownSlugs],
  );

  // タブを替えるとき、移った先に無い列の並べ替えは外す（黙って効かない sort を残さない）
  const setTab = (tab: Tab) => {
    const current = parseSort(params.sort);
    setParams({
      tab,
      ...(current && !sortKeyBelongsToTab(current.key, tab) ? { sort: null } : {}),
    });
  };
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

  // 操作＝キーの絞り込み（"action:keyCode"）。同じ操作の条件は置き換える。
  const bindConditions = useMemo(() => parseBindConditions(params.bind), [params.bind]);
  const setBindConditions = (conds: BindCondition[]) =>
    setParams({ bind: conds.length > 0 ? conds.map(formatBindCondition) : null });
  const addBindCondition = (cond: BindCondition) =>
    setParams({ bind: upsertBindCondition(params.bind, cond) });
  const removeBindCondition = (action: string) =>
    setBindConditions(bindConditions.filter((c) => c.action !== action));

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
      bind: null,
    });

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (params.dpiMin != null || params.dpiMax != null) count += 1;
    if (params.sensMin != null || params.sensMax != null) count += 1;
    if (params.cm360Min != null || params.cm360Max != null) count += 1;
    count += bindConditions.length;
    return count;
  }, [
    bindConditions,
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
  const applyToPlayers = useCallback(<P extends FilterablePlayer>(players: P[]): P[] => {
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

    // 操作＝キーの絞り込み（全条件を満たす走者のみ）
    if (bindConditions.length > 0) {
      players = players.filter((p) =>
        rowMatchesBind(
          { keybindings: p.keybindings ?? [], customKeys: p.customKeys, playerConfig: p.playerConfig },
          bindConditions,
        ),
      );
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
  }, [params, bindConditions]);

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
    bindConditions,
    addBindCondition,
    removeBindCondition,
    clearFilters,
    activeFilterCount,
    hasActiveFilters,
    sort,
    applyToPlayers,
  };
}
