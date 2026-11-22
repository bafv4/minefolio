// users.hiddenSpeedrunRecords / users.pinnedSpeedrunRecords 共通の
// 「run ID の配列を JSON 文字列で保持する」形式のヘルパー。
// 非表示・ピン留めのトグル（サーバーaction / クライアント楽観的更新）で共用する。

export function parseRunIdList(json: string | null): string[] {
  if (!json) return [];
  // 列の値が壊れていても loader（プロフィール・記録ページ）を 500 にしない
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

export function toggleRunId(list: string[], runId: string): string[] {
  return list.includes(runId) ? list.filter((id) => id !== runId) : [...list, runId];
}

/** 2つの run ID リストが、順序を問わず同じ集合か（下書きと保存済みの差分判定用） */
export function sameRunIdSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return set.size === new Set(b).size && b.every((id) => set.has(id));
}

/** 1ユーザーが保持できる run ID の上限（改ざんされた巨大なリストで列を膨らませない） */
export const MAX_RUN_IDS = 500;

/**
 * フォームから届いた JSON 配列文字列を run ID リストに正規化する（重複除去・空文字除去）。
 * 配列でない・文字列以外を含む・上限超過のときは null。
 */
export function parseRunIdListInput(value: FormDataEntryValue | null): string[] | null {
  if (typeof value !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length > MAX_RUN_IDS) return null;
  if (!parsed.every((id): id is string => typeof id === "string")) return null;
  return [...new Set(parsed.filter((id) => id.length > 0 && id.length <= 100))];
}
