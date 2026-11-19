// @vitest-environment jsdom
// ガイドの色パレット判定と、ペースト HTML からのパレット外色除去のテスト。
// stripNonPaletteColorsFromHtml は DOMParser を使うため jsdom 環境で実行する。
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  GUIDE_BG_COLORS,
  GUIDE_BG_COLOR_TOKENS,
  GUIDE_TEXT_COLORS,
  GUIDE_TEXT_COLOR_TOKENS,
  guideTextColorVar,
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

describe("文字パレットのテーマ別表示色（GUIDE_TEXT_COLOR_TOKENS / app.css）", () => {
  const css = readFileSync(resolve(process.cwd(), "app/app.css"), "utf-8").replace(/\r\n/g, "\n");
  const allText = GUIDE_TEXT_COLORS.map((c) => c.value).filter(Boolean);
  const rgbOf = (hex: string) => {
    const v = hex.replace("#", "");
    return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
  };

  // 色値（hex / oklch）→ 線形 sRGB
  const toLinear = (value: string): [number, number, number] => {
    const v = value.trim();
    if (v.startsWith("#")) {
      return rgbOf(v).map((c) => {
        const x = c / 255;
        return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      }) as [number, number, number];
    }
    const m = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/.exec(v);
    if (!m) throw new Error(`unsupported color: ${value}`);
    const [L, C, h] = [Number(m[1]), Number(m[2]), (Number(m[3]) * Math.PI) / 180];
    const a = C * Math.cos(h);
    const b = C * Math.sin(h);
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const ss = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    return [
      4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * ss,
      -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * ss,
      -0.0041960863 * l - 0.7034186147 * mm + 1.7076147010 * ss,
    ].map((x) => Math.min(1, Math.max(0, x))) as [number, number, number];
  };
  const luminance = ([r, g, b]: [number, number, number]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const contrast = (a: string, b: string) => {
    const x = luminance(toLinear(a));
    const y = luminance(toLinear(b));
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };

  /** セレクタ（複数行は改行で連結）の直後の `{` から、最初の閉じ括弧までのブロック本文 */
  const blockOf = (...selectorLines: string[]) => {
    const start = css.indexOf(`${selectorLines.join("\n")} {`);
    expect(start, selectorLines.join(" ")).toBeGreaterThanOrEqual(0);
    return css.slice(start, css.indexOf("\n}", start));
  };
  const varOf = (block: string, name: string) => {
    const m = new RegExp(`${name}: ([^;]+);`).exec(block);
    expect(m, name).not.toBeNull();
    return m![1];
  };

  const SURFACES = ["--background", "--card", "--secondary"];
  const LIGHT = blockOf(":root,", ".light");
  const DARK = blockOf(".dark,", ".ultra-dark");
  const ULTRA = blockOf(".ultra-dark");
  const surfacesOf = (base: string) => SURFACES.map((n) => varOf(base, n));
  const LIGHT_HC = blockOf(':root[data-contrast="more"]:not(.dark):not(.ultra-dark)');
  const DARK_HC = blockOf('.dark[data-contrast="more"],', '.ultra-dark[data-contrast="more"]');
  const ULTRA_HC = blockOf('.ultra-dark[data-contrast="more"]');

  // [名前, 文字色トークンを持つブロック, 面を持つブロック, 目標比]。ライトの通常は白地（card と同じ）に対して 4.5:1。
  // ライトの secondary（淡い灰）は、保存色の見た目を大きく変えないため通常モードでは対象外
  const cases: Array<[string, string, string[], number]> = [
    ["light", LIGHT, [varOf(LIGHT, "--background"), varOf(LIGHT, "--card")], 4.5],
    ["dark", DARK, surfacesOf(DARK), 4.5],
    ["ultra-dark", ULTRA, surfacesOf(ULTRA), 4.5],
    ["light HC", LIGHT_HC, surfacesOf(LIGHT_HC), 7],
    ["dark HC", DARK_HC, surfacesOf(DARK), 7],
    ["ultra-dark HC", ULTRA_HC, surfacesOf(ULTRA), 7],
  ];

  it("文字パレットのすべての色にトークンがある", () => {
    for (const hex of allText) expect(GUIDE_TEXT_COLOR_TOKENS[hex.toLowerCase()]).toBeTruthy();
  });

  it("guideTextColorVar は hex / rgb のどちらでもトークンを返し、パレット外・背景色は null", () => {
    expect(guideTextColorVar("#D44C47")).toBe("var(--guide-fg-red, #D44C47)");
    expect(guideTextColorVar("rgb(212, 76, 71)")).toBe("var(--guide-fg-red, #D44C47)");
    expect(guideTextColorVar("#123456")).toBeNull();
    expect(guideTextColorVar("#FDEBEC")).toBeNull();
  });

  it("app.css が各色の hex と 2 つの rgb 形式を同じトークンへ置き換える", () => {
    for (const hex of allText) {
      const token = GUIDE_TEXT_COLOR_TOKENS[hex.toLowerCase()];
      const [r, g, b] = rgbOf(hex);
      const rule = new RegExp(
        [
          String.raw`\.guide-content \[style\*="${hex.toLowerCase()}" i\],\s*`,
          String.raw`\.guide-content \[style\*="rgb\(${r}, ${g}, ${b}\)"\],\s*`,
          String.raw`\.guide-content \[style\*="rgb\(${r},${g},${b}\)"\]\s*\{\s*`,
          String.raw`color: var\(${token}\) !important;`,
        ].join(""),
      );
      expect(css, hex).toMatch(rule);
    }
  });

  it.each(cases)("%s: 全トークンが本文の面に対して目標のコントラスト比以上", (_name, block, surfaces, target) => {
    for (const token of Object.values(GUIDE_TEXT_COLOR_TOKENS)) {
      const fg = varOf(block, token);
      for (const surface of surfaces) {
        expect(contrast(fg, surface), `${token} on ${surface}`).toBeGreaterThanOrEqual(target);
      }
    }
  });
});
