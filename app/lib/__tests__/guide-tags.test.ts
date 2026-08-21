import { describe, it, expect } from "vitest";
import { parseGuideTags } from "../guide-tags";

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
