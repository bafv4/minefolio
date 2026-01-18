// Mojang API ユニットテスト
import { describe, it, expect } from "vitest";
import { formatUuid } from "./mojang";

describe("Mojang API utilities", () => {
  describe("formatUuid", () => {
    it("should format UUID without hyphens to hyphenated format", () => {
      const input = "069a79f444e94726a5befca90e38aaf5";
      const expected = "069a79f4-44e9-4726-a5be-fca90e38aaf5";
      expect(formatUuid(input)).toBe(expected);
    });

    it("should handle already hyphenated UUID", () => {
      const input = "069a79f4-44e9-4726-a5be-fca90e38aaf5";
      const expected = "069a79f4-44e9-4726-a5be-fca90e38aaf5";
      expect(formatUuid(input)).toBe(expected);
    });

    it("should handle mixed case UUIDs", () => {
      const input = "069A79F444E94726A5BEFCA90E38AAF5";
      const expected = "069A79F4-44E9-4726-A5BE-FCA90E38AAF5";
      expect(formatUuid(input)).toBe(expected);
    });
  });
});
