import { describe, it, expect } from "vitest";
import { formatTime, parseTimeToMs } from "../time-utils";

describe("formatTime", () => {
  it("ミリ秒を M:SS.mmm 形式にフォーマットする", () => {
    expect(formatTime(0)).toBe("0:00.000");
    expect(formatTime(585000)).toBe("9:45.000");
    expect(formatTime(448618)).toBe("7:28.618");
    expect(formatTime(3600000)).toBe("60:00.000");
  });

  it("数値文字列は数値として扱う（DBドライバ経由で文字列化された正常値の許容）", () => {
    expect(formatTime("585000" as unknown as number)).toBe("9:45.000");
  });

  it("数値化できない値は NaN:NaN.NaN ではなく - を返す", () => {
    // integer 列に "9:45" のような文字列が入った型崩れデータを想定
    expect(formatTime("9:45" as unknown as number)).toBe("-");
    expect(formatTime(NaN)).toBe("-");
    expect(formatTime(Infinity)).toBe("-");
    expect(formatTime(undefined as unknown as number)).toBe("-");
  });
});

describe("parseTimeToMs", () => {
  it("M:SS.mmm / SS.mmm 形式をミリ秒に変換する", () => {
    expect(parseTimeToMs("9:45.000")).toBe(585000);
    expect(parseTimeToMs("7:28.618")).toBe(448618);
    expect(parseTimeToMs("59.999")).toBe(59999);
  });

  it("形式が不正なら null を返す", () => {
    expect(parseTimeToMs("9:45")).toBeNull();
    expect(parseTimeToMs("abc")).toBeNull();
    expect(parseTimeToMs("")).toBeNull();
  });
});
