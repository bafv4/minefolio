// ガイド公開表示の本文 HTML の後段変換（コールアウトの読み上げ・YouTube の title）と、
// splitContentAtEmbeds の YouTube 分割（本文の直下だけ）のテスト。入力はサニタイズ後の HTML で書く。
import { describe, it, expect } from "vitest";
import {
  annotateGuideCallouts,
  htmlDepthDelta,
  lastHeadingLevel,
  leadingHeadingMatchesTitle,
  normalizeGuideIframes,
  parseGuideYouTubeEmbedUrl,
  removeLeadingHeading,
  titleGuideYouTubeIframes,
} from "../guide-view-html";
import { sanitizeGuideHtml } from "../guide-sanitize.server";
import { buildTableOfContents } from "../guide-toc";
import { embedGroupHeadingLevels, splitContentAtEmbeds } from "../../components/guide-embeds";
import { demoteGuideHeadings } from "../guide-heading-demote";

const LABELS: Record<string, string> = { tip: "ヒント", info: "情報", warning: "警告", danger: "危険" };
const labelFor = (type: string) => LABELS[type] ?? null;

const callout = (type: string, body = "<p>本文</p>") =>
  `<div data-callout="" data-callout-type="${type}" class="callout callout-${type}">${body}</div>`;
const youtube = (src: string) =>
  `<div data-youtube-video=""><iframe src="${src}" width="640" height="360" allowfullscreen="true"></iframe></div>`;
const YT = "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ";

describe("annotateGuideCallouts", () => {
  it("サニタイズ後のコールアウトに role=note と種類名を付ける", () => {
    const html = sanitizeGuideHtml(callout("warning"));
    const out = annotateGuideCallouts(html, labelFor);
    expect(out).toMatch(/<div[^>]*class="callout callout-warning"[^>]*role="note" aria-label="警告">/);
    expect(out).toContain("<p>本文</p>");
  });

  it("4 種類それぞれの名前になる", () => {
    const html = sanitizeGuideHtml(["tip", "info", "warning", "danger"].map((type) => callout(type)).join(""));
    const out = annotateGuideCallouts(html, labelFor);
    for (const label of Object.values(LABELS)) expect(out).toContain(`aria-label="${label}"`);
    expect(out.match(/role="note"/g)).toHaveLength(4);
  });

  it("未知の種類は role だけ付ける", () => {
    const out = annotateGuideCallouts(sanitizeGuideHtml(callout("other")), labelFor);
    expect(out).toContain('role="note"');
    expect(out).not.toContain("aria-label");
  });

  it("コールアウト以外の div（data-callout-type だけ・段組など）は変えない", () => {
    const html = `<div data-callout-type="tip"></div><div data-columns="2"><div data-column=""></div></div>`;
    expect(annotateGuideCallouts(html, labelFor)).toBe(html);
  });

  it("名前の特殊文字はエスケープする", () => {
    const out = annotateGuideCallouts(callout("tip"), () => `"<&>`);
    expect(out).toContain('aria-label="&quot;&lt;&amp;&gt;"');
  });
});

describe("titleGuideYouTubeIframes", () => {
  it("出現順の番号で title と loading=lazy を付ける", () => {
    const html = sanitizeGuideHtml(youtube(YT) + "<p>x</p>" + youtube(YT));
    const out = titleGuideYouTubeIframes(html, (n) => `動画 ${n}`);
    expect(out).toContain('title="動画 1" loading="lazy"');
    expect(out).toContain('title="動画 2" loading="lazy"');
  });

  it("入れ子（コールアウトの中）の iframe にも付く", () => {
    const html = sanitizeGuideHtml(callout("tip", youtube(YT)));
    expect(titleGuideYouTubeIframes(html, (n) => `動画 ${n}`)).toContain('title="動画 1"');
  });

  it("YouTube 以外の本文は変えない", () => {
    const html = "<p>本文</p><div><p>a</p></div>";
    expect(titleGuideYouTubeIframes(html, () => "x")).toBe(html);
  });
});

