/**
 * /me/items の保存ペイロード（アイテム配置）の形・長さの検証。
 * slots / offhand の中身の形が崩れたまま永続化されると、公開プロフィール側の ItemHotbar
 * （slots.find／items.map）が TypeError を投げて SSR が 500 になるため、書き込み前に拒否する。
 */
import { SAVE_LIMITS, isStringWithin } from "@/lib/save-limits";

function isItemList(value: unknown, max: number): boolean {
  return (
    Array.isArray(value) &&
    value.length <= max &&
    value.every((item) => isStringWithin(item, SAVE_LIMITS.shortText))
  );
}

function isValidSlotShape(slot: unknown): boolean {
  if (!slot || typeof slot !== "object") return false;
  const s = slot as Record<string, unknown>;
  return (
    typeof s.slot === "number" &&
    Number.isInteger(s.slot) &&
    isItemList(s.items, SAVE_LIMITS.itemsPerSlot)
  );
}

/**
 * アイテム配置の配列を検証する。
 * - 件数・各文字列・スロット数・アイテム数の上限
 * - セグメント名は空でない文字列で、大文字小文字を無視して重複しない（画面側の規則と同じ）
 * - id は空でない文字列で、ペイロード内で重複しない
 */
export function isValidItemLayoutsPayload(raw: unknown): boolean {
  if (!Array.isArray(raw) || raw.length > SAVE_LIMITS.itemLayouts) return false;
  const ids = new Set<string>();
  const segments = new Set<string>();
  for (const layout of raw as Array<Record<string, unknown> | null>) {
    if (!layout || typeof layout !== "object") return false;
    if (!isStringWithin(layout.id, SAVE_LIMITS.shortText) || !layout.id) return false;
    if (ids.has(layout.id)) return false;
    ids.add(layout.id);
    if (!isStringWithin(layout.segment, SAVE_LIMITS.segmentName)) return false;
    const segmentKey = layout.segment.trim().toLowerCase();
    if (!segmentKey || segments.has(segmentKey)) return false;
    segments.add(segmentKey);
    if (!Array.isArray(layout.slots) || layout.slots.length > SAVE_LIMITS.itemSlotsPerLayout) return false;
    if (!layout.slots.every(isValidSlotShape)) return false;
    if (!isItemList(layout.offhand, SAVE_LIMITS.itemsPerSlot)) return false;
    if (layout.notes !== null && !isStringWithin(layout.notes, SAVE_LIMITS.layoutNotes)) return false;
  }
  return true;
}
