import { FINGER_TYPES, type FingerType } from "./keybindings";

/** 指割り当てに入れられるキー数の上限（キーボード全キー＋マウスボタンに十分な余裕） */
export const MAX_FINGER_ASSIGNMENT_KEYS = 200;
/** キー名（code）の最大長 */
export const MAX_FINGER_ASSIGNMENT_KEY_LENGTH = 32;
/** 1 キーに割り当てられる指の最大数（指の種類の数） */
export const MAX_FINGERS_PER_KEY = FINGER_TYPES.length;

const FINGER_SET: ReadonlySet<string> = new Set(FINGER_TYPES);

export function isFingerType(value: unknown): value is FingerType {
  return typeof value === "string" && FINGER_SET.has(value);
}

export type FingerAssignmentMap = Record<string, FingerType[]>;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * 保存時の厳格な検証。1 つでも不正（配列でない値・未知の指・上限超過）なら null を返す。
 * 呼び出し側は null のときエラーを返す（空や null で上書きしない）。
 */
export function validateFingerAssignments(value: unknown): FingerAssignmentMap | null {
  if (!isPlainObject(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > MAX_FINGER_ASSIGNMENT_KEYS) return null;
  const result: FingerAssignmentMap = {};
  for (const [key, fingers] of entries) {
    // "__proto__" への代入はプロトタイプの書き換えになるため、キー名として受け付けない
    if (key === "__proto__") return null;
    if (key.length === 0 || key.length > MAX_FINGER_ASSIGNMENT_KEY_LENGTH) return null;
    if (!Array.isArray(fingers) || fingers.length > MAX_FINGERS_PER_KEY) return null;
    if (!fingers.every(isFingerType)) return null;
    result[key] = fingers;
  }
  return result;
}

/** JSON 文字列版。パース失敗も不正として null。 */
export function validateFingerAssignmentsJson(raw: string): FingerAssignmentMap | null {
  try {
    return validateFingerAssignments(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * 読み取り時の寛容なサニタイズ。配列でない項目・有効でない指・上限を超える項目を落として返す。
 * すでに不正な行が保存されていても描画（SSR）を落とさないための保険。
 */
export function sanitizeFingerAssignments(value: unknown): FingerAssignmentMap {
  if (!isPlainObject(value)) return {};
  const result: FingerAssignmentMap = {};
  let count = 0;
  for (const [key, fingers] of Object.entries(value)) {
    if (count >= MAX_FINGER_ASSIGNMENT_KEYS) break;
    if (key === "__proto__") continue;
    if (key.length === 0 || key.length > MAX_FINGER_ASSIGNMENT_KEY_LENGTH) continue;
    if (!Array.isArray(fingers)) continue;
    result[key] = fingers.filter(isFingerType).slice(0, MAX_FINGERS_PER_KEY);
    count++;
  }
  return result;
}
