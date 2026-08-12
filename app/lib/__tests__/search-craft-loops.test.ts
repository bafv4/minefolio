import { describe, it, expect } from "vitest";
import {
  commonPrefixLength,
  minBackspaceCount,
  minArrowLeftCount,
  deriveTransition,
  resolveLoopSteps,
  parseLoopSteps,
  isValidLoopTransitionValue,
  isValidLoopStepsShape,
  remapLoopSteps,
  type LoopStepData,
} from "../search-craft-loops";

describe("commonPrefixLength", () => {
  it("共通接頭辞がない場合は 0", () => {
    expect(commonPrefixLength("abc", "xyz")).toBe(0);
  });

  it("完全一致は文字列長そのもの", () => {
    expect(commonPrefixLength("abc", "abc")).toBe(3);
  });

  it("片方がもう片方の接頭辞の場合はその長さ", () => {
    expect(commonPrefixLength("ab", "abc")).toBe(2);
    expect(commonPrefixLength("abc", "ab")).toBe(2);
  });

  it("空文字列を含む場合は 0", () => {
    expect(commonPrefixLength("", "abc")).toBe(0);
    expect(commonPrefixLength("abc", "")).toBe(0);
    expect(commonPrefixLength("", "")).toBe(0);
  });

  it("先頭スペースは有意な文字として扱う（trim しない）", () => {
    expect(commonPrefixLength(" er", "er")).toBe(0);
    expect(commonPrefixLength(" er", " en")).toBe(2);
  });

  it("マルチバイト文字列（日本語）でも1文字単位で正しく比較する", () => {
    expect(commonPrefixLength("げんこつ", "げんき")).toBe(2);
    expect(commonPrefixLength("寿司", "寿司")).toBe(2);
  });
});

describe("minBackspaceCount", () => {
  it('"er" → "en" は 1（共通接頭辞 "e"）', () => {
    expect(minBackspaceCount("er", "en")).toBe(1);
  });

  it("共通接頭辞がない場合は prev.length 全体を消す必要がある", () => {
    expect(minBackspaceCount("abc", "xyz")).toBe(3);
  });
});

describe("minArrowLeftCount", () => {
  it('"ener" → "enxer" は 2（k=1 は残存接頭辞不一致）', () => {
    expect(minArrowLeftCount("ener", "enxer")).toBe(2);
  });

  it('"aa" → "aaa" は 1（k=1, k=2 双方妥当だが最初に見つかる k=1 を返す）', () => {
    expect(minArrowLeftCount("aa", "aaa")).toBe(1);
  });

  it("挿入として成立しない場合は null", () => {
    expect(minArrowLeftCount("ab", "ba")).toBeNull();
    expect(minArrowLeftCount("er", "er")).toBeNull();
    expect(minArrowLeftCount("er", "e")).toBeNull();
  });

  it("prev が空文字列なら null（k >= 1 を満たす k が存在しない）", () => {
    expect(minArrowLeftCount("", "abc")).toBeNull();
  });
});

