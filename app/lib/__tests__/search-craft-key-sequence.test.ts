import { describe, it, expect } from "vitest";
import { createTranslator } from "../messages";

// ラベル生成は表示ロケールに依存するため、テストでは日本語で固定する
const t = createTranslator("ja");
import {
  buildCraftKeySequence,
  buildLoopKeySequence,
  physicalKeyForStep,
  heldKeysForStep,
  buildKeyAnnotations,
  stepDurationMs,
  ANIMATION_BASE_STEP_MS,
  type KeySequenceStep,
} from "../search-craft-key-sequence";
import { resolveLoopSteps, type LoopStepData } from "../search-craft-loops";
import type { RemapInfo } from "../remap-utils";

// resolveLoopSteps 用（検索文字列の解決）
type Craft = { searchStrs: string[]; withShifts?: boolean[] };
const makeGetCraft =
  (crafts: Record<string, Craft>) =>
  (id: string): Craft | undefined =>
    crafts[id];

// buildLoopKeySequence 用（クラフト実行マーカーのアイテム解決）
type CraftInfo = { items: string[] };
const makeGetCraftInfo =
  (crafts: Record<string, CraftInfo>) =>
  (id: string): CraftInfo | undefined =>
    crafts[id];

describe("buildCraftKeySequence", () => {
  it("リマップなし・小文字のみ: type ステップが順番に並び、heldKeys は空（グローバル/ステップ単位とも）", () => {
    const sequence = buildCraftKeySequence(t, "ab", [], false);
    expect(sequence.steps).toEqual([
      {
        kind: "type",
        order: 1,
        info: { char: "a", keyCode: "KeyA", isRemapped: false, needsShift: false, displayLabel: "A" },
        heldKeys: [],
      },
      {
        kind: "type",
        order: 2,
        info: { char: "b", keyCode: "KeyB", isRemapped: false, needsShift: false, displayLabel: "B" },
        heldKeys: [],
      },
    ]);
    expect(sequence.heldKeys).toEqual([]);
  });

  it("withShift: true は個々のキーには ⇧ を付けず、グローバル heldKeys とステップ単位の heldKeys の両方に ShiftLeft を積む（非シフト時と同じキーに解決される）", () => {
    const withShift = buildCraftKeySequence(t, "ab", [], true);
    expect(withShift.steps).toEqual([
      {
        kind: "type",
        order: 1,
        info: { char: "a", keyCode: "KeyA", isRemapped: false, needsShift: false, displayLabel: "A" },
        heldKeys: ["ShiftLeft"],
      },
      {
        kind: "type",
        order: 2,
        info: { char: "b", keyCode: "KeyB", isRemapped: false, needsShift: false, displayLabel: "B" },
        heldKeys: ["ShiftLeft"],
      },
    ]);
    expect(withShift.heldKeys).toEqual(["ShiftLeft"]);
    expect(withShift.steps.map((s) => heldKeysForStep(s))).toEqual([["ShiftLeft"], ["ShiftLeft"]]);
  });

  it("withShift: true でも検索文字列が空なら steps 0件・heldKeys も空", () => {
    const sequence = buildCraftKeySequence(t, "", [], true);
    expect(sequence.steps).toEqual([]);
    expect(sequence.heldKeys).toEqual([]);
  });

  it("大文字混じり（withShift なし）は keyCode が Shift+KeyX になり、physicalKeyForStep はベースキーを返す。needsShift 由来でステップ単位の heldKeys にも ShiftLeft が入る（グローバル heldKeys は withShift 専用のため空のまま）", () => {
    const sequence = buildCraftKeySequence(t, "A", [], false);
    expect(sequence.steps).toEqual([
      {
        kind: "type",
        order: 1,
        info: { char: "a", keyCode: "Shift+KeyA", isRemapped: false, needsShift: true, displayLabel: "⇧+A" },
        heldKeys: ["ShiftLeft"],
      },
    ]);
    expect(physicalKeyForStep(sequence.steps[0])).toBe("KeyA");
    expect(sequence.heldKeys).toEqual([]);
  });

  it("リマップあり（KeyX → KeyT で t を打つ）: isRemapped が true になり、physicalKeyForStep はソースキーを返す", () => {
    const remaps: RemapInfo[] = [{ sourceKey: "KeyX", targetKey: "KeyT" }];
    const sequence = buildCraftKeySequence(t, "t", remaps, false);
    expect(sequence.steps).toHaveLength(1);
    const [step] = sequence.steps;
    if (step.kind !== "type") throw new Error("expected type step");
    expect(step.info.keyCode).toBe("KeyX");
    expect(step.info.isRemapped).toBe(true);
    expect(physicalKeyForStep(step)).toBe("KeyX");
  });
});

