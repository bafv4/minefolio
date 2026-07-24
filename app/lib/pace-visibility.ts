// ペースフィードの「自分のペースを隠す」設定の適用ロジック。
// /paces のページ（クライアント側の一覧フィルタ）と loader（件数バッジの算出）の
// 両方から使い、表示件数とカード数がずれないようにする。
// ※ フィード本体のレスポンス（/api/paces）はユーザー非依存＝CDNキャッシュ対象のため、
//    除外は常にこのクライアント側ロジックで行う（feed-video.ts の filterOwnVideos と同じ方針）

/** 表示設定のうち、ペースの除外判定に必要な部分 */
export interface OwnPacePrefs {
  mcid: string | null;
  showPacemanOnHome: boolean;
}

/** 除外対象のMCID（小文字）。除外しない場合は null */
export function getHiddenPaceMcid(prefs: OwnPacePrefs): string | null {
  return prefs.showPacemanOnHome === false && prefs.mcid
    ? prefs.mcid.toLowerCase()
    : null;
}

/** 自分のペースを設定に従って除外する（MCIDは大文字小文字を無視して比較） */
export function filterOwnPaces<T extends { mcid: string }>(
  paces: T[],
  prefs: OwnPacePrefs,
): T[] {
  const hiddenMcid = getHiddenPaceMcid(prefs);
  if (!hiddenMcid) return paces;
  return paces.filter((p) => p.mcid.toLowerCase() !== hiddenMcid);
}
