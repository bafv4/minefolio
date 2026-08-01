// マウス設定の計算ロジック（感度異常値・WinSens 未設定ハンドリング）のテスト。
// - isValidSensitivity: 内部値 0..1（表示 0..200%）の閉区間外／NaN を無効とする
// - getWindowsMultiplierOrNull: WinSens・カスタム係数がどちらも未設定なら null（フォールバックしない）
// - calculateCm360 / calculateCursorSpeed: 感度異常値・DPI 未設定・WinSens 未設定で null を返す
// - toSensitivityPercent: 内部値 0..1 → 表示 0..200% への換算（*200、floor）。範囲外も換算だけは行う
import { describe, it, expect } from "vitest";
import {
  isValidSensitivity,
  calculateCm360,
  calculateCursorSpeed,
  getWindowsMultiplierOrNull,
  getWindowsMultiplier,
  toSensitivityPercent,
} from "../mouse-settings";

describe("isValidSensitivity", () => {
  it("内部値 0..1（表示 0..200%）の閉区間は有効", () => {
    expect(isValidSensitivity(0)).toBe(true);
    expect(isValidSensitivity(1)).toBe(true);
    expect(isValidSensitivity(0.5)).toBe(true);
  });

  it("閉区間外・null・undefined・NaN は無効", () => {
    expect(isValidSensitivity(1.005)).toBe(false); // 表示 201%
    expect(isValidSensitivity(-0.01)).toBe(false);
    expect(isValidSensitivity(null)).toBe(false);
    expect(isValidSensitivity(undefined)).toBe(false);
    expect(isValidSensitivity(NaN)).toBe(false);
  });
});

describe("calculateCm360", () => {
  it("既知値: dpi=800, sensitivity=0.5（f=0.5）, rawInput=true → 3.81", () => {
    expect(calculateCm360(800, 0.5, true, null)).toBeCloseTo(3.81, 2);
  });

  it("dpi が null なら null（既存挙動の pin）", () => {
    expect(calculateCm360(null, 0.5, true, null)).toBeNull();
  });

  it("sensitivity が null なら null（既存挙動の pin）", () => {
    expect(calculateCm360(800, null, true, null)).toBeNull();
  });

  it("感度異常値（表示 201% 相当）は null", () => {
    expect(calculateCm360(800, 1.005, true, null)).toBeNull();
  });

  it("感度異常値（負値）は null", () => {
    expect(calculateCm360(800, -0.1, true, null)).toBeNull();
  });

  it("感度の境界値 0 / 1.0 は有限な数値を返す", () => {
    const atZero = calculateCm360(800, 0, true, null);
    const atOne = calculateCm360(800, 1, true, null);
    expect(atZero).not.toBeNull();
    expect(Number.isFinite(atZero)).toBe(true);
    expect(atOne).not.toBeNull();
    expect(Number.isFinite(atOne)).toBe(true);
  });

  it("rawInput=false + windowsSpeed=6 は base をテーブル係数（0.5）で除算した値になる", () => {
    const base = calculateCm360(800, 0.5, true, null); // 3.81
    const divided = calculateCm360(800, 0.5, false, 6, null);
    expect(base).not.toBeNull();
    expect(divided).not.toBeNull();
    expect(divided).toBeCloseTo(base! / 0.5, 6);
  });

  it("rawInput=false + Win 情報なし（windowsSpeed/multiplier 両方 null）は base と同値（1.0 フォールバック温存の pin）", () => {
    const base = calculateCm360(800, 0.5, true, null);
    const fallback = calculateCm360(800, 0.5, false, null, null);
    expect(fallback).toBe(base);
  });

  it("rawInput=false + テーブル外の windowsSpeed（99）は計算しない（x1.000 と断定せず null）", () => {
    expect(calculateCm360(800, 0.5, false, 99, null)).toBeNull();
  });

  it("rawInput=true ならテーブル外の windowsSpeed でも Windows 側を無視して計算する", () => {
    const base = calculateCm360(800, 0.5, true, null);
    expect(calculateCm360(800, 0.5, true, 99, null)).toBe(base);
  });

  it("テーブル外の windowsSpeed でもカスタム係数があればそれで計算する", () => {
    const base = calculateCm360(800, 0.5, true, null);
    const divided = calculateCm360(800, 0.5, false, 99, 2);
    expect(divided).toBeCloseTo(base! / 2, 6);
  });
});

