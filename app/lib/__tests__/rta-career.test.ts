// RTA歴（開始年月, "YYYY-MM"）のパース・検証・経過期間算出・表示文言組み立てのテスト。
// - isValidRtaStartedYearMonth: 書式（^\d{4}-(0[1-9]|1[0-2])$）+ 範囲（2009-01〜現在年月、未来は不正）
// - rtaCareerElapsed: 開始年月から now までの経過月数（totalMonths / years / months）。不正値は null
// - parseRtaStartedYearMonth: 書式のみの検証（範囲チェックはしない）で {year, month} を返す
// - formatRtaStartedLabel / rtaCareerView / hasRtaCareerRemainder / rtaCareerLabel / rtaCareerExactLabel:
//   表示用のロケール別整形・単複分岐。t は実際の createTranslator（ja/en 両方）で検証し、
//   文言（pages-ja.ts / pages-en.ts）の回帰も検出できるようにする。
//
// now は 2026-08-01 に固定して境界（下限2009-01・現在年月・翌月）を検証する。
import { describe, it, expect } from "vitest";
import {
  isValidRtaStartedYearMonth,
  rtaCareerElapsed,
  parseRtaStartedYearMonth,
  formatRtaStartedLabel,
  rtaCareerView,
  hasRtaCareerRemainder,
  rtaCareerLabel,
  rtaCareerExactLabel,
  type RtaCareerView,
} from "../rta-career";
import { createTranslator } from "../messages";

const tJa = createTranslator("ja");
const tEn = createTranslator("en");

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

describe("formatRtaStartedLabel", () => {
  it("ja は「YYYY/M」形式（ゼロ埋めなし）", () => {
    expect(formatRtaStartedLabel({ year: 2020, month: 6 }, "ja")).toBe("2020/6");
  });

  it("en は「Mon YYYY」形式（月は短縮英語表記）", () => {
    expect(formatRtaStartedLabel({ year: 2020, month: 6 }, "en")).toBe("Jun 2020");
  });

  it("ja の1桁月もゼロ埋めしない", () => {
    expect(formatRtaStartedLabel({ year: 2020, month: 1 }, "ja")).toBe("2020/1");
  });

  it("en の1月は Jan と表記される", () => {
    expect(formatRtaStartedLabel({ year: 2020, month: 1 }, "en")).toBe("Jan 2020");
  });
});

describe("rtaCareerView", () => {
  it("2020-06 → 6年2ヶ月・ja の開始表記", () => {
    expect(rtaCareerView("2020-06", "ja", NOW)).toEqual({
      totalMonths: 74,
      years: 6,
      months: 2,
      start: "2020/6",
    });
  });

  it("2020-06 → 6年2ヶ月・en の開始表記", () => {
    expect(rtaCareerView("2020-06", "en", NOW)).toEqual({
      totalMonths: 74,
      years: 6,
      months: 2,
      start: "Jun 2020",
    });
  });

  it("null は null", () => {
    expect(rtaCareerView(null, "ja", NOW)).toBeNull();
  });

  it("undefined は null", () => {
    expect(rtaCareerView(undefined, "ja", NOW)).toBeNull();
  });

  it("空文字は null", () => {
    expect(rtaCareerView("", "ja", NOW)).toBeNull();
  });

  it("書式不正は null", () => {
    expect(rtaCareerView("abc", "ja", NOW)).toBeNull();
  });

  it("範囲外（下限未満）は null", () => {
    expect(rtaCareerView("2008-12", "ja", NOW)).toBeNull();
  });

  it("範囲外（未来）は null", () => {
    expect(rtaCareerView("2026-09", "ja", NOW)).toBeNull();
  });
});

describe("hasRtaCareerRemainder", () => {
  it("6年2ヶ月（端数あり）は true", () => {
    const view: RtaCareerView = { totalMonths: 74, years: 6, months: 2, start: "2020/6" };
    expect(hasRtaCareerRemainder(view)).toBe(true);
  });

  it("6年0ヶ月（端数なし）は false", () => {
    const view: RtaCareerView = { totalMonths: 72, years: 6, months: 0, start: "2020/8" };
    expect(hasRtaCareerRemainder(view)).toBe(false);
  });

  it("0年3ヶ月（1年未満）は false", () => {
    const view: RtaCareerView = { totalMonths: 3, years: 0, months: 3, start: "2026/5" };
    expect(hasRtaCareerRemainder(view)).toBe(false);
  });
});