describe("deriveTransition - backspace", () => {
  it("k = 最小BS回数（minBs）で妥当", () => {
    expect(deriveTransition("er", "en", { type: "backspace", bsCount: 1 })).toEqual({
      valid: true,
      ops: [
        { kind: "backspace", count: 1 },
        { kind: "type", text: "n" },
      ],
      typed: "n",
      minBs: 1,
      maxBs: 2,
    });
  });

  it("k = prev.length で妥当（typed は next 全体）", () => {
    expect(deriveTransition("er", "en", { type: "backspace", bsCount: 2 })).toEqual({
      valid: true,
      ops: [
        { kind: "backspace", count: 2 },
        { kind: "type", text: "en" },
      ],
      typed: "en",
      minBs: 1,
      maxBs: 2,
    });
  });

  it("中間の k でも残存接頭辞が一致すれば妥当", () => {
    expect(deriveTransition("abcd", "abxy", { type: "backspace", bsCount: 3 })).toEqual({
      valid: true,
      ops: [
        { kind: "backspace", count: 3 },
        { kind: "type", text: "bxy" },
      ],
      typed: "bxy",
      minBs: 2,
      maxBs: 4,
    });
  });

  it("k が最小BS回数未満で残存接頭辞が一致しない場合は prefix_mismatch", () => {
    expect(deriveTransition("er", "en", { type: "backspace", bsCount: 0 })).toEqual({
      valid: false,
      reason: "prefix_mismatch",
    });
    expect(deriveTransition("abcd", "abxy", { type: "backspace", bsCount: 1 })).toEqual({
      valid: false,
      reason: "prefix_mismatch",
    });
  });

  it("負数・非整数・prev.length超過は bs_out_of_range", () => {
    expect(deriveTransition("er", "en", { type: "backspace", bsCount: -1 })).toEqual({
      valid: false,
      reason: "bs_out_of_range",
    });
    expect(deriveTransition("er", "en", { type: "backspace", bsCount: 1.5 })).toEqual({
      valid: false,
      reason: "bs_out_of_range",
    });
    expect(deriveTransition("er", "en", { type: "backspace", bsCount: 3 })).toEqual({
      valid: false,
      reason: "bs_out_of_range",
    });
  });

  it("prev が空文字列・k=0 でも妥当（typed は next 全体）", () => {
    expect(deriveTransition("", "abc", { type: "backspace", bsCount: 0 })).toEqual({
      valid: true,
      ops: [{ kind: "type", text: "abc" }],
      typed: "abc",
      minBs: 0,
      maxBs: 0,
    });
  });

  it("k=0 かつ prev===next のときは ops が空配列になる", () => {
    expect(deriveTransition("abc", "abc", { type: "backspace", bsCount: 0 })).toEqual({
      valid: true,
      ops: [],
      typed: "",
      minBs: 0,
      maxBs: 3,
    });
  });
});

