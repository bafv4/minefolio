// プロフィールの「年代」の値リスト。schema.ts の users.ageGroup enum と、表示側・検証側
// （me/edit.tsx の action・Select、走者画面）が別々に値リストを持つと同期が崩れやすいため、
// 単一情報源としてここに集約する。`.server` ではないので、クライアントからも値として import できる。
// 値・順序は年代の若い順（Select の選択肢の並びもこの順）。
export const AGE_GROUP_VALUES = [
  "junior_high",
  "high_school",
  "age_18_21",
  "20s",
  "30s",
  "40s",
  "50s",
  "60s_plus",
] as const;

export type AgeGroup = (typeof AGE_GROUP_VALUES)[number];

/** 未知の値は null ではなく undefined（＝不正）として返す。呼び出し側は「未設定」(null) と区別して扱う */
export function parseAgeGroup(value: unknown): AgeGroup | undefined {
  return (AGE_GROUP_VALUES as readonly unknown[]).includes(value) ? (value as AgeGroup) : undefined;
}

/**
 * 公開してよい年代だけを返す。非公開（または未設定）は null。
 * 走者画面の loader がレスポンスへ入れる値はこれを通す（非公開の値を他人のレスポンスに含めない）
 */
export function publicAgeGroup(row: { ageGroup: string | null; ageGroupPublic: boolean }): AgeGroup | null {
  // 未知の値（DB の不整合など）は未設定として扱い、翻訳キーが画面に出ないようにする
  return row.ageGroupPublic ? (parseAgeGroup(row.ageGroup) ?? null) : null;
}