describe("parseGuideYouTubeEmbedUrl", () => {
  it("nocookie の埋め込み URL にし、開始位置を引き継ぐ", () => {
    expect(parseGuideYouTubeEmbedUrl(` src="${YT}"`)).toBe(YT);
    expect(parseGuideYouTubeEmbedUrl(` src="https://www.youtube.com/embed/dQw4w9WgXcQ?start=30&amp;rel=0"`)).toBe(
      `${YT}?start=30`,
    );
  });

  it("src が無い・動画 ID が取れないときは null", () => {
    expect(parseGuideYouTubeEmbedUrl(' width="640"')).toBeNull();
    expect(parseGuideYouTubeEmbedUrl(' src="https://www.youtube-nocookie.com/"')).toBeNull();
  });

  it("数字でない start は捨てる", () => {
    expect(parseGuideYouTubeEmbedUrl(` src="${YT}?start=abc"`)).toBe(YT);
  });
});

describe("htmlDepthDelta", () => {
  it("開きタグ +1・閉じタグ -1、空要素は数えない", () => {
    expect(htmlDepthDelta("<div><p>a<br>b</p>")).toBe(1);
    expect(htmlDepthDelta('<img src="x"><hr></div>')).toBe(-1);
    expect(htmlDepthDelta("<colgroup><col style=\"width:1px\"></colgroup>")).toBe(0);
  });
});

describe("splitContentAtEmbeds の YouTube", () => {
  it("本文の直下の動画はセグメントに分ける（番号は出現順）", () => {
    const html = sanitizeGuideHtml(`<p>前</p>${youtube(YT)}<p>後</p>${youtube(`${YT}?start=5`)}`);
    const segs = splitContentAtEmbeds(html);
    expect(segs.map((s) => s.type)).toEqual(["html", "youtube", "html", "youtube"]);
    expect(segs[1]).toEqual({ type: "youtube", embedUrl: YT, index: 1 });
    expect(segs[3]).toEqual({ type: "youtube", embedUrl: `${YT}?start=5`, index: 2 });
  });

  it("コールアウト・段組・トグルの中の動画は分けず、番号だけ進める", () => {
    const nested = [
      callout("tip", youtube(YT)),
      `<div data-columns="2"><div data-column="">${youtube(YT)}</div><div data-column=""><p>b</p></div></div>`,
      `<details><summary>開く</summary><div class="toggle-content">${youtube(YT)}</div></details>`,
    ].join("");
    const html = sanitizeGuideHtml(nested + youtube(YT));
    const segs = splitContentAtEmbeds(html);
    expect(segs).toHaveLength(2);
    expect(segs[0].type).toBe("html");
    // 入れ子の動画は iframe のまま断片に残り、構造（開閉タグ）が揃っている
    const first = segs[0].type === "html" ? segs[0].content : "";
    expect(first.match(/<iframe/g)).toHaveLength(3);
    expect(htmlDepthDelta(first)).toBe(0);
    expect(segs[1]).toEqual({ type: "youtube", embedUrl: YT, index: 4 });
  });

  it("titleGuideYouTubeIframes の後でも分けられる", () => {
    const html = titleGuideYouTubeIframes(sanitizeGuideHtml(youtube(YT)), (n) => `動画 ${n}`);
    expect(splitContentAtEmbeds(html)).toEqual([{ type: "youtube", embedUrl: YT, index: 1 }]);
  });

  it("許可外ホストで src が除去された直下の動画は何も描かない", () => {
    const html = sanitizeGuideHtml(`<p>a</p>${youtube("https://evil.example.com/embed/x")}<p>b</p>`);
    expect(html).not.toContain("evil.example.com");
    const segs = splitContentAtEmbeds(html);
    expect(segs.map((s) => s.type)).toEqual(["html", "html"]);
  });

  it("再生リスト（videoseries・list 付き）は押してから読み込む形に直せないので iframe のまま残す", () => {
    const playlist = "https://www.youtube-nocookie.com/embed/videoseries?list=PLabcdefghijk";
    expect(parseGuideYouTubeEmbedUrl(` src="${playlist}"`)).toBeNull();
    expect(parseGuideYouTubeEmbedUrl(` src="${YT}?list=PLabcdefghijk"`)).toBeNull();
    const html = titleGuideYouTubeIframes(sanitizeGuideHtml(`<p>a</p>${youtube(playlist)}${youtube(YT)}`), (n) => `動画 ${n}`);
    const segs = splitContentAtEmbeds(html);
    expect(segs.map((s) => s.type)).toEqual(["html", "youtube"]);
    const first = segs[0].type === "html" ? segs[0].content : "";
    expect(first).toContain("videoseries");
    expect(first).toContain('title="動画 1"');
    expect(segs[1]).toEqual({ type: "youtube", embedUrl: YT, index: 2 });
  });

  it("動画とほかの埋め込みが混ざっても順番どおり", () => {
    const html = sanitizeGuideHtml(
      `${youtube(YT)}<div data-keybind-embed="" data-user-slug="runner1"></div><p>x</p>`,
    );
    expect(splitContentAtEmbeds(html).map((s) => s.type)).toEqual(["youtube", "keybind-embed", "html"]);
  });
});

