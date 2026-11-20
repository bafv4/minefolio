import { describe, expect, it } from "vitest";
import type { Translator } from "@/lib/messages";
import { formatStreamDuration } from "../home-format";

// 文言ではなく「どのキーにどの値が渡るか」を検証するため、キーとパラメータをそのまま返す
const t = ((key: string, params?: Record<string, unknown>) =>
  `${key}:${JSON.stringify(params)}`) as unknown as Translator;

const MIN = 60_000;

describe("formatStreamDuration", () => {
  it("0分は分表記", () => {
    expect(formatStreamDuration(t, 0)).toBe('home.twitchDurationMinutes:{"minutes":0}');
  });

  it("59分は分表記、60分から時間表記に切り替わる", () => {
    expect(formatStreamDuration(t, 59 * MIN)).toBe('home.twitchDurationMinutes:{"minutes":59}');
    expect(formatStreamDuration(t, 60 * MIN)).toBe('home.twitchDurationHours:{"hours":1,"minutes":0}');
  });

  it("秒は切り捨てる", () => {
    expect(formatStreamDuration(t, 59 * MIN + 59_999)).toBe('home.twitchDurationMinutes:{"minutes":59}');
  });

  it("時と分に分解する", () => {
    expect(formatStreamDuration(t, 135 * MIN)).toBe('home.twitchDurationHours:{"hours":2,"minutes":15}');
  });
});
