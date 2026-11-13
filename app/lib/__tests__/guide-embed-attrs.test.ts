import { describe, expect, it } from "vitest";
import { decodeHtmlAttr, collectPresetNames } from "../guide-embed-attrs";
import { sanitizeGuideHtml } from "../guide-sanitize.server";
import { extractEmbedRefs, splitContentAtEmbeds } from "../../components/guide-embeds";

describe("decodeHtmlAttr", () => {
  it("名前付き実体をデコードする", () => {
    expect(decodeHtmlAttr("A &amp; &quot;B&quot; &lt;x&gt; &#39;y&#39; &apos;z&apos;")).toBe(
      `A & "B" <x> 'y' 'z'`,
    );
  });
  it("数値参照をデコードする", () => {
    expect(decodeHtmlAttr("&#38;&#x26;&#X3c;&#34;")).toBe(`&&<"`);
  });
  it("二重エスケープは1段だけ戻す", () => {
    expect(decodeHtmlAttr("&amp;lt;")).toBe("&lt;");
    expect(decodeHtmlAttr("&amp;amp;")).toBe("&amp;");
  });
  it("通常文字列・未知の実体・不正な数値参照は不変", () => {
    expect(decodeHtmlAttr("メイン preset-1")).toBe("メイン preset-1");
    expect(decodeHtmlAttr("&foo; &#99999999; a&b")).toBe("&foo; &#99999999; a&b");
  });
});

describe("サニタイズ済み本文からの埋め込み抽出", () => {
  const embed = (name?: string) =>
    `<div data-keybind-embed="" data-user-slug="runner1"${
      name === undefined ? "" : ` data-preset-name="${name.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`
    }></div>`;

  it("& と \" を含むプリセット名が元の名前に戻る", () => {
    const html = sanitizeGuideHtml(embed(`A & "B"`));
    expect(html).toContain("&amp;");
    expect(splitContentAtEmbeds(html)).toEqual([
      { type: "keybind-embed", userSlug: "runner1", presetName: `A & "B"` },
    ]);
    expect([...collectPresetNames(html)]).toEqual([`A & "B"`]);
  });

  it("< > ' を含む名前も戻る", () => {
    const html = sanitizeGuideHtml(`<div data-keybind-embed="" data-user-slug="runner1" data-preset-name="x&lt;y&gt;z 'q'"></div>`);
    expect(splitContentAtEmbeds(html)[0]).toMatchObject({ presetName: "x<y>z 'q'" });
    expect(collectPresetNames(html).has("x<y>z 'q'")).toBe(true);
  });

  it("通常名は従来どおり、属性なしは null", () => {
    const html = sanitizeGuideHtml(embed("メイン") + embed());
    const segs = splitContentAtEmbeds(html);
    expect(segs[0]).toMatchObject({ userSlug: "runner1", presetName: "メイン" });
    expect(segs[1]).toMatchObject({ presetName: null });
    expect(extractEmbedRefs(html)[0]).toMatchObject({ userSlug: "runner1" });
  });

  it("属性が逆順でも extractEmbedRefs がデコードする", () => {
    const html = `<div data-keybind-embed="" data-preset-name="A &amp; B" data-user-slug="r"></div>`;
    expect(extractEmbedRefs(html).some((r) => r.presetName === "A & B")).toBe(true);
  });
});
