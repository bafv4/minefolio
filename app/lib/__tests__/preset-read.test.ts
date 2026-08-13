import { describe, it, expect } from "vitest";
import {
  coerceStringArray,
  decodePresetSearchCrafts,
  decodePresetSearchCraftLoops,
  decodePresetConfig,
} from "../preset-read";

describe("decodePresetSearchCrafts", () => {
  const userId = "user-1";

  it("旧スナップショット（variations 列なし）は searchStr/withShift から1件のバリエーションに合成する", () => {
    const craftsData = JSON.stringify([
      { sequence: 1, items: "[]", keys: "[]", searchStr: "en", withShift: true, comment: null },
    ]);
    const crafts = decodePresetSearchCrafts(craftsData, userId)!;
    expect(crafts[0].variations).toEqual([{ str: "en", withShift: true }]);
    expect(crafts[0].searchStr).toBe("en");
    expect(crafts[0].withShift).toBe(true);
    expect(JSON.parse(crafts[0].searchVariations)).toEqual([{ str: "en", withShift: true }]);
  });

  it("variations 列があればそれを正準とし、searchStr/withShift は第1バリエーションのミラーとして併せ持つ", () => {
    const craftsData = JSON.stringify([
      {
        sequence: 1,
        items: "[]",
        keys: "[]",
        searchStr: "en",
        withShift: false,
        comment: null,
        variations: [
          { str: "en", withShift: false },
          { str: "er", withShift: true },
        ],
      },
    ]);
    const crafts = decodePresetSearchCrafts(craftsData, userId)!;
    expect(crafts[0].variations).toEqual([
      { str: "en", withShift: false },
      { str: "er", withShift: true },
    ]);
    expect(crafts[0].searchStr).toBe("en");
    expect(crafts[0].withShift).toBe(false);
  });

  it("破損JSON・null は null を返す", () => {
    expect(decodePresetSearchCrafts(null, userId)).toBeNull();
    expect(decodePresetSearchCrafts("not json", userId)).toBeNull();
  });
});

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

  it("variationIndex は craftSeq→合成id 解決後もそのまま（正規化した上で）引き継ぎ、欠落・不正値は0に矯正する", () => {
    const decodedCrafts = [
      { id: "preset-craft-0", sequence: 1 },
      { id: "preset-craft-1", sequence: 2 },
    ];
    const loopsData = JSON.stringify([
      {
        sequence: 1,
        steps: [
          { craftSeq: 1, transition: null }, // variationIndex 欠落 → 0
          { craftSeq: 2, transition: { type: "selectAll" }, variationIndex: 3 }, // 妥当値はそのまま
        ],
        comment: null,
        timing: null,
      },
      {
        sequence: 2,
        steps: [
          { craftSeq: 1, transition: null, variationIndex: -1 }, // 不正値 → 0
          { craftSeq: 2, transition: { type: "home" }, variationIndex: 1 },
        ],
        comment: null,
        timing: null,
      },
    ]);
    const loops = decodePresetSearchCraftLoops(loopsData, decodedCrafts);
    expect(loops[0].steps.map((s) => s.variationIndex)).toEqual([0, 3]);
    expect(loops[1].steps.map((s) => s.variationIndex)).toEqual([0, 1]);
  });
});

describe("decodePresetConfig - searchCraftLoops", () => {
  it("searchCraftLoopsData が無いスナップショットは searchCraftLoops が空配列（デフォルト）", () => {
    const config = decodePresetConfig({ searchCraftsData: null }, "user-1");
    expect(config.searchCraftLoops).toEqual([]);
  });
});
