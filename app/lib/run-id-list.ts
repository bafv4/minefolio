// users.hiddenSpeedrunRecords / users.pinnedSpeedrunRecords 共通の
// 「run ID の配列を JSON 文字列で保持する」形式のヘルパー。
// 非表示・ピン留めのトグル（サーバーaction / クライアント楽観的更新）で共用する。

export function parseRunIdList(json: string | null): string[] {
  return json ? JSON.parse(json) : [];
}

export function toggleRunId(list: string[], runId: string): string[] {
  return list.includes(runId) ? list.filter((id) => id !== runId) : [...list, runId];
}
