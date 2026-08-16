import { describe, it, expect } from "vitest";
import {
  applyTypingTestAction,
  classifyTypingTestKey,
  INITIAL_TYPING_TEST_BUFFER_STATE,
  type TypingTestBufferState,
} from "../typing-test-buffer";

describe("applyTypingTestAction - 非選択中", () => {
  it("insert: カーソル位置に挿入しカーソルを挿入分進める", () => {
    const state = applyTypingTestAction(INITIAL_TYPING_TEST_BUFFER_STATE, { type: "insert", text: "w" });
    expect(state).toEqual({ text: "w", cursor: 1, selection: null });
    const state2 = applyTypingTestAction(state, { type: "insert", text: "d" });
    expect(state2).toEqual({ text: "wd", cursor: 2, selection: null });
  });

  it('insert: text: "" は no-op（同一 state を返す）', () => {
    const state: TypingTestBufferState = { text: "wd", cursor: 1, selection: null };
    expect(applyTypingTestAction(state, { type: "insert", text: "" })).toBe(state);
  });

  it("backspace: カーソル直前の1文字を削除しカーソルを1つ戻す", () => {
    const state: TypingTestBufferState = { text: "wd", cursor: 2, selection: null };
    expect(applyTypingTestAction(state, { type: "backspace" })).toEqual({
      text: "w",
      cursor: 1,
      selection: null,
    });
  });

  it("backspace: cursor === 0 なら no-op（同一 state を返す）", () => {
    const state: TypingTestBufferState = { text: "wd", cursor: 0, selection: null };
    expect(applyTypingTestAction(state, { type: "backspace" })).toBe(state);
  });

  it("backspace: 空バッファ（cursor 0）でも no-op", () => {
    expect(applyTypingTestAction(INITIAL_TYPING_TEST_BUFFER_STATE, { type: "backspace" })).toBe(
      INITIAL_TYPING_TEST_BUFFER_STATE,
    );
  });

  it("arrowLeft: カーソルを1つ左へ移動する", () => {
    const state: TypingTestBufferState = { text: "wd", cursor: 2, selection: null };
    expect(applyTypingTestAction(state, { type: "arrowLeft" })).toEqual({
      text: "wd",
      cursor: 1,
      selection: null,
    });
  });

  it("arrowLeft: cursor 0 では 0 未満にならない", () => {
    const state: TypingTestBufferState = { text: "wd", cursor: 0, selection: null };
    expect(applyTypingTestAction(state, { type: "arrowLeft" })).toEqual({
      text: "wd",
      cursor: 0,
      selection: null,
    });
  });

  it("home: カーソルを先頭（0）へ移動する", () => {
    const state: TypingTestBufferState = { text: "wd", cursor: 2, selection: null };
    expect(applyTypingTestAction(state, { type: "home" })).toEqual({
      text: "wd",
      cursor: 0,
      selection: null,
    });
  });

  it("selectAll: カーソル位置までを選択する（{ start: 0, end: cursor }）", () => {
    const state: TypingTestBufferState = { text: "wd", cursor: 2, selection: null };
    expect(applyTypingTestAction(state, { type: "selectAll" })).toEqual({
      text: "wd",
      cursor: 2,
      selection: { start: 0, end: 2 },
    });
  });

  it("selectAll: カーソルが中間位置なら先頭〜カーソルのみを選択する（末尾は保持）", () => {
    const state: TypingTestBufferState = { text: "world", cursor: 2, selection: null };
    expect(applyTypingTestAction(state, { type: "selectAll" })).toEqual({
      text: "world",
      cursor: 2,
      selection: { start: 0, end: 2 },
    });
  });

  it("selectAll: cursor === 0（空選択になる）なら選択を作らない", () => {
    const state: TypingTestBufferState = { text: "wd", cursor: 0, selection: null };
    expect(applyTypingTestAction(state, { type: "selectAll" })).toEqual({
      text: "wd",
      cursor: 0,
      selection: null,
    });
  });

  it("selectAll: 空バッファ（cursor 0）でも選択を作らない", () => {
    expect(applyTypingTestAction(INITIAL_TYPING_TEST_BUFFER_STATE, { type: "selectAll" })).toEqual({
      text: "",
      cursor: 0,
      selection: null,
    });
  });

  it("clear: 初期状態に戻す", () => {
    const state: TypingTestBufferState = { text: "wd", cursor: 2, selection: { start: 0, end: 2 } };
    expect(applyTypingTestAction(state, { type: "clear" })).toEqual(INITIAL_TYPING_TEST_BUFFER_STATE);
  });
});