describe("leadingHeadingMatchesTitle / removeLeadingHeading", () => {
  it("本文の先頭がタイトルと同じ文の h1 なら一致し、取り除くと次のブロックから始まる", () => {
    const html = sanitizeGuideHtml("<h1>ウクライナ語サーチクラフト</h1><h2>1.特徴</h2><p>本文</p>");
    expect(leadingHeadingMatchesTitle(html, "ウクライナ語サーチクラフト")).toBe(true);
    expect(removeLeadingHeading(html)).toBe("<h2>1.特徴</h2><p>本文</p>");
  });

  it("前後の空白・全角と半角の空白の違い・インラインの装飾は無視して比べる", () => {
    const html = sanitizeGuideHtml("<h1>  <strong>地下Blind</strong>　の対処法 </h1><p>x</p>");
    expect(leadingHeadingMatchesTitle(html, "地下Blind の対処法")).toBe(true);
    expect(leadingHeadingMatchesTitle(html, " 地下Blind　の対処法")).toBe(true);
  });

  it("文字参照を復号して比べる（タイトルの & や < も一致する）", () => {
    const html = sanitizeGuideHtml("<h2>A &amp; B &lt;1.16&gt;</h2><p>x</p>");
    expect(html.startsWith("<h2>A &amp; B &lt;1.16&gt;</h2>")).toBe(true);
    expect(leadingHeadingMatchesTitle(html, "A & B <1.16>")).toBe(true);
  });

  it("言い換えた見出し・空白の有無が違う見出しは一致しない", () => {
    const html = sanitizeGuideHtml("<h1>ハンガリー語サーチクラフト</h1><p>x</p>");
    expect(leadingHeadingMatchesTitle(html, "Magyar(ハンガリー語)サーチクラフト")).toBe(false);
    expect(leadingHeadingMatchesTitle(html, "ハンガリー語 サーチクラフト")).toBe(false);
  });

  it("最初のブロックが見出しでなければ一致せず、取り除かない（2番目以降の見出しは見ない）", () => {
    const html = sanitizeGuideHtml("<p>はじめに</p><h1>タイトル</h1>");
    expect(leadingHeadingMatchesTitle(html, "タイトル")).toBe(false);
    expect(removeLeadingHeading(html)).toBe(html);
  });

  it("段組み・コールアウトの中の見出しは見ない", () => {
    const columns = sanitizeGuideHtml(
      '<div data-columns="2"><div data-column=""><h1>タイトル</h1><p>a</p></div><div data-column=""><p>b</p></div></div>',
    );
    expect(leadingHeadingMatchesTitle(columns, "タイトル")).toBe(false);
    expect(removeLeadingHeading(columns)).toBe(columns);
  });

  it("タイトルか見出しが空なら一致しない", () => {
    expect(leadingHeadingMatchesTitle(sanitizeGuideHtml("<h1></h1><p>x</p>"), "")).toBe(false);
    expect(leadingHeadingMatchesTitle(sanitizeGuideHtml("<h1>a</h1>"), "   ")).toBe(false);
  });

  it("閉じていない見出しは見出しとして扱わない", () => {
    expect(leadingHeadingMatchesTitle("<h1>タイトル<p>x</p>", "タイトル")).toBe(false);
    expect(removeLeadingHeading("<h1>タイトル<p>x</p>")).toBe("<h1>タイトル<p>x</p>");
  });

  it("目次は取り除いた後の本文から作られ、タイトルの見出しを含まない", () => {
    const html = removeLeadingHeading(sanitizeGuideHtml("<h1>T</h1><h1>節A</h1><h2>小節</h2>"));
    const { toc } = buildTableOfContents(html);
    expect(toc.map((i) => i.text)).toEqual(["節A", "小節"]);
    expect(toc[0].id).toBe("heading-1");
  });
});

