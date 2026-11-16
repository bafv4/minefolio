import { describe, it, expect } from "vitest";
import { MAX_RUN_IDS, parseRunIdListInput, sameRunIdSet } from "@/lib/run-id-list";

describe("sameRunIdSet", () => {
  it("順序が違っても同じ集合なら true", () => {
    expect(sameRunIdSet(["a", "b"], ["b", "a"])).toBe(true);
    expect(sameRunIdSet([], [])).toBe(true);
  });
  it("要素が違う・件数が違うなら false", () => {
    expect(sameRunIdSet(["a"], ["b"])).toBe(false);
    expect(sameRunIdSet(["a"], ["a", "b"])).toBe(false);
  });
});

describe("parseRunIdListInput", () => {
  it("JSON 配列を重複・空文字を除いて返す", () => {
    expect(parseRunIdListInput(JSON.stringify(["a", "b", "a", ""]))).toEqual(["a", "b"]);
    expect(parseRunIdListInput("[]")).toEqual([]);
  });
  it("配列でない・文字列以外を含む・壊れた JSON・未指定は null", () => {
    expect(parseRunIdListInput(null)).toBeNull();
    expect(parseRunIdListInput("not json")).toBeNull();
    expect(parseRunIdListInput('{"a":1}')).toBeNull();
    expect(parseRunIdListInput("[1,2]")).toBeNull();
    expect(parseRunIdListInput(new File([], "x"))).toBeNull();
  });
  it("上限を超える件数は null", () => {
    const over = Array.from({ length: MAX_RUN_IDS + 1 }, (_, i) => `id${i}`);
    expect(parseRunIdListInput(JSON.stringify(over))).toBeNull();
  });
});
