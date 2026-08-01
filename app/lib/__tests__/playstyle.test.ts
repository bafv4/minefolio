// プレイスタイル共有定義（app/lib/playstyle.ts）のテスト。
// - validatePlaystyle: 既知キーのみ・重複除去・定義順正規化・main∈選択集合・enum検証・自由入力の trim/上限
// - parse系: 破損JSON耐性（preset-read.ts の safeParseArray と同じ方針）
// - editionOfVersion / versionLabel / groupVersionsByEdition
// - 表示条件ヘルパー（isKbmPlaystyle / playsJavaRsgOrRanked / hasBastionVersions）
import { describe, it, expect } from "vitest";
import {
  validatePlaystyle,
  parsePlaystyleVersions,
  parsePlaystyleCategories,
  parsePlaystyleClickMethods,
  editionOfVersion,
  versionLabel,
  groupVersionsByEdition,
  isKbmPlaystyle,
  playsJavaRsgOrRanked,
  hasBastionVersions,
  type PlaystyleInput,
} from "../playstyle";

describe("validatePlaystyle", () => {
  it("全項目 null（未回答）でも ok になる", () => {
    const result = validatePlaystyle({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      versions: [],
      categories: [],
      mainVersion: null,
      mainCategory: null,
      hotbarSwitching: null,
      searchCraft: null,
      halfShift: null,
      itemLayoutPolicy: null,
      clickMethods: [],
      dragTapeType: null,
      usesMousepad: null,
      mousepadType: null,
      zeroCycle: null,
      groundZero: null,
      oneshot: null,
      favoriteBastion: null,
    });
  });

  it("フル入力（全項目に有効な値）で ok になる", () => {
    const input: PlaystyleInput = {
      versions: ["java:1_16_1_19", "bedrock:1_18"],
      categories: ["rsg", "ranked"],
      mainVersion: "java:1_16_1_19",
      mainCategory: "rsg",
      hotbarSwitching: "hotkeys",
      searchCraft: "does",
      halfShift: "actively",
      itemLayoutPolicy: "strict",
      clickMethods: ["normal", "drag"],
      dragTapeType: "青テープ",
      usesMousepad: "uses",
      mousepadType: "XLサイズ",
      zeroCycle: "does",
      groundZero: "can",
      oneshot: "cannot",
      favoriteBastion: "housing",
    };
    const result = validatePlaystyle(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      versions: ["java:1_16_1_19", "bedrock:1_18"],
      categories: ["rsg", "ranked"],
      mainVersion: "java:1_16_1_19",
      mainCategory: "rsg",
      hotbarSwitching: "hotkeys",
      searchCraft: "does",
      halfShift: "actively",
      itemLayoutPolicy: "strict",
      clickMethods: ["normal", "drag"],
      dragTapeType: "青テープ",
      usesMousepad: "uses",
      mousepadType: "XLサイズ",
      zeroCycle: "does",
      groundZero: "can",
      oneshot: "cannot",
      favoriteBastion: "housing",
    });
  });

  it("mainVersion が versions（正規化後）に含まれていなければ拒否する", () => {
    const result = validatePlaystyle({
      versions: ["java:1_8"],
      mainVersion: "java:1_16_1_19",
    });
    expect(result).toEqual({ ok: false, errorKey: "mePlaystyle.errorMainVersionInvalid" });
  });

  it("mainCategory が categories（正規化後）に含まれていなければ拒否する", () => {
    const result = validatePlaystyle({
      categories: ["rsg"],
      mainCategory: "ranked",
    });
    expect(result).toEqual({ ok: false, errorKey: "mePlaystyle.errorMainCategoryInvalid" });
  });

  it("未知キーは除去される（versions/categories/clickMethods）", () => {
    const result = validatePlaystyle({
      versions: ["java:1_8", "java:9999_bogus", "switch:1_16"],
      categories: ["rsg", "unknown_category"],
      clickMethods: ["normal", "teleport"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.versions).toEqual(["java:1_8"]);
    expect(result.value.categories).toEqual(["rsg"]);
    expect(result.value.clickMethods).toEqual(["normal"]);
  });

  it("重複は除去され、定義順（ALL_VERSION_KEYS / CATEGORIES / CLICK_METHOD_OPTIONS の並び）に正規化される", () => {
    const result = validatePlaystyle({
      versions: ["bedrock:1_18", "java:1_8", "java:1_8", "java:pre_1_8"],
      categories: ["ranked", "rsg", "ranked", "ssg"],
      clickMethods: ["drag", "normal", "drag", "jitter"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // ALL_VERSION_KEYS は Java(定義順) → Bedrock(定義順) なので java:pre_1_8 → java:1_8 → bedrock:1_18
    expect(result.value.versions).toEqual(["java:pre_1_8", "java:1_8", "bedrock:1_18"]);
    // CATEGORIES の定義順は rsg, ssg, aa, ce, ranked, other
    expect(result.value.categories).toEqual(["rsg", "ssg", "ranked"]);
    // CLICK_METHOD_OPTIONS の定義順は normal, jitter, butterfly, drag
    expect(result.value.clickMethods).toEqual(["normal", "jitter", "drag"]);
  });

  it("enum 外の値（hotbarSwitching 等）は errorKey を返して拒否する", () => {
    expect(validatePlaystyle({ hotbarSwitching: "bogus" })).toEqual({
      ok: false,
      errorKey: "mePlaystyle.errorInvalidOption",
    });
    expect(validatePlaystyle({ searchCraft: "bogus" })).toEqual({
      ok: false,
      errorKey: "mePlaystyle.errorInvalidOption",
    });
    expect(validatePlaystyle({ halfShift: "bogus" })).toEqual({
      ok: false,
      errorKey: "mePlaystyle.errorInvalidOption",
    });
    expect(validatePlaystyle({ itemLayoutPolicy: "bogus" })).toEqual({
      ok: false,
      errorKey: "mePlaystyle.errorInvalidOption",
    });
    expect(validatePlaystyle({ usesMousepad: "bogus" })).toEqual({
      ok: false,
      errorKey: "mePlaystyle.errorInvalidOption",
    });
    expect(validatePlaystyle({ zeroCycle: "bogus" })).toEqual({
      ok: false,
      errorKey: "mePlaystyle.errorInvalidOption",
    });
    expect(validatePlaystyle({ groundZero: "bogus" })).toEqual({
      ok: false,
      errorKey: "mePlaystyle.errorInvalidOption",
    });
    expect(validatePlaystyle({ oneshot: "bogus" })).toEqual({
      ok: false,
      errorKey: "mePlaystyle.errorInvalidOption",
    });
    expect(validatePlaystyle({ favoriteBastion: "bogus" })).toEqual({
      ok: false,
      errorKey: "mePlaystyle.errorInvalidOption",
    });
  });

  describe("dragTapeType / mousepadType（自由入力）", () => {
    it("前後の空白は trim される", () => {
      const result = validatePlaystyle({
        dragTapeType: "  青テープ  ",
        mousepadType: "  XLサイズ  ",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.dragTapeType).toBe("青テープ");
      expect(result.value.mousepadType).toBe("XLサイズ");
    });

    it("空文字・空白のみは null になる", () => {
      const result = validatePlaystyle({ dragTapeType: "   ", mousepadType: "" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.dragTapeType).toBeNull();
      expect(result.value.mousepadType).toBeNull();
    });

    it("trim 後 100 文字はそのまま通る", () => {
      const exactly100 = "a".repeat(100);
      const result = validatePlaystyle({ dragTapeType: exactly100 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.dragTapeType).toBe(exactly100);
    });

    it("trim 後 101 文字は errorKey を返す（dragTapeType）", () => {
      const tooLong = "a".repeat(101);
      expect(validatePlaystyle({ dragTapeType: tooLong })).toEqual({
        ok: false,
        errorKey: "mePlaystyle.errorDragTapeTypeTooLong",
      });
    });

    it("trim 後 101 文字は errorKey を返す（mousepadType）", () => {
      const tooLong = "a".repeat(101);
      expect(validatePlaystyle({ mousepadType: tooLong })).toEqual({
        ok: false,
        errorKey: "mePlaystyle.errorMousepadTypeTooLong",
      });
    });

    it("前後の空白を含めて 101 文字超なら trim 後の長さで判定する（trim 後ちょうど100は通る）", () => {
      const padded = `  ${"a".repeat(100)}  `;
      const result = validatePlaystyle({ dragTapeType: padded });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.dragTapeType).toBe("a".repeat(100));
    });
  });

  it("条件外項目でも値は受理される（KBM限定の clickMethods が inputMethod と無関係に保存される）", () => {
    // validatePlaystyle 自体は inputMethod を受け取らない（表示条件は別ヘルパー側の責務）。
    // KBM 限定の項目であっても常に受理されることを確認する。
    const result = validatePlaystyle({ clickMethods: ["jitter", "butterfly"] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.clickMethods).toEqual(["jitter", "butterfly"]);
  });

  it("条件外項目でも値は受理される（Java RSG/Ranked 限定の zeroCycle 等が単独でも保存される）", () => {
    const result = validatePlaystyle({
      versions: ["bedrock:1_18"],
      categories: ["ssg"],
      zeroCycle: "does",
      groundZero: "can",
      oneshot: "cannot",
      favoriteBastion: "bridge",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.zeroCycle).toBe("does");
    expect(result.value.groundZero).toBe("can");
    expect(result.value.oneshot).toBe("cannot");
    expect(result.value.favoriteBastion).toBe("bridge");
  });
});

describe("parsePlaystyleVersions", () => {
  it("null / undefined は空配列", () => {
    expect(parsePlaystyleVersions(null)).toEqual([]);
    expect(parsePlaystyleVersions(undefined)).toEqual([]);
  });

  it("破損 JSON は例外を投げず空配列を返す", () => {
    expect(parsePlaystyleVersions("not json")).toEqual([]);
    expect(parsePlaystyleVersions('["unterminated')).toEqual([]);
  });

  it("非配列 JSON（オブジェクト）は空配列", () => {
    expect(parsePlaystyleVersions("{}")).toEqual([]);
    expect(parsePlaystyleVersions('{"foo":"bar"}')).toEqual([]);
  });

  it("未知キー混在は既知のみ残す", () => {
    expect(parsePlaystyleVersions('["java:1_8","bogus:1_0","bedrock:1_18"]')).toEqual([
      "java:1_8",
      "bedrock:1_18",
    ]);
  });

  it("正常な配列はそのまま復元する", () => {
    expect(parsePlaystyleVersions('["java:1_16_1_19","java:1_20_plus"]')).toEqual([
      "java:1_16_1_19",
      "java:1_20_plus",
    ]);
  });
});

describe("parsePlaystyleCategories", () => {
  it("null / undefined は空配列", () => {
    expect(parsePlaystyleCategories(null)).toEqual([]);
    expect(parsePlaystyleCategories(undefined)).toEqual([]);
  });

  it("破損 JSON は空配列", () => {
    expect(parsePlaystyleCategories("{bad")).toEqual([]);
  });

  it("非配列 JSON は空配列", () => {
    expect(parsePlaystyleCategories('{"value":"rsg"}')).toEqual([]);
  });

  it("未知キー混在は既知のみ残す", () => {
    expect(parsePlaystyleCategories('["rsg","bogus","ranked"]')).toEqual(["rsg", "ranked"]);
  });

  it("正常な配列はそのまま復元する", () => {
    expect(parsePlaystyleCategories('["rsg","ssg","other"]')).toEqual(["rsg", "ssg", "other"]);
  });
});

describe("parsePlaystyleClickMethods", () => {
  it("null / undefined は空配列", () => {
    expect(parsePlaystyleClickMethods(null)).toEqual([]);
    expect(parsePlaystyleClickMethods(undefined)).toEqual([]);
  });

  it("破損 JSON は空配列", () => {
    expect(parsePlaystyleClickMethods("[[[")).toEqual([]);
  });

  it("非配列 JSON は空配列", () => {
    expect(parsePlaystyleClickMethods("42")).toEqual([]);
  });

  it("未知キー混在は既知のみ残す", () => {
    expect(parsePlaystyleClickMethods('["normal","teleport","drag"]')).toEqual([
      "normal",
      "drag",
    ]);
  });

  it("正常な配列はそのまま復元する", () => {
    expect(parsePlaystyleClickMethods('["jitter","butterfly"]')).toEqual(["jitter", "butterfly"]);
  });
});

describe("editionOfVersion", () => {
  it("java: プレフィックスは java", () => {
    expect(editionOfVersion("java:1_8")).toBe("java");
    expect(editionOfVersion("java:1_20_plus")).toBe("java");
  });

  it("bedrock: プレフィックスは bedrock", () => {
    expect(editionOfVersion("bedrock:1_18")).toBe("bedrock");
    expect(editionOfVersion("bedrock:pre_1_11")).toBe("bedrock");
  });
});

describe("versionLabel", () => {
  it("java:1_16_1_19 は '1.16-1.19'（エディション名は含まない）", () => {
    expect(versionLabel("java:1_16_1_19")).toBe("1.16-1.19");
  });

  it("bedrock:1_16_100_1_17 は '1.16.100-1.17'", () => {
    expect(versionLabel("bedrock:1_16_100_1_17")).toBe("1.16.100-1.17");
  });

  it("bedrock:1_18 は '1.18+'", () => {
    expect(versionLabel("bedrock:1_18")).toBe("1.18+");
  });
});

describe("groupVersionsByEdition", () => {
  it("java / bedrock に振り分ける", () => {
    const result = groupVersionsByEdition(["java:1_8", "bedrock:1_18", "java:1_20_plus"]);
    expect(result.java).toEqual(["java:1_8", "java:1_20_plus"]);
    expect(result.bedrock).toEqual(["bedrock:1_18"]);
  });

  it("空配列は両方とも空配列", () => {
    expect(groupVersionsByEdition([])).toEqual({ java: [], bedrock: [] });
  });
});

describe("isKbmPlaystyle", () => {
  it("keyboard_mouse のみ true", () => {
    expect(isKbmPlaystyle("keyboard_mouse")).toBe(true);
  });

  it("controller / touch / null / undefined は false", () => {
    expect(isKbmPlaystyle("controller")).toBe(false);
    expect(isKbmPlaystyle("touch")).toBe(false);
    expect(isKbmPlaystyle(null)).toBe(false);
    expect(isKbmPlaystyle(undefined)).toBe(false);
  });
});

describe("playsJavaRsgOrRanked", () => {
  it("java が無ければ rsg/ranked があっても false", () => {
    expect(playsJavaRsgOrRanked(["bedrock:1_18"], ["rsg"])).toBe(false);
  });

  it("java があっても rsg/ranked が無ければ false（ssg のみ）", () => {
    expect(playsJavaRsgOrRanked(["java:1_16_1_19"], ["ssg"])).toBe(false);
  });

  it("java + rsg なら true", () => {
    expect(playsJavaRsgOrRanked(["java:1_16_1_19"], ["rsg"])).toBe(true);
  });

  it("java + ranked なら true", () => {
    expect(playsJavaRsgOrRanked(["java:1_8"], ["ranked"])).toBe(true);
  });

  it("bedrock のみ + ranked は false（java が無い）", () => {
    expect(playsJavaRsgOrRanked(["bedrock:1_18"], ["ranked"])).toBe(false);
  });

  it("空配列は false", () => {
    expect(playsJavaRsgOrRanked([], [])).toBe(false);
  });
});

describe("hasBastionVersions", () => {
  it("java:1_16_1_19 は true", () => {
    expect(hasBastionVersions(["java:1_16_1_19"])).toBe(true);
  });

  it("java:1_20_plus は true", () => {
    expect(hasBastionVersions(["java:1_20_plus"])).toBe(true);
  });

  it("bedrock:1_16 は true", () => {
    expect(hasBastionVersions(["bedrock:1_16"])).toBe(true);
  });

  it("bedrock:1_16_100_1_17 は true", () => {
    expect(hasBastionVersions(["bedrock:1_16_100_1_17"])).toBe(true);
  });

  it("bedrock:1_18 は true", () => {
    expect(hasBastionVersions(["bedrock:1_18"])).toBe(true);
  });

  it("java:1_8 のような 1.16 未満は false", () => {
    expect(hasBastionVersions(["java:1_8"])).toBe(false);
    expect(hasBastionVersions(["java:pre_1_8"])).toBe(false);
    expect(hasBastionVersions(["java:1_9_1_12"])).toBe(false);
    expect(hasBastionVersions(["java:1_13_1_15"])).toBe(false);
    expect(hasBastionVersions(["bedrock:pre_1_11"])).toBe(false);
    expect(hasBastionVersions(["bedrock:1_11_1_14"])).toBe(false);
  });

  it("空配列は false", () => {
    expect(hasBastionVersions([])).toBe(false);
  });
});