describe("deriveTransition - arrowLeft", () => {
  it('"ener" → "enxer" は k=2 で妥当（先頭2文字を残しカーソル位置に "x" を挿入）', () => {
    expect(deriveTransition("ener", "enxer", { type: "arrowLeft", arrowCount: 2 })).toEqual({
      valid: true,
      ops: [
        { kind: "arrowLeft", count: 2 },
        { kind: "type", text: "x" },
      ],
      typed: "x",
      minBs: 2,
      maxBs: 4,
    });
  });

  it("同じ組で k=1 は残存接頭辞が一致せず not_insertion", () => {
    expect(deriveTransition("ener", "enxer", { type: "arrowLeft", arrowCount: 1 })).toEqual({
      valid: false,
      reason: "not_insertion",
    });
  });

  it("k=0 は arrow_out_of_range（0 は backspace(0) と等価のため範囲外）", () => {
    expect(deriveTransition("ener", "enxer", { type: "arrowLeft", arrowCount: 0 })).toEqual({
      valid: false,
      reason: "arrow_out_of_range",
    });
  });

  it("k が prev.length を超える場合は arrow_out_of_range", () => {
    expect(deriveTransition("ener", "enxer", { type: "arrowLeft", arrowCount: 5 })).toEqual({
      valid: false,
      reason: "arrow_out_of_range",
    });
  });

  it("prev が空文字列なら arrow_out_of_range（k >= 1 > prev.length = 0）", () => {
    expect(deriveTransition("", "abc", { type: "arrowLeft", arrowCount: 1 })).toEqual({
      valid: false,
      reason: "arrow_out_of_range",
    });
  });

  it("非整数・負数は arrow_out_of_range", () => {
    expect(deriveTransition("ener", "enxer", { type: "arrowLeft", arrowCount: 1.5 })).toEqual({
      valid: false,
      reason: "arrow_out_of_range",
    });
    expect(deriveTransition("ener", "enxer", { type: "arrowLeft", arrowCount: -1 })).toEqual({
      valid: false,
      reason: "arrow_out_of_range",
    });
  });

  it("k = prev.length（Home相当。先頭に挿入）でも妥当", () => {
    expect(deriveTransition("er", "xer", { type: "arrowLeft", arrowCount: 2 })).toEqual({
      valid: true,
      ops: [
        { kind: "arrowLeft", count: 2 },
        { kind: "type", text: "x" },
      ],
      typed: "x",
      minBs: 2,
      maxBs: 2,
    });
  });

  it("next が prev より長くない場合は not_insertion", () => {
    expect(deriveTransition("er", "er", { type: "arrowLeft", arrowCount: 1 })).toEqual({
      valid: false,
      reason: "not_insertion",
    });
    expect(deriveTransition("er", "e", { type: "arrowLeft", arrowCount: 1 })).toEqual({
      valid: false,
      reason: "not_insertion",
    });
  });

  it('周期的な文字列は複数の k が妥当になりうる（"aa" → "aaa"）', () => {
    expect(deriveTransition("aa", "aaa", { type: "arrowLeft", arrowCount: 1 })).toEqual({
      valid: true,
      ops: [
        { kind: "arrowLeft", count: 1 },
        { kind: "type", text: "a" },
      ],
      typed: "a",
      minBs: 0,
      maxBs: 2,
    });
    expect(deriveTransition("aa", "aaa", { type: "arrowLeft", arrowCount: 2 })).toEqual({
      valid: true,
      ops: [
        { kind: "arrowLeft", count: 2 },
        { kind: "type", text: "a" },
      ],
      typed: "a",
      minBs: 0,
      maxBs: 2,
    });
  });

  it("末尾スペース付きの prev でも残存接尾辞にスペースを含めて判定する", () => {
    expect(deriveTransition("er ", "erx ", { type: "arrowLeft", arrowCount: 1 })).toEqual({
      valid: true,
      ops: [
        { kind: "arrowLeft", count: 1 },
        { kind: "type", text: "x" },
      ],
      typed: "x",
      minBs: 1,
      maxBs: 3,
    });
  });

  it("typed にスペースが含まれる場合もそのまま保持する", () => {
    expect(deriveTransition("ab", "a b", { type: "arrowLeft", arrowCount: 1 })).toEqual({
      valid: true,
      ops: [
        { kind: "arrowLeft", count: 1 },
        { kind: "type", text: " " },
      ],
      typed: " ",
      minBs: 1,
      maxBs: 2,
    });
  });
});

describe("deriveTransition - selectAll", () => {
  it("常に妥当で、typed は next のスペースも含め原文どおり保持する", () => {
    expect(deriveTransition("abc", " en ", { type: "selectAll" })).toEqual({
      valid: true,
      ops: [
        { kind: "selectAll" },
        { kind: "type", text: " en " },
      ],
      typed: " en ",
      minBs: 3,
      maxBs: 3,
    });
  });
});

describe("deriveTransition - home", () => {
  it("next が prev で終わり、より長ければ妥当（先頭に打ち足す）", () => {
    expect(deriveTransition("er", "over", { type: "home" })).toEqual({
      valid: true,
      ops: [
        { kind: "home" },
        { kind: "type", text: "ov" },
      ],
      typed: "ov",
      minBs: 2,
      maxBs: 2,
    });
  });

  it("next === prev（打ち足しがない）は not_extension", () => {
    expect(deriveTransition("er", "er", { type: "home" })).toEqual({
      valid: false,
      reason: "not_extension",
    });
  });

  it("next が prev の接尾辞になっていない場合は not_extension", () => {
    expect(deriveTransition("er", "err", { type: "home" })).toEqual({
      valid: false,
      reason: "not_extension",
    });
  });

  it("末尾スペース付きの prev でもスペースを含めて接尾辞判定する", () => {
    expect(deriveTransition("er ", "over ", { type: "home" })).toEqual({
      valid: true,
      ops: [
        { kind: "home" },
        { kind: "type", text: "ov" },
      ],
      typed: "ov",
      minBs: 3,
      maxBs: 3,
    });
  });
});

