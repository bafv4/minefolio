import type { Env } from "../env";

/**
 * サーバーサイドで環境変数を取得するヘルパー関数
 * Vercelではprocess.envから直接取得
 */
export function getEnv(): Env {
  return {
    TURSO_DATABASE_URL: process.env.TURSO_DATABASE_URL!,
    TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN,
    DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID!,
    DISCORD_CLIENT_SECRET: process.env.DISCORD_CLIENT_SECRET!,
    APP_URL: process.env.APP_URL!,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET!,
    LEGACY_API_URL: process.env.LEGACY_API_URL,
    TWITCH_CLIENT_ID: process.env.TWITCH_CLIENT_ID,
    TWITCH_CLIENT_SECRET: process.env.TWITCH_CLIENT_SECRET,
    YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY,
  };
}
