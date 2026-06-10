// @vitest-environment jsdom
// HTML 互換性の回帰テスト。
// 保存形式の代表 HTML を parse(JSON) → render(HTML) し、
//   1) 再変換しても安定する（不動点 = 既存ガイドを無編集再保存しても diff が出ない）
//   2) 互換性の判定基準である data-* / class マーカーが保持される
// ことを assert する。buildExtensions() を唯一のソースとして使う。
import { describe, it, expect } from "vitest";
import { generateHTML, generateJSON } from "@tiptap/html";
import { buildExtensions } from "../../editor-config";

const extensions = buildExtensions();

/** HTML → JSON → HTML の 1 往復 */
function roundTrip(html: string): string {
  return generateHTML(generateJSON(html, extensions), extensions);
}

/**
 * 代表サンプル。値は旧エディタの保存形式（renderHTML 出力）に一致させてある。
 * sanitize 許可属性（guides/view.tsx）= 互換性の最終判定基準。
 */
const FIXTURES: Record<string, string> = {
  calloutTip: `<div data-callout="" data-callout-type="tip" class="callout callout-tip"><p>ヒント本文</p></div>`,
  calloutInfo: `<div data-callout="" data-callout-type="info" class="callout callout-info"><p>情報本文</p></div>`,
  calloutWarning: `<div data-callout="" data-callout-type="warning" class="callout callout-warning"><p>警告本文</p></div>`,
  calloutDanger: `<div data-callout="" data-callout-type="danger" class="callout callout-danger"><p>危険本文</p></div>`,
  toggle: `<details><summary>サマリー</summary><div class="toggle-content"><p>中身</p></div></details>`,
  keybindEmbed: `<div data-keybind-embed="" data-user-slug="runner1"></div>`,
  keybindEmbedPreset: `<div data-keybind-embed="" data-user-slug="runner1" data-preset-name="メイン"></div>`,
  searchCraftEmbed: `<div data-searchcraft-embed="" data-user-slug="runner1"></div>`,
  guideLinkNoCover: `<div data-guide-link="" class="guide-link-card"><a href="/g/x" class="guide-link-inner"><div class="guide-link-body"><span class="guide-link-icon">📄</span><div class="guide-link-text"><span class="guide-link-title">タイトル</span></div></div></a></div>`,
  guideLinkWithCover: `<div data-guide-link="" class="guide-link-card"><a href="/g/x" class="guide-link-inner"><img src="https://example.com/c.png" alt="" class="guide-link-cover"><div class="guide-link-body"><span class="guide-link-icon">📄</span><div class="guide-link-text"><span class="guide-link-title">タイトル</span><span class="guide-link-author">著者</span></div></div></a></div>`,
  columns2: `<div data-columns="2"><div data-column=""><p>左</p></div><div data-column=""><p>右</p></div></div>`,
  columns3: `<div data-columns="3"><div data-column=""><p>1</p></div><div data-column=""><p>2</p></div><div data-column=""><p>3</p></div></div>`,
  coloredTable: `<table><tbody><tr><th style="background-color: #F1F1EF">見出し</th><td style="background-color: #FDEBEC; color: #D44C47">セル</td></tr></tbody></table>`,
  widthImage: `<img src="https://example.com/i.png" alt="代替テキスト" width="320">`,
};

describe("guide editor round-trip", () => {
  for (const [name, html] of Object.entries(FIXTURES)) {
    it(`${name} は不動点である（再保存で diff が出ない）`, () => {
      const once = roundTrip(html);
      const twice = roundTrip(once);
      expect(twice).toBe(once);
    });
  }

  it("callout は data-callout-type と class を保持する", () => {
    const out = roundTrip(FIXTURES.calloutWarning);
    expect(out).toContain('data-callout=""');
    expect(out).toContain('data-callout-type="warning"');
    expect(out).toContain("callout callout-warning");
  });

  it("toggle は summary と toggle-content を保持する", () => {
    const out = roundTrip(FIXTURES.toggle);
    expect(out).toContain("<summary>サマリー</summary>");
    expect(out).toContain('class="toggle-content"');
  });

  it("keybind 埋め込みは preset を条件付きで保持する", () => {
    expect(roundTrip(FIXTURES.keybindEmbed)).not.toContain("data-preset-name");
    const withPreset = roundTrip(FIXTURES.keybindEmbedPreset);
    expect(withPreset).toContain('data-keybind-embed=""');
    expect(withPreset).toContain('data-user-slug="runner1"');
    expect(withPreset).toContain('data-preset-name="メイン"');
  });

  it("searchcraft 埋め込みは data-searchcraft-embed を保持する", () => {
    const out = roundTrip(FIXTURES.searchCraftEmbed);
    expect(out).toContain('data-searchcraft-embed=""');
    expect(out).toContain('data-user-slug="runner1"');
  });

  it("ガイドリンクはカバー画像有無の両方で構造を保持する", () => {
    expect(roundTrip(FIXTURES.guideLinkNoCover)).toContain('class="guide-link-card"');
    const withCover = roundTrip(FIXTURES.guideLinkWithCover);
    expect(withCover).toContain('class="guide-link-cover"');
    expect(withCover).toContain('class="guide-link-author"');
  });

  it("段組は data-columns と data-column を保持する", () => {
    expect(roundTrip(FIXTURES.columns2)).toContain('data-columns="2"');
    expect(roundTrip(FIXTURES.columns3)).toContain('data-columns="3"');
    expect(roundTrip(FIXTURES.columns2)).toContain('data-column=""');
  });

  it("色付きテーブルは background-color / color を保持する", () => {
    const out = roundTrip(FIXTURES.coloredTable);
    expect(out).toContain("background-color: #F1F1EF");
    expect(out).toContain("background-color: #FDEBEC");
    expect(out).toContain("color: #D44C47");
  });

  it("画像は width と alt を保持する", () => {
    const out = roundTrip(FIXTURES.widthImage);
    expect(out).toContain('width="320"');
    expect(out).toContain('alt="代替テキスト"');
  });
});
