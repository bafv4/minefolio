/// <reference types="@cloudflare/workers-types" />

/**
 * Cloudflare Workers環境変数の型定義
 */
export interface CloudflareEnv {
  DB: D1Database;
  DISCORD_CLIENT_ID: string;
  DISCORD_CLIENT_SECRET: string;
  APP_URL: string;
  BETTER_AUTH_SECRET: string;
  LEGACY_API_URL?: string;
}

/**
 * React Router Cloudflareコンテキストの型定義
 */
declare module "react-router" {
  interface AppLoadContext {
    cloudflare: {
      env: CloudflareEnv;
      ctx: ExecutionContext;
      cf: CfProperties;
    };
  }
}
