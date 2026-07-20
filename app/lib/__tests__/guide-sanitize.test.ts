import { describe, it, expect } from "vitest";
import { sanitizeGuideHtml } from "../guide-sanitize.server";
import { normalizeGuideTables } from "../guide-tables";

describe("sanitizeGuideHtml", () => {
  describe("許可タグ", () => {
    it("基本的な書式タグを保持する", () => {
      const html =
        `<h2>見出し</h2><p>本文 <strong>太字</strong> <em>斜体</em> <s>取消</s> <code>code</code></p>` +
        `<ul><li>項目</li></ul><blockquote><p>引用</p></blockquote><hr><pre><code>block</code></pre>`;
      expect(sanitizeGuideHtml(html)).toBe(html);
    });

    it("details / summary（トグルリスト）を保持する", () => {
      const html = `<details class="toggle"><summary>タイトル</summary><p>中身</p></details>`;
      expect(sanitizeGuideHtml(html)).toBe(html);
    });

    it("許可外タグはタグのみ除去して中身のテキストは残す", () => {
      expect(sanitizeGuideHtml(`<p>前<button>クリック</button>後</p>`)).toBe(
        `<p>前クリック後</p>`,
      );
      expect(sanitizeGuideHtml(`<form action="/x"><p>本文</p></form>`)).toBe(`<p>本文</p>`);
    });

    it("script / style は中身ごと除去する", () => {
      expect(sanitizeGuideHtml(`<p>a</p><script>alert(1)</script><p>b</p>`)).toBe(
        `<p>a</p><p>b</p>`,
      );
      expect(sanitizeGuideHtml(`<style>body{display:none}</style><p>x</p>`)).toBe(`<p>x</p>`);
    });

    it("svg / math 等の名前空間タグも除去する", () => {
      const out = sanitizeGuideHtml(`<svg onload="alert(1)"><circle r="1"></circle></svg>`);
      expect(out).not.toContain("<svg");
      expect(out).not.toContain("onload");
    });

    it("HTML コメントを除去する", () => {
      expect(sanitizeGuideHtml(`<p>a</p><!-- コメント --><p>b</p>`)).toBe(`<p>a</p><p>b</p>`);
    });
  });

  describe("属性フィルタ", () => {
    it("class は任意のタグで保持する", () => {
      const html = `<p class="lead">x</p><div class="callout">y</div><h2 class="t">z</h2>`;
      expect(sanitizeGuideHtml(html)).toBe(html);
    });

    it("イベントハンドラ属性を除去する", () => {
      const out = sanitizeGuideHtml(`<p onclick="alert(1)" onmouseover="x()">t</p>`);
      expect(out).toBe(`<p>t</p>`);
    });

    it("img は許可属性のみ保持し、onerror 等を除去する", () => {
      const out = sanitizeGuideHtml(
        `<img src="https://example.com/a.png" alt="図" width="600" height="400" onerror="alert(1)" srcset="x 2x">`,
      );
      expect(out).toContain(`src="https://example.com/a.png"`);
      expect(out).toContain(`alt="図"`);
      expect(out).toContain(`width="600"`);
      expect(out).not.toContain("onerror");
      expect(out).not.toContain("srcset");
    });

    it("a の javascript: href を無効化する", () => {
      const out = sanitizeGuideHtml(`<a href="javascript:alert(1)">link</a>`);
      expect(out).not.toContain("javascript:");
    });

    it("a の通常リンクは href / target / rel を保持する", () => {
      const html = `<a href="https://example.com/x" target="_blank" rel="noopener noreferrer">link</a>`;
      expect(sanitizeGuideHtml(html)).toBe(html);
    });

    it("div のガイド用 data 属性を保持する（空値は裸属性になる）", () => {
      const html =
        `<div data-callout="" data-callout-type="info"><p>注</p></div>` +
        `<div data-keybind-embed="" data-user-slug="alice" data-preset-name="main"></div>`;
      expect(sanitizeGuideHtml(html)).toBe(
        `<div data-callout data-callout-type="info"><p>注</p></div>` +
          `<div data-keybind-embed data-user-slug="alice" data-preset-name="main"></div>`,
      );
    });

    it("mark の data-color と style を保持する", () => {
      const out = sanitizeGuideHtml(`<mark data-color="#fef08a" style="background-color: #fef08a;">強調</mark>`);
      expect(out).toContain(`data-color="#fef08a"`);
      expect(out).toContain("background-color:#fef08a");
    });
  });

  describe("style フィルタ", () => {
    it("許可プロパティ（color / background-color / text-align）のみ通す", () => {
      const out = sanitizeGuideHtml(
        `<span style="color: #D44C47; position: fixed; background-color: #FDEBEC;">x</span>`,
      );
      expect(out).toContain("color:#D44C47");
      expect(out).toContain("background-color:#FDEBEC");
      expect(out).not.toContain("position");
    });

    it("color / background-color はパレット色のみ許可する（焼き付いたテーマ色を除去）", () => {
      // 外部ペースト由来で焼き付く算出スタイル（閲覧テーマの文字色・named color 等）は除去
      const baked = sanitizeGuideHtml(
        `<span style="color: rgb(226, 232, 240);">x</span><span style="color: #000000;">y</span><span style="color: red;">z</span>`,
      );
      expect(baked).not.toContain("color");
      // パレット色は rgb 形式（公開ページからのコピーでブラウザが正規化した形）でも保持
      const paletteRgb = sanitizeGuideHtml(
        `<span style="color: rgb(212, 76, 71);">x</span>`,
      );
      expect(paletteRgb).toContain("rgb(212, 76, 71)");
      // パレット外の背景色も除去
      const bakedBg = sanitizeGuideHtml(
        `<span style="background-color: rgb(30, 41, 59);">x</span>`,
      );
      expect(bakedBg).not.toContain("background-color");
    });

    it("text-align は left/center/right/justify のみ許可する", () => {
      expect(sanitizeGuideHtml(`<td style="text-align: center;">x</td>`)).toContain(
        "text-align:center",
      );
      expect(sanitizeGuideHtml(`<td style="text-align: -moz-evil;">x</td>`)).not.toContain(
        "text-align",
      );
    });

    it("url() / expression() を含む style を除去する", () => {
      const out = sanitizeGuideHtml(
        `<span style="color: expression(alert(1)); background-color: url(javascript:x);">x</span>`,
      );
      expect(out).not.toContain("expression");
      expect(out).not.toContain("url(");
    });

    it("style を許可していないタグの style は除去する", () => {
      expect(sanitizeGuideHtml(`<p style="color: red;">x</p>`)).toBe(`<p>x</p>`);
    });
  });

  describe("iframe（YouTube 埋め込み）", () => {
    it("YouTube の埋め込み iframe を保持する", () => {
      const out = sanitizeGuideHtml(
        `<div data-youtube-video=""><iframe src="https://www.youtube-nocookie.com/embed/abc123" width="640" height="480" allowfullscreen="true" frameborder="0"></iframe></div>`,
      );
      expect(out).toContain(`src="https://www.youtube-nocookie.com/embed/abc123"`);
      expect(out).toContain(`data-youtube-video`);
      expect(sanitizeGuideHtml(`<iframe src="https://www.youtube.com/embed/x"></iframe>`)).toContain(
        "youtube.com/embed/x",
      );
    });

    it("YouTube 以外のホストの iframe は src を除去して無効化する", () => {
      const out = sanitizeGuideHtml(`<iframe src="https://evil.example.com/x"></iframe>`);
      expect(out).not.toContain("evil.example.com");
      expect(sanitizeGuideHtml(`<iframe src="javascript:alert(1)"></iframe>`)).not.toContain(
        "javascript:",
      );
    });

    it("紛らわしいホスト名（youtube.com.evil.com 等）を拒否する", () => {
      expect(
        sanitizeGuideHtml(`<iframe src="https://www.youtube.com.evil.com/embed/x"></iframe>`),
      ).not.toContain("evil.com");
      expect(
        sanitizeGuideHtml(`<iframe src="https://user@evil.com/www.youtube.com"></iframe>`),
      ).not.toContain("evil.com");
    });

    it("相対 URL の iframe src は拒否する", () => {
      expect(sanitizeGuideHtml(`<iframe src="/embed/x"></iframe>`)).not.toContain("src=");
    });
  });

  describe("テーブル（guide-tables パイプラインとの結合）", () => {
    it("TipTap 出力のテーブルは colgroup / col / セル属性を保持する", () => {
      const html =
        `<table style="min-width: 601px;"><colgroup>` +
        `<col style="width: 59px;"><col style="width: 299px;"><col style="width: 218px;"><col style="min-width: 25px;">` +
        `</colgroup><tbody><tr><th colspan="1" rowspan="1"><p>#</p></th></tr></tbody></table>`;
      const out = sanitizeGuideHtml(html);
      expect(out).toContain(`<col style="width:59px;">`);
      expect(out).toContain(`colspan="1"`);
      expect(out).toContain(`min-width:601px;`);
    });

    it("サニタイズ後の出力を normalizeGuideTables が処理できる", () => {
      const html =
        `<table style="min-width: 601px;"><colgroup>` +
        `<col style="width: 59px;"><col style="width: 299px;"><col style="width: 218px;"><col style="min-width: 25px;">` +
        `</colgroup><tbody><tr><th><p>#</p></th></tr></tbody></table>`;
      const out = normalizeGuideTables(sanitizeGuideHtml(html));
      // 固定 576px + 未指定 1 列 × 160px = 736px
      expect(out).toContain("min-width:736px");
    });
  });
});
