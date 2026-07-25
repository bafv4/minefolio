// @vitest-environment jsdom
// ガイドの文字サイズ（段階指定）の判定と、ペースト HTML からの許可外サイズ除去のテスト。
// stripDisallowedFontSizesFromHtml は DOMParser を使うため jsdom 環境で実行する。
import { describe, it, expect } from "vitest";
import {
  GUIDE_FONT_SIZES,
  isAllowedFontSize,
  stripDisallowedFontSizesFromHtml,
} from "../guide-font-sizes";

describe("GUIDE_FONT_SIZES", () => {
  it("標準（空文字）を1つだけ含む5段階である", () => {
    expect(GUIDE_FONT_SIZES).toHaveLength(5);
    expect(GUIDE_FONT_SIZES.filter((s) => s.value === "")).toHaveLength(1);
  });

  it("標準以外はすべて em 指定で、小さい順に並んでいる", () => {
    const sized = GUIDE_FONT_SIZES.filter((s) => s.value !== "");
    for (const { value } of sized) expect(value).toMatch(/^\d+(\.\d+)?em$/);
    // 「標準」を 1em とみなして全体が昇順であることを確認する
    const numbers = GUIDE_FONT_SIZES.map((s) => parseFloat(s.value || "1em"));
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
  });
});

describe("isAllowedFontSize", () => {
  it("ピッカーの段階を受理する", () => {
    for (const { value } of GUIDE_FONT_SIZES) {
      if (!value) continue;
      expect(isAllowedFontSize(value)).toBe(true);
    }
  });

  it("大文字・前後空白を許容する", () => {
    expect(isAllowedFontSize("  1.25EM ")).toBe(true);
  });

  it("段階外・別単位の任意サイズは拒否する", () => {
    for (const value of ["14px", "1.3em", "2em", "120%", "xx-large", "1rem", ""]) {
      expect(isAllowedFontSize(value)).toBe(false);
    }
  });
});

describe("stripDisallowedFontSizesFromHtml", () => {
  it("段階内の font-size は保持する", () => {
    const out = stripDisallowedFontSizesFromHtml(
      `<span style="font-size: 1.25em">大</span>`,
    );
    expect(out).toContain("font-size: 1.25em");
  });

  it("外部ペースト由来の任意サイズを除去する", () => {
    const out = stripDisallowedFontSizesFromHtml(
      `<span style="font-size: 14px">x</span><span style="font-size: 200%">y</span>`,
    );
    expect(out).not.toContain("font-size");
    // テキスト自体は残す
    expect(out).toContain("x");
    expect(out).toContain("y");
  });

  it("他のプロパティは保持し、空になった style 属性だけ落とす", () => {
    const kept = stripDisallowedFontSizesFromHtml(
      `<span style="color: #D44C47; font-size: 14px">x</span>`,
    );
    expect(kept).toContain("color");
    expect(kept).not.toContain("font-size");

    const dropped = stripDisallowedFontSizesFromHtml(
      `<span style="font-size: 14px">x</span>`,
    );
    expect(dropped).not.toContain("style");
  });

  it("style を持たない要素はそのまま通す", () => {
    const html = `<p>ふつうの<strong>本文</strong></p>`;
    expect(stripDisallowedFontSizesFromHtml(html)).toBe(html);
  });
});
