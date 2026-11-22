// 手入力の記録（category_records.category）の「カテゴリキー」。
// プロフィールのハイライトが、プレイスタイルのメインカテゴリ（rsg / ssg / aa / ce / ranked）の記録を
// 前方一致で選ぶ（profile-highlights.ts の recordMatchesMainCategory）ため、先頭をカテゴリキーにそろえる。
// 画面ではカテゴリキー（選択式）＋サブカテゴリ（任意）に分けて入力し、保存値は `rsg_any` の形に組み立てる。
import { CATEGORY_KEYS, type CategoryKey } from "@/lib/playstyle";

/** 手入力の記録で選べるカテゴリキー（"other" は先頭一致の対象外＝自由な名前の記録） */
export const RECORD_CATEGORY_KEYS = CATEGORY_KEYS;

/** 保存値をカテゴリキー＋サブカテゴリに分ける。どのキーにも属さない値（既存の自由入力）は "other" ＋全体 */
export function splitRecordCategory(category: string): { key: CategoryKey; suffix: string } {
  const trimmed = category.trim();
  const lower = trimmed.toLowerCase();
  for (const key of CATEGORY_KEYS) {
    if (key === "other") continue;
    if (lower === key) return { key, suffix: "" };
    if (lower.startsWith(`${key}_`) || lower.startsWith(`${key}-`)) {
      return { key, suffix: trimmed.slice(key.length + 1) };
    }
  }
  return { key: "other", suffix: trimmed };
}

/**
 * 編集で送るカテゴリ値。開いた時点のキー・サブカテゴリから変更が無ければ元の値をそのまま返す
 * （`RSG-any` 等を開いて表示名だけ変えても `rsg_any` に正規化されず、`rsg-any` と `rsg_any` を
 * 両方持つ走者でも重複エラーにならない）。変更があるときだけ組み立て直す。
 */
export function resolveRecordCategory(original: string | null, key: CategoryKey, suffix: string): string {
  if (original !== null) {
    const prev = splitRecordCategory(original);
    if (prev.key === key && prev.suffix.trim() === suffix.trim()) return original;
  }
  return buildRecordCategory(key, suffix);
}

/** カテゴリキー＋サブカテゴリから保存値を組み立てる（"other" はサブカテゴリをそのまま使い、空なら "other"） */
export function buildRecordCategory(key: CategoryKey, suffix: string): string {
  const s = suffix.trim();
  if (key === "other") return s || "other";
  return s ? `${key}_${s}` : key;
}
