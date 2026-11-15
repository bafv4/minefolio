// ガイド公開表示の本文 HTML の後段変換（コールアウトの読み上げ）のテスト。入力はサニタイズ後の HTML で書く。
import { describe, it, expect } from "vitest";
import { annotateGuideCallouts } from "../guide-view-html";
import { sanitizeGuideHtml } from "../guide-sanitize.server";

const LABELS: Record<string, string> = { tip: "ヒント", info: "情報", warning: "警告", danger: "危険" };
const labelFor = (type: string) => LABELS[type] ?? null;

const callout = (type: string, body = "<p>本文</p>") =>
  `<div data-callout="" data-callout-type="${type}" class="callout callout-${type}">${body}</div>`;
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
