import { describe, it, expect } from "vitest";
import { countAssignedToKey, getActionAssignmentStatus } from "../keybindings-assignment";

describe("getActionAssignmentStatus", () => {
  const rows = [
    { keyCode: "_UNBOUND" },
    { keyCode: "KeyA" },
    { keyCode: "KeyA" },
    { keyCode: "KeyB" },
    { keyCode: null },
  ];
  const count = countAssignedToKey(rows, "KeyA");

  it("同じキーに複数の操作があれば conflict", () => {
    expect(count).toBe(2);
    expect(getActionAssignmentStatus(rows[1], "KeyA", count)).toBe("conflict");
  });

  it("このキー単独の割当は none（警告しない）", () => {
    expect(getActionAssignmentStatus({ keyCode: "KeyA" }, "KeyA", 1)).toBe("none");
  });

  it("他のキーへの割当は警告ではなく moves", () => {
    expect(getActionAssignmentStatus(rows[3], "KeyA", count)).toBe("moves");
  });

  it("未割当・不使用（_UNBOUND）は none", () => {
    expect(getActionAssignmentStatus(rows[0], "KeyA", count)).toBe("none");
    expect(getActionAssignmentStatus(rows[4], "KeyA", count)).toBe("none");
  });
});
