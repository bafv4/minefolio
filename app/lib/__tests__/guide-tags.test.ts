import { describe, it, expect } from "vitest";
import { parseGuideTags, rankGuideTags } from "../guide-tags";

describe("parseGuideTags", () => {
  it("null・undefined・空文字は空配列を返す", () => {
    expect(parseGuideTags(null)).toEqual([]);
    expect(parseGuideTags(undefined)).toEqual([]);
    expect(parseGuideTags("")).toEqual([]);
  });

  it("不正なJSONは空配列を返す", () => {
    expect(parseGuideTags("{ not json")).toEqual([]);
  });

  it("非配列（オブジェクト）のJSONは空配列を返す", () => {
    expect(parseGuideTags("{}")).toEqual([]);
    expect(parseGuideTags('{"a":1}')).toEqual([]);
  });

  it("非文字列要素を除外する", () => {
    expect(parseGuideTags(JSON.stringify(["speedrun", 123, null, {}, ["x"], "any%"]))).toEqual([
      "speedrun",
      "any%",
    ]);
  });

  it("正常な文字列配列はそのまま返す", () => {
    expect(parseGuideTags(JSON.stringify(["a", "b", "c"]))).toEqual(["a", "b", "c"]);
  });
});

describe("rankGuideTags", () => {
  it("件数の多い順、同数は名前順", () => {
    expect(rankGuideTags({ b: 1, a: 1, c: 3, d: 2 }, "en")).toEqual(["c", "d", "a", "b"]);
  });

  it("入力の順序（一覧の並び替え）に依存しない", () => {
    const x = rankGuideTags({ doog: 2, abc: 2, zzz: 5 }, "ja");
    const y = rankGuideTags({ zzz: 5, abc: 2, doog: 2 }, "ja");
    expect(x).toEqual(y);
    expect(x).toEqual(["zzz", "abc", "doog"]);
  });

  it("上限で打ち切る（既定 20）", () => {
    const counts = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`t${String(i).padStart(2, "0")}`, 1]));
    const ranked = rankGuideTags(counts, "en");
    expect(ranked).toHaveLength(20);
    expect(ranked[0]).toBe("t00");
    expect(rankGuideTags(counts, "en", 3)).toEqual(["t00", "t01", "t02"]);
  });

  it("空は空配列", () => {
    expect(rankGuideTags({}, "ja")).toEqual([]);
  });
});
