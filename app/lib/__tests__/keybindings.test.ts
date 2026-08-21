import { describe, it, expect } from "vitest";
import { createTranslator } from "../messages";
import {
  UNBOUND_KEY,
  normalizeKeyCode,
  keysEqual,
  parseKeyCombination,
  formatKeyCombination,
  normalizeKeyCombination,
  getKeyLabel,
} from "../keybindings";

// ラベル生成は表示ロケールに依存するため、テストでは日本語で固定する
const t = createTranslator("ja");

describe("normalizeKeyCode", () => {
  it("Minecraft形式（key.keyboard.*）をPascalCaseへ変換する", () => {
    expect(normalizeKeyCode("key.keyboard.w")).toBe("KeyW");
    expect(normalizeKeyCode("key.keyboard.1")).toBe("Digit1");
    expect(normalizeKeyCode("key.keyboard.f5")).toBe("F5");
    expect(normalizeKeyCode("key.keyboard.f12")).toBe("F12");
    expect(normalizeKeyCode("key.keyboard.keypad.5")).toBe("Numpad5");
    expect(normalizeKeyCode("key.keyboard.left.control")).toBe("ControlLeft");
    expect(normalizeKeyCode("key.keyboard.space")).toBe("Space");
  });

  it("Minecraft形式（key.mouse.*）をPascalCaseへ変換する", () => {
    expect(normalizeKeyCode("key.mouse.left")).toBe("Mouse0");
    expect(normalizeKeyCode("key.mouse.right")).toBe("Mouse1");
    expect(normalizeKeyCode("key.mouse.4")).toBe("Mouse3");
  });

  it("大文字形式（KEYW 等）をPascalCaseへ変換する", () => {
    expect(normalizeKeyCode("KEYW")).toBe("KeyW");
    expect(normalizeKeyCode("DIGIT1")).toBe("Digit1");
    expect(normalizeKeyCode("NUMPAD1")).toBe("Numpad1");
    expect(normalizeKeyCode("CONTROLLEFT")).toBe("ControlLeft");
    expect(normalizeKeyCode("SHIFTRIGHT")).toBe("ShiftRight");
    expect(normalizeKeyCode("MOUSE0")).toBe("Mouse0");
    expect(normalizeKeyCode("SPACE")).toBe("Space");
  });

  it("PascalCase形式はそのまま素通しする", () => {
    expect(normalizeKeyCode("KeyW")).toBe("KeyW");
    expect(normalizeKeyCode("ControlLeft")).toBe("ControlLeft");
    expect(normalizeKeyCode("Digit1")).toBe("Digit1");
  });

  it("未知のキーコードは変換できずそのまま返す（フォールバック）", () => {
    expect(normalizeKeyCode("totally-unknown-code")).toBe("totally-unknown-code");
    expect(normalizeKeyCode("key.keyboard.unknown")).toBe("key.keyboard.unknown");
  });
});

describe("keysEqual", () => {
  it("系統違いの表記でも同一キーなら true", () => {
    expect(keysEqual("key.keyboard.w", "KeyW")).toBe(true);
    expect(keysEqual("KEYW", "KeyW")).toBe(true);
    expect(keysEqual("key.mouse.left", "MOUSE0")).toBe(true);
  });

  it("異なるキーなら false", () => {
    expect(keysEqual("KeyW", "KeyA")).toBe(false);
    expect(keysEqual("key.keyboard.w", "KeyA")).toBe(false);
  });
});

describe("parseKeyCombination / formatKeyCombination", () => {
  it("修飾キー付きの文字列を分解する", () => {
    expect(parseKeyCombination("Ctrl+Shift+KeyA")).toEqual({
      modifiers: ["Ctrl", "Shift"],
      keyCode: "KeyA",
    });
  });

  it("修飾キーなしの文字列は modifiers が空配列になる", () => {
    expect(parseKeyCombination("KeyW")).toEqual({ modifiers: [], keyCode: "KeyW" });
  });

  it("UNBOUND_KEY はそのまま構造化される", () => {
    expect(parseKeyCombination(UNBOUND_KEY)).toEqual({ modifiers: [], keyCode: UNBOUND_KEY });
  });

  it("formatKeyCombination は修飾キーを正規化順序（Ctrl > Shift > Alt > Meta）でソートする", () => {
    expect(formatKeyCombination({ modifiers: ["Shift", "Ctrl"], keyCode: "KeyA" })).toBe(
      "Ctrl+Shift+KeyA",
    );
    expect(formatKeyCombination({ modifiers: ["Meta", "Alt", "Ctrl"], keyCode: "KeyB" })).toBe(
      "Ctrl+Alt+Meta+KeyB",
    );
  });

  it("formatKeyCombination は修飾キーなしならキーコードのみ返す", () => {
    expect(formatKeyCombination({ modifiers: [], keyCode: "KeyA" })).toBe("KeyA");
  });

  it("parseKeyCombination → formatKeyCombination は往復して元の（正規化済み）文字列に戻る", () => {
    const combo = parseKeyCombination("Ctrl+Shift+KeyA");
    expect(formatKeyCombination(combo)).toBe("Ctrl+Shift+KeyA");
  });
});

