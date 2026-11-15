// @vitest-environment jsdom
// ガイドの色パレット判定と、ペースト HTML からのパレット外色除去のテスト。
// stripNonPaletteColorsFromHtml は DOMParser を使うため jsdom 環境で実行する。
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  GUIDE_BG_COLORS,
  GUIDE_BG_COLOR_TOKENS,
  GUIDE_LEGACY_BG_COLORS,
  guideBgColorVar,
  isPaletteTextColor,
  isPaletteBgColor,
  stripNonPaletteColorsFromHtml,
} from "../guide-colors";

describe("isPaletteTextColor / isPaletteBgColor", () => {
  it("パレットの hex を大文字小文字を問わず受理する", () => {
    expect(isPaletteTextColor("#D44C47")).toBe(true);
    expect(isPaletteTextColor("#d44c47")).toBe(true);
    expect(isPaletteBgColor("#FDEBEC")).toBe(true);
  });

  it("パレット色の rgb 形式（ブラウザ正規化形）を受理する", () => {
    // #D44C47 = rgb(212, 76, 71)
    expect(isPaletteTextColor("rgb(212, 76, 71)")).toBe(true);
    expect(isPaletteTextColor("rgb(212,76,71)")).toBe(true);
  });

  it("パレット外の色を拒否する", () => {
    expect(isPaletteTextColor("rgb(226, 232, 240)")).toBe(false); // ダークテーマの文字色
    expect(isPaletteTextColor("#000000")).toBe(false);
    expect(isPaletteTextColor("red")).toBe(false);
  });

  it("旧ハイライト既定色（#FEF08A）は背景色として受理する", () => {
    expect(isPaletteBgColor("#FEF08A")).toBe(true);
    expect(isPaletteBgColor("rgb(254, 240, 138)")).toBe(true);
  });
});

describe("stripNonPaletteColorsFromHtml（ペースト時の色除去）", () => {
  it("焼き付いたテーマ色（rgb）と黒・白を除去し、テキストは保持する", () => {
    const out = stripNonPaletteColorsFromHtml(
      `<p><span style="color: rgb(226, 232, 240);">ダーク文字</span><span style="color: #000000;">黒文字</span></p>`,
    );
    expect(out).not.toContain("color");
    expect(out).toContain("ダーク文字");
    expect(out).toContain("黒文字");
    // style が空になった要素からは style 属性ごと除去される
    expect(out).not.toContain("style=");
  });

  it("パレット色（hex / rgb）は保持する", () => {
    const out = stripNonPaletteColorsFromHtml(
      `<span style="color: #D44C47;">赤</span><span style="color: rgb(51, 126, 169);">青</span>`,
    );
    expect(out).toContain("赤");
    expect(out).toContain("青");
    expect(out).toMatch(/color:\s*(#D44C47|rgb\(212,\s*76,\s*71\))/i);
    expect(out).toMatch(/color:\s*rgb\(51,\s*126,\s*169\)/i);
  });

  it("パレット外の背景色を除去し、パレット背景色は保持する", () => {
    const out = stripNonPaletteColorsFromHtml(
      `<span style="background-color: rgb(30, 41, 59);">a</span><mark style="background-color: #FDEBEC;">b</mark>`,
    );
    expect(out).not.toContain("rgb(30, 41, 59)");
    expect(out).toMatch(/background-color:\s*(#FDEBEC|rgb\(253,\s*235,\s*236\))/i);
  });

  it("テーブルセルの文字色（外来 HTML）も除去する", () => {
    const out = stripNonPaletteColorsFromHtml(
      `<table><tr><td style="color: rgb(15, 23, 42); text-align: center;">セル</td></tr></table>`,
    );
    expect(out).not.toContain("rgb(15, 23, 42)");
    // color 以外のスタイル（text-align）は残す
    expect(out).toContain("text-align");
  });
});

describe("背景パレットのテーマ別表示色（GUIDE_BG_COLOR_TOKENS / app.css）", () => {
  // jsdom 環境では import.meta.url が file: でないので、リポジトリ直下（vitest の実行場所）から辿る
  const css = readFileSync(resolve(process.cwd(), "app/app.css"), "utf-8");
  const allBg = [...GUIDE_BG_COLORS, ...GUIDE_LEGACY_BG_COLORS].map((c) => c.value).filter(Boolean);
  const rgbOf = (hex: string) => {
    const v = hex.replace("#", "");
    return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
  };

  it("背景パレット（旧色を含む）のすべての色にトークンがある", () => {
    for (const hex of allBg) expect(GUIDE_BG_COLOR_TOKENS[hex.toLowerCase()]).toBeTruthy();
  });

  it("guideBgColorVar は hex / rgb のどちらでもトークンを返し、パレット外は null", () => {
    expect(guideBgColorVar("#FDEBEC")).toBe("var(--guide-bg-red, #FDEBEC)");
    expect(guideBgColorVar("#fdebec")).toBe("var(--guide-bg-red, #FDEBEC)");
    expect(guideBgColorVar("rgb(253, 235, 236)")).toBe("var(--guide-bg-red, #FDEBEC)");
    expect(guideBgColorVar("#FEF08A")).toBe("var(--guide-bg-legacy-yellow, #FEF08A)");
    expect(guideBgColorVar("#123456")).toBeNull();
    expect(guideBgColorVar("#D44C47")).toBeNull(); // 文字色パレットは対象外
  });

  it("app.css が各色の hex と 2 つの rgb 形式を同じトークンへ置き換える", () => {
    for (const hex of allBg) {
      const token = GUIDE_BG_COLOR_TOKENS[hex.toLowerCase()];
      const [r, g, b] = rgbOf(hex);
      const rule = new RegExp(
        [
          String.raw`\.guide-content \[style\*="${hex.toLowerCase()}" i\],\s*`,
          String.raw`\.guide-content \[style\*="rgb\(${r}, ${g}, ${b}\)"\],\s*`,
          String.raw`\.guide-content \[style\*="rgb\(${r},${g},${b}\)"\]\s*\{\s*`,
          String.raw`background-color: var\(${token}\) !important;`,
        ].join(""),
      );
      expect(css, hex).toMatch(rule);
    }
  });

  it("トークンはライト・dark・ultra-dark のすべてで定義され、ライトは保存色と同じ", () => {
    for (const [hex, token] of Object.entries(GUIDE_BG_COLOR_TOKENS)) {
      const defs = [...css.matchAll(new RegExp(`${token}: ([^;]+);`, "g"))].map((m) => m[1]);
      expect(defs, token).toHaveLength(3);
      expect(defs[0].toLowerCase(), token).toBe(hex);
    }
  });
});
