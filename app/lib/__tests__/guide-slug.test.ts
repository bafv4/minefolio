import { describe, it, expect } from "vitest";
import { normalizeSlug, MAX_GUIDE_SLUG_LENGTH } from "../guide-slug";

describe("normalizeSlug", () => {
  it("大文字を小文字化する", () => {
    expect(normalizeSlug("Fastest-Any-RSG")).toBe("fastest-any-rsg");
  });

  it("空白（連続含む）をハイフン1個に変換する", () => {
    expect(normalizeSlug("fastest   any   rsg")).toBe("fastest-any-rsg");
  });

  it("許可文字 a-z / 0-9 / _ / - は保持する", () => {
    expect(normalizeSlug("any_1-2")).toBe("any_1-2");
  });

  it("アンダースコアは圧縮せず保持する", () => {
    expect(normalizeSlug("a__b")).toBe("a__b");
  });

  it("連続ハイフンは1個に圧縮する", () => {
    expect(normalizeSlug("a---b")).toBe("a-b");
  });

  it("前後のハイフンを除去する", () => {
    expect(normalizeSlug("-foo-bar-")).toBe("foo-bar");
    expect(normalizeSlug("  foo  ")).toBe("foo");
  });

  it("許可外の記号を除去する", () => {
    expect(normalizeSlug("foo!@#$%bar.baz")).toBe("foobarbaz");
  });

  it("日本語（非ASCII）は除去され、結果が空になり得る", () => {
    expect(normalizeSlug("最速攻略")).toBe("");
    expect(normalizeSlug("最速 rsg 攻略")).toBe("rsg");
  });

  it(`${MAX_GUIDE_SLUG_LENGTH} 文字に切り詰める`, () => {
    const long = "a".repeat(MAX_GUIDE_SLUG_LENGTH + 50);
    expect(normalizeSlug(long)).toHaveLength(MAX_GUIDE_SLUG_LENGTH);
  });
});
