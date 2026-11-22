import { describe, it, expect } from "vitest";
import { createTranslator } from "@/lib/messages";
import {
  describeHistory,
  encodeHistoryDescription,
  encodeKeybindingUpdate,
  historyGroupKey,
  parseHistoryDescription,
} from "@/lib/history-description";

const ja = createTranslator("ja");
const en = createTranslator("en");

function show(t: typeof ja, stored: string) {
  return describeHistory(t, stored, parseHistoryDescription(stored));
}
function key(stored: string) {
  return historyGroupKey(stored, parseHistoryDescription(stored));
}

describe("history-description", () => {
  it("トークンを表示ロケールで組む", () => {
    const stored = encodeHistoryDescription("preset.delete", { name: "A" });
    expect(show(ja, stored)).toBe("プリセット「A」を削除");
    expect(show(en, stored)).toBe('Deleted preset "A"');
  });

  it("パラメータ無しの種類", () => {
    const stored = encodeHistoryDescription("devices.update");
    expect(parseHistoryDescription(stored)).toEqual({ kind: "devices.update", params: {} });
    expect(show(ja, stored)).toBe("デバイスとゲーム内設定を更新");
  });

  it("旧文言（現行・旧々・英語）が同じ種類へ読み替わり、新トークンと同じ判定キーになる", () => {
    const token = encodeHistoryDescription("devices.update");
    for (const legacy of ["デバイスとゲーム内設定を更新", "デバイス・設定を更新", "Update devices & in-game settings", "Update devices & settings"]) {
      expect(parseHistoryDescription(legacy)?.kind).toBe("devices.update");
      expect(key(legacy)).toBe(key(token));
    }
  });

  it("名前つきの旧文言からパラメータを取り出す", () => {
    expect(parseHistoryDescription("プリセット「旧」の名前を「新」に変更")).toEqual({
      kind: "preset.rename",
      params: { oldName: "旧", name: "新" },
    });
    expect(parseHistoryDescription('Created preset "X" from an import')).toEqual({
      kind: "preset.createFromImport",
      params: { name: "X" },
    });
    expect(parseHistoryDescription("現在の設定からプリセット「Y」を作成・適用")?.kind).toBe("preset.createFromCurrent");
    // 作成（自動）と作成（コピー）を取り違えない
    expect(parseHistoryDescription("プリセット「Z」を作成（「Y」からコピー）")?.kind).toBe("preset.copy");
    expect(parseHistoryDescription("プリセット「Z」を作成")?.kind).toBe("preset.createManual");
  });

  it("名前が違えば別の判定キー", () => {
    expect(key(encodeHistoryDescription("preset.delete", { name: "A" }))).not.toBe(
      key(encodeHistoryDescription("preset.delete", { name: "B" })),
    );
  });

  it("keybindings.update: 旧文言の欄名を id へ戻し、言語を問わず同じ判定キーにする", () => {
    const token = encodeKeybindingUpdate(["actions", "remaps"]);
    expect(show(ja, token)).toBe("操作割り当て・リマップを更新");
    expect(show(en, token)).toBe("Updated Action bindings, Remaps");
    expect(key("操作割り当て・リマップを更新")).toBe(key(token));
    expect(key("Updated Action bindings, Remaps")).toBe(key(token));
    // tabActions の旧ラベル「操作の種類」
    expect(key("操作の種類・リマップを更新")).toBe(key(token));
  });

  it("4f31a28 より前の英語の旧文言を読み替える", () => {
    expect(parseHistoryDescription('Copied preset "A" to create and apply "B"')).toEqual({
      kind: "preset.copy",
      params: { source: "A", name: "B" },
    });
    expect(parseHistoryDescription('Created and applied preset "C" from current settings')).toEqual({
      kind: "preset.createFromCurrent",
      params: { name: "C" },
    });
  });

  it("読み替えできない文字列はそのまま", () => {
    expect(parseHistoryDescription("自由入力")).toBeNull();
    expect(show(ja, "自由入力")).toBe("自由入力");
    expect(parseHistoryDescription("@h:unknown.kind")).toBeNull();
    expect(parseHistoryDescription("@h:preset.delete|{broken")).toBeNull();
  });
});
