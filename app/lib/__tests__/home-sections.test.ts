import { describe, it, expect } from "vitest";
import {
  DEFAULT_HOME_SECTION_ORDER,
  HOME_SECTION_IDS,
  isDefaultHomeSectionOrder,
  normalizeHomeSectionOrder,
} from "../home-sections";

describe("normalizeHomeSectionOrder", () => {
  const def = [...DEFAULT_HOME_SECTION_ORDER];

  it("null / undefined / 非文字列・非配列は既定順", () => {
    expect(normalizeHomeSectionOrder(null)).toEqual(def);
    expect(normalizeHomeSectionOrder(undefined)).toEqual(def);
    expect(normalizeHomeSectionOrder(42)).toEqual(def);
    expect(normalizeHomeSectionOrder({ a: 1 })).toEqual(def);
  });

  it("壊れた JSON は既定順", () => {
    expect(normalizeHomeSectionOrder("{not json")).toEqual(def);
    expect(normalizeHomeSectionOrder('{"a":1}')).toEqual(def);
  });

  it("JSON 文字列・配列のどちらも受け付ける", () => {
    const order = ["profiles", "live", "videos", "guides", "featured", "favoriteActivity"];
    expect(normalizeHomeSectionOrder(JSON.stringify(order))).toEqual(order);
    expect(normalizeHomeSectionOrder(order)).toEqual(order);
  });

  it("未知 ID と非文字列を除く", () => {
    expect(normalizeHomeSectionOrder(["bogus", "videos", 1, null, "live"])).toEqual([
      "videos",
      "live",
      "favoriteActivity",
      "guides",
      "featured",
      "profiles",
    ]);
  });

  it("重複は最初の出現のみ残す", () => {
    const result = normalizeHomeSectionOrder(["live", "live", "videos", "live"]);
    expect(result.slice(0, 2)).toEqual(["live", "videos"]);
    expect(new Set(result).size).toBe(HOME_SECTION_IDS.length);
  });

  it("欠けた ID は既定順で末尾に補う", () => {
    expect(normalizeHomeSectionOrder(["profiles"])).toEqual([
      "profiles",
      "favoriteActivity",
      "live",
      "videos",
      "guides",
      "featured",
    ]);
    expect(normalizeHomeSectionOrder([])).toEqual(def);
  });
});

describe("isDefaultHomeSectionOrder", () => {
  it("既定順のみ true", () => {
    expect(isDefaultHomeSectionOrder([...DEFAULT_HOME_SECTION_ORDER])).toBe(true);
    expect(isDefaultHomeSectionOrder(["live", ...DEFAULT_HOME_SECTION_ORDER.filter((i) => i !== "live")])).toBe(false);
  });
});
