/** 外部統計サービス1つの取得状態 */
export type StatsServiceLoadPhase = "loading" | "done" | "error";

/**
 * 記録タブでサービスごとの「読み込み・失敗」の見せ方を決める。
 * - "card": 読み込み中の欄（記録がある見込みがあるとき）／失敗の欄（再試行のため）
 * - "checking": 見込みが無いので欄は出さず、1行の確認中表示だけにする
 * - "none": 出さない（取得済み、または表示設定がオフ）。取得済みの中身は呼び出し側が描く
 */
export function statsServiceDisplay(opts: {
  /** 欄を出してよい（表示設定がオン・週間統計が無い、など） */
  enabled: boolean;
  state: StatsServiceLoadPhase;
  /** 取得前に記録がある見込みが分かっているか */
  expected: boolean;
}): "card" | "checking" | "none" {
  const { enabled, state, expected } = opts;
  if (!enabled || state === "done") return "none";
  if (state === "error") return "card";
  return expected ? "card" : "checking";
}