describe("buildLoopKeySequence", () => {
  it("2ステップ（selectAll遷移）: 先頭の打鍵→クラフトマーカー→selectAll→次の打鍵→クラフトマーカーの順で order が通し番号になる", () => {
    const resolved = resolveLoopSteps(
      [
        { craftId: "a", transition: null },
        { craftId: "b", transition: { type: "selectAll" } },
      ] satisfies LoopStepData[],
      makeGetCraft({ a: { searchStrs: ["te"], withShifts: [true] }, b: { searchStrs: ["tor"] } }),
    ).steps;
    const getCraft = makeGetCraftInfo({ a: { items: ["stick"] }, b: { items: ["torch"] } });
    const sequence = buildLoopKeySequence(t, resolved, getCraft, []);

    expect(sequence.steps.map((s) => s.kind)).toEqual([
      "type",
      "type",
      "craft",
      "selectAll",
      "type",
      "type",
      "type",
      "craft",
    ]);
    expect(sequence.steps.map((s) => s.order)).toEqual([1, 2, null, 3, 4, 5, 6, null]);
    expect(sequence.steps[2]).toEqual({
      kind: "craft",
      order: null,
      craft: { items: ["stick"], searchStr: "te" },
    });
    expect(sequence.steps[7]).toEqual({
      kind: "craft",
      order: null,
      craft: { items: ["torch"], searchStr: "tor" },
    });

    const selectAllStep = sequence.steps[3];
    if (selectAllStep.kind !== "selectAll") throw new Error("expected selectAll step");
    expect(selectAllStep.info.keyCode).toBe("ShiftLeft+Home");
    expect(selectAllStep.info.displayLabel).toBe("⇧+Home");
    // ⇧Home の Shift 成分（keyCode のプレフィックス）がそのままステップ単位の heldKeys になる
    expect(selectAllStep.heldKeys).toEqual(["ShiftLeft"]);

    // withShift（先頭ステップ）由来と ⇧Home の Shift 成分由来が Set で重複しない
    expect(sequence.heldKeys).toEqual(["ShiftLeft"]);

    // ステップ単位の heldKeys: 先頭2ステップ（craft "a" の withShift: true）は ShiftLeft を保持、
    // 末尾3ステップ（craft "b" は withShifts 未指定＝ withShift: false）は空
    expect(sequence.steps.map((s) => heldKeysForStep(s))).toEqual([
      ["ShiftLeft"],
      ["ShiftLeft"],
      [], // craft マーカー
      ["ShiftLeft"], // selectAll
      [],
      [],
      [],
      [], // craft マーカー
    ]);
  });

  it("backspace 遷移（bsCount 2以上）は1ステップで count を保持し、n個には展開しない", () => {
    const resolved = resolveLoopSteps(
      [
        { craftId: "a", transition: null },
        { craftId: "b", transition: { type: "backspace", bsCount: 2 } },
      ] satisfies LoopStepData[],
      makeGetCraft({ a: { searchStrs: ["er"] }, b: { searchStrs: ["en"] } }),
    ).steps;
    const getCraft = makeGetCraftInfo({ a: { items: ["ender_pearl"] }, b: { items: ["enchanting_table"] } });
    const sequence = buildLoopKeySequence(t, resolved, getCraft, []);

    expect(sequence.steps.map((s) => s.kind)).toEqual([
      "type",
      "type",
      "craft",
      "backspace",
      "type",
      "type",
      "craft",
    ]);
    const bsStep = sequence.steps[3];
    if (bsStep.kind !== "backspace") throw new Error("expected backspace step");
    expect(bsStep.order).toBe(3);
    expect(bsStep.count).toBe(2);
    expect(bsStep.info.keyCode).toBe("Backspace");
    // backspace は修飾キーを伴わない単発操作のため heldKeys は常に空
    expect(bsStep.heldKeys).toEqual([]);
  });

  it("無効な遷移（参照切れの craftId）はそのステップの打鍵を生成せず、クラフトマーカーのみ挿入する", () => {
    const resolved = resolveLoopSteps(
      [
        { craftId: "a", transition: null },
        { craftId: "missing", transition: { type: "backspace", bsCount: 1 } },
      ] satisfies LoopStepData[],
      makeGetCraft({ a: { searchStrs: ["er"] } }),
    ).steps;
    expect(resolved[1].derived).toEqual({ valid: false, reason: "missing_search_str" });

    const getCraft = makeGetCraftInfo({ a: { items: ["ender_pearl"] } });
    const sequence = buildLoopKeySequence(t, resolved, getCraft, []);

    expect(sequence.steps.map((s) => s.kind)).toEqual(["type", "type", "craft", "craft"]);
    expect(sequence.steps[3]).toEqual({
      kind: "craft",
      order: null,
      craft: { items: [], searchStr: null },
    });
  });

  it("遷移は解決できても buildLoopKeySequence 側の getCraft が undefined を返す craftId は items: [] になる", () => {
    const resolved = resolveLoopSteps(
      [
        { craftId: "a", transition: null },
        { craftId: "b", transition: { type: "selectAll" } },
      ] satisfies LoopStepData[],
      makeGetCraft({ a: { searchStrs: ["ab"] }, b: { searchStrs: ["abc"] } }),
    ).steps;
    // "b" は items 側のマップに存在しない
    const getCraft = makeGetCraftInfo({ a: { items: ["stick"] } });
    const sequence = buildLoopKeySequence(t, resolved, getCraft, []);

    const craftSteps = sequence.steps.filter((s): s is Extract<KeySequenceStep, { kind: "craft" }> => s.kind === "craft");
    expect(craftSteps).toHaveLength(2);
    expect(craftSteps[1]).toEqual({
      kind: "craft",
      order: null,
      craft: { items: [], searchStr: "abc" },
    });
  });
});