describe("rtaCareerLabel", () => {
  it("今月開始（totalMonths=0）は JustStarted 文言（ja）", () => {
    const view: RtaCareerView = { totalMonths: 0, years: 0, months: 0, start: "2026/8" };
    expect(rtaCareerLabel(tJa, view)).toBe("RTA歴 1か月未満（2026/8〜）");
  });

  it("今月開始（totalMonths=0）は JustStarted 文言（en）", () => {
    const view: RtaCareerView = { totalMonths: 0, years: 0, months: 0, start: "Aug 2026" };
    expect(rtaCareerLabel(tEn, view)).toBe("Speedrunning for less than a month (since Aug 2026)");
  });

  it("1年ちょうどは単数キー（en は year、複数の s なし）", () => {
    const view: RtaCareerView = { totalMonths: 12, years: 1, months: 0, start: "2025/8" };
    expect(rtaCareerLabel(tEn, view)).toBe("Speedrunning for 1 year (since 2025/8)");
  });

  it("1年ちょうどは単数キー（ja は単複同形）", () => {
    const view: RtaCareerView = { totalMonths: 12, years: 1, months: 0, start: "2025/8" };
    expect(rtaCareerLabel(tJa, view)).toBe("RTA歴 1年（2025/8〜）");
  });

  it("6年（複数）は複数キー（en は years）", () => {
    const view: RtaCareerView = { totalMonths: 74, years: 6, months: 2, start: "2020/6" };
    expect(rtaCareerLabel(tEn, view)).toBe("Speedrunning for 6 years (since 2020/6)");
  });

  it("1年以上は端数月を切り捨てて年のみ表示する（ja）", () => {
    const view: RtaCareerView = { totalMonths: 74, years: 6, months: 2, start: "2020/6" };
    expect(rtaCareerLabel(tJa, view)).toBe("RTA歴 6年（2020/6〜）");
  });

  it("1年未満・1ヶ月は単数キー（en は month）", () => {
    const view: RtaCareerView = { totalMonths: 1, years: 0, months: 1, start: "2026/7" };
    expect(rtaCareerLabel(tEn, view)).toBe("Speedrunning for 1 month (since 2026/7)");
  });

  it("1年未満・3ヶ月は複数キー（en は months）", () => {
    const view: RtaCareerView = { totalMonths: 3, years: 0, months: 3, start: "2026/5" };
    expect(rtaCareerLabel(tEn, view)).toBe("Speedrunning for 3 months (since 2026/5)");
  });

  it("1年未満・3ヶ月（ja）", () => {
    const view: RtaCareerView = { totalMonths: 3, years: 0, months: 3, start: "2026/5" };
    expect(rtaCareerLabel(tJa, view)).toBe("RTA歴 3か月（2026/5〜）");
  });
});

describe("rtaCareerExactLabel", () => {
  it("端数ありは「6年2か月（2020/6〜）」形式（ja）", () => {
    const view: RtaCareerView = { totalMonths: 74, years: 6, months: 2, start: "2020/6" };
    expect(rtaCareerExactLabel(tJa, view)).toBe("RTA歴 6年2か月（2020/6〜）");
  });

  it("端数ありは英語でも年+月を両方表示する（en）", () => {
    const view: RtaCareerView = { totalMonths: 74, years: 6, months: 2, start: "Jun 2020" };
    expect(rtaCareerExactLabel(tEn, view)).toBe(
      "Speedrunning for 6 years 2 months (since Jun 2020)",
    );
  });

  it("1年Xか月は年が単数になる（en: 1 year）", () => {
    const view: RtaCareerView = { totalMonths: 14, years: 1, months: 2, start: "Jun 2025" };
    expect(rtaCareerExactLabel(tEn, view)).toBe(
      "Speedrunning for 1 year 2 months (since Jun 2025)",
    );
    expect(rtaCareerExactLabel(tJa, { ...view, start: "2025/6" })).toBe(
      "RTA歴 1年2か月（2025/6〜）",
    );
  });

  it("X年1か月は月が単数になる（en: 1 month）", () => {
    const view: RtaCareerView = { totalMonths: 73, years: 6, months: 1, start: "Jul 2020" };
    expect(rtaCareerExactLabel(tEn, view)).toBe(
      "Speedrunning for 6 years 1 month (since Jul 2020)",
    );
  });

  it("端数なし（6年0ヶ月）は通常表記にフォールバックする", () => {
    const view: RtaCareerView = { totalMonths: 72, years: 6, months: 0, start: "2020/8" };
    expect(rtaCareerExactLabel(tJa, view)).toBe(rtaCareerLabel(tJa, view));
    expect(rtaCareerExactLabel(tJa, view)).toBe("RTA歴 6年（2020/8〜）");
  });

  it("端数なし（1年未満）は通常表記にフォールバックする", () => {
    const view: RtaCareerView = { totalMonths: 3, years: 0, months: 3, start: "2026/5" };
    expect(rtaCareerExactLabel(tEn, view)).toBe(rtaCareerLabel(tEn, view));
    expect(rtaCareerExactLabel(tEn, view)).toBe("Speedrunning for 3 months (since 2026/5)");
  });
});
