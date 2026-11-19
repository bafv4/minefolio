import { describe, expect, it } from "vitest";
import { decodeHtmlAttr, collectPresetNames, isValidTemplateId, parseTemplateIdInput } from "../guide-embed-attrs";
import { sanitizeGuideHtml } from "../guide-sanitize.server";
import { extractEmbedRefs, extractTemplateEmbedIds, splitContentAtEmbeds } from "../../components/guide-embeds";

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

describe("サーチクラフトテンプレート埋め込み", () => {
  const ID_A = "abcdefghijklmnopqrstuvwx";
  const ID_B = "zyxwvutsrqponmlkjihgfedc";
  const tpl = (id: string) => `<div data-sctemplate-embed="" data-template-id="${id}"></div>`;

  it("isValidTemplateId は cuid2 形式だけを通す", () => {
    expect(isValidTemplateId(ID_A)).toBe(true);
    expect(isValidTemplateId("short")).toBe(false);
    expect(isValidTemplateId("A" + ID_A.slice(1))).toBe(false);
    expect(isValidTemplateId(`${ID_A}"><script>`)).toBe(false);
    expect(isValidTemplateId(undefined)).toBe(false);
  });

  it("parseTemplateIdInput は ID・URL・パスから ID を取り出す", () => {
    expect(parseTemplateIdInput(ID_A)).toBe(ID_A);
    expect(parseTemplateIdInput(`https://minefolio.app/guides/templates/${ID_A}`)).toBe(ID_A);
    expect(parseTemplateIdInput(`/guides/templates/${ID_A}?x=1`)).toBe(ID_A);
    expect(parseTemplateIdInput("/guides/templates/new")).toBeNull();
    expect(parseTemplateIdInput("タイトル")).toBeNull();
  });

  it("サニタイズ後も ID が残り、分割・抽出できる", () => {
    const html = sanitizeGuideHtml(tpl(ID_A));
    expect(html).toContain("data-sctemplate-embed");
    expect(html).toContain(`data-template-id="${ID_A}"`);
    expect(splitContentAtEmbeds(html)).toEqual([{ type: "sctemplate-embed", templateId: ID_A, hideKeys: false }]);
    expect(extractTemplateEmbedIds(html)).toEqual([ID_A]);
  });

  it("不正な ID はサニタイズで属性ごと落ち、描画側は null として扱う", () => {
    const html = sanitizeGuideHtml(tpl("not-a-cuid-123456789012345") + tpl("short"));
    expect(html).not.toContain("data-template-id");
    expect(extractTemplateEmbedIds(html)).toEqual([]);
    const segs = splitContentAtEmbeds(html).filter((s) => s.type === "sctemplate-embed");
    expect(segs).toEqual([
      { type: "sctemplate-embed", templateId: null, hideKeys: false },
      { type: "sctemplate-embed", templateId: null, hideKeys: false },
    ]);
  });

  it("keybind / searchcraft / template の混在で順序が保たれ、既存2種は不変", () => {
    const html = sanitizeGuideHtml(
      `<p>a</p><div data-keybind-embed="" data-user-slug="r1"></div>${tpl(ID_A)}<p>b</p>` +
        `<div data-searchcraft-embed="" data-user-slug="r2" data-preset-name="メイン"></div>${tpl(ID_B)}${tpl(ID_A)}`,
    );
    const segs = splitContentAtEmbeds(html);
    expect(segs.map((s) => s.type)).toEqual([
      "html",
      "keybind-embed",
      "sctemplate-embed",
      "html",
      "searchcraft-embed",
      "sctemplate-embed",
      "sctemplate-embed",
    ]);
    expect(segs[1]).toEqual({ type: "keybind-embed", userSlug: "r1", presetName: null });
    expect(segs[4]).toEqual({ type: "searchcraft-embed", userSlug: "r2", presetName: "メイン", hideKeys: false });
    expect(extractTemplateEmbedIds(html)).toEqual([ID_A, ID_B]);
    // テンプレート埋め込みはユーザー参照に混ざらない
    expect(extractEmbedRefs(html).map((r) => r.userSlug)).toEqual(["r1", "r2"]);
  });
});

describe("押すキーを隠す属性（data-hide-keys）", () => {
  it("サニタイズは値が \"true\" のときだけ残す", () => {
    const ok = sanitizeGuideHtml(`<div data-searchcraft-embed data-user-slug="a" data-hide-keys="true"></div>`);
    expect(ok).toContain('data-hide-keys="true"');
    const bad = sanitizeGuideHtml(`<div data-searchcraft-embed data-user-slug="a" data-hide-keys="x"></div>`);
    expect(bad).not.toContain("data-hide-keys");
  });

  it("splitContentAtEmbeds は hideKeys を読む（属性なしは false）", () => {
    const segs = splitContentAtEmbeds(
      `<div data-searchcraft-embed="" data-user-slug="a" data-hide-keys="true"></div>` +
        `<div data-searchcraft-embed="" data-user-slug="b"></div>` +
        `<div data-sctemplate-embed="" data-template-id="abcdefghijklmnopqrstuvwx" data-hide-keys="true"></div>`,
    );
    expect(segs.map((s) => ("hideKeys" in s ? s.hideKeys : null))).toEqual([true, false, true]);
  });
});