describe("normalizeKeyCombination（修飾キー順序正規化）", () => {
  it("修飾キーが正規化順序と異なる並びでも Ctrl > Shift > Alt > Meta の順に並べ替える", () => {
    // parseKeyCombination の修飾キー判定は MODIFIER_ORDER（"Ctrl"/"Shift"等）との
    // 完全一致（大文字小文字区別あり）で行われるため、入力の修飾キー部分は正規のケースが前提。
    // このプロジェクトの実際の呼び出し元（formatKeyCombination の出力やUI由来の文字列）は
    // 常にこのケースで渡ってくる。
    expect(normalizeKeyCombination("Shift+Ctrl+KeyA")).toBe("Ctrl+Shift+KeyA");
    expect(normalizeKeyCombination("Meta+Alt+Ctrl+Shift+KeyZ")).toBe("Ctrl+Shift+Alt+Meta+KeyZ");
  });

  it("修飾キーなしの単一キーはキーコードの正規化のみ行う", () => {
    expect(normalizeKeyCombination("keyw")).toBe("KeyW");
  });

  it("UNBOUND_KEY はそのまま返す", () => {
    expect(normalizeKeyCombination(UNBOUND_KEY)).toBe(UNBOUND_KEY);
  });
});

describe("getKeyLabel", () => {
  it("UNBOUND_KEY は '-' を返す", () => {
    expect(getKeyLabel(t, UNBOUND_KEY)).toBe("-");
    expect(getKeyLabel(t, UNBOUND_KEY, "jis")).toBe("-");
  });

  it("JIS/US 配列で表示が異なる記号キーを解決する", () => {
    expect(getKeyLabel(t, "Semicolon", "us")).toBe(";");
    expect(getKeyLabel(t, "Semicolon", "jis")).toBe(":");
    expect(getKeyLabel(t, "Quote", "us")).toBe("'");
    expect(getKeyLabel(t, "Quote", "jis")).toBe("^");
  });

  it("配列未指定は US 配列として扱う", () => {
    expect(getKeyLabel(t, "Semicolon")).toBe(";");
    expect(getKeyLabel(t, "Semicolon", null)).toBe(";");
  });

  it("JIS 配列の半角キー（Backquote）は翻訳経由でラベル化する", () => {
    expect(getKeyLabel(t, "Backquote", "jis")).toBe("半角");
    expect(getKeyLabel(t, "Backquote", "us")).toBe("`");
  });

  it("翻訳が要るキー名（左Ctrl・左クリック等）を解決する", () => {
    expect(getKeyLabel(t, "ControlLeft")).toBe("左Ctrl");
    expect(getKeyLabel(t, "key.mouse.left")).toBe("左クリック");
  });

  it("Key プレフィックスを剥がして単一英字ラベルにする", () => {
    expect(getKeyLabel(t, "KeyW")).toBe("W");
    expect(getKeyLabel(t, "key.keyboard.w")).toBe("W");
    expect(getKeyLabel(t, "KEYW")).toBe("W");
  });

  it("Digit プレフィックスを剥がして数字ラベルにする", () => {
    expect(getKeyLabel(t, "Digit1")).toBe("1");
  });

  it("Numpad プレフィックスは 'Num' + 数字のラベルにする（個別定義のないテンキー数字キー）", () => {
    expect(getKeyLabel(t, "Numpad1")).toBe("Num1");
  });

  it("KEY_CODE_LABELS に定義済みのキーはそのラベルを返す", () => {
    expect(getKeyLabel(t, "F5")).toBe("F5");
    expect(getKeyLabel(t, "Space")).toBe("Space");
    expect(getKeyLabel(t, "NumpadEnter")).toBe("Num Enter");
  });
});
