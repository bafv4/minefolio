// RTA歴（開始年月, "YYYY-MM"）のパース・検証・経過期間算出のテスト。
// - isValidRtaStartedYearMonth: 書式（^\d{4}-(0[1-9]|1[0-2])$）+ 範囲（2009-01〜現在年月、未来は不正）
// - rtaCareerElapsed: 開始年月から now までの経過月数（totalMonths / years / months）。不正値は null
// - parseRtaStartedYearMonth: 書式のみの検証（範囲チェックはしない）で {year, month} を返す
//
// now は 2026-08-01 に固定して境界（下限2009-01・現在年月・翌月）を検証する。
import { describe, it, expect } from "vitest";
import {
  isValidRtaStartedYearMonth,
  rtaCareerElapsed,
  parseRtaStartedYearMonth,
} from "../rta-career";

// ローカルタイムゾーンで構築する（"2026-08-01" 文字列だと UTC 解釈になり、
// 負オフセット TZ の環境ではローカル日付が前日=前月となってテストが落ちる）
const NOW = new Date(2026, 7, 1);

describe("isValidRtaStartedYearMonth", () => {
  it("通常の過去の年月は有効", () => {
    expect(isValidRtaStartedYearMonth("2020-06", NOW)).toBe(true);
  });

  it("下限境界 2009-01 は有効", () => {
    expect(isValidRtaStartedYearMonth("2009-01", NOW)).toBe(true);
  });

  it("下限未満 2008-12 は無効", () => {
    expect(isValidRtaStartedYearMonth("2008-12", NOW)).toBe(false);
  });

  it("現在年月（2026-08）は有効", () => {
    expect(isValidRtaStartedYearMonth("2026-08", NOW)).toBe(true);
  });

  it("翌月（2026-09、未来）は無効", () => {
    expect(isValidRtaStartedYearMonth("2026-09", NOW)).toBe(false);
  });

  it.each([
    ["2020-13", "月が範囲外（13）"],
    ["2020-00", "月が範囲外（00）"],
    ["2020-6", "月が1桁"],
    ["20-06", "年が2桁"],
    ["abc", "数値でない"],
    ["", "空文字"],
  ])("書式不正 %s（%s）は無効", (value) => {
    expect(isValidRtaStartedYearMonth(value, NOW)).toBe(false);
  });
});

describe("rtaCareerElapsed", () => {
  it("2020-06 → 74ヶ月（6年2ヶ月）", () => {
    expect(rtaCareerElapsed("2020-06", NOW)).toEqual({
      totalMonths: 74,
      years: 6,
      months: 2,
    });
  });

  it("2026-05 → 3ヶ月（0年3ヶ月）", () => {
    expect(rtaCareerElapsed("2026-05", NOW)).toEqual({
      totalMonths: 3,
      years: 0,
      months: 3,
    });
  });

  it("2026-08（今月）→ 0ヶ月", () => {
    expect(rtaCareerElapsed("2026-08", NOW)).toEqual({
      totalMonths: 0,
      years: 0,
      months: 0,
    });
  });

  it("不正値（下限未満）は null", () => {
    expect(rtaCareerElapsed("2008-12", NOW)).toBeNull();
  });

  it("不正値（未来）は null", () => {
    expect(rtaCareerElapsed("2026-09", NOW)).toBeNull();
  });

  it("不正値（書式不正）は null", () => {
    expect(rtaCareerElapsed("abc", NOW)).toBeNull();
  });
});

describe("parseRtaStartedYearMonth", () => {
  it("正常な書式は {year, month} を返す", () => {
    expect(parseRtaStartedYearMonth("2020-06")).toEqual({ year: 2020, month: 6 });
  });

  it("範囲外（下限未満・未来）でも書式さえ正しければパースできる（範囲検証はしない）", () => {
    expect(parseRtaStartedYearMonth("2008-12")).toEqual({ year: 2008, month: 12 });
    expect(parseRtaStartedYearMonth("2099-01")).toEqual({ year: 2099, month: 1 });
  });

  it("書式不正は null", () => {
    expect(parseRtaStartedYearMonth("2020-13")).toBeNull();
    expect(parseRtaStartedYearMonth("2020-6")).toBeNull();
    expect(parseRtaStartedYearMonth("abc")).toBeNull();
    expect(parseRtaStartedYearMonth("")).toBeNull();
  });
});
