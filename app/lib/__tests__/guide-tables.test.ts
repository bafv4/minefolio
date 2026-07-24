import { describe, it, expect } from "vitest";
import { normalizeGuideTables } from "../guide-tables";

/** 表タグの min-width を取り出すヘルパー */
function tableMinWidth(html: string): string | null {
  const m = html.match(/<table[^>]*style="([^"]*)"/);
  if (!m) return null;
  const mw = m[1].match(/min-width\s*:\s*([^;"]+)/);
  return mw ? mw[1].trim() : null;
}

describe("normalizeGuideTables", () => {
  it("部分リサイズの表: 未指定列に160pxを確保した min-width に引き上げる（実ガイドの Bastion 表）", () => {
    // 実データ: 固定 59+299+218=576px + 未指定1列（TipTap出力は 25px 換算で 601px）
    const html =
      `<table style="min-width: 601px;"><colgroup>` +
      `<col style="width: 59px;"><col style="width: 299px;"><col style="width: 218px;"><col style="min-width: 25px;">` +
      `</colgroup><tbody><tr><th colspan="1" rowspan="1" colwidth="59"><p>#</p></th></tr></tbody></table>`;
    const out = normalizeGuideTables(html);
    // 576 + 160 = 736
    expect(tableMinWidth(out)).toBe("736px");
    // colgroup・セルは無傷
    expect(out).toContain(`<col style="width: 59px;">`);
    expect(out).toContain(`colwidth="59"`);
  });

  it("サニタイザ（xss/cssfilter）出力形式（空白・末尾セミコロンなし）も同様に処理する", () => {
    const html =
      `<table style="min-width:601px"><colgroup>` +
      `<col style="width:59px" /><col style="width:299px" /><col style="width:218px" /><col style="min-width:25px" />` +
      `</colgroup><tbody><tr><th><p>#</p></th></tr></tbody></table>`;
    expect(tableMinWidth(normalizeGuideTables(html))).toBe("736px");
  });

  it("全列未指定の表: 列数×160px を確保する（実ガイドの UI 表: 2列）", () => {
    const html =
      `<table style="min-width: 50px;"><colgroup>` +
      `<col style="min-width: 25px;"><col style="min-width: 25px;">` +
      `</colgroup><tbody><tr><th><p>スウェーデン語</p></th><th><p>日本語</p></th></tr></tbody></table>`;
    expect(tableMinWidth(normalizeGuideTables(html))).toBe("320px");
  });

  it("全列リサイズ済みの表（style=width）は変更しない", () => {
    const html =
      `<table style="width: 280px;"><colgroup>` +
      `<col style="width: 80px;"><col style="width: 200px;">` +
      `</colgroup><tbody><tr><th><p>A</p></th><th><p>B</p></th></tr></tbody></table>`;
    expect(normalizeGuideTables(html)).toBe(html);
  });

  it("colgroup なしの旧形式: 先頭行のセル数（colspan込み）から min-width を付与する", () => {
    const html =
      `<table><tbody><tr><th>A</th><th colspan="2">BC</th></tr>` +
      `<tr><td>1</td><td>2</td><td>3</td></tr></tbody></table>`;
    const out = normalizeGuideTables(html);
    // 3列 × 160 = 480
    expect(tableMinWidth(out)).toBe("480px");
  });

  it("複数の表をそれぞれ独立に処理する", () => {
    const t1 =
      `<table style="min-width: 50px;"><colgroup><col style="min-width: 25px;"><col style="min-width: 25px;"></colgroup><tbody><tr><td>a</td><td>b</td></tr></tbody></table>`;
    const t2 =
      `<table style="width: 280px;"><colgroup><col style="width: 80px;"><col style="width: 200px;"></colgroup><tbody><tr><td>c</td><td>d</td></tr></tbody></table>`;
    const out = normalizeGuideTables(`<p>x</p>${t1}<p>y</p>${t2}`);
    expect(tableMinWidth(out)).toBe("320px"); // 最初の表
    expect(out).toContain(`<table style="width: 280px;">`); // 2つ目は無傷
  });

  it("表以外の HTML は変更しない", () => {
    const html = `<p>本文 <code> spaced </code></p><h2>見出し</h2>`;
    expect(normalizeGuideTables(html)).toBe(html);
  });
});

/**
 * 旧実装（遅延一致グローバル正規表現）の正確な複製。
 * 未閉じ `<table>` が多いと開始位置ごとに末尾まで再走査するため O(n^2)。
 * 現行の線形実装が「整形済みの正常な表」で出力をバイト単位で一致させることの照合基準に使う。
 */
const LEGACY_AUTO_COL_MIN_PX = 160;
const LEGACY_COL_WIDTH_RE = /(?<![-\w])width\s*:\s*([\d.]+)px/;
function legacyNormalizeGuideTables(html: string): string {
  return html.replace(
    /<table([^>]*)>([\s\S]*?)<\/table>/g,
    (whole: string, attrs: string, inner: string) => {
      const styleMatch = attrs.match(/style="([^"]*)"/);
      const style = styleMatch ? styleMatch[1] : "";
      if (LEGACY_COL_WIDTH_RE.test(style)) return whole;
      let fixedSum = 0;
      let autoCount = 0;
      const colgroup = inner.match(/<colgroup>([\s\S]*?)<\/colgroup>/);
      if (colgroup) {
        const cols = colgroup[1].match(/<col\b[^>]*>/g) ?? [];
        for (const col of cols) {
          const w = col.match(LEGACY_COL_WIDTH_RE);
          if (w) {
            fixedSum += parseFloat(w[1]);
          } else {
            autoCount++;
          }
        }
      } else {
        const firstRow = inner.match(/<tr[\s\S]*?<\/tr>/);
        if (firstRow) {
          for (const cell of firstRow[0].match(/<t[hd]\b[^>]*>/g) ?? []) {
            const span = cell.match(/colspan="(\d+)"/);
            autoCount += span ? parseInt(span[1], 10) : 1;
          }
        }
      }
      const total = Math.round(fixedSum + autoCount * LEGACY_AUTO_COL_MIN_PX);
      if (total <= 0) return whole;
      let newStyle: string;
      if (/min-width\s*:\s*[^;"]+/.test(style)) {
        newStyle = style.replace(/min-width\s*:\s*[^;"]+/, `min-width:${total}px`);
      } else {
        newStyle = style
          ? `${style.replace(/;?\s*$/, "")};min-width:${total}px`
          : `min-width:${total}px`;
      }
      const newAttrs = styleMatch
        ? attrs.replace(styleMatch[0], `style="${newStyle}"`)
        : `${attrs} style="min-width:${total}px"`;
      return `<table${newAttrs}>${inner}</table>`;
    },
  );
}

describe("normalizeGuideTables: 旧実装とのバイト一致（整形済みコンテンツ）", () => {
  const wellFormed: Array<[string, string]> = [
    [
      "部分リサイズ（Bastion 表・エディタ生出力形式）",
      `<table style="min-width: 601px;"><colgroup>` +
        `<col style="width: 59px;"><col style="width: 299px;"><col style="width: 218px;"><col style="min-width: 25px;">` +
        `</colgroup><tbody><tr><th colspan="1" rowspan="1" colwidth="59"><p>#</p></th></tr></tbody></table>`,
    ],
    [
      "サニタイザ出力形式（空白・末尾セミコロンなし）",
      `<table style="min-width:601px"><colgroup>` +
        `<col style="width:59px" /><col style="width:299px" /><col style="width:218px" /><col style="min-width:25px" />` +
        `</colgroup><tbody><tr><th><p>#</p></th></tr></tbody></table>`,
    ],
    [
      "全列未指定（2 列）",
      `<table style="min-width: 50px;"><colgroup>` +
        `<col style="min-width: 25px;"><col style="min-width: 25px;">` +
        `</colgroup><tbody><tr><th><p>A</p></th><th><p>B</p></th></tr></tbody></table>`,
    ],
    [
      "全列リサイズ済み（style=width・無変更）",
      `<table style="width: 280px;"><colgroup>` +
        `<col style="width: 80px;"><col style="width: 200px;">` +
        `</colgroup><tbody><tr><th><p>A</p></th><th><p>B</p></th></tr></tbody></table>`,
    ],
    [
      "colgroup なし旧形式（colspan 込み・style 属性なし）",
      `<table><tbody><tr><th>A</th><th colspan="2">BC</th></tr>` +
        `<tr><td>1</td><td>2</td><td>3</td></tr></tbody></table>`,
    ],
    [
      "改行を含む表",
      `<table style="min-width: 50px;">\n<colgroup>\n` +
        `<col style="min-width: 25px;">\n<col style="min-width: 25px;">\n` +
        `</colgroup>\n<tbody>\n<tr>\n<td>a</td>\n<td>b</td>\n</tr>\n</tbody>\n</table>`,
    ],
    [
      "前後にテキストがある複数表",
      `<p>導入</p>` +
        `<table style="min-width: 50px;"><colgroup><col style="min-width: 25px;"><col style="min-width: 25px;"></colgroup><tbody><tr><td>a</td><td>b</td></tr></tbody></table>` +
        `<p>あいだ</p>` +
        `<table style="width: 280px;"><colgroup><col style="width: 80px;"><col style="width: 200px;"></colgroup><tbody><tr><td>c</td><td>d</td></tr></tbody></table>` +
        `<p>結び</p>`,
    ],
    ["表を含まない本文", `<p>本文 <code> spaced </code></p><h2>見出し</h2>`],
  ];

  for (const [label, html] of wellFormed) {
    it(`旧実装と同一の出力: ${label}`, () => {
      expect(normalizeGuideTables(html)).toBe(legacyNormalizeGuideTables(html));
    });
  }
});

describe("normalizeGuideTables: ReDoS 耐性（未閉じ/不均衡なタグでも線形時間）", () => {
  it("未閉じ <table> の連打でも出力は不変で、旧実装ともバイト一致（小規模）", () => {
    const input = "<table>".repeat(300);
    // 閉じタグが無いので正規化対象は 0 個 → 入力そのまま
    expect(normalizeGuideTables(input)).toBe(input);
    expect(normalizeGuideTables(input)).toBe(legacyNormalizeGuideTables(input));
  });

  it("未閉じ <colgroup> を大量に含む閉じた表でも出力不変・旧実装とバイト一致（小規模）", () => {
    // 閉じた <table>（コールバック実行）内に閉じない <colgroup> が多数 → 旧実装は内側走査が O(n^2)
    const input =
      `<table style="min-width:5px">` + "<colgroup>".repeat(2000) + `</table>`;
    expect(normalizeGuideTables(input)).toBe(legacyNormalizeGuideTables(input));
    expect(normalizeGuideTables(input)).toBe(input);
  });

  it("未閉じ <table> 10 万個を上限時間内に処理する（旧実装なら O(n^2)）", () => {
    const input = "<table>".repeat(100_000); // 約 700KB
    const start = performance.now();
    const out = normalizeGuideTables(input);
    const elapsed = performance.now() - start;
    expect(out).toBe(input); // 閉じタグ無し → 無変更
    expect(elapsed).toBeLessThan(1000);
  });

  it("閉じた表の中に未閉じ <colgroup> 10 万個でも上限時間内に処理する", () => {
    const input =
      `<table style="min-width:5px">` + "<colgroup>".repeat(100_000) + `</table>`;
    const start = performance.now();
    const out = normalizeGuideTables(input);
    const elapsed = performance.now() - start;
    expect(out).toBe(input); // colgroup が閉じない → 列数 0 → 無変更
    expect(elapsed).toBeLessThan(1000);
  });

  it("未閉じ表の連打の後ろに正常な表があっても旧実装と一致（貪欲な最初の </table> 併合）", () => {
    const input =
      "<table>".repeat(50) +
      `<table style="min-width: 50px;"><colgroup><col style="min-width: 25px;"><col style="min-width: 25px;"></colgroup><tbody><tr><td>a</td><td>b</td></tr></tbody></table>`;
    expect(normalizeGuideTables(input)).toBe(legacyNormalizeGuideTables(input));
  });
});
