import { describe, it, expect } from "vitest";
import {
  coerceStringArray,
  decodePresetSearchCrafts,
  decodePresetSearchCraftLoops,
  decodePresetConfig,
} from "../preset-read";

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

describe("decodePresetSearchCraftLoops", () => {
  const userId = "user-1";

  it("crafts 配列が sequence 順に並んでいないスナップショットでも craftSeq→合成id を正しく解決する", () => {
    // 配列順（sequence: 2, 1）と sequence の昇順は一致しない
    const craftsData = JSON.stringify([
      { sequence: 2, items: "[]", keys: "[]", searchStr: "en", comment: null },
      { sequence: 1, items: "[]", keys: "[]", searchStr: "er", comment: null },
    ]);
    const decodedCrafts = decodePresetSearchCrafts(craftsData, userId)!;
    // id は元の配列 index に紐づき（map は sort 前）、返り値は sequence 昇順にソートされる
    expect(decodedCrafts.map((c) => ({ id: c.id, sequence: c.sequence }))).toEqual([
      { id: "preset-craft-1", sequence: 1 },
      { id: "preset-craft-0", sequence: 2 },
    ]);

    const loopsData = JSON.stringify([
      {
        sequence: 1,
        steps: [
          { craftSeq: 1, transition: null },
          { craftSeq: 2, transition: { type: "backspace", bsCount: 1 } },
        ],
        comment: null,
        timing: null,
      },
    ]);
    const loops = decodePresetSearchCraftLoops(loopsData, decodedCrafts);
    expect(loops).toHaveLength(1);
    // sequence:1 → preset-craft-1、sequence:2 → preset-craft-0（配列 index とは無関係に sequence で突合）
    expect(loops[0].steps.map((s) => s.craftId)).toEqual(["preset-craft-1", "preset-craft-0"]);
  });

  it("欠落した craftSeq を参照するステップは除去し、2件未満になった Loop は除去する", () => {
    const decodedCrafts = [
      { id: "preset-craft-0", sequence: 1 },
      { id: "preset-craft-1", sequence: 2 },
    ];
    const loopsData = JSON.stringify([
      {
        sequence: 1,
        steps: [
          { craftSeq: 1, transition: null },
          { craftSeq: 99, transition: { type: "backspace", bsCount: 1 } }, // 存在しない sequence
        ],
        comment: null,
        timing: null,
      },
      {
        sequence: 2,
        steps: [
          { craftSeq: 1, transition: null },
          { craftSeq: 2, transition: { type: "selectAll" } },
        ],
        comment: null,
        timing: null,
      },
    ]);
    const loops = decodePresetSearchCraftLoops(loopsData, decodedCrafts);
    expect(loops).toHaveLength(1);
    expect(loops[0].sequence).toBe(2);
  });

  it("旧スナップショット（searchCraftLoopsData 列が無い）は空配列", () => {
    expect(decodePresetSearchCraftLoops(undefined, [])).toEqual([]);
    expect(decodePresetSearchCraftLoops(null, [])).toEqual([]);
  });

  it("破損JSONは空配列にフォールバックする", () => {
    expect(decodePresetSearchCraftLoops("not json", [])).toEqual([]);
    expect(decodePresetSearchCraftLoops('{"a":1}', [])).toEqual([]);
  });
});

describe("decodePresetConfig - searchCraftLoops", () => {
  it("searchCraftLoopsData が無いスナップショットは searchCraftLoops が空配列（デフォルト）", () => {
    const config = decodePresetConfig({ searchCraftsData: null }, "user-1");
    expect(config.searchCraftLoops).toEqual([]);
  });
});
