import { describe, expect, it } from "vitest";
import { interpolate } from "@/lib/messages";

const GUIDES = "{count, plural, one {# guide} other {# guides}}";

describe("interpolate: 通常の置換", () => {
  it("{var} を置換し、値が無ければそのまま残す", () => {
    expect(interpolate("{a} and {b}", { a: 1 })).toBe("1 and {b}");
  });
});

describe("interpolate: plural 簡易形", () => {
  it("1件は one", () => {
    expect(interpolate(GUIDES, { count: 1 }, "en")).toBe("1 guide");
  });

  it("複数件は other", () => {
    expect(interpolate(GUIDES, { count: 5 }, "en")).toBe("5 guides");
  });

  it("0件は other（en）", () => {
    expect(interpolate(GUIDES, { count: 0 }, "en")).toBe("0 guides");
  });

  it("# と他の変数を併用できる", () => {
    expect(
      interpolate("By {name}: {n, plural, one {# like} other {# likes ({n} total)}}", { name: "A", n: 3 }, "en")
    ).toBe("By A: 3 likes (3 total)");
  });

  it("選択肢の中の {var} も置換する", () => {
    expect(
      interpolate("{count, plural, one {# item by {name}} other {# items by {name}}}", { count: 1, name: "Bob" }, "en")
    ).toBe("1 item by Bob");
  });

  it("zero など one / other 以外の区分は other に落ちる", () => {
    expect(interpolate("{count, plural, zero {none} other {# x}}", { count: 0 }, "en")).toBe("0 x");
  });

  it("=0 の完全一致を使える", () => {
    expect(interpolate("{count, plural, =0 {none} one {# x} other {# xs}}", { count: 0 }, "en")).toBe("none");
  });

  it("ja は常に other", () => {
    expect(interpolate(GUIDES, { count: 1 }, "ja")).toBe("1 guides");
  });

  it("書式済みの数は桁区切りを除いて読み、# には渡した値を入れる", () => {
    const views = "{count, plural, one {# view} other {# views}}";
    expect(interpolate(views, { count: "1,234" }, "en")).toBe("1,234 views");
    expect(interpolate("{count, plural, one {# subscriber} other {# subscribers}}", { count: "1.2K" }, "en")).toBe(
      "1.2K subscribers"
    );
    expect(interpolate(views, { count: "1" }, "en")).toBe("1 view");
  });

  it("文中に複数あっても展開する", () => {
    expect(
      interpolate("{a, plural, one {# cat} other {# cats}} and {b, plural, one {# dog} other {# dogs}}", { a: 1, b: 2 }, "en")
    ).toBe("1 cat and 2 dogs");
  });

  it("不正な形は元の文字を返す", () => {
    expect(interpolate("{count, plural, one {# guide}}", { count: 1 }, "en")).toBe(
      "{count, plural, one {# guide}}"
    );
    expect(interpolate("{count, plural, one {# guide} other {# guides}", { count: 1 }, "en")).toBe(
      "{count, plural, one {# guide} other {# guides}"
    );
    expect(interpolate(GUIDES, {}, "en")).toBe(GUIDES);
  });
});
