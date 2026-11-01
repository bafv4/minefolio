// ガイド本文 HTML のテキストノード抽出・書き戻し（app/lib/guide-translate-html.server.ts）の回帰テスト。
//
// 守る契約（docs/translation.md「中核」）: マークアップ・属性・埋め込みはモデルに触れさせず、
// テキストノードだけを配列で往復する。訳文は必ずエスケープされ、タグとして注入されない。
import { describe, it, expect } from "vitest";
import { chunkTexts, extractGuideHtmlTexts } from "../guide-translate-html.server";
import { sanitizeGuideHtml } from "../guide-sanitize.server";

/** 全要素に印を付ける疑似翻訳 */
function mark(texts: string[]): string[] {
  return texts.map((t) => `[T]${t}`);
}

describe("extractGuideHtmlTexts - 除外ルール", () => {
  it("<code> / <pre> / <kbd> の中身は抽出されず、書き戻し後も不変", () => {
    const html =
      "<p>実行は <code>npm run dev</code> です</p><pre><code>seed 12345\n/tp 0 64 0</code></pre><p>押すキーは <kbd>Ctrl</kbd> です</p>";
    const { texts, apply } = extractGuideHtmlTexts(html);
    expect(texts).toEqual(["実行は", "です", "押すキーは", "です"]);
    const out = apply(mark(texts));
    expect(out).toContain("<code>npm run dev</code>");
    expect(out).toContain("<pre><code>seed 12345\n/tp 0 64 0</code></pre>");
    expect(out).toContain("<kbd>Ctrl</kbd>");
    expect(out).toContain("[T]実行は");
  });

  it("埋め込み div（keybind / searchcraft / guide-link）は中身も属性も不変", () => {
    const keybind =
      '<div data-keybind-embed="" data-user-slug="runner1" data-preset-name="メイン">埋め込みの中身</div>';
    const searchcraft = '<div data-searchcraft-embed="" data-user-slug="runner1">サーチクラフト</div>';
    const guideLink = '<div data-guide-link="" data-user-slug="runner1">ガイドリンク</div>';
    const html = `<p>前</p>${keybind}${searchcraft}${guideLink}<p>後</p>`;
    const { texts, apply } = extractGuideHtmlTexts(html);
    expect(texts).toEqual(["前", "後"]);
    const out = apply(mark(texts));
    expect(out).toContain(keybind);
    expect(out).toContain(searchcraft);
    expect(out).toContain(guideLink);
    expect(out).toContain("<p>[T]前</p>");
    expect(out).toContain("<p>[T]後</p>");
  });

  it("埋め込み div の中にネストした要素があっても抽出されない", () => {
    const html = '<div data-keybind-embed=""><p>入れ子</p><span>テキスト</span></div><p>本文</p>';
    const { texts } = extractGuideHtmlTexts(html);
    expect(texts).toEqual(["本文"]);
  });

  it("<script> / <style> / <textarea> の中身も抽出しない", () => {
    const html = "<p>本文</p><script>var a = 1;</script><style>p { color: red; }</style><textarea>メモ</textarea>";
    expect(extractGuideHtmlTexts(html).texts).toEqual(["本文"]);
  });

  it("空白のみのテキストノードは抽出されない", () => {
    const html = "<ul>\n  <li>一つ目</li>\n  <li>二つ目</li>\n</ul>\n";
    const { texts, apply } = extractGuideHtmlTexts(html);
    expect(texts).toEqual(["一つ目", "二つ目"]);
    // 空白ノードは書き戻しでも元のまま残る
    expect(apply(mark(texts))).toBe("<ul>\n  <li>[T]一つ目</li>\n  <li>[T]二つ目</li>\n</ul>\n");
  });

  it("空文字の HTML は空配列で、apply([]) は空文字", () => {
    const { texts, apply } = extractGuideHtmlTexts("");
    expect(texts).toEqual([]);
    expect(apply([])).toBe("");
  });
});

