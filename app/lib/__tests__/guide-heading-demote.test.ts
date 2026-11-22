import { describe, it, expect } from "vitest";
import { demoteGuideHeadings } from "../guide-heading-demote";

describe("demoteGuideHeadings", () => {
  it("h1 始まりは +1 し、h6 でクランプする。元レベルを data-guide-level に残す", () => {
    const html = [1, 2, 3, 4, 5, 6].map((n) => `<h${n}>t</h${n}>`).join("");
    expect(demoteGuideHeadings(html)).toBe(
      [
        '<h2 data-guide-level="1">t</h2>',
        '<h3 data-guide-level="2">t</h3>',
        '<h4 data-guide-level="3">t</h4>',
        '<h5 data-guide-level="4">t</h5>',
        '<h6 data-guide-level="5">t</h6>',
        '<h6 data-guide-level="6">t</h6>',
      ].join("")
    );
  });

  it("h2 始まりは降格しない（h2→h2, h3→h3）", () => {
    expect(demoteGuideHeadings("<h2>a</h2><h3>b</h3>")).toBe(
      '<h2 data-guide-level="2">a</h2><h3 data-guide-level="3">b</h3>'
    );
  });

  it("h3 始まりは h2 に昇格する（相対階層は保つ）", () => {
    expect(demoteGuideHeadings("<h3>a</h3><h4>b</h4>")).toBe(
      '<h2 data-guide-level="3">a</h2><h3 data-guide-level="4">b</h3>'
    );
  });

  it("見出しが無い本文は変更しない", () => {
    const html = "<p>a</p><hr><header>x</header>";
    expect(demoteGuideHeadings(html)).toBe(html);
  });

  it("h1 と h3 の混在は最小の h1 を基準に +1", () => {
    expect(demoteGuideHeadings("<h3>a</h3><h1>b</h1>")).toBe(
      '<h4 data-guide-level="3">a</h4><h2 data-guide-level="1">b</h2>'
    );
  });

  it("属性を保持する", () => {
    expect(demoteGuideHeadings('<h1 id="heading-1" class="x">a</h1>')).toBe(
      '<h2 data-guide-level="1" id="heading-1" class="x">a</h2>'
    );
  });

  it("大文字タグの大文字小文字を保持する", () => {
    expect(demoteGuideHeadings("<H1>a</H1>")).toBe('<H2 data-guide-level="1">a</H2>');
  });

  it("入れ子の中の見出しや周辺要素を壊さない", () => {
    expect(
      demoteGuideHeadings("<div><h2><strong>a</strong></h2><p>b</p><details><h1>c</h1></details></div>")
    ).toBe(
      '<div><h3 data-guide-level="2"><strong>a</strong></h3><p>b</p><details><h2 data-guide-level="1">c</h2></details></div>'
    );
  });

  it("見出し以外のタグ（hr, header, h7, h11）は変更しない", () => {
    const html = "<hr><header>x</header><h7>a</h7><h11>b</h11>";
    expect(demoteGuideHeadings(html)).toBe(html);
  });
});
