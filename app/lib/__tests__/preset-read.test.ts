import { describe, it, expect } from "vitest";
import { coerceStringArray } from "../preset-read";

describe("coerceStringArray", () => {
  it("正当な JSON 文字列配列をそのまま string[] に復元する", () => {
    expect(coerceStringArray('["minecraft:diamond","minecraft:iron_ingot"]')).toEqual([
      "minecraft:diamond",
      "minecraft:iron_ingot",
    ]);
  });

  it("既にデコード済みの string[] をそのまま返す", () => {
    expect(coerceStringArray(["a", "b"])).toEqual(["a", "b"]);
  });

  it("非配列 JSON（オブジェクト）は空配列に倒す（.map の TypeError を防ぐ）", () => {
    expect(coerceStringArray("{}")).toEqual([]);
    expect(coerceStringArray('{"foo":"bar"}')).toEqual([]);
  });

  it("破損 JSON でも例外を投げず空配列を返す", () => {
    expect(coerceStringArray("not json")).toEqual([]);
    expect(coerceStringArray('["unterminated')).toEqual([]);
  });

  it("配列内の非文字列要素は除去する", () => {
    expect(coerceStringArray('["ok",1,null,{},"fine"]')).toEqual(["ok", "fine"]);
    expect(coerceStringArray(["ok", 2, undefined, "fine"])).toEqual(["ok", "fine"]);
  });

  it("null / undefined / 非配列値は空配列に倒す", () => {
    expect(coerceStringArray(null)).toEqual([]);
    expect(coerceStringArray(undefined)).toEqual([]);
    expect(coerceStringArray(42)).toEqual([]);
    expect(coerceStringArray({})).toEqual([]);
  });

  it("空配列 JSON はそのまま空配列", () => {
    expect(coerceStringArray("[]")).toEqual([]);
  });
});