describe("lastHeadingLevel", () => {
  it("最後に現れる見出しの開きタグの段を返す（閉じタグ・入れ物の中も文書順）", () => {
    expect(lastHeadingLevel("<h2>A</h2><p>x</p><h4>B</h4>")).toBe(4);
    expect(lastHeadingLevel(`<h2>A</h2>${callout("tip", "<h3>中</h3>")}`)).toBe(3);
    expect(lastHeadingLevel('<H3 id="a">A</H3>')).toBe(3);
  });

  it("見出しが無ければ null（h1x のような別タグ・エスケープされた文字列は数えない）", () => {
    expect(lastHeadingLevel("<p>本文</p>")).toBeNull();
    expect(lastHeadingLevel("<header>x</header><hr><p>&lt;h2&gt;</p>")).toBeNull();
  });

  it("降格後は data-guide-level（元の段）ではなくタグ名の段を返す", () => {
    expect(lastHeadingLevel(demoteGuideHeadings("<h1>A</h1><h2>B</h2>"))).toBe(3);
    // h3 始まりは1段上がる（−1）
    expect(lastHeadingLevel(demoteGuideHeadings("<h3>A</h3>"))).toBe(2);
  });
});

describe("embedGroupHeadingLevels", () => {
  const sc = '<div data-searchcraft-embed="" data-user-slug="r"></div>';
  const tpl = '<div data-sctemplate-embed="" data-template-id="abc"></div>';
  const kb = '<div data-keybind-embed="" data-user-slug="r"></div>';
  const levels = (html: string) =>
    embedGroupHeadingLevels(splitContentAtEmbeds(demoteGuideHeadings(html)));

  it("直前の本文の見出し（降格後）の1つ下にする（本文 h1 → 公開 h2 → 埋め込み h3）", () => {
    expect(levels(`<h1>サーチクラフト</h1>${sc}`)).toEqual([null, "h3"]);
  });

  it("本文 h2 の下は h4（固定の h3 だと h3 → h3 になる）", () => {
    expect(levels(`<h1>A</h1><h2>B</h2><p>x</p>${tpl}`)).toEqual([null, "h4"]);
  });

  it("前に見出しが無ければ h3、上限は h6", () => {
    expect(levels(`<p>前</p>${sc}`)).toEqual([null, "h3"]);
    expect(levels(sc)).toEqual(["h3"]);
    expect(levels(`<h1>A</h1><h2>B</h2><h3>C</h3><h4>D</h4><h5>E</h5>${sc}`)).toEqual([null, "h6"]);
  });

  it("直前の見出しはセグメントをまたいで持ち越し、後ろの見出しは前の埋め込みに効かない", () => {
    const html = `<h1>A</h1>${sc}${youtube(YT)}${kb}<h2>B</h2>${tpl}`;
    expect(levels(html)).toEqual([null, "h3", null, "h3", null, "h4"]);
  });

  it("h3 始まりの本文（降格で h2 に上がる）の下も h3", () => {
    expect(levels(`<h3>A</h3>${sc}`)).toEqual([null, "h3"]);
  });
});

