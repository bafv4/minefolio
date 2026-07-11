import { describe, it, expect } from "vitest";
import { buildTableOfContents } from "../guide-toc";

describe("buildTableOfContents", () => {
  it("h1〜h3 を抽出し id を付与する", () => {
    const { html, toc } = buildTableOfContents(
      "<h1>導入</h1><p>x</p><h2>準備</h2><h3>詳細</h3>",
    );
    expect(toc).toEqual([
      { id: "heading-1", text: "導入", level: 1 },
      { id: "heading-2", text: "準備", level: 2 },
      { id: "heading-3", text: "詳細", level: 3 },
    ]);
    expect(html).toContain('<h1 id="heading-1">導入</h1>');
    expect(html).toContain('<h2 id="heading-2">準備</h2>');
    expect(html).toContain('<h3 id="heading-3">詳細</h3>');
  });

  it("見出し内のインライン装飾はテキストのみ抽出する", () => {
    const { toc } = buildTableOfContents("<h2>強調 <strong>太字</strong> 文字</h2>");
    expect(toc[0].text).toBe("強調 太字 文字");
  });

  it("既存の属性を保持したまま id を追加する", () => {
    const { html } = buildTableOfContents('<h2 style="text-align: center">中央</h2>');
    expect(html).toContain('style="text-align: center"');
    expect(html).toContain('id="heading-1"');
  });

  it("空の見出しは id 付与・目次登録ともにスキップする", () => {
    const { html, toc } = buildTableOfContents("<h2></h2><h2>本文</h2>");
    expect(toc).toHaveLength(1);
    expect(toc[0].text).toBe("本文");
    expect(html).toContain("<h2></h2>");
  });

  it("h4〜h6 やその他要素は対象外", () => {
    const { toc } = buildTableOfContents("<h4>小見出し</h4><p>段落</p><h5>x</h5>");
    expect(toc).toHaveLength(0);
  });

  it("HTMLエンティティをデコードする", () => {
    const { toc } = buildTableOfContents("<h2>A &amp; B &lt;C&gt;</h2>");
    expect(toc[0].text).toBe("A & B <C>");
  });

  it("見出しが無ければ空配列とhtml不変", () => {
    const input = "<p>本文のみ</p>";
    const { html, toc } = buildTableOfContents(input);
    expect(toc).toEqual([]);
    expect(html).toBe(input);
  });
});