describe("calculateCursorSpeed", () => {
  it("dpi が null なら null", () => {
    expect(calculateCursorSpeed(null, 6, null)).toBeNull();
  });

  it("回帰点: WinSens・カスタム係数がどちらも未設定なら null（修正前は dpi そのまま=800 が出ていた）", () => {
    expect(calculateCursorSpeed(800, null, null)).toBeNull();
  });

  it("windowsSpeed=6（テーブル係数 0.5）→ dpi × 0.5 を四捨五入", () => {
    expect(calculateCursorSpeed(800, 6, null)).toBe(400);
  });

  it("カスタム係数 1.5 → dpi × 1.5", () => {
    expect(calculateCursorSpeed(800, null, 1.5)).toBe(1200);
  });

  it("カスタム係数 0 は無効なので windowsSpeed も無ければ null", () => {
    expect(calculateCursorSpeed(800, null, 0)).toBeNull();
  });

  it("カスタム係数 0 は無効なので windowsSpeed のテーブル参照にフォールスルーする", () => {
    expect(calculateCursorSpeed(800, 6, 0)).toBe(400);
  });
});

describe("getWindowsMultiplierOrNull", () => {
  it("WinSens・カスタム係数がどちらも未設定なら null（フォールバックしない）", () => {
    expect(getWindowsMultiplierOrNull(null, null)).toBeNull();
  });

  it("カスタム係数が設定されていればテーブルより優先される", () => {
    expect(getWindowsMultiplierOrNull(6, 2)).toBe(2);
  });

  it("windowsSpeed のみ設定されていればテーブルを参照する", () => {
    expect(getWindowsMultiplierOrNull(11, null)).toBe(1.25);
  });

  it("テーブル外の windowsSpeed は null", () => {
    expect(getWindowsMultiplierOrNull(99, null)).toBeNull();
  });
});

describe("getWindowsMultiplier", () => {
  it("WinSens・カスタム係数がどちらも未設定なら 1.0 にフォールバックする（従来挙動維持の pin）", () => {
    expect(getWindowsMultiplier(null, null)).toBe(1.0);
  });
});

describe("toSensitivityPercent", () => {
  it("null・undefined・NaN・Infinity は null", () => {
    expect(toSensitivityPercent(null)).toBeNull();
    expect(toSensitivityPercent(undefined)).toBeNull();
    expect(toSensitivityPercent(NaN)).toBeNull();
    expect(toSensitivityPercent(Infinity)).toBeNull();
    expect(toSensitivityPercent(-Infinity)).toBeNull();
  });

  it("既知値: 0 → 0%, 0.5 → 100%, 0.8 → 160%, 1.0 → 200%", () => {
    expect(toSensitivityPercent(0)).toBe(0);
    expect(toSensitivityPercent(0.5)).toBe(100);
    expect(toSensitivityPercent(0.8)).toBe(160);
    expect(toSensitivityPercent(1.0)).toBe(200);
  });

  it("端数は切り捨て（0.8975 → 179%、切り上げなら180になってしまう境界）", () => {
    expect(toSensitivityPercent(0.8975)).toBe(179);
  });

  it("有効範囲（0..1）外でも換算だけは行う（警告付き表示用）", () => {
    expect(toSensitivityPercent(1.5)).toBe(300);
    expect(toSensitivityPercent(-0.1)).toBe(-20);
  });

  it("FP 回帰: (percent/200).toFixed(4) 由来の保存値は *200 で微小に下振れするが、6桁丸めで正しい整数%になる（修正前は 57 / 114 だった）", () => {
    expect(toSensitivityPercent(0.29)).toBe(58);
    expect(toSensitivityPercent(0.575)).toBe(115);
  });
});
