import { describe, it, expect } from "vitest";
import { blankGenericImageAlt } from "../guide-image-alt";

describe("blankGenericImageAlt", () => {
  it('alt="image" を空にし、他の属性は保持する', () => {
    expect(blankGenericImageAlt('<img src="a.png" alt="image" width="320">')).toBe(
      '<img src="a.png" alt="" width="320">'
    );
  });

  it("大文字小文字・シングルクォート・前後空白を許容する", () => {
    expect(blankGenericImageAlt("<img src='a.png' alt=' Image '>")).toBe(
      "<img src='a.png' alt=\"\">"
    );
  });

  it("利用者が入力した alt は保持する", () => {
    const html = '<img src="a.png" alt="スポーン地点の画像">';
    expect(blankGenericImageAlt(html)).toBe(html);
    expect(blankGenericImageAlt('<img src="a.png" alt="image of a house">')).toBe(
      '<img src="a.png" alt="image of a house">'
    );
  });

  it("本文テキストや img 以外の属性は変えない", () => {
    const html = '<p alt="image">image</p><img src="a.png">';
    expect(blankGenericImageAlt(html)).toBe(html);
  });

  it("複数の画像をそれぞれ処理する", () => {
    expect(
      blankGenericImageAlt('<img alt="image" src="a"><img alt="x" src="b"><img alt="image" src="c">')
    ).toBe('<img alt="" src="a"><img alt="x" src="b"><img alt="" src="c">');
  });
});