describe("applyTypingTestAction - 選択中", () => {
  it("insert: 選択範囲を削除してから挿入する（上書き）。カーソルは start + 挿入長、選択解除", () => {
    const state: TypingTestBufferState = { text: "world", cursor: 5, selection: { start: 0, end: 5 } };
    expect(applyTypingTestAction(state, { type: "insert", text: "a" })).toEqual({
      text: "a",
      cursor: 1,
      selection: null,
    });
  });

  it("insert: 中間位置までの選択（末尾が残る）は末尾を保持したまま先頭側だけ上書きする", () => {
    const state: TypingTestBufferState = { text: "world", cursor: 2, selection: { start: 0, end: 2 } };
    expect(applyTypingTestAction(state, { type: "insert", text: "a" })).toEqual({
      text: "arld",
      cursor: 1,
      selection: null,
    });
  });

  it("backspace: 選択範囲を削除する。カーソルは start（=0）、選択解除", () => {
    const state: TypingTestBufferState = { text: "wd", cursor: 2, selection: { start: 0, end: 2 } };
    expect(applyTypingTestAction(state, { type: "backspace" })).toEqual({
      text: "",
      cursor: 0,
      selection: null,
    });
  });

  it("arrowLeft: 選択解除してカーソルを selection.start（=0）へ", () => {
    const state: TypingTestBufferState = { text: "wd", cursor: 2, selection: { start: 0, end: 2 } };
    expect(applyTypingTestAction(state, { type: "arrowLeft" })).toEqual({
      text: "wd",
      cursor: 0,
      selection: null,
    });
  });

  it("home: 選択解除してカーソル先頭へ", () => {
    const state: TypingTestBufferState = { text: "wd", cursor: 2, selection: { start: 0, end: 2 } };
    expect(applyTypingTestAction(state, { type: "home" })).toEqual({
      text: "wd",
      cursor: 0,
      selection: null,
    });
  });

  it("selectAll: 冪等（既存 selection の end を維持する）", () => {
    const state: TypingTestBufferState = { text: "world", cursor: 2, selection: { start: 0, end: 2 } };
    expect(applyTypingTestAction(state, { type: "selectAll" })).toEqual(state);
  });

  it("clear: 選択中でも初期状態に戻す", () => {
    const state: TypingTestBufferState = { text: "wd", cursor: 2, selection: { start: 0, end: 2 } };
    expect(applyTypingTestAction(state, { type: "clear" })).toEqual(INITIAL_TYPING_TEST_BUFFER_STATE);
  });
});

describe("applyTypingTestAction - 操作シーケンス", () => {
  it('"wd" と打つ → Home → "a" 挿入で "awd" になる', () => {
    let state = INITIAL_TYPING_TEST_BUFFER_STATE;
    state = applyTypingTestAction(state, { type: "insert", text: "w" });
    state = applyTypingTestAction(state, { type: "insert", text: "d" });
    expect(state.text).toBe("wd");
    state = applyTypingTestAction(state, { type: "home" });
    expect(state.cursor).toBe(0);
    state = applyTypingTestAction(state, { type: "insert", text: "a" });
    expect(state).toEqual({ text: "awd", cursor: 1, selection: null });
  });

  it("ArrowLeft 2回で挿入位置を戻してから挿入する", () => {
    let state: TypingTestBufferState = { text: "world", cursor: 5, selection: null };
    state = applyTypingTestAction(state, { type: "arrowLeft" });
    state = applyTypingTestAction(state, { type: "arrowLeft" });
    expect(state.cursor).toBe(3);
    state = applyTypingTestAction(state, { type: "insert", text: "X" });
    expect(state).toEqual({ text: "worXld", cursor: 4, selection: null });
  });

  it("Shift+Home 相当（selectAll）→ 文字入力で全上書きする", () => {
    let state: TypingTestBufferState = { text: "world", cursor: 5, selection: null };
    state = applyTypingTestAction(state, { type: "selectAll" });
    expect(state.selection).toEqual({ start: 0, end: 5 });
    state = applyTypingTestAction(state, { type: "insert", text: "a" });
    expect(state).toEqual({ text: "a", cursor: 1, selection: null });
  });

  it("Shift+Home 相当（selectAll）→ backspace で全削除する", () => {
    let state: TypingTestBufferState = { text: "world", cursor: 5, selection: null };
    state = applyTypingTestAction(state, { type: "selectAll" });
    state = applyTypingTestAction(state, { type: "backspace" });
    expect(state).toEqual({ text: "", cursor: 0, selection: null });
  });
});

