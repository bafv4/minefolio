/**
 * 区間（セグメント）の表示名の辞書。アイテム配置とサーチクラフトのタイミングで共有する。
 * 表示名だけを持つ。保存データの値（アイテム配置の segment 文字列・サーチクラフトの timing id）は変えない。
 * 固有名詞なので翻訳しない。
 */
export const SEGMENT_LABELS = {
  ow: "OW",
  bastion: "Bastion",
  bastion_fort: "Bastion→Fort",
  fortress: "Fortress",
  blinded: "Blinded",
} as const;

/** アイテム配置に保存されている segment 文字列 → 区間の表示名（辞書にある区間だけ） */
const ITEM_SEGMENT_VALUE_TO_LABEL: Record<string, string> = {
  Overworld: SEGMENT_LABELS.ow,
  Bastion: SEGMENT_LABELS.bastion,
  "Bastion → Fort": SEGMENT_LABELS.bastion_fort,
  Fortress: SEGMENT_LABELS.fortress,
};

/** アイテム配置の segment 値から表示名を引く。辞書に無い値（Common・カスタム名など）はそのまま返す */
export function itemSegmentLabel(value: string): string {
  return ITEM_SEGMENT_VALUE_TO_LABEL[value] ?? value;
}
