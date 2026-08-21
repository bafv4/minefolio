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
