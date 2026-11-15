// ガイド公開表示の本文 HTML の後段変換（コールアウトの読み上げ・YouTube の title）と、
// splitContentAtEmbeds の YouTube 分割（本文の直下だけ）のテスト。入力はサニタイズ後の HTML で書く。
import { describe, it, expect } from "vitest";
import {
  annotateGuideCallouts,
  htmlDepthDelta,
  parseGuideYouTubeEmbedUrl,
  titleGuideYouTubeIframes,
} from "../guide-view-html";
import { sanitizeGuideHtml } from "../guide-sanitize.server";
import { splitContentAtEmbeds } from "../../components/guide-embeds";

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