describe("resolveLoopSteps", () => {
  type Craft = { searchStr: string | null };
  const makeGetCraft =
    (crafts: Record<string, Craft>) =>
    (id: string): Craft | undefined =>
      crafts[id];

  it("3ステップの正常系: 全ステップが解決し valid=true", () => {
    const getCraft = makeGetCraft({
      c1: { searchStr: "er" },
      c2: { searchStr: "en" },
      c3: { searchStr: "anything" },
    });
    const steps: LoopStepData[] = [
      { craftId: "c1", transition: null },
      { craftId: "c2", transition: { type: "backspace", bsCount: 1 } },
      { craftId: "c3", transition: { type: "selectAll" } },
    ];
    const result = resolveLoopSteps(steps, getCraft);
    expect(result.valid).toBe(true);
    expect(result.steps).toHaveLength(3);
    expect(result.steps[0].derived).toBeNull();
    expect(result.steps[1].derived).toEqual({
      valid: true,
      ops: [
        { kind: "backspace", count: 1 },
        { kind: "type", text: "n" },
      ],
      typed: "n",
      minBs: 1,
      maxBs: 2,
    });
    expect(result.steps[2].derived?.valid).toBe(true);
  });

  it("参照切れ（craftId が見つからない）は craft:null になり Loop 全体が invalid", () => {
    const getCraft = makeGetCraft({ c1: { searchStr: "er" } });
    const steps: LoopStepData[] = [
      { craftId: "c1", transition: null },
      { craftId: "missing", transition: { type: "backspace", bsCount: 1 } },
    ];
    const result = resolveLoopSteps(steps, getCraft);
    expect(result.valid).toBe(false);
    expect(result.steps[1].craft).toBeNull();
    expect(result.steps[1].derived).toEqual({ valid: false, reason: "missing_search_str" });
  });

  it("craft は解決できても searchStr が null の場合も missing_search_str", () => {
    const getCraft = makeGetCraft({
      c1: { searchStr: "er" },
      c2: { searchStr: null },
    });
    const steps: LoopStepData[] = [
      { craftId: "c1", transition: null },
      { craftId: "c2", transition: { type: "backspace", bsCount: 0 } },
    ];
    const result = resolveLoopSteps(steps, getCraft);
    expect(result.valid).toBe(false);
    expect(result.steps[1].craft).toEqual({ searchStr: null });
    expect(result.steps[1].derived).toEqual({ valid: false, reason: "missing_search_str" });
  });

  it("非先頭ステップの transition が null（破損データ）は derived を計算せず invalid化する", () => {
    const getCraft = makeGetCraft({
      c1: { searchStr: "er" },
      c2: { searchStr: "en" },
    });
    const steps: LoopStepData[] = [
      { craftId: "c1", transition: null },
      { craftId: "c2", transition: null },
    ];
    const result = resolveLoopSteps(steps, getCraft);
    expect(result.valid).toBe(false);
    expect(result.steps[1].derived).toBeNull();
  });

  it("同一 craft の複数回参照は許可される", () => {
    const getCraft = makeGetCraft({
      c1: { searchStr: "er" },
      c2: { searchStr: "en" },
    });
    const steps: LoopStepData[] = [
      { craftId: "c1", transition: null },
      { craftId: "c2", transition: { type: "backspace", bsCount: 1 } },
      { craftId: "c1", transition: { type: "backspace", bsCount: 1 } },
    ];
    const result = resolveLoopSteps(steps, getCraft);
    expect(result.valid).toBe(true);
    expect(result.steps.map((s) => s.craftId)).toEqual(["c1", "c2", "c1"]);
  });

  it("ステップ数が2未満は invalid", () => {
    const getCraft = makeGetCraft({ c1: { searchStr: "er" } });
    expect(resolveLoopSteps([], getCraft).valid).toBe(false);
    expect(resolveLoopSteps([{ craftId: "c1", transition: null }], getCraft).valid).toBe(false);
  });
});

