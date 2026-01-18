// 環境変数のバリデーション
import { z } from "zod";

// 環境変数のスキーマ定義
const envSchema = z.object({
  // Discord OAuth
  DISCORD_CLIENT_ID: z.string().min(1, "DISCORD_CLIENT_ID is required"),
  DISCORD_CLIENT_SECRET: z.string().min(1, "DISCORD_CLIENT_SECRET is required"),

  // Better Auth
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  BETTER_AUTH_URL: z.string().url().optional(),

  // Twitch API
  TWITCH_CLIENT_ID: z.string().min(1, "TWITCH_CLIENT_ID is required"),
  TWITCH_CLIENT_SECRET: z.string().min(1, "TWITCH_CLIENT_SECRET is required"),

  // YouTube API
  YOUTUBE_API_KEY: z.string().min(1, "YOUTUBE_API_KEY is required"),

  // Cloudflare D1 Database (Cloudflare環境でのみ必要)
  DB: z.any().optional(),
});

export type Env = z.infer<typeof envSchema>;

/**
 * 環境変数を検証して返す
 * 検証に失敗した場合はエラーをスローする
 */
export function validateEnv(env: Record<string, unknown>): Env {
  try {
    return envSchema.parse(env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues
        .map((issue) => `- ${issue.path.join(".")}: ${issue.message}`)
        .join("\n");

      throw new Error(
        `Environment variable validation failed:\n${issues}\n\n` +
        `Please check your .dev.vars file (for local development) or ` +
        `Cloudflare Dashboard environment variables (for production).`
      );
    }
    throw error;
  }
}

/**
 * 環境変数を安全に取得する
 * 開発環境ではより詳細なエラーメッセージを表示
 */
export function getEnv(context: { env?: Record<string, unknown> }): Env {
  if (!context.env) {
    throw new Error(
      "Environment variables are not available. " +
      "Make sure you're running in a proper execution context."
    );
  }

  return validateEnv(context.env);
}
