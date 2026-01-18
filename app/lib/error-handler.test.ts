// エラーハンドラー ユニットテスト
import { describe, it, expect } from "vitest";
import {
  ApiError,
  createValidationError,
  createNotFoundError,
  createUnauthorizedError,
  createForbiddenError,
  createExternalApiError,
  createRateLimitError,
  toApiError,
} from "./error-handler";
import { MojangError } from "./mojang";

describe("Error Handler", () => {
  describe("ApiError", () => {
    it("should create ApiError with correct properties", () => {
      const error = new ApiError(
        "VALIDATION_ERROR",
        "Invalid input",
        { field: "email" },
        400
      );

      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.message).toBe("Invalid input");
      expect(error.details).toEqual({ field: "email" });
      expect(error.statusCode).toBe(400);
    });

    it("should convert to JSON response format", () => {
      const error = new ApiError("NOT_FOUND", "User not found");
      const json = error.toJSON();

      expect(json).toEqual({
        error: {
          code: "NOT_FOUND",
          message: "User not found",
          details: undefined,
        },
      });
    });

    it("should create Response object with correct status", () => {
      const error = new ApiError("UNAUTHORIZED", "Not logged in", undefined, 401);
      const response = error.toResponse();

      expect(response.status).toBe(401);
      expect(response.headers.get("Content-Type")).toBe("application/json");
    });
  });

  describe("Error factory functions", () => {
    it("should create validation error", () => {
      const error = createValidationError("Invalid email", { field: "email" });

      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.statusCode).toBe(400);
      expect(error.details).toEqual({ field: "email" });
    });

    it("should create not found error", () => {
      const error = createNotFoundError("User", "123");

      expect(error.code).toBe("NOT_FOUND");
      expect(error.message).toBe("User not found: 123");
      expect(error.statusCode).toBe(404);
    });

    it("should create unauthorized error", () => {
      const error = createUnauthorizedError();

      expect(error.code).toBe("UNAUTHORIZED");
      expect(error.statusCode).toBe(401);
    });

    it("should create forbidden error", () => {
      const error = createForbiddenError();

      expect(error.code).toBe("FORBIDDEN");
      expect(error.statusCode).toBe(403);
    });

    it("should create external API error", () => {
      const error = createExternalApiError("Mojang API");

      expect(error.code).toBe("EXTERNAL_API_ERROR");
      expect(error.statusCode).toBe(502);
      expect(error.message).toContain("Mojang API");
    });

    it("should create rate limit error", () => {
      const error = createRateLimitError(60);

      expect(error.code).toBe("RATE_LIMIT_ERROR");
      expect(error.statusCode).toBe(429);
      expect(error.details?.retryAfter).toBe(60);
    });
  });

  describe("toApiError", () => {
    it("should return ApiError as-is", () => {
      const apiError = new ApiError("VALIDATION_ERROR", "Test");
      const result = toApiError(apiError);

      expect(result).toBe(apiError);
    });

    it("should convert MojangError to ApiError", () => {
      const mojangError = new MojangError("MCID_NOT_FOUND", "Player not found");
      const result = toApiError(mojangError);

      expect(result).toBeInstanceOf(ApiError);
      expect(result.code).toBe("NOT_FOUND");
    });

    it("should convert generic Error to ApiError", () => {
      const genericError = new Error("Something went wrong");
      const result = toApiError(genericError);

      expect(result).toBeInstanceOf(ApiError);
      expect(result.code).toBe("INTERNAL_ERROR");
      expect(result.message).toBe("Something went wrong");
    });

    it("should handle unknown error types", () => {
      const unknownError = "string error";
      const result = toApiError(unknownError);

      expect(result).toBeInstanceOf(ApiError);
      expect(result.code).toBe("INTERNAL_ERROR");
      expect(result.message).toBe("An unexpected error occurred");
    });
  });
});