describe("remapLoopSteps", () => {
  it("全ステップをリマップする", () => {
    const steps: LoopStepData[] = [
      { craftId: "a", transition: null },
      { craftId: "b", transition: { type: "backspace", bsCount: 1 } },
    ];
    const idMap = new Map([
      ["a", "A"],
      ["b", "B"],
    ]);
    expect(remapLoopSteps(steps, idMap)).toEqual([
      { craftId: "A", transition: null },
      { craftId: "B", transition: { type: "backspace", bsCount: 1 } },
    ]);
  });

  it("マップに存在しないステップは除去し、先頭が入れ替わったら transition を null にリセットする", () => {
    const steps: LoopStepData[] = [
      { craftId: "a", transition: null },
      { craftId: "b", transition: { type: "backspace", bsCount: 1 } },
      { craftId: "c", transition: { type: "selectAll" } },
    ];
    // "a" は削除済みエントリを想定（idMap に存在しない）
    const idMap = new Map([
      ["b", "B"],
      ["c", "C"],
    ]);
    expect(remapLoopSteps(steps, idMap)).toEqual([
      { craftId: "B", transition: null },
      { craftId: "C", transition: { type: "selectAll" } },
    ]);
  });

  it("残りが2件未満になったら Loop ごと null を返す", () => {
    const steps: LoopStepData[] = [
      { craftId: "a", transition: null },
      { craftId: "b", transition: { type: "backspace", bsCount: 1 } },
    ];
    expect(remapLoopSteps(steps, new Map([["a", "A"]]))).toBeNull();
    expect(remapLoopSteps(steps, new Map())).toBeNull();
  });

  it("arrowLeft transition を含むステップも素通しでリマップする", () => {
    const steps: LoopStepData[] = [
      { craftId: "a", transition: null },
      { craftId: "b", transition: { type: "arrowLeft", arrowCount: 2 } },
    ];
    const idMap = new Map([
      ["a", "A"],
      ["b", "B"],
    ]);
    expect(remapLoopSteps(steps, idMap)).toEqual([
      { craftId: "A", transition: null },
      { craftId: "B", transition: { type: "arrowLeft", arrowCount: 2 } },
    ]);
  });
});

describe("parseLoopSteps", () => {
  it("破損JSON・null は空配列", () => {
    expect(parseLoopSteps(null)).toEqual([]);
    expect(parseLoopSteps("not json")).toEqual([]);
    expect(parseLoopSteps('{"a":1}')).toEqual([]);
  });

  it("不正な要素だけを取り除いて残りを返す", () => {
    const json = JSON.stringify([
      { craftId: "a", transition: null },
      { craftId: "", transition: { type: "selectAll" } }, // craftId 空文字 → 除去
      { transition: { type: "selectAll" } }, // craftId なし → 除去
      { craftId: "b", transition: { type: "backspace", bsCount: -1 } }, // bsCount 不正 → 除去
      { craftId: "c", transition: { type: "backspace", bsCount: 1 } },
    ]);
    expect(parseLoopSteps(json)).toEqual([
      { craftId: "a", transition: null },
      { craftId: "c", transition: { type: "backspace", bsCount: 1 } },
    ]);
  });

  it("先頭ステップの transition が null でない場合は配列ごと空にする", () => {
    const json = JSON.stringify([
      { craftId: "a", transition: { type: "selectAll" } },
      { craftId: "b", transition: { type: "backspace", bsCount: 1 } },
    ]);
    expect(parseLoopSteps(json)).toEqual([]);
  });

  it("先頭以外に transition:null が混ざる場合は配列ごと空にする", () => {
    const json = JSON.stringify([
      { craftId: "a", transition: null },
      { craftId: "b", transition: null },
    ]);
    expect(parseLoopSteps(json)).toEqual([]);
  });

  it("arrowLeft transition を含む要素は素通しで保持し、arrowCount 不正な要素だけ除去する", () => {
    const json = JSON.stringify([
      { craftId: "a", transition: null },
      { craftId: "b", transition: { type: "arrowLeft", arrowCount: 2 } },
      { craftId: "c", transition: { type: "arrowLeft", arrowCount: -1 } }, // arrowCount 不正 → 除去
    ]);
    expect(parseLoopSteps(json)).toEqual([
      { craftId: "a", transition: null },
      { craftId: "b", transition: { type: "arrowLeft", arrowCount: 2 } },
    ]);
  });
});

