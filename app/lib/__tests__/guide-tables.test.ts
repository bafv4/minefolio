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
