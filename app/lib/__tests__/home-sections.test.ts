import { describe, it, expect } from "vitest";
import {
  DEFAULT_HOME_SECTION_ORDER,
  HOME_SECTION_IDS,
  isDefaultHomeLayout,
  normalizeHomeLayout,
  parseHomeLayoutFields,
  sameHomeLayout,
  serializeHomeLayout,
} from "../home-sections";

describe("normalizeHomeLayout", () => {
  const def = [...DEFAULT_HOME_SECTION_ORDER];
  const defLayout = { order: def, hidden: [] };

  it("null / undefined / 非文字列・非配列は既定", () => {
    expect(normalizeHomeLayout(null)).toEqual(defLayout);
    expect(normalizeHomeLayout(undefined)).toEqual(defLayout);
    expect(normalizeHomeLayout(42)).toEqual(defLayout);
  });

  it("壊れた JSON は既定", () => {
    expect(normalizeHomeLayout("{not json")).toEqual(defLayout);
    expect(normalizeHomeLayout('"x"')).toEqual(defLayout);
  });

  it("旧形式（配列）は order のみ・hidden 空", () => {
    const order = ["profiles", "live", "videos", "guides", "featured", "favoriteActivity"];
    expect(normalizeHomeLayout(JSON.stringify(order))).toEqual({ order, hidden: [] });
    expect(normalizeHomeLayout(order)).toEqual({ order, hidden: [] });
  });

  it("旧形式でも未知 ID・重複を除き、欠けは既定順で末尾に補う", () => {
    expect(normalizeHomeLayout(["bogus", "videos", 1, "live", "live"]).order).toEqual([
      "videos",
      "live",
      "favoriteActivity",
      "guides",
      "featured",
      "profiles",
    ]);
    expect(normalizeHomeLayout([]).order).toEqual(def);
  });

  it("新形式の order / hidden を読む", () => {
    const layout = normalizeHomeLayout('{"order":["live","videos"],"hidden":["videos","bogus","videos",3]}');
    expect(layout.order).toEqual(["live", "videos", "favoriteActivity", "guides", "featured", "profiles"]);
    expect(layout.hidden).toEqual(["videos"]);
  });

  it("新形式で order が欠けていても hidden は有効", () => {
    expect(normalizeHomeLayout({ hidden: ["guides"] })).toEqual({ order: def, hidden: ["guides"] });
  });

  it("全欄が hidden のときは hidden を空にする", () => {
    expect(normalizeHomeLayout({ order: def, hidden: [...HOME_SECTION_IDS] })).toEqual(defLayout);
  });
});

describe("isDefaultHomeLayout / serializeHomeLayout", () => {
  it("既定順かつ hidden 空のみ既定", () => {
    expect(isDefaultHomeLayout({ order: [...DEFAULT_HOME_SECTION_ORDER], hidden: [] })).toBe(true);
    expect(isDefaultHomeLayout({ order: [...DEFAULT_HOME_SECTION_ORDER], hidden: ["live"] })).toBe(false);
    expect(
      isDefaultHomeLayout({ order: ["live", ...DEFAULT_HOME_SECTION_ORDER.filter((i) => i !== "live")], hidden: [] }),
    ).toBe(false);
  });

  it("既定は null、それ以外は新形式 JSON", () => {
    expect(serializeHomeLayout({ order: [...DEFAULT_HOME_SECTION_ORDER], hidden: [] })).toBeNull();
    const layout = { order: [...DEFAULT_HOME_SECTION_ORDER], hidden: ["live" as const] };
    expect(JSON.parse(serializeHomeLayout(layout)!)).toEqual(layout);
  });
});

describe("parseHomeLayoutFields", () => {
  it("order / hidden の JSON を解析する。hidden が無ければ []", () => {
    expect(parseHomeLayoutFields('["live"]', '["videos"]')).toEqual({ order: ["live"], hidden: ["videos"] });
    expect(parseHomeLayoutFields('["live"]', null)).toEqual({ order: ["live"], hidden: [] });
    expect(parseHomeLayoutFields('["live"]', undefined)).toEqual({ order: ["live"], hidden: [] });
  });

  it("文字列でない・JSON として壊れているときは null", () => {
    expect(parseHomeLayoutFields(null, "[]")).toBeNull();
    expect(parseHomeLayoutFields(new File([], "x"), "[]")).toBeNull();
    expect(parseHomeLayoutFields("[]", new File([], "x"))).toBeNull();
    expect(parseHomeLayoutFields("{oops", "[]")).toBeNull();
    expect(parseHomeLayoutFields("[]", "{oops")).toBeNull();
  });
});

describe("sameHomeLayout", () => {
  const base = { order: [...DEFAULT_HOME_SECTION_ORDER], hidden: ["live" as const, "videos" as const] };

  it("hidden は順序を問わず、order は順序まで比べる", () => {
    expect(sameHomeLayout(base, { order: [...base.order], hidden: ["videos", "live"] })).toBe(true);
    expect(sameHomeLayout(base, { order: [...base.order].reverse(), hidden: base.hidden })).toBe(false);
    expect(sameHomeLayout(base, { order: base.order, hidden: ["live"] })).toBe(false);
    expect(sameHomeLayout(base, { order: base.order, hidden: ["live", "guides"] })).toBe(false);
  });
});