describe("isValidLoopTransitionValue", () => {
  it("arrowLeft は arrowCount が非負整数であれば妥当", () => {
    expect(isValidLoopTransitionValue({ type: "arrowLeft", arrowCount: 2 })).toBe(true);
    expect(isValidLoopTransitionValue({ type: "arrowLeft", arrowCount: 0 })).toBe(true);
  });

  it("arrowLeft は arrowCount が負・非整数・欠落なら不正", () => {
    expect(isValidLoopTransitionValue({ type: "arrowLeft", arrowCount: -1 })).toBe(false);
    expect(isValidLoopTransitionValue({ type: "arrowLeft", arrowCount: 1.5 })).toBe(false);
    expect(isValidLoopTransitionValue({ type: "arrowLeft" })).toBe(false);
    expect(isValidLoopTransitionValue({ type: "arrowLeft", arrowCount: "2" })).toBe(false);
  });
});

describe("isValidLoopStepsShape", () => {
  it("妥当な形状は true", () => {
    expect(
      isValidLoopStepsShape([
        { craftId: "a", transition: null },
        { craftId: "b", transition: { type: "backspace", bsCount: 0 } },
      ]),
    ).toBe(true);
  });

  it("配列でない・2件未満は false", () => {
    expect(isValidLoopStepsShape(null)).toBe(false);
    expect(isValidLoopStepsShape("not array")).toBe(false);
    expect(isValidLoopStepsShape([{ craftId: "a", transition: null }])).toBe(false);
    expect(isValidLoopStepsShape([])).toBe(false);
  });

  it("先頭ステップの transition が null でない場合は false", () => {
    expect(
      isValidLoopStepsShape([
        { craftId: "a", transition: { type: "selectAll" } },
        { craftId: "b", transition: null },
      ]),
    ).toBe(false);
  });

  it("先頭以外の transition が null の場合は false", () => {
    expect(
      isValidLoopStepsShape([
        { craftId: "a", transition: null },
        { craftId: "b", transition: null },
      ]),
    ).toBe(false);
  });

  it("craftId が非文字列・空文字列の場合は false", () => {
    expect(
      isValidLoopStepsShape([
        { craftId: "", transition: null },
        { craftId: "b", transition: { type: "selectAll" } },
      ]),
    ).toBe(false);
    expect(
      isValidLoopStepsShape([
        { craftId: 1, transition: null },
        { craftId: "b", transition: { type: "selectAll" } },
      ]),
    ).toBe(false);
  });

  it("bsCount が負・非整数の場合は false", () => {
    expect(
      isValidLoopStepsShape([
        { craftId: "a", transition: null },
        { craftId: "b", transition: { type: "backspace", bsCount: -1 } },
      ]),
    ).toBe(false);
    expect(
      isValidLoopStepsShape([
        { craftId: "a", transition: null },
        { craftId: "b", transition: { type: "backspace", bsCount: 1.5 } },
      ]),
    ).toBe(false);
  });

  it("arrowLeft は arrowCount が非負整数なら true", () => {
    expect(
      isValidLoopStepsShape([
        { craftId: "a", transition: null },
        { craftId: "b", transition: { type: "arrowLeft", arrowCount: 2 } },
      ]),
    ).toBe(true);
  });

  it("arrowLeft は arrowCount が負・非整数・欠落の場合は false", () => {
    expect(
      isValidLoopStepsShape([
        { craftId: "a", transition: null },
        { craftId: "b", transition: { type: "arrowLeft", arrowCount: -1 } },
      ]),
    ).toBe(false);
    expect(
      isValidLoopStepsShape([
        { craftId: "a", transition: null },
        { craftId: "b", transition: { type: "arrowLeft", arrowCount: 1.5 } },
      ]),
    ).toBe(false);
    expect(
      isValidLoopStepsShape([
        { craftId: "a", transition: null },
        { craftId: "b", transition: { type: "arrowLeft" } },
      ]),
    ).toBe(false);
  });
});
