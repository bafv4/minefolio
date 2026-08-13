import { describe, it, expect } from "vitest";
import {
  MAX_SEARCH_VARIATIONS,
  isValidVariationsShape,
  parseVariationsJson,
  resolveVariations,
  variationMirror,
  type SearchCraftVariation,
} from "../search-craft-variations";

describe("isValidVariationsShape", () => {
  it("1〜MAX_SEARCH_VARIATIONS件の { str, withShift }[] は妥当", () => {
    expect(isValidVariationsShape([{ str: "er", withShift: false }])).toBe(true);
    expect(
      isValidVariationsShape([
        { str: "er", withShift: false },
        { str: "en", withShift: true },
      ]),
    ).toBe(true);
  });

  it("配列でない値は不正", () => {
    expect(isValidVariationsShape(null)).toBe(false);
    expect(isValidVariationsShape(undefined)).toBe(false);
    expect(isValidVariationsShape("er")).toBe(false);
    expect(isValidVariationsShape({ str: "er", withShift: false })).toBe(false);
  });

  it("0件は不正（最低1件）", () => {
    expect(isValidVariationsShape([])).toBe(false);
  });

  it(`${MAX_SEARCH_VARIATIONS}件は妥当、${MAX_SEARCH_VARIATIONS + 1}件は不正（上限超過）`, () => {
    const atMax = Array.from({ length: MAX_SEARCH_VARIATIONS }, (_, i) => ({
      str: `s${i}`,
      withShift: false,
    }));
    const overMax = Array.from({ length: MAX_SEARCH_VARIATIONS + 1 }, (_, i) => ({
      str: `s${i}`,
      withShift: false,
    }));
    expect(isValidVariationsShape(atMax)).toBe(true);
    expect(isValidVariationsShape(overMax)).toBe(false);
  });

  it("要素の型が不正（str が非文字列・withShift が非真偽値・欠落）は不正", () => {
    expect(isValidVariationsShape([{ str: 1, withShift: false }])).toBe(false);
    expect(isValidVariationsShape([{ str: "er", withShift: "yes" }])).toBe(false);
    expect(isValidVariationsShape([{ str: "er" }])).toBe(false);
    expect(isValidVariationsShape([{ withShift: false }])).toBe(false);
    expect(isValidVariationsShape([null])).toBe(false);
    expect(isValidVariationsShape(["er"])).toBe(false);
  });

  it("str が空文字列でも構造のみを見るため妥当（非空判定は呼び出し側の業務検証が担う）", () => {
    expect(isValidVariationsShape([{ str: "", withShift: false }])).toBe(true);
  });
});

describe("parseVariationsJson", () => {
  it("妥当な JSON をパースする", () => {
    const json = JSON.stringify([{ str: "er", withShift: false }]);
    expect(parseVariationsJson(json)).toEqual([{ str: "er", withShift: false }]);
  });

  it("null / undefined / 空文字列は null", () => {
    expect(parseVariationsJson(null)).toBeNull();
    expect(parseVariationsJson(undefined)).toBeNull();
    expect(parseVariationsJson("")).toBeNull();
  });

  it("破損JSONは null", () => {
    expect(parseVariationsJson("not json")).toBeNull();
    expect(parseVariationsJson("[{")).toBeNull();
  });

  it("構造が不正な JSON（isValidVariationsShape を満たさない）は null", () => {
    expect(parseVariationsJson(JSON.stringify([]))).toBeNull();
    expect(parseVariationsJson(JSON.stringify({ str: "er", withShift: false }))).toBeNull();
    expect(parseVariationsJson(JSON.stringify([{ str: 1, withShift: false }]))).toBeNull();
  });
});

describe("resolveVariations", () => {
  it("妥当な variations があればそれを採用する", () => {
    const variations: SearchCraftVariation[] = [
      { str: "er", withShift: false },
      { str: "en", withShift: true },
    ];
    expect(
      resolveVariations({ variations, searchStr: "should-be-ignored", withShift: false }),
    ).toEqual(variations);
  });

  it("variations が無効な形状の場合は searchStr/withShift から1件合成する", () => {
    expect(
      resolveVariations({ variations: undefined, searchStr: "er", withShift: true }),
    ).toEqual([{ str: "er", withShift: true }]);
    expect(
      resolveVariations({ variations: [], searchStr: "er", withShift: false }),
    ).toEqual([{ str: "er", withShift: false }]);
    expect(
      resolveVariations({ variations: "not-array", searchStr: "er" }),
    ).toEqual([{ str: "er", withShift: false }]);
  });

  it("withShift 省略時は false として合成する", () => {
    expect(resolveVariations({ searchStr: "er" })).toEqual([{ str: "er", withShift: false }]);
  });

  it("variations も searchStr も無ければ空配列", () => {
    expect(resolveVariations({ searchStr: null })).toEqual([]);
    expect(resolveVariations({ variations: undefined, searchStr: null, withShift: true })).toEqual(
      [],
    );
  });

  it("searchStr が空文字列の場合も未入力扱いで空配列", () => {
    expect(resolveVariations({ searchStr: "" })).toEqual([]);
  });
});

describe("variationMirror", () => {
  it("第1バリエーションをミラーする", () => {
    const variations: SearchCraftVariation[] = [
      { str: "er", withShift: true },
      { str: "en", withShift: false },
    ];
    expect(variationMirror(variations)).toEqual({ searchStr: "er", withShift: true });
  });

  it("第1バリエーションの str が空文字列の場合は searchStr を null にする（\"\" をそのまま書き込まない）", () => {
    expect(variationMirror([{ str: "", withShift: true }])).toEqual({
      searchStr: null,
      withShift: true,
    });
  });

  it("空配列（未入力状態）は searchStr: null, withShift: false", () => {
    expect(variationMirror([])).toEqual({ searchStr: null, withShift: false });
  });
});
