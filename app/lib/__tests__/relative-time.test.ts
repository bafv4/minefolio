// 相対時刻表示（日単位・時間単位・分単位）。全ページ級の呼び出し面を持ち、
// 境界のオフバイワンがサイレント誤表示になるため fake timers で固定時刻に対して検証する。
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { createTranslator } from "../messages";
import {
  formatRelativeDate,
  formatRelativeTimeInHours,
  formatRelativeTimeInMinutes,
} from "../relative-time";

const t = createTranslator("ja");

// 基準時刻（"今"）。時刻部分を固定してから、そこから遡った Date を作って各関数へ渡す。
const NOW = new Date("2024-06-15T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/** NOW から指定ミリ秒だけ遡った Date を返す */
function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("formatRelativeDate（日単位）", () => {
  it("0日前は「今日」", () => {
    expect(formatRelativeDate(t, ago(0))).toBe("今日");
  });

  it("1日前は「昨日」", () => {
    expect(formatRelativeDate(t, ago(1 * DAY_MS))).toBe("昨日");
  });

  it("6日前は「6日前」、7日前は「1週間前」（週表記への切り替わり境界）", () => {
    expect(formatRelativeDate(t, ago(6 * DAY_MS))).toBe("6日前");
    expect(formatRelativeDate(t, ago(7 * DAY_MS))).toBe("1週間前");
  });

  it("29日前は「4週間前」、30日前は「1ヶ月前」（月表記への切り替わり境界）", () => {
    expect(formatRelativeDate(t, ago(29 * DAY_MS))).toBe("4週間前");
    expect(formatRelativeDate(t, ago(30 * DAY_MS))).toBe("1ヶ月前");
  });

  it("364日前は「12ヶ月前」、365日前は「1年前」（年表記への切り替わり境界）", () => {
    expect(formatRelativeDate(t, ago(364 * DAY_MS))).toBe("12ヶ月前");
    expect(formatRelativeDate(t, ago(365 * DAY_MS))).toBe("1年前");
  });

  it("未来日時（負の差分）でも例外にならず現行挙動（負のdaysAgo表記）のまま", () => {
    // 現在の実装は diffDays===0/1 判定のあと即 diffDays<7 に落ちるため、
    // 未来日時は負の日数がそのまま daysAgo に埋め込まれる。
    const future = new Date(NOW.getTime() + 5 * DAY_MS);
    expect(formatRelativeDate(t, future)).toBe("-5日前");
  });
});

describe("formatRelativeTimeInHours（時間単位）", () => {
  it("59分前は「1時間以内」", () => {
    expect(formatRelativeTimeInHours(t, ago(59 * MINUTE_MS))).toBe("1時間以内");
  });

  it("60分前（1時間ちょうど）は「1時間前」", () => {
    expect(formatRelativeTimeInHours(t, ago(60 * MINUTE_MS))).toBe("1時間前");
  });

  it("23時間前は「23時間前」、24時間前は「1日前」（日表記への切り替わり境界）", () => {
    expect(formatRelativeTimeInHours(t, ago(23 * HOUR_MS))).toBe("23時間前");
    expect(formatRelativeTimeInHours(t, ago(24 * HOUR_MS))).toBe("1日前");
  });

  it("文字列日時も Date と同様に扱える", () => {
    expect(formatRelativeTimeInHours(t, ago(23 * HOUR_MS).toISOString())).toBe("23時間前");
  });
});

describe("formatRelativeTimeInMinutes（分単位）", () => {
  it("0分〜1分未満は「たった今」", () => {
    expect(formatRelativeTimeInMinutes(t, ago(0))).toBe("たった今");
    expect(formatRelativeTimeInMinutes(t, ago(30 * 1000))).toBe("たった今"); // 30秒前
  });

  it("59分前は「59分前」、60分前（1時間ちょうど）は「1時間前」", () => {
    expect(formatRelativeTimeInMinutes(t, ago(59 * MINUTE_MS))).toBe("59分前");
    expect(formatRelativeTimeInMinutes(t, ago(60 * MINUTE_MS))).toBe("1時間前");
  });

  it("23時間59分前は時間表記、24時間前は日表記に切り替わる", () => {
    expect(formatRelativeTimeInMinutes(t, ago(23 * HOUR_MS + 59 * MINUTE_MS))).toBe("23時間前");
    expect(formatRelativeTimeInMinutes(t, ago(24 * HOUR_MS))).toBe("1日前");
  });

  it("文字列日時も Date と同様に扱える", () => {
    expect(formatRelativeTimeInMinutes(t, ago(59 * MINUTE_MS).toISOString())).toBe("59分前");
  });
});
