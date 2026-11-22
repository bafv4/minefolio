/**
 * キー編集ダイアログの「操作割り当て」行の状態判定。
 *
 * ほぼ全ての操作は何かしらのキーに割り当て済みなので、「他のキーに割当済」を警告にすると
 * 全行が警告になり、本当に衝突している行が埋もれる。そこで次の3状態に分ける:
 * - "conflict": このキーに割り当て済みで、同じキーに他の操作も割り当てられている（要注意）
 * - "moves": 他のキーに割り当て済み（チェックするとそのキーから移動する。情報表示のみ）
 * - "none": 上記以外（このキーのみに割当・未割当）
 */
import { isUnbound } from "./keybindings";

export type ActionAssignmentStatus = "conflict" | "moves" | "none";

export type AssignmentRow = { keyCode: string | null | undefined };

/** 指定キーに割り当てられている操作の件数 */
export function countAssignedToKey(rows: AssignmentRow[], editingKeyCode: string): number {
  return rows.filter((r) => r.keyCode === editingKeyCode).length;
}

export function getActionAssignmentStatus(
  row: AssignmentRow,
  editingKeyCode: string,
  assignedCountOnKey: number,
): ActionAssignmentStatus {
  if (row.keyCode === editingKeyCode) return assignedCountOnKey > 1 ? "conflict" : "none";
  if (row.keyCode && !isUnbound(row.keyCode)) return "moves";
  return "none";
}
