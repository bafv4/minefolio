// マウス設定の計算ロジック。
// 旧 /keybindings と /keybindings/stats に重複定義されていたものを集約。

// Windows ポインター速度の乗数（11/11 がデフォルト）
// https://liquipedia.net/counterstrike/Mouse_Settings#Windows_Sensitivity
export const WINDOWS_POINTER_MULTIPLIERS: Record<number, number> = {
  1: 0.03125,
  2: 0.0625,
  3: 0.125,
  4: 0.25,
  5: 0.375,
  6: 0.5,
  7: 0.625,
  8: 0.75,
  9: 0.875,
  10: 1,
  11: 1.25,
  12: 1.5,
  13: 1.75,
  14: 2,
  15: 2.25,
  16: 2.5,
  17: 2.75,
  18: 3,
  19: 3.25,
  20: 3.5,
};

/**
 * Windows ポインター速度の乗数を取得（カスタム係数優先）
 */
export function getWindowsMultiplier(
  windowsSpeed: number | null | undefined,
  windowsSpeedMultiplier: number | null | undefined,
): number {
  if (windowsSpeedMultiplier != null && windowsSpeedMultiplier > 0) {
    return windowsSpeedMultiplier;
  }
  return windowsSpeed != null
    ? (WINDOWS_POINTER_MULTIPLIERS[windowsSpeed] ?? 1.0)
    : 1.0;
}

/**
 * 振り向き距離（cm/360）を計算
 * 計算式: 6096 / (DPI * 8 * (0.6 * sensitivity + 0.2)^3) / 2
 * Raw Input が ON のときは Windows ポインター速度を無視
 */
export function calculateCm360(
  dpi: number | null | undefined,
  sensitivity: number | null | undefined,
  rawInput: boolean | null | undefined,
  windowsSpeed: number | null | undefined,
  windowsSpeedMultiplier: number | null | undefined = null,
): number | null {
  if (dpi == null || sensitivity == null) return null;

  const f = 0.6 * sensitivity + 0.2;
  const cm360Base = 6096 / (dpi * 8 * f * f * f) / 2;

  if (rawInput === true) {
    return cm360Base;
  }

  const winMultiplier = getWindowsMultiplier(windowsSpeed, windowsSpeedMultiplier);
  return cm360Base / winMultiplier;
}

/**
 * カーソル速度（実効 DPI）を計算
 * Raw Input の状態に関わらず DPI に Windows 速度の係数をかける
 */
export function calculateCursorSpeed(
  dpi: number | null | undefined,
  windowsSpeed: number | null | undefined,
  windowsSpeedMultiplier: number | null | undefined = null,
): number | null {
  if (dpi == null) return null;
  const winMultiplier = getWindowsMultiplier(windowsSpeed, windowsSpeedMultiplier);
  return Math.round(dpi * winMultiplier);
}
