/**
 * アプリケーション環境変数の型定義。
 * サーバーでは app/lib/env.server.ts の getEnv() が process.env から組み立てて返す。
 */
export interface Env {
  TURSO_DATABASE_URL: string;
  TURSO_AUTH_TOKEN?: string;
  DISCORD_CLIENT_ID: string;
  DISCORD_CLIENT_SECRET: string;
  APP_URL: string;
  BETTER_AUTH_SECRET: string;
  LEGACY_API_URL?: string;
  // External APIs
  TWITCH_CLIENT_ID?: string;
  TWITCH_CLIENT_SECRET?: string;
  YOUTUBE_API_KEY?: string;
  // Feedback
  FEEDBACK_EMAIL?: string;
  RESEND_API_KEY?: string;
}

