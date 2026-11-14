// ペースフィードで扱う区間（Enter Nether を除く、進行順）
// サーバー側のバリデーションとクライアント側の選択肢で共用する
export const PACE_FEED_SPLITS = [
  "Bastion",
  "Fortress",
  "First Portal",
  "Obtain Blaze Rods",
  "Enter Stronghold",
  "Enter End",
  "Finish",
] as const;

// スプリットIDの正規タイムライン名（SPLIT_MARK_ITEM / pacemanPaces.timeline と同じ語彙）
const SPLIT_TIMELINES: Record<string, string> = {
  "rsg.enter_nether": "Enter Nether",
  "rsg.enter_bastion": "Bastion",
  "rsg.enter_fortress": "Fortress",
  "rsg.first_portal": "First Portal",
  "rsg.second_portal": "Second Portal",
  "rsg.enter_stronghold": "Enter Stronghold",
  "rsg.enter_end": "Enter End",
  "rsg.credits": "Finish",
};

// 英語表示ラベル（正規タイムライン名との差分は First Portal の口語表記 "Blind" のみ）
const SPLIT_LABELS_EN: Record<string, string> = {
  ...SPLIT_TIMELINES,
  "rsg.first_portal": "Blind",
};

/**
 * スプリットIDを英語ラベルに変換
 */
export function getSplitLabelEnglish(eventId: string): string {
  return SPLIT_LABELS_EN[eventId] || eventId.replace("rsg.", "").replace(/_/g, " ");
}

/**
 * スプリットIDを PaceManSplitMark（アイコン+名称チップ）等で使う共通タイムライン名に変換する。
 * getSplitLabelEnglish の口語表記（"Blind" 等）ではなく、SPLIT_MARK_ITEM や
 * pacemanPaces.timeline と同じ語彙（"First Portal" 等）に揃える。
 */
export function getSplitTimeline(eventId: string): string {
  return SPLIT_TIMELINES[eventId] || getSplitLabelEnglish(eventId);
}
