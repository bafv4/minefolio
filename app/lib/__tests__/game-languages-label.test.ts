import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createTranslator } from "../messages";
import { flattenParenthetical, gameLanguageOptions, hasItemNameDictionary } from "../game-languages";

describe("flattenParenthetical", () => {
  it("括弧を「・」にして入れ子にしない", () => {
    expect(flattenParenthetical("ノルウェー語（ブークモール）")).toBe("ノルウェー語・ブークモール");
    expect(flattenParenthetical("中国語（繁体字・台湾）")).toBe("中国語・繁体字・台湾");
  });
  it("括弧の直前の文字は消さない（前の空白だけ詰める）", () => {
    expect(flattenParenthetical("Bokmals（x）")).toBe("Bokmals・x");
    expect(flattenParenthetical("English (UK)")).toBe("English・UK");
  });
  it("括弧を含まない名前は変わらない", () => {
    expect(flattenParenthetical("スペイン語")).toBe("スペイン語");
  });
});

describe("hasItemNameDictionary", () => {
  it("全ゲーム言語で、辞書ファイルの有無と一致する", () => {
    const options = gameLanguageOptions(createTranslator("ja"), "ja");
    expect(options.length).toBeGreaterThan(0);
    for (const { value } of options) {
      const file = resolve(process.cwd(), "public/mcitems/1.16/lang", `${value}.json`);
      expect({ value, has: hasItemNameDictionary(value) }).toEqual({ value, has: existsSync(file) });
    }
  });
  it("大文字のコードでも判定できる", () => {
    expect(hasItemNameDictionary("NB_NO")).toBe(false);
    expect(hasItemNameDictionary("ja_jp")).toBe(true);
  });
});
