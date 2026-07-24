import { describe, it, expect } from "vitest";
import { buildTableOfContents } from "../guide-toc";

// 旧実装（O(n^2) の遅延後方参照版）の逐語コピー。線形版が整形式HTMLに対して
// バイト一致することを回帰テストで担保するためのリファレンス。
// NOTE: 閉じタグ無しの見出しを大量に含む入力には掛けないこと（これ自体が DoS 源）。
const LEGACY_HEADING_RE = /<(h[1-3])(\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
function legacyBuildTableOfContents(html: string): {
  html: string;
  toc: { id: string; text: string; level: number }[];
} {
  const toc: { id: string; text: string; level: number }[] = [];
  let index = 0;
  const decode = (s: string) =>
    s
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#0*39;|&apos;/g, "'")
      .replace(/&nbsp;/g, " ");
  const out = html.replace(
    LEGACY_HEADING_RE,
    (match, tag: string, attrs: string | undefined, inner: string) => {
      const text = decode(inner.replace(/<[^>]*>/g, ""))
        .replace(/\s+/g, " ")
        .trim();
      if (!text) return match;
      index += 1;
      const id = `heading-${index}`;
      toc.push({ id, text, level: Number(tag[1]) });
      return `<${tag}${attrs ?? ""} id="${id}">${inner}</${tag}>`;
    },
  );
  return { html: out, toc };
}

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

  it("整形式HTMLに対して旧実装（正規表現版）とバイト一致する", () => {
    const cases = [
      "<h1>導入</h1><p>x</p><h2>準備</h2><h3>詳細</h3>",
      "<h2>強調 <strong>太字</strong> 文字</h2>",
      '<h2 style="text-align: center">中央</h2>',
      "<h2></h2><h2>本文</h2>",
      "<h4>小見出し</h4><p>段落</p><h5>x</h5>",
      "<h2>A &amp; B &lt;C&gt;</h2>",
      "<p>本文のみ</p>",
      // 属性・空白のバリエーション
      '<h1 class="title" data-x="1">見出し</h1>',
      "<h1 >余分な空白</h1>",
      "<h3\n  data-multi='y'\n>改行属性</h3>",
      // 大文字タグ（正規表現の i フラグ・後方参照の再現）
      "<H1>大文字</H1><h2>小文字</h2>",
      "<h1>大小混在</H1>",
      // インライン装飾・エンティティ・空白正規化
      "<h2>  複数    空白  </h2>",
      "<h1><em>斜体</em> と <code>コード</code></h1>",
      // 見出しの間に別要素・改行
      "<h1>A</h1>\n<div><p>本文</p></div>\n<h2>B</h2>",
      // <br> のみ＝テキスト実体が空
      "<h2><br></h2><h3>実体あり</h3>",
      // 連続見出し・重複テキスト
      "<h1>同じ</h1><h2>同じ</h2><h3>同じ</h3>",
    ];
    for (const input of cases) {
      const actual = buildTableOfContents(input);
      const expected = legacyBuildTableOfContents(input);
      expect(actual, `mismatch for: ${input}`).toEqual(expected);
    }
  });

  it("閉じタグ無しの見出し大量入力を線形時間で処理する（O(n^2) ではない）", () => {
    // 攻撃入力: 閉じタグの無い <h1> を 20 万個並べる（旧実装は各開始位置から
    // 末尾まで再走査して O(n^2) となり、サーバレスの CPU 上限を超えていた）。
    const input = "<h1>".repeat(200_000);
    const start = performance.now();
    const { html, toc } = buildTableOfContents(input);
    const elapsedMs = performance.now() - start;

    // どの <h1> も閉じないため見出しは 0 件・html は不変。
    expect(toc).toEqual([]);
    expect(html).toBe(input);
    // 線形なら数十 ms 程度で完了する。O(n^2) は桁違いに遅い。余裕を持って上限 1000ms。
    expect(elapsedMs).toBeLessThan(1000);
  });

  it("閉じタグ無しでも id 付与済み見出しはそのまま抽出する（部分的に閉じた病的入力）", () => {
    // 大量の未閉じ <h1> の後に、正しく閉じた見出しを 1 つ置く。
    const input = "<h1>".repeat(50_000) + "<h2>末尾</h2>";
    const start = performance.now();
    const { toc } = buildTableOfContents(input);
    const elapsedMs = performance.now() - start;

    expect(toc).toEqual([{ id: "heading-1", text: "末尾", level: 2 }]);
    expect(elapsedMs).toBeLessThan(1000);
  });
});
