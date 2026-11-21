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

  it("29日前は「4週間前」、30日前は「1か月前」（月表記への切り替わり境界）", () => {
    expect(formatRelativeDate(t, ago(29 * DAY_MS))).toBe("4週間前");
    expect(formatRelativeDate(t, ago(30 * DAY_MS))).toBe("1か月前");
  });

  it("364日前は「12か月前」、365日前は「1年前」（年表記への切り替わり境界）", () => {
    expect(formatRelativeDate(t, ago(364 * DAY_MS))).toBe("12か月前");
    expect(formatRelativeDate(t, ago(365 * DAY_MS))).toBe("1年前");
  });

  it("未来日時（負の差分）は「今日」にクランプされる", () => {
    // diffDays は Math.max(0, ...) でクランプされるため、未来日時は常に diffDays===0 扱いになる。
    const future = new Date(NOW.getTime() + 5 * DAY_MS);
    expect(formatRelativeDate(t, future)).toBe("今日");
  });
});

describe("暦日で数える（端末の日付変更を基準にする）", () => {
  it("日をまたいだ直近の出来事は、24時間未満でも formatRelativeDate では「昨日」", () => {
    vi.setSystemTime(new Date(2024, 5, 15, 0, 30)); // ローカル 00:30
    expect(formatRelativeDate(t, new Date(2024, 5, 14, 23, 50))).toBe("昨日");
    expect(formatRelativeDate(t, new Date(2024, 5, 15, 0, 5))).toBe("今日");
  });

  it("分・時間と日の表記は 24 時間で切り替わり、日以降は formatRelativeDate と一致する", () => {
    const at = ago(3 * DAY_MS + 5 * HOUR_MS);
    expect(formatRelativeTimeInMinutes(t, at)).toBe(formatRelativeDate(t, at));
    expect(formatRelativeTimeInHours(t, at)).toBe(formatRelativeDate(t, at));
  });

  it("en は短い形（Yesterday / 2d ago / 5mo ago）", () => {
    const en = createTranslator("en");
    expect(formatRelativeDate(en, ago(1 * DAY_MS))).toBe("Yesterday");
    expect(formatRelativeDate(en, ago(2 * DAY_MS))).toBe("2d ago");
    expect(formatRelativeDate(en, ago(150 * DAY_MS))).toBe("5mo ago");
  });
});

describe("formatRelativeTimeInHours（時間単位）", () => {
  it("59分前は「1時間以内」", () => {
    expect(formatRelativeTimeInHours(t, ago(59 * MINUTE_MS))).toBe("1時間以内");
  });

  it("60分前（1時間ちょうど）は「1時間前」", () => {
    expect(formatRelativeTimeInHours(t, ago(60 * MINUTE_MS))).toBe("1時間前");
  });

  it("23時間前は「23時間前」、24時間前は「昨日」（暦日表記への切り替わり境界）", () => {
    expect(formatRelativeTimeInHours(t, ago(23 * HOUR_MS))).toBe("23時間前");
    expect(formatRelativeTimeInHours(t, ago(24 * HOUR_MS))).toBe("昨日");
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
    expect(formatRelativeTimeInMinutes(t, ago(24 * HOUR_MS))).toBe("昨日");
  });

  it("文字列日時も Date と同様に扱える", () => {
    expect(formatRelativeTimeInMinutes(t, ago(59 * MINUTE_MS).toISOString())).toBe("59分前");
  });
});

describe("calendar: false（SSR・水和用の経過日数）", () => {
  it("タイムゾーンに依らず、経過 24 時間単位で数える", () => {
    expect(formatRelativeDate(t, ago(0), { calendar: false })).toBe("今日");
    expect(formatRelativeDate(t, ago(23 * HOUR_MS), { calendar: false })).toBe("今日");
    expect(formatRelativeDate(t, ago(24 * HOUR_MS), { calendar: false })).toBe("昨日");
    expect(formatRelativeDate(t, ago(3 * DAY_MS), { calendar: false })).toBe("3日前");
    expect(formatRelativeDate(t, ago(14 * DAY_MS), { calendar: false })).toBe("2週間前");
  });

  it("未来は今日にクランプされる", () => {
    expect(formatRelativeDate(t, new Date(NOW.getTime() + DAY_MS), { calendar: false })).toBe("今日");
  });

  it("時間・分単位にも引き継がれる（24時間未満は変わらず、以上は経過日数）", () => {
    expect(formatRelativeTimeInHours(t, ago(5 * HOUR_MS), { calendar: false })).toBe("5時間前");
    expect(formatRelativeTimeInHours(t, ago(48 * HOUR_MS), { calendar: false })).toBe("2日前");
    expect(formatRelativeTimeInMinutes(t, ago(48 * HOUR_MS), { calendar: false })).toBe("2日前");
  });
});
