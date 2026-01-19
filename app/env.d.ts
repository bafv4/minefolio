/**
 * アプリケーション環境変数の型定義
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
}

/**
 * React Router コンテキストの型定義
 */
declare module "react-router" {
  interface AppLoadContext {
    env: Env;
  }
}