describe("normalizeGuideIframes", () => {
  const bare = (src: string) => `<iframe src="${src}" width="640" height="360"></iframe>`;

  it("包まれていない iframe を div[data-youtube-video] で包む", () => {
    const out = normalizeGuideIframes(`<p>前</p>${bare(YT)}<p>後</p>`);
    expect(out).toBe(`<p>前</p><div data-youtube-video>${bare(YT)}</div><p>後</p>`);
  });

  it("包んだ後は titleGuideYouTubeIframes と splitContentAtEmbeds が埋め込みとして扱える", () => {
    const out = normalizeGuideIframes(`<p>前</p>${bare(YT)}`);
    expect(titleGuideYouTubeIframes(out, (i) => `動画 ${i}`)).toContain('title="動画 1"');
    const segments = splitContentAtEmbeds(out);
    expect(segments.some((s) => s.type === "youtube")).toBe(true);
  });

  it("すでに包まれている埋め込みは二重に包まない（属性の順・値の有無によらず）", () => {
    const wrapped = youtube(YT);
    expect(normalizeGuideIframes(wrapped)).toBe(wrapped);
    const bareAttr = `<div class="x" data-youtube-video><iframe src="${YT}"></iframe></div>`;
    expect(normalizeGuideIframes(bareAttr)).toBe(bareAttr);
    // 2回かけても変わらない（冪等）
    const once = normalizeGuideIframes(bare(YT));
    expect(normalizeGuideIframes(once)).toBe(once);
  });

  it("src の無い iframe は、包まれていてもいなくても取り除く", () => {
    expect(normalizeGuideIframes(`<p>a</p><iframe width="640"></iframe><p>b</p>`)).toBe("<p>a</p><p>b</p>");
    expect(normalizeGuideIframes(`<p>a</p><div data-youtube-video=""><iframe width="640"></iframe></div>`)).toBe(
      "<p>a</p>",
    );
    expect(normalizeGuideIframes(`<iframe src=""></iframe>`)).toBe("");
  });

  it("包まれた埋め込みと包まれていない iframe が混在しても、それぞれを扱う", () => {
    const html = `${youtube(YT)}${bare(YT)}<iframe></iframe>`;
    expect(normalizeGuideIframes(html)).toBe(`${youtube(YT)}<div data-youtube-video>${bare(YT)}</div>`);
  });

  it("ホストは見ない（src があれば包む）。YouTube 以外を落とすのはサニタイズの役目", () => {
    // 前提: サニタイズの後に呼ぶ。この関数単体は src の有無だけを見る
    const other = bare("https://example.com/embed/x");
    expect(normalizeGuideIframes(other)).toBe(`<div data-youtube-video>${other}</div>`);
  });

  it("サニタイズを通すと、YouTube 以外の iframe は取り除かれ、YouTube だけが包まれて残る", () => {
    const html = sanitizeGuideHtml(
      `<p>a</p><iframe src="https://example.com/embed/x"></iframe><iframe src="${YT}"></iframe><p>b</p>`,
    );
    const out = normalizeGuideIframes(html);
    expect(out).not.toContain("example.com");
    // サニタイズは許可外ホストの src だけを除去し（`<iframe></iframe>` が残る）、ここでそれを取り除く
    expect(html).toContain("<iframe></iframe>");
    expect(out).toBe(`<p>a</p><div data-youtube-video><iframe src="${YT}"></iframe></div><p>b</p>`);
  });
});
