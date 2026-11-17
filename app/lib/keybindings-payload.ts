/**
 * /me/keybindings の保存ペイロード（リマップ・カスタムキー・カスタムアクション）の形・長さの検証。
 * 書き込みを始める前（トランザクションの外）に呼び、1行でも不正なら保存全体を拒否する。
 *
 * - `_delete` の行は id だけ検証する（削除する行の中身は使わない）
 * - 新規の空行（キー名などが空）は従来どおり保存時に黙ってスキップされるため、ここでは弾かない
 * - 既存行（id あり）を空の名前で更新するカスタムキーは拒否する
 */
import { customKeys, customActions } from "@/lib/schema";
import { SAVE_LIMITS, isOptionalStringWithin, isStringWithin } from "@/lib/save-limits";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 行の共通部分: id（任意の文字列）と _delete（任意の boolean）。削除行は id が必須 */
function isValidRowHead(row: Record<string, unknown>): { ok: boolean; deleted: boolean } {
  if (row.id !== undefined && !isStringWithin(row.id, SAVE_LIMITS.shortText)) {
    return { ok: false, deleted: false };
  }
  if (row._delete !== undefined && typeof row._delete !== "boolean") {
    return { ok: false, deleted: false };
  }
  const deleted = row._delete === true;
  return { ok: !deleted || typeof row.id === "string", deleted };
}

export function isValidRemapInputs(rows: unknown[]): boolean {
  if (rows.length > SAVE_LIMITS.remaps) return false;
  return rows.every((row) => {
    if (!isRecord(row)) return false;
    const head = isValidRowHead(row);
    if (!head.ok) return false;
    if (head.deleted) return true;
    return (
      isStringWithin(row.sourceKey, SAVE_LIMITS.shortText) &&
      isOptionalStringWithin(row.targetKey, SAVE_LIMITS.shortText) &&
      isOptionalStringWithin(row.software, SAVE_LIMITS.shortText) &&
      isOptionalStringWithin(row.notes, SAVE_LIMITS.memo) &&
      isOptionalStringWithin(row.remapType, SAVE_LIMITS.shortText)
    );
  });
}

/**
 * @param stored 自分の既存行（id → 保存値）。既存行に保存済みの空のキーコード・名前（過去の実装は
 *   既存行を空の値で更新できた）が同じ値のまま送り返された場合は通す（値は変えない）
 */
export function isValidCustomKeyInputs(
  rows: unknown[],
  stored: ReadonlyMap<string, { keyCode: string; keyName: string }> = new Map(),
): boolean {
  if (rows.length > SAVE_LIMITS.customKeys * 2) return false;
  const categories = customKeys.category.enumValues as readonly string[];
  return rows.every((row) => {
    if (!isRecord(row)) return false;
    const head = isValidRowHead(row);
    if (!head.ok) return false;
    if (head.deleted) return true;
    if (
      !isStringWithin(row.keyCode, SAVE_LIMITS.shortText) ||
      !isStringWithin(row.keyName, SAVE_LIMITS.shortText) ||
      typeof row.category !== "string" ||
      !categories.includes(row.category)
    ) {
      return false;
    }
    // 既存行を新しく空のキーコード・名前で上書きさせない（保存値と同じ値の送り返しは通す）
    if (typeof row.id === "string") {
      const before = stored.get(row.id);
      if (!row.keyCode.trim() && before?.keyCode !== row.keyCode) return false;
      if (!row.keyName.trim() && before?.keyName !== row.keyName) return false;
    }
    return true;
  });
}

export function isValidCustomActionInputs(rows: unknown[]): boolean {
  if (rows.length > SAVE_LIMITS.customActions * 2) return false;
  const categories = customActions.category.enumValues as readonly string[];
  return rows.every((row) => {
    if (!isRecord(row)) return false;
    const head = isValidRowHead(row);
    if (!head.ok) return false;
    if (head.deleted) return true;
    return (
      isStringWithin(row.actionName, SAVE_LIMITS.shortText) &&
      isStringWithin(row.triggerKey, SAVE_LIMITS.shortText) &&
      isOptionalStringWithin(row.description, SAVE_LIMITS.memo) &&
      typeof row.category === "string" &&
      categories.includes(row.category)
    );
  });
}
