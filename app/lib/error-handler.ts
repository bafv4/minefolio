// 統一されたエラーハンドリング
import { MojangError } from "./mojang";

/**
 * APIエラーのタイプ
 */
export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "INTERNAL_ERROR"
  | "EXTERNAL_API_ERROR"
  | "RATE_LIMIT_ERROR";

/**
 * 統一されたエラーレスポンス形式
 */
export interface ApiErrorResponse {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
}

/**
 * カスタムAPIエラークラス
 */
export class ApiError extends Error {
  constructor(
    public code: ApiErrorCode,
    message: string,
    public details?: Record<string, unknown>,
    public statusCode: number = 500
  ) {
    super(message);
    this.name = "ApiError";
  }

  toJSON(): ApiErrorResponse {
    return {
      error: {
        code: this.code,
        message: this.message,
        details: this.details,
      },
    };
  }

  toResponse(): Response {
    return Response.json(this.toJSON(), {
      status: this.statusCode,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }
}

/**
 * バリデーションエラーを作成
 */
export function createValidationError(
  message: string,
  details?: Record<string, unknown>
): ApiError {
  return new ApiError("VALIDATION_ERROR", message, details, 400);
}

/**
 * Not Foundエラーを作成
 */
export function createNotFoundError(
  resource: string,
  identifier?: string
): ApiError {
  const message = identifier
    ? `${resource} not found: ${identifier}`
    : `${resource} not found`;

  return new ApiError("NOT_FOUND", message, undefined, 404);
}

/**
 * 認証エラーを作成
 */
export function createUnauthorizedError(message: string = "Unauthorized"): ApiError {
  return new ApiError("UNAUTHORIZED", message, undefined, 401);
}

/**
 * 権限エラーを作成
 */
export function createForbiddenError(message: string = "Forbidden"): ApiError {
  return new ApiError("FORBIDDEN", message, undefined, 403);
}

/**
 * 外部APIエラーを作成
 */
export function createExternalApiError(
  apiName: string,
  originalError?: Error
): ApiError {
  return new ApiError(
    "EXTERNAL_API_ERROR",
    `External API error: ${apiName}`,
    { originalError: originalError?.message },
    502
  );
}

/**
 * レート制限エラーを作成
 */
export function createRateLimitError(
  retryAfter?: number
): ApiError {
  return new ApiError(
    "RATE_LIMIT_ERROR",
    "Rate limit exceeded",
    { retryAfter },
    429
  );
}

/**
 * エラーをAPIエラーに変換
 * 既知のエラータイプを適切なAPIエラーに変換する
 */
export function toApiError(error: unknown): ApiError {
  // 既にApiErrorの場合はそのまま返す
  if (error instanceof ApiError) {
    return error;
  }

  // MojangErrorの場合
  if (error instanceof MojangError) {
    switch (error.code) {
      case "MCID_NOT_FOUND":
        return createNotFoundError("Minecraft ID", error.message);
      case "UUID_NOT_FOUND":
        return createNotFoundError("UUID", error.message);
      case "API_ERROR":
        return createExternalApiError("Mojang API", error);
    }
  }

  // 一般的なErrorの場合
  if (error instanceof Error) {
    return new ApiError("INTERNAL_ERROR", error.message, undefined, 500);
  }

  // その他の場合
  return new ApiError(
    "INTERNAL_ERROR",
    "An unexpected error occurred",
    undefined,
    500
  );
}

/**
 * エラーハンドリングミドルウェア
 * ルートハンドラーをラップしてエラーを統一されたレスポンスに変換
 */
export function withErrorHandler<T extends (...args: any[]) => Promise<Response>>(
  handler: T
): T {
  return (async (...args: any[]) => {
    try {
      return await handler(...args);
    } catch (error) {
      const apiError = toApiError(error);

      // 本番環境ではコンソールにエラーをログ
      if (process.env.NODE_ENV === "production") {
        console.error("API Error:", {
          code: apiError.code,
          message: apiError.message,
          details: apiError.details,
        });
      } else {
        // 開発環境ではスタックトレースも表示
        console.error("API Error:", error);
      }

      return apiError.toResponse();
    }
  }) as T;
}