describe("physicalKeyForStep", () => {
  it("craft マーカー（order: null）は対象キーを持たないため null を返す", () => {
    const craftStep: KeySequenceStep = {
      kind: "craft",
      order: null,
      craft: { items: [], searchStr: null },
    };
    expect(physicalKeyForStep(craftStep)).toBeNull();
  });

  it("修飾キーなしの keyCode はそのまま返す", () => {
    const sequence = buildCraftKeySequence(t, "a", [], false);
    expect(physicalKeyForStep(sequence.steps[0])).toBe("KeyA");
  });

  it("修飾キー込みの keyCode（Shift+KeyA）はベースキー（最後のセグメント）のみを返す", () => {
    const sequence = buildCraftKeySequence(t, "A", [], false);
    expect(physicalKeyForStep(sequence.steps[0])).toBe("KeyA");
  });
});

describe("heldKeysForStep", () => {
  it("craft マーカーはキーボード上で何も押していない扱いのため常に空配列", () => {
    const craftStep: KeySequenceStep = {
      kind: "craft",
      order: null,
      craft: { items: [], searchStr: null },
    };
    expect(heldKeysForStep(craftStep)).toEqual([]);
  });

  it("非 craft ステップはステップ自身の heldKeys をそのまま返す", () => {
    const sequence = buildCraftKeySequence(t, "ab", [], true);
    expect(heldKeysForStep(sequence.steps[0])).toEqual(["ShiftLeft"]);
    expect(heldKeysForStep(sequence.steps[1])).toEqual(["ShiftLeft"]);
  });
});

describe("stepDurationMs", () => {
  const typeStep: KeySequenceStep = buildCraftKeySequence(t, "a", [], false).steps[0];
  const craftStep: KeySequenceStep = { kind: "craft", order: null, craft: { items: [], searchStr: null } };

  it("速度1×では type ステップは基本間隔のまま", () => {
    expect(stepDurationMs(typeStep, 1)).toBe(ANIMATION_BASE_STEP_MS);
  });

  it("craft ステップは基本間隔の2倍（クラフト実行の区切りを長く見せる）", () => {
    expect(stepDurationMs(craftStep, 1)).toBe(ANIMATION_BASE_STEP_MS * 2);
  });

  it("速度2×では待機時間が半分になる（type・craft とも比率は維持）", () => {
    expect(stepDurationMs(typeStep, 2)).toBe(ANIMATION_BASE_STEP_MS / 2);
    expect(stepDurationMs(craftStep, 2)).toBe(ANIMATION_BASE_STEP_MS);
  });

  it("速度0.5×では待機時間が2倍になる", () => {
    expect(stepDurationMs(typeStep, 0.5)).toBe(ANIMATION_BASE_STEP_MS * 2);
  });
});

describe("buildKeyAnnotations", () => {
  it("同じキーを複数回押す場合はカンマ区切りの通し番号になる", () => {
    const sequence = buildCraftKeySequence(t, "aba", [], false);
    expect(buildKeyAnnotations(sequence)).toEqual({ KeyA: "1,3", KeyB: "2" });
  });

  it("heldKeys に含まれるキーには注釈を振らない（withShift 由来の ShiftLeft）", () => {
    const remaps: RemapInfo[] = [{ sourceKey: "ShiftLeft", targetKey: "KeyE" }];
    const sequence = buildCraftKeySequence(t, "e", remaps, true);
    expect(sequence.heldKeys).toEqual(["ShiftLeft"]);
    expect(physicalKeyForStep(sequence.steps[0])).toBe("ShiftLeft");
    expect(buildKeyAnnotations(sequence)).toEqual({});
  });

  it("craft マーカー（order: null）は注釈の対象外", () => {
    const resolved = resolveLoopSteps(
      [
        { craftId: "a", transition: null },
        { craftId: "b", transition: { type: "selectAll" } },
      ] satisfies LoopStepData[],
      makeGetCraft({ a: { searchStrs: ["te"] }, b: { searchStrs: ["tor"] } }),
    ).steps;
    const getCraft = makeGetCraftInfo({ a: { items: ["stick"] }, b: { items: ["torch"] } });
    const sequence = buildLoopKeySequence(t, resolved, getCraft, []);

    // craft マーカーの order は null のため通し番号 1〜6 のみが振られ、マーカー分の欠番は生じない
    expect(buildKeyAnnotations(sequence)).toEqual({
      KeyT: "1,4",
      KeyE: "2",
      Home: "3",
      KeyO: "5",
      KeyR: "6",
    });
  });
});
