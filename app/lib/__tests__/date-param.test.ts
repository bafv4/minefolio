import { describe, expect, it } from "vitest";
import { normalizeDateParam } from "../date-param";

describe("normalizeDateParam", () => {
  it("実在する日付はそのまま返す", () => {
    expect(normalizeDateParam("2026-11-21")).toBe("2026-11-21");
    expect(normalizeDateParam("2024-02-29")).toBe("2024-02-29");
  });

  it("存在しない日付は捨てる", () => {
    expect(normalizeDateParam("2026-02-31")).toBeUndefined();
    expect(normalizeDateParam("2025-02-29")).toBeUndefined();
    expect(normalizeDateParam("2026-13-01")).toBeUndefined();
    expect(normalizeDateParam("2026-00-10")).toBeUndefined();
    expect(normalizeDateParam("2026-04-31")).toBeUndefined();
  });

  it("形式が違う・空は捨てる", () => {
    expect(normalizeDateParam(null)).toBeUndefined();
    expect(normalizeDateParam("")).toBeUndefined();
    expect(normalizeDateParam("2026-1-1")).toBeUndefined();
    expect(normalizeDateParam("abc")).toBeUndefined();
  });
});
