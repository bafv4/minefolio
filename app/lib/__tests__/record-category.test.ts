import { describe, it, expect } from "vitest";
import { buildRecordCategory, resolveRecordCategory, splitRecordCategory } from "@/lib/record-category";
import { recordMatchesMainCategory } from "@/lib/profile-highlights";

describe("splitRecordCategory", () => {
  it("カテゴリキー＋サブカテゴリに分ける", () => {
    expect(splitRecordCategory("rsg_any")).toEqual({ key: "rsg", suffix: "any" });
    expect(splitRecordCategory("ssg-glitchless")).toEqual({ key: "ssg", suffix: "glitchless" });
    expect(splitRecordCategory("aa")).toEqual({ key: "aa", suffix: "" });
    expect(splitRecordCategory("RSG_Any")).toEqual({ key: "rsg", suffix: "Any" });
  });
  it("どのキーにも属さない既存の自由入力は other として全体を保つ", () => {
    expect(splitRecordCategory("any_glitchless")).toEqual({ key: "other", suffix: "any_glitchless" });
    expect(splitRecordCategory("rsgx")).toEqual({ key: "other", suffix: "rsgx" });
  });
});

describe("resolveRecordCategory", () => {
  it("キー・サブカテゴリに変更が無ければ元の値をそのまま返す（正規化しない）", () => {
    for (const v of ["RSG-any", "RSG_any", "rsg-any", "ssg-x", "any_glitchless"]) {
      const { key, suffix } = splitRecordCategory(v);
      expect(resolveRecordCategory(v, key, suffix)).toBe(v);
    }
  });
  it("変更があれば組み立て直す", () => {
    expect(resolveRecordCategory("RSG-any", "rsg", "village")).toBe("rsg_village");
    expect(resolveRecordCategory("rsg-any", "ssg", "any")).toBe("ssg_any");
  });
  it("新規（元の値なし）は組み立てる", () => {
    expect(resolveRecordCategory(null, "rsg", "any")).toBe("rsg_any");
  });
});

describe("buildRecordCategory", () => {
  it("キー＋サブカテゴリから保存値を組み立てる", () => {
    expect(buildRecordCategory("rsg", "any")).toBe("rsg_any");
    expect(buildRecordCategory("rsg", "  ")).toBe("rsg");
    expect(buildRecordCategory("other", "")).toBe("other");
    expect(buildRecordCategory("other", "any_glitchless")).toBe("any_glitchless");
  });
  it("分けて組み立て直しても元の値になる（既存データを壊さない）", () => {
    for (const v of ["rsg_any", "ssg-x", "aa", "any_glitchless", "other"]) {
      const { key, suffix } = splitRecordCategory(v);
      const rebuilt = buildRecordCategory(key, suffix);
      // ハイフン区切りはアンダースコアに正規化される（先頭一致の対象は同じ）
      expect(rebuilt.replace("-", "_")).toBe(v.replace("-", "_"));
    }
  });
  it("組み立てた値は、プロフィールのハイライトでメインカテゴリに一致する", () => {
    expect(recordMatchesMainCategory(buildRecordCategory("rsg", "any"), "rsg")).toBe(true);
    expect(recordMatchesMainCategory(buildRecordCategory("ssg", "any"), "rsg")).toBe(false);
  });
});
