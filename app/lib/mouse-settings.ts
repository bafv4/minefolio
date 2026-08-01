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
 * ゲーム内感度が有効な範囲かどうかを判定
 * 内部値 0..1 が表示 0..200% に対応する（閉区間。ちょうど 0% / 200% は有効）。
 * 範囲外（表示 201% 以上 / 0% 未満）や NaN は無効として扱い、
 * 振り向き（cm/360）を計算しない。
 */
export function isValidSensitivity(
  sensitivity: number | null | undefined,
): sensitivity is number {
  return sensitivity != null && sensitivity >= 0 && sensitivity <= 1;
}

/**
 * 内部値（0..1）を表示用パーセント（0..200%）へ換算する。
 * Minecraft の設定画面と同じ 0〜200% 表記に揃えるため係数は 200。
 * 有効範囲外の値も換算だけは行う（一覧では警告付きで表示するため）。
 * 端数は切り捨て（Minecraft 本体の int キャストと同じ挙動に揃える。表示・CSV・統計で同じ整数になるよう統一）。
 * 保存値は `(percent/200).toFixed(4)` 経由のため、整数% ちょうどの値でも `sensitivity * 200` が
 * 浮動小数点誤差でわずかに下振れすることがある（例: 58% → 57.99999999999999）。
 * floor 前に 6 桁へ丸めて誤差を吸収してから切り捨てる。
 */
export function toSensitivityPercent(
  sensitivity: number | null | undefined,
): number | null {
  if (sensitivity == null || !Number.isFinite(sensitivity)) return null;
  return Math.floor(Number((sensitivity * 200).toFixed(6)));
}

/**
 * Windows ポインター速度の乗数を取得（カスタム係数優先）
 * WinSens もカスタム係数も未設定なら null を返す（フォールバックしない）。
 */
export function getWindowsMultiplierOrNull(
  windowsSpeed: number | null | undefined,
  windowsSpeedMultiplier: number | null | undefined,
): number | null {
  if (windowsSpeedMultiplier != null && windowsSpeedMultiplier > 0) {
    return windowsSpeedMultiplier;
  }
  if (windowsSpeed != null) {
    return WINDOWS_POINTER_MULTIPLIERS[windowsSpeed] ?? null;
  }
  return null;
}

/**
 * Windows ポインター速度の乗数を取得（カスタム係数優先）
 * 未設定・未知の値は 1.0 にフォールバックする。
 */
export function getWindowsMultiplier(
  windowsSpeed: number | null | undefined,
  windowsSpeedMultiplier: number | null | undefined,
): number {
  return getWindowsMultiplierOrNull(windowsSpeed, windowsSpeedMultiplier) ?? 1.0;
}

/**
 * 振り向き距離（cm/360）を計算
 * 計算式: 6096 / (DPI * 8 * (0.6 * sensitivity + 0.2)^3) / 2
 * Raw Input が ON のときは Windows ポインター速度を無視
 * ゲーム内感度が有効範囲（内部値 0..1）外なら計算しない
 *
 * Raw Input が OFF（未設定含む）のときの Windows 側の扱いは 2 通りに分ける:
 * - WinSens もカスタム係数も**未設定** → 従来どおり 1.0 とみなして計算する
 * - どちらかが**設定済みなのに係数が決まらない**（係数テーブル 1〜20 外の WinSens など）
 *   → 不正値として計算しない（null）。x1.000 と断定すると Cursor Speed 列（同条件で「-」）と
 *     食い違うため、振り向き側も計算不能に揃える
 */
export function calculateCm360(
  dpi: number | null | undefined,
  sensitivity: number | null | undefined,
  rawInput: boolean | null | undefined,
  windowsSpeed: number | null | undefined,
  windowsSpeedMultiplier: number | null | undefined = null,
): number | null {
  if (dpi == null || !isValidSensitivity(sensitivity)) return null;

  const f = 0.6 * sensitivity + 0.2;
  const cm360Base = 6096 / (dpi * 8 * f * f * f) / 2;

  if (rawInput === true) {
    return cm360Base;
  }

  const winMultiplier = getWindowsMultiplierOrNull(windowsSpeed, windowsSpeedMultiplier);
  if (winMultiplier != null) {
    return cm360Base / winMultiplier;
  }
  // 未設定（両方 null）のみ 1.0 フォールバックを維持する
  if (windowsSpeed == null && windowsSpeedMultiplier == null) {
    return cm360Base;
  }
  return null;
}

/**
 * カーソル速度（実効 DPI）を計算
 * Raw Input の状態に関わらず DPI に Windows 速度の係数をかける
 * WinSens もカスタム係数も未設定なら計算しない（DPI をそのまま出さない）
 */
export function calculateCursorSpeed(
  dpi: number | null | undefined,
  windowsSpeed: number | null | undefined,
  windowsSpeedMultiplier: number | null | undefined = null,
): number | null {
  if (dpi == null) return null;
  const winMultiplier = getWindowsMultiplierOrNull(windowsSpeed, windowsSpeedMultiplier);
  if (winMultiplier == null) return null;
  return Math.round(dpi * winMultiplier);
}
