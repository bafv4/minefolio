import { describe, it, expect } from "vitest";
import { simulateRemapOutput, getActualKeyInfos, type RemapInfo } from "../remap-utils";

const REMAPS: RemapInfo[] = [
  // 単一キーのリマップ
  { sourceKey: "Semicolon", targetKey: "KeyE" },
  // 修飾キー組み合わせのリマップ
  { sourceKey: "Shift+KeyW", targetKey: "KeyA" },
  // 無効化
  { sourceKey: "KeyQ", targetKey: null },
  // 文字出力（キーコード以外のターゲット）
  { sourceKey: "Slash", targetKey: "-" },
];

describe("simulateRemapOutput", () => {
  it("リマップなしの印字可能キーはそのままの文字を出力する", () => {
    const result = simulateRemapOutput("KeyA", REMAPS);
    expect(result.output).toBe("a");
    expect(result.isRemapped).toBe(false);
  });

  it("Shift + 印字可能キーは大文字を出力する", () => {
    const result = simulateRemapOutput("Shift+KeyB", REMAPS);
    expect(result.output).toBe("B");
    expect(result.isRemapped).toBe(false);
  });

  it("単一キーのリマップを適用する", () => {
    const result = simulateRemapOutput("Semicolon", REMAPS);
    expect(result.output).toBe("e");
    expect(result.isRemapped).toBe(true);
  });

  it("修飾キー込みの完全一致リマップを優先する", () => {
    const result = simulateRemapOutput("Shift+KeyW", REMAPS);
    expect(result.output).toBe("a");
    expect(result.isRemapped).toBe(true);
  });

  it("Shift + 単一キーリマップは出力を大文字化する", () => {
    const result = simulateRemapOutput("Shift+Semicolon", REMAPS);
    expect(result.output).toBe("E");
    expect(result.isRemapped).toBe(true);
  });

  it("無効化されたキーは出力なし", () => {
    const result = simulateRemapOutput("KeyQ", REMAPS);
    expect(result.output).toBeNull();
    expect(result.isRemapped).toBe(true);
  });

  it("文字出力ターゲットはそのまま出力する", () => {
    const result = simulateRemapOutput("Slash", REMAPS);
    expect(result.output).toBe("-");
    expect(result.isRemapped).toBe(true);
  });

  it("印字不能キーは出力なし", () => {
    const result = simulateRemapOutput("F3", REMAPS);
    expect(result.output).toBeNull();
    expect(result.isRemapped).toBe(false);
  });

  it("未定義の Ctrl 組み合わせは出力なし", () => {
    const result = simulateRemapOutput("Ctrl+KeyC", REMAPS);
    expect(result.output).toBeNull();
    expect(result.isRemapped).toBe(false);
  });

  it("スペースキーは空白を出力する", () => {
    const result = simulateRemapOutput("Space", REMAPS);
    expect(result.output).toBe(" ");
    // 可視1文字でないキーは getKeyLabel() のラベル（Space は「スペース」）
    expect(result.pressedLabel).toBe("スペース");
  });

  it("記号キーは文字を出力する（keyCode名ではなく）", () => {
    expect(simulateRemapOutput("Minus", REMAPS).output).toBe("-");
    expect(simulateRemapOutput("Comma", REMAPS).output).toBe(",");
    expect(simulateRemapOutput("Period", REMAPS).output).toBe(".");
  });

  it("Shift + 記号/数字キーはシフト後の文字を出力する（US配列基準）", () => {
    expect(simulateRemapOutput("Shift+Minus", REMAPS).output).toBe("_");
    expect(simulateRemapOutput("Shift+Digit1", REMAPS).output).toBe("!");
  });

  it("JIS の Shift+IntlRo はアンダースコアを出力する", () => {
    expect(simulateRemapOutput("Shift+IntlRo", REMAPS).output).toBe("_");
  });

  it("キー出力ターゲットが記号キーの場合も文字を出力する", () => {
    const remaps: RemapInfo[] = [{ sourceKey: "KeyB", targetKey: "Space" }];
    expect(simulateRemapOutput("KeyB", remaps).output).toBe(" ");
    const remaps2: RemapInfo[] = [{ sourceKey: "KeyC", targetKey: "Minus" }];
    expect(simulateRemapOutput("KeyC", remaps2).output).toBe("-");
  });

  it("修飾キー単独のリマップは完全一致で解決する", () => {
    const remaps: RemapInfo[] = [{ sourceKey: "ShiftLeft", targetKey: "KeyE" }];
    const result = simulateRemapOutput("ShiftLeft", remaps);
    expect(result.output).toBe("e");
    expect(result.isRemapped).toBe(true);
  });
});

describe("simulateRemapOutput と getActualKeyInfos の整合性", () => {
  it("逆引きで得たキーを順方向に適用すると元の文字に戻る", () => {
    const searchStr = "sea";
    const keyInfos = getActualKeyInfos(searchStr, REMAPS);
    const roundTrip = keyInfos
      .map((info) => simulateRemapOutput(info.keyCode, REMAPS).output)
      .join("");
    expect(roundTrip).toBe(searchStr);
  });
});
