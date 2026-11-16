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
  isJisLayout,
  isTklLayout,
  getKeyCodeAliases,
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

  it("JIS/US 配列で表示が異なる記号キーを解決する（JIS は仮想キーボードの刻印と同じ）", () => {
    expect(getKeyLabel(t, "Semicolon", "us")).toBe(";");
    expect(getKeyLabel(t, "Semicolon", "jis")).toBe(";");
    expect(getKeyLabel(t, "Quote", "us")).toBe("'");
    expect(getKeyLabel(t, "Quote", "jis")).toBe(":");
    expect(getKeyLabel(t, "Equal", "us")).toBe("=");
    expect(getKeyLabel(t, "Equal", "jis")).toBe("^");
    expect(getKeyLabel(t, "BracketLeft", "jis")).toBe("@");
    expect(getKeyLabel(t, "BracketRight", "jis")).toBe("[");
    expect(getKeyLabel(t, "Backslash", "jis")).toBe("]");
  });

  it("保存値の配列名（JIS / JIS_TKL / US_TKL）をそのまま受け取る", () => {
    expect(getKeyLabel(t, "Quote", "JIS")).toBe(":");
    expect(getKeyLabel(t, "Quote", "JIS_TKL")).toBe(":");
    expect(getKeyLabel(t, "Backquote", "JIS")).toBe("半角");
    expect(getKeyLabel(t, "Quote", "US")).toBe("'");
    expect(getKeyLabel(t, "Quote", "US_TKL")).toBe("'");
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

describe("Windows 仮想キーコード（16進表記）", () => {
  it("マウスボタンの VK を正規コードに解決する", () => {
    expect(normalizeKeyCode("0x01")).toBe("Mouse0");
    expect(normalizeKeyCode("0x02")).toBe("Mouse1");
    expect(normalizeKeyCode("0x04")).toBe("Mouse2");
    expect(normalizeKeyCode("0x05")).toBe("Mouse4");
    expect(normalizeKeyCode("0x06")).toBe("Mouse3");
    expect(normalizeKeyCode("0X06")).toBe("Mouse3");
  });

  it("0x05 / 0x06 はサイドボタンのラベルで表示される", () => {
    const t = createTranslator("ja");
    expect(getKeyLabel(t, "0x05")).toBe(getKeyLabel(t, "Mouse4"));
    expect(getKeyLabel(t, "0x06")).toBe(getKeyLabel(t, "Mouse3"));
    expect(keysEqual("0x06", "Mouse3")).toBe(true);
  });

  it("未対応の16進コードは生の値ではなく「不明なキー」と表示する", () => {
    expect(getKeyLabel(createTranslator("ja"), "0x07")).toBe("不明なキー（0x07）");
    expect(getKeyLabel(createTranslator("en"), "0x07")).toBe("Unknown key (0x07)");
  });
});

describe("isJisLayout / isTklLayout", () => {
  it("アンダースコア・ハイフン表記と大文字小文字を同じに扱う", () => {
    for (const l of ["JIS", "JIS_TKL", "JIS-TKL", "jis"]) expect(isJisLayout(l)).toBe(true);
    for (const l of ["US", "US_TKL", "US-TKL", null, undefined, ""]) expect(isJisLayout(l)).toBe(false);
    for (const l of ["US_TKL", "US-TKL", "JIS_TKL", "JIS-TKL", "jis-tkl"]) expect(isTklLayout(l)).toBe(true);
    for (const l of ["US", "JIS", null, undefined]) expect(isTklLayout(l)).toBe(false);
  });
});

describe("IntlYen / IntlBackslash のラベル", () => {
  it("JIS では IntlYen が半角、IntlBackslash が ¥。ハイフン表記も同じ", () => {
    expect(getKeyLabel(t, "IntlYen", "JIS")).toBe("半角");
    expect(getKeyLabel(t, "IntlYen", "JIS-TKL")).toBe("半角");
    expect(getKeyLabel(t, "IntlBackslash", "JIS")).toBe("¥");
  });

  it("JIS 以外の IntlYen は ¥", () => {
    expect(getKeyLabel(t, "IntlYen", "US")).toBe("¥");
    expect(getKeyLabel(t, "IntlYen")).toBe("¥");
  });
});

describe("getKeyCodeAliases", () => {
  it("JIS の IntlYen には Backquote を別名として足す（ハイフン表記も）", () => {
    expect(getKeyCodeAliases("IntlYen", "JIS")).toEqual(["IntlYen", "Backquote"]);
    expect(getKeyCodeAliases("IntlYen", "JIS-TKL")).toEqual(["IntlYen", "Backquote"]);
  });

  it("US・配列なし・ほかのキーは別名なし", () => {
    expect(getKeyCodeAliases("IntlYen", "US")).toEqual(["IntlYen"]);
    expect(getKeyCodeAliases("IntlYen", null)).toEqual(["IntlYen"]);
    expect(getKeyCodeAliases("Backquote", "JIS")).toEqual(["Backquote"]);
    expect(getKeyCodeAliases("KeyA", "JIS")).toEqual(["KeyA"]);
  });
});

describe("読めないキー名の表示ラベル", () => {
  const t = createTranslator("ja");
  it("JIS の変換系キーは日本語のラベルになる", () => {
    expect(getKeyLabel(t, "NonConvert")).toBe("無変換");
    expect(getKeyLabel(t, "Convert")).toBe("変換");
    expect(getKeyLabel(t, "KanaMode")).toBe("かな");
  });

  it("scancode.N は「スキャンコード N」になる", () => {
    expect(getKeyLabel(t, "scancode.93")).toBe("スキャンコード 93");
    expect(getKeyLabel(createTranslator("en"), "scancode.93")).toBe("Scancode 93");
  });

  it("不使用は「-」のまま（統計側で「未割り当て」に差し替える）", () => {
    expect(getKeyLabel(t, "_UNBOUND")).toBe("-");
  });
});
