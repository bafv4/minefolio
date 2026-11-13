import { describe, it, expect } from "vitest";
import { demoteGuideHeadings } from "../guide-heading-demote";

describe("demoteGuideHeadings", () => {
  it("h1〜h5 を1段下げ、h6 は据え置く", () => {
    const html = [1, 2, 3, 4, 5, 6].map((n) => `<h${n}>t</h${n}>`).join("");
    expect(demoteGuideHeadings(html)).toBe(
      "<h2>t</h2><h3>t</h3><h4>t</h4><h5>t</h5><h6>t</h6><h6>t</h6>"
    );
  });

  it("属性を保持する", () => {
    expect(demoteGuideHeadings('<h1 id="heading-1" class="x">a</h1>')).toBe(
      '<h2 id="heading-1" class="x">a</h2>'
    );
  });

  it("大文字タグの大文字小文字を保持する", () => {
    expect(demoteGuideHeadings("<H1>a</H1>")).toBe("<H2>a</H2>");
  });

  it("入れ子の中の見出しや周辺要素を壊さない", () => {
    expect(
      demoteGuideHeadings("<div><h2><strong>a</strong></h2><p>b</p><details><h1>c</h1></details></div>")
    ).toBe("<div><h3><strong>a</strong></h3><p>b</p><details><h2>c</h2></details></div>");
  });

  it("見出し以外のタグ（hr, header, h7, h11）は変更しない", () => {
    const html = "<hr><header>x</header><h7>a</h7><h11>b</h11>";
    expect(demoteGuideHeadings(html)).toBe(html);
  });
});