describe("extractGuideHtmlTexts - img の alt / 属性", () => {
  it("img[alt] は抽出・翻訳され、前後の空白は元のまま保たれる", () => {
    const html = '<img src="/a.png" alt="  図の説明 ">';
    const { texts, apply } = extractGuideHtmlTexts(html);
    expect(texts).toEqual(["図の説明"]);
    expect(apply(["Diagram"])).toBe('<img src="/a.png" alt="  Diagram ">');
  });

  it("title / src / width などほかの属性は不変", () => {
    const html = '<img src="/a.png" alt="図" title="タイトル" width="100" data-align="center">';
    const { texts, apply } = extractGuideHtmlTexts(html);
    expect(texts).toEqual(["図"]);
    expect(apply(["Fig"])).toBe(
      '<img src="/a.png" alt="Fig" title="タイトル" width="100" data-align="center">',
    );
  });

  it("alt が無い／空白のみの img は抽出されない", () => {
    expect(extractGuideHtmlTexts('<img src="/a.png">').texts).toEqual([]);
    expect(extractGuideHtmlTexts('<img src="/a.png" alt="   ">').texts).toEqual([]);
    expect(extractGuideHtmlTexts('<img src="/a.png" alt="">').texts).toEqual([]);
  });

  it("alt と本文テキストは文書順で並ぶ", () => {
    const html = '<p>前</p><img alt="画像"><p>後</p>';
    const { texts, apply } = extractGuideHtmlTexts(html);
    expect(texts).toEqual(["前", "画像", "後"]);
    expect(apply(["a", "b", "c"])).toBe('<p>a</p><img alt="b"><p>c</p>');
  });

  it("alt に引用符を含む訳文を入れても属性が壊れず、属性が増えない", () => {
    const { apply } = extractGuideHtmlTexts('<img src="/a.png" alt="図">');
    const out = apply(['x" onerror="alert(1)']);
    // 引用符は &quot; にエスケープされ、alt の値の中に収まる（属性としては増えない）
    expect(out).toBe('<img src="/a.png" alt="x&quot; onerror=&quot;alert(1)">');
    // 再パースしても alt の値 1 つとして読み戻せる
    expect(extractGuideHtmlTexts(out).texts).toEqual(['x" onerror="alert(1)']);
  });

  it("<a href> 内のテキストは抽出され、href は不変（& は属性値としてエスケープ）", () => {
    const html = '<p><a href="https://example.com/?a=1&amp;b=2" target="_blank" rel="noopener">公式サイト</a></p>';
    const { texts, apply } = extractGuideHtmlTexts(html);
    expect(texts).toEqual(["公式サイト"]);
    expect(apply(["Official site"])).toBe(
      '<p><a href="https://example.com/?a=1&amp;b=2" target="_blank" rel="noopener">Official site</a></p>',
    );
  });

  it("インライン装飾をまたぐ文は断片ごとに抽出される", () => {
    const html = "<p>これは<strong>重要</strong>です</p>";
    const { texts, apply } = extractGuideHtmlTexts(html);
    expect(texts).toEqual(["これは", "重要", "です"]);
    expect(apply(["This is ", "important", "."])).toBe("<p>This is <strong>important</strong>.</p>");
  });
});

