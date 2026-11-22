import { describe, it, expect } from "vitest";
import { formatTime, parseTimeToMs } from "../time-utils";

describe("formatTime", () => {
  it("ミリ秒を M:SS.mmm 形式にフォーマットする", () => {
    expect(formatTime(0)).toBe("0:00.000");
    expect(formatTime(585000)).toBe("9:45.000");
    expect(formatTime(448618)).toBe("7:28.618");
  });

  it("1時間未満は M:SS.mmm のまま（境界 59:59.999）", () => {
    expect(formatTime(3599999)).toBe("59:59.999");
  });

  it("1時間以上は H:MM:SS.mmm（境界 1:00:00.000・100分台・ミリ秒なし）", () => {
    expect(formatTime(3600000)).toBe("1:00:00.000");
    expect(formatTime(6028757)).toBe("1:40:28.757");
    expect(formatTime(7200000)).toBe("2:00:00.000");
    expect(formatTime(3661005)).toBe("1:01:01.005");
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

  it("H:MM:SS.mmm もパースでき、formatTime と往復できる", () => {
    expect(parseTimeToMs("1:40:28.757")).toBe(6028757);
    for (const ms of [3599999, 3600000, 6028757, 36000123]) {
      expect(parseTimeToMs(formatTime(ms))).toBe(ms);
    }
    // 従来の 100:28.757 形式も受け付ける
    expect(parseTimeToMs("100:28.757")).toBe(6028757);
  });

  it("形式が不正なら null を返す", () => {
    expect(parseTimeToMs("9:45")).toBeNull();
    expect(parseTimeToMs("abc")).toBeNull();
    expect(parseTimeToMs("")).toBeNull();
  });
});