describe("applyTypingTestAction - 不変条件", () => {
  it("あらゆる操作後も cursor は 0..text.length の範囲に収まる", () => {
    const actions: Array<Parameters<typeof applyTypingTestAction>[1]> = [
      { type: "insert", text: "w" },
      { type: "insert", text: "d" },
      { type: "arrowLeft" },
      { type: "arrowLeft" },
      { type: "arrowLeft" },
      { type: "home" },
      { type: "selectAll" },
      { type: "insert", text: "abc" },
      { type: "backspace" },
      { type: "backspace" },
      { type: "backspace" },
      { type: "backspace" },
      { type: "clear" },
    ];
    let state = INITIAL_TYPING_TEST_BUFFER_STATE;
    for (const action of actions) {
      state = applyTypingTestAction(state, action);
      expect(state.cursor).toBeGreaterThanOrEqual(0);
      expect(state.cursor).toBeLessThanOrEqual(state.text.length);
    }
  });
});

describe("classifyTypingTestKey", () => {
  it('outputKeyCode "Backspace" → backspace', () => {
    expect(classifyTypingTestKey({ output: null, outputKeyCode: "Backspace" }, false)).toEqual({
      type: "backspace",
    });
  });

  it('outputKeyCode "ArrowLeft" → arrowLeft', () => {
    expect(classifyTypingTestKey({ output: null, outputKeyCode: "ArrowLeft" }, false)).toEqual({
      type: "arrowLeft",
    });
  });

  it('outputKeyCode "Home" かつ shiftHeld: false → home', () => {
    expect(classifyTypingTestKey({ output: null, outputKeyCode: "Home" }, false)).toEqual({
      type: "home",
    });
  });

  it('outputKeyCode "Home" かつ shiftHeld: true → selectAll', () => {
    expect(classifyTypingTestKey({ output: null, outputKeyCode: "Home" }, true)).toEqual({
      type: "selectAll",
    });
  });

  it("制御キー以外で output が truthy → insert", () => {
    expect(classifyTypingTestKey({ output: "a", outputKeyCode: "KeyA" }, false)).toEqual({
      type: "insert",
      text: "a",
    });
  });

  it("output が null かつ制御キーでもない → null", () => {
    expect(classifyTypingTestKey({ output: null, outputKeyCode: "F3" }, false)).toBeNull();
  });

  it("非対応の制御キー（ArrowRight / End / Delete）は output があっても null 出力なら null", () => {
    expect(classifyTypingTestKey({ output: null, outputKeyCode: "ArrowRight" }, false)).toBeNull();
    expect(classifyTypingTestKey({ output: null, outputKeyCode: "End" }, false)).toBeNull();
    expect(classifyTypingTestKey({ output: null, outputKeyCode: "Delete" }, false)).toBeNull();
  });

  it("outputKeyCode の制御キー判定は output より優先する（Backspace 出力があっても backspace 扱い）", () => {
    expect(classifyTypingTestKey({ output: "x", outputKeyCode: "Backspace" }, false)).toEqual({
      type: "backspace",
    });
    expect(classifyTypingTestKey({ output: "x", outputKeyCode: "ArrowLeft" }, false)).toEqual({
      type: "arrowLeft",
    });
    expect(classifyTypingTestKey({ output: "x", outputKeyCode: "Home" }, true)).toEqual({
      type: "selectAll",
    });
  });
});
