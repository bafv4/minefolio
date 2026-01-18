// 環境変数検証 ユニットテスト
import { describe, it, expect } from "vitest";
import { validateEnv } from "./env";

describe("Environment validation", () => {
  const validEnv = {
    DISCORD_CLIENT_ID: "test_client_id",
    DISCORD_CLIENT_SECRET: "test_client_secret",
    BETTER_AUTH_SECRET: "a".repeat(32), // 32文字以上
    TWITCH_CLIENT_ID: "test_twitch_id",
    TWITCH_CLIENT_SECRET: "test_twitch_secret",
    YOUTUBE_API_KEY: "test_youtube_key",
  };

  it("should validate correct environment variables", () => {
    const result = validateEnv(validEnv);

    expect(result.DISCORD_CLIENT_ID).toBe("test_client_id");
    expect(result.TWITCH_CLIENT_ID).toBe("test_twitch_id");
  });

  it("should accept optional fields", () => {
    const envWithOptional = {
      ...validEnv,
      BETTER_AUTH_URL: "https://example.com",
      DB: {},
    };

    const result = validateEnv(envWithOptional);

    expect(result.BETTER_AUTH_URL).toBe("https://example.com");
  });

  it("should throw error for missing required fields", () => {
    const invalidEnv = {
      ...validEnv,
      DISCORD_CLIENT_ID: undefined,
    };

    expect(() => validateEnv(invalidEnv)).toThrow("Environment variable validation failed");
  });

  it("should throw error for BETTER_AUTH_SECRET too short", () => {
    const invalidEnv = {
      ...validEnv,
      BETTER_AUTH_SECRET: "short", // 32文字未満
    };

    expect(() => validateEnv(invalidEnv)).toThrow("at least 32 characters");
  });

  it("should throw error for invalid URL format", () => {
    const invalidEnv = {
      ...validEnv,
      BETTER_AUTH_URL: "not-a-url",
    };

    expect(() => validateEnv(invalidEnv)).toThrow();
  });

  it("should provide detailed error messages", () => {
    const invalidEnv = {
      DISCORD_CLIENT_ID: "",
      DISCORD_CLIENT_SECRET: "",
      BETTER_AUTH_SECRET: "short",
      TWITCH_CLIENT_ID: "",
      TWITCH_CLIENT_SECRET: "",
      YOUTUBE_API_KEY: "",
    };

    try {
      validateEnv(invalidEnv);
      expect.fail("Should have thrown an error");
    } catch (error) {
      if (error instanceof Error) {
        expect(error.message).toContain("Environment variable validation failed");
        expect(error.message).toContain("DISCORD_CLIENT_ID");
      }
    }
  });
});
