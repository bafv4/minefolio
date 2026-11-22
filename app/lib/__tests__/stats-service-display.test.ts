import { describe, expect, it } from "vitest";
import { statsServiceDisplay } from "../stats-service-display";

describe("statsServiceDisplay", () => {
  it("読み込み中: 見込みありなら欄、なしなら確認中", () => {
    expect(statsServiceDisplay({ enabled: true, state: "loading", expected: true })).toBe("card");
    expect(statsServiceDisplay({ enabled: true, state: "loading", expected: false })).toBe("checking");
  });
  it("失敗は見込みに関係なく欄（再試行のため）", () => {
    expect(statsServiceDisplay({ enabled: true, state: "error", expected: false })).toBe("card");
  });
  it("取得済みは出さない", () => {
    expect(statsServiceDisplay({ enabled: true, state: "done", expected: true })).toBe("none");
  });
  it("無効なら状態に関係なく出さない", () => {
    for (const state of ["loading", "done", "error"] as const) {
      expect(statsServiceDisplay({ enabled: false, state, expected: true })).toBe("none");
    }
  });
});