describe("extractGuideHtmlTexts - エスケープと往復", () => {
  it("&amp; / &lt; を含むテキストは実文字として抽出され、同じ訳文で書き戻すと元のエスケープに戻る", () => {
    const html = "<p>A &amp; B &lt; C</p>";
    const { texts, apply } = extractGuideHtmlTexts(html);
    expect(texts).toEqual(["A & B < C"]);
    expect(apply(texts)).toBe(html);
  });

  it("訳文に <b> や <script> を入れてもエスケープされ、タグ注入にならない", () => {
    const { apply } = extractGuideHtmlTexts("<p>こんにちは</p>");
    const out = apply(["<b>bold</b><script>alert(1)</script>"]);
    expect(out).toBe("<p>&lt;b&gt;bold&lt;/b&gt;&lt;script&gt;alert(1)&lt;/script&gt;</p>");
    // サニタイズ後もタグとして現れない
    const sanitized = sanitizeGuideHtml(out);
    expect(sanitized).not.toContain("<b>");
    expect(sanitized).not.toContain("<script");
  });

  it("訳文=原文で書き戻すと、サニタイズ後の HTML が元と一致する（往復恒等性）", () => {
    const html = [
      "<h2>はじめに</h2>",
      "<p>本文 <strong>強調</strong> と <a href=\"https://example.com/?a=1&amp;b=2\">リンク</a> と &amp; と &lt;tag&gt;</p>",
      "<ul>\n  <li>項目1</li>\n  <li>項目2 <code>cmd</code></li>\n</ul>",
      '<img src="https://example.com/a.png" alt="説明">',
      '<div data-keybind-embed="" data-user-slug="runner1">x</div>',
      "<pre><code>/seed</code></pre>",
      "<p><kbd>F3</kbd> + <kbd>C</kbd></p>",
    ].join("");
    const { texts, apply } = extractGuideHtmlTexts(html);
    expect(texts.length).toBeGreaterThan(0);
    expect(sanitizeGuideHtml(apply([...texts]))).toBe(sanitizeGuideHtml(html));
  });

  it("apply は同じ抽出結果に対して再度呼んでも書き戻せる（後の呼び出しが優先）", () => {
    const { texts, apply } = extractGuideHtmlTexts("<p>あ</p><p>い</p>");
    expect(apply(["1", "2"])).toBe("<p>1</p><p>2</p>");
    expect(apply(texts)).toBe("<p>あ</p><p>い</p>");
  });

  it("要素数が違う配列で書き戻すと例外（多くても少なくても）", () => {
    const { texts, apply } = extractGuideHtmlTexts("<p>あ</p><p>い</p>");
    expect(texts).toHaveLength(2);
    expect(() => apply(["x"])).toThrow(/length mismatch/);
    expect(() => apply(["x", "y", "z"])).toThrow(/length mismatch/);
    expect(() => apply([])).toThrow(/length mismatch/);
  });
});

describe("chunkTexts", () => {
  it("合計文字数が上限以下に収まるよう連続区間に分ける", () => {
    // 3 + 3 = 6 <= 6、次の 3 で超える
    expect(chunkTexts(["aaa", "bbb", "ccc", "ddd"], 6)).toEqual([
      [0, 2],
      [2, 4],
    ]);
  });

  it("上限ちょうどは同じチャンクに入る／1 文字超えると分かれる", () => {
    expect(chunkTexts(["aaa", "bbb"], 6)).toEqual([[0, 2]]);
    expect(chunkTexts(["aaa", "bbbb"], 6)).toEqual([
      [0, 1],
      [1, 2],
    ]);
  });

  it("上限を超える単独要素は単独チャンクになり、前後の要素とは混ざらない", () => {
    expect(chunkTexts(["a", "x".repeat(10), "b"], 5)).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
    expect(chunkTexts(["x".repeat(10)], 5)).toEqual([[0, 1]]);
  });

  it("全チャンクを連結すると元のインデックスが欠けず順序どおりに並ぶ", () => {
    const texts = Array.from({ length: 50 }, (_, i) => "x".repeat((i % 7) + 1));
    const chunks = chunkTexts(texts, 12);
    let expectedStart = 0;
    for (const [start, end] of chunks) {
      expect(start).toBe(expectedStart);
      expect(end).toBeGreaterThan(start);
      const size = texts.slice(start, end).reduce((n, t) => n + t.length, 0);
      if (end - start > 1) expect(size).toBeLessThanOrEqual(12);
      expectedStart = end;
    }
    expect(expectedStart).toBe(texts.length);
  });

  it("空配列は空、全要素が収まるなら 1 チャンク", () => {
    expect(chunkTexts([], 10)).toEqual([]);
    expect(chunkTexts(["a", "b", "c"], 100)).toEqual([[0, 3]]);
  });

  it("空文字の要素も 1 要素として数える", () => {
    expect(chunkTexts(["", "", ""], 1)).toEqual([[0, 3]]);
  });
});
