import { describe, it, expect } from "vitest";
import {
  MAX_FINGER_ASSIGNMENT_KEYS,
  MAX_FINGER_ASSIGNMENT_KEY_LENGTH,
  MAX_FINGERS_PER_KEY,
  sanitizeFingerAssignments,
  validateFingerAssignments,
  validateFingerAssignmentsJson,
} from "../finger-assignments";
import { FINGER_TYPES } from "../keybindings";
import { parseFingerAssignments } from "../preset-read";

describe("validateFingerAssignments（保存時）", () => {
  it("有効な指の配列は通す（空配列も可）", () => {
    expect(validateFingerAssignments({ KeyW: ["left-middle"], KeyS: [] })).toEqual({ KeyW: ["left-middle"], KeyS: [] });
  });

  it.each([
    ["数値", { KeyW: 5 }],
    ["オブジェクト", { KeyW: { a: 1 } }],
    ["文字列", { KeyW: "left-index" }],
    ["未知の指", { KeyW: ["left-toe"] }],
    ["指でない要素", { KeyW: ["left-index", 3] }],
    ["配列そのもの", [["left-index"]]],
    ["null", null],
    ["キー名が空", { "": ["left-index"] }],
    ["キー名が長すぎる", { ["K".repeat(MAX_FINGER_ASSIGNMENT_KEY_LENGTH + 1)]: ["left-index"] }],
    ["1キーの指が多すぎる", { KeyW: Array(MAX_FINGERS_PER_KEY + 1).fill("left-index") }],
    [
      "キー数が多すぎる",
      Object.fromEntries(Array.from({ length: MAX_FINGER_ASSIGNMENT_KEYS + 1 }, (_, i) => [`K${i}`, ["left-index"]])),
    ],
  ])("不正（%s）は null", (_name, value) => {
    expect(validateFingerAssignments(value)).toBeNull();
  });

  it("JSON 版: 破損 JSON も null", () => {
    expect(validateFingerAssignmentsJson("{")).toBeNull();
    expect(validateFingerAssignmentsJson('{"KeyW":5}')).toBeNull();
    expect(validateFingerAssignmentsJson('{"KeyW":["left-index"]}')).not.toBeNull();
  });

  it("許可リストは FINGER_TYPES と一致する", () => {
    for (const f of FINGER_TYPES) expect(validateFingerAssignments({ KeyW: [f] })).not.toBeNull();
  });
});

describe("sanitizeFingerAssignments / parseFingerAssignments（読み取り時）", () => {
  it("配列でない項目と不正な指を落として、描画を落とさない形にする", () => {
    const json = JSON.stringify({ KeyW: 5, KeyA: { x: 1 }, KeyS: ["left-index", "bogus", 7], KeyD: ["right-index"] });
    expect(parseFingerAssignments(json)).toEqual({ KeyS: ["left-index"], KeyD: ["right-index"] });
  });

  it("キー名 __proto__ は保存で拒否し、読み取りでは落とす（プロトタイプを書き換えない）", () => {
    // JSON.parse は "__proto__" を自身のプロパティとして作るので、素のオブジェクトへ代入し直すとプロトタイプが変わる
    const raw = '{"__proto__":["left-index"],"KeyW":["left-middle"]}';
    expect(validateFingerAssignmentsJson(raw)).toBeNull();
    const parsed = parseFingerAssignments(raw);
    expect(parsed).toEqual({ KeyW: ["left-middle"] });
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
  });

  it("巨大な件数は上限で切る", () => {
    const big = Object.fromEntries(Array.from({ length: MAX_FINGER_ASSIGNMENT_KEYS + 50 }, (_, i) => [`K${i}`, ["left-index"]]));
    expect(Object.keys(sanitizeFingerAssignments(big))).toHaveLength(MAX_FINGER_ASSIGNMENT_KEYS);
  });
});
