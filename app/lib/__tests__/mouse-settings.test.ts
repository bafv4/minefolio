// マウス設定の計算ロジック（感度異常値・WinSens 未設定ハンドリング）のテスト。
// - isValidSensitivity: 内部値 0..1（表示 0..200%）の閉区間外／NaN を無効とする
// - getWindowsMultiplierOrNull: WinSens・カスタム係数がどちらも未設定なら null（フォールバックしない）
// - calculateCm360 / calculateCursorSpeed: 感度異常値・DPI 未設定・WinSens 未設定で null を返す
import { describe, it, expect } from "vitest";
import {
  isValidSensitivity,
  calculateCm360,
  calculateCursorSpeed,
  getWindowsMultiplierOrNull,
  getWindowsMultiplier,
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
