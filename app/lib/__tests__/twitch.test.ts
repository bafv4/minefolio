import { describe, it, expect } from "vitest";
import { parseTwitchDuration } from "../twitch";

// Twitch /videos の duration 文字列（"3h12m5s" 形式）→ 秒変換の回帰テスト
describe("parseTwitchDuration", () => {
  it("時分秒の複合形式をパースする", () => {
    expect(parseTwitchDuration("3h12m5s")).toBe(3 * 3600 + 12 * 60 + 5);
    expect(parseTwitchDuration("1h0m0s")).toBe(3600);
  });

  it("部分的な形式（分のみ・秒のみ・時分など）をパースする", () => {
    expect(parseTwitchDuration("45m")).toBe(45 * 60);
    expect(parseTwitchDuration("58s")).toBe(58);
    expect(parseTwitchDuration("2h30m")).toBe(2 * 3600 + 30 * 60);
    expect(parseTwitchDuration("5m30s")).toBe(5 * 60 + 30);
  });

  it("不正な形式は null を返す", () => {
    expect(parseTwitchDuration("")).toBeNull();
    expect(parseTwitchDuration("abc")).toBeNull();
    expect(parseTwitchDuration("12")).toBeNull();
    expect(parseTwitchDuration("1s2h")).toBeNull();
  });
});
