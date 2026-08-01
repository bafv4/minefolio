// 振り向き（cm/360）・カーソル速度（実効DPI）が「計算できない理由」を、
// 欠けている入力から導出する純関数群。
// /keybindings の一覧セル（app/components/keybindings/keybindings-cells.tsx）と
// プロフィールページ（app/routes/player/profile.tsx）の両方が使う。
// 理由の分岐は app/lib/mouse-settings.ts の calculateCm360 / calculateCursorSpeed が
// null を返す条件と対で保守すること（どちらかだけ直すと表示上の理由と実際の計算結果が食い違う）。
import { getWindowsMultiplierOrNull, isValidSensitivity } from "@/lib/mouse-settings";
import type { Translator } from "@/lib/messages";

/**
 * 理由導出に必要なマウス設定の最小構造。
 * 一覧セルの MouseConfig（必須プロパティ）・プロフィールの MouseSettingsSubset
 * （optional プロパティ）のどちらも代入できるよう、全プロパティを optional にする
 * （必須 → optional は構造的に代入可。逆は「プロパティ欠落の可能性」で弾かれる）。
 */
export type MouseReasonConfig = {
  mouseDpi?: number | null;
  gameSensitivity?: number | null;
  rawInput?: boolean | null;
  windowsSpeed?: number | null;
  windowsSpeedMultiplier?: number | null;
};

/** Windows 側の乗数が決まらない理由（未設定 / 係数不明）。決まるなら null */
export function windowsMultiplierReason(
  t: Translator,
  config: MouseReasonConfig,
): string | null {
  if (
    getWindowsMultiplierOrNull(config.windowsSpeed, config.windowsSpeedMultiplier) != null
  ) {
    return null;
  }
  return config.windowsSpeed == null && config.windowsSpeedMultiplier == null
    ? t("keybindings.reasonNoWindowsSpeed")
    : t("keybindings.reasonUnknownWindowsMultiplier");
}

/** 振り向き（cm/360）が計算できない理由を、欠けている入力から導出する */
export function cm360MissingReasons(t: Translator, config: MouseReasonConfig): string[] {
  const reasons: string[] = [];
  if (config.mouseDpi == null) reasons.push(t("keybindings.reasonNoDpi"));
  if (config.gameSensitivity == null) {
    reasons.push(t("keybindings.reasonNoSensitivity"));
  } else if (!isValidSensitivity(config.gameSensitivity)) {
    reasons.push(t("keybindings.reasonSensitivityOutOfRange"));
  }
  // Raw Input ON なら Windows 側は無視される。OFF（未設定含む）でも
  // WinSens・カスタム係数がともに未設定なら x1.0 とみなして計算するため理由にならない。
  if (
    config.rawInput !== true &&
    (config.windowsSpeed != null || config.windowsSpeedMultiplier != null)
  ) {
    const reason = windowsMultiplierReason(t, config);
    if (reason) reasons.push(reason);
  }
  return reasons;
}

/** カーソル速度（実効 DPI）が計算できない理由を、欠けている入力から導出する */
export function cursorSpeedMissingReasons(
  t: Translator,
  config: MouseReasonConfig,
): string[] {
  const reasons: string[] = [];
  if (config.mouseDpi == null) reasons.push(t("keybindings.reasonNoDpi"));
  const reason = windowsMultiplierReason(t, config);
  if (reason) reasons.push(reason);
  return reasons;
}

/**
 * 理由配列を表示用の1文字列へ連結する。
 * HintTip の message にそのまま渡す想定（一覧セル・プロフィールの両方で共通）。
 */
export function joinMouseReasons(reasons: string[]): string {
  return reasons.join(" / ");
}
