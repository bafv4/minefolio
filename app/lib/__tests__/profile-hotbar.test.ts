import { describe, expect, it } from "vitest";
import { hotbarTabForKey, type HotbarKeyEvent } from "../profile-hotbar";

function ev(key: string, mods: Partial<HotbarKeyEvent> = {}): HotbarKeyEvent {
  return { key, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, ...mods };
}

const values = ["a", "b", "c", "d", "e", "f", "g"];

describe("hotbarTabForKey", () => {
  it("1〜9 が values[n-1] に対応する", () => {
    expect(hotbarTabForKey(ev("1"), values)).toBe("a");
    expect(hotbarTabForKey(ev("4"), values)).toBe("d");
    expect(hotbarTabForKey(ev("7"), values)).toBe("g");
    const nine = ["1", "2", "3", "4", "5", "6", "7", "8", "9x"];
    expect(hotbarTabForKey(ev("9"), nine)).toBe("9x");
  });
  it("範囲外の数字は null", () => {
    expect(hotbarTabForKey(ev("8"), values)).toBeNull();
    expect(hotbarTabForKey(ev("9"), values)).toBeNull();
  });
  it("0・英字・Enter・2文字以上・空文字は null", () => {
    for (const key of ["0", "a", "Enter", "10", "12", ""]) {
      expect(hotbarTabForKey(ev(key), values)).toBeNull();
    }
  });
  it("修飾キーが押されていれば数字でも null", () => {
    for (const mod of ["ctrlKey", "altKey", "metaKey", "shiftKey"] as const) {
      expect(hotbarTabForKey(ev("1", { [mod]: true }), values)).toBeNull();
    }
  });
  it("values が空なら null", () => {
    expect(hotbarTabForKey(ev("1"), [])).toBeNull();
  });
});
