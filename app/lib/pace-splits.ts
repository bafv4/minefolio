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

export type PaceFeedSplit = (typeof PACE_FEED_SPLITS)[number];
