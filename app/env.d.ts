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
  // 利用者コンテンツの自動翻訳（docs/translation.md）。未設定なら機能ごと無効
  ANTHROPIC_API_KEY?: string;
  // Feedback
  FEEDBACK_EMAIL?: string;
  RESEND_API_KEY?: string;
  // Release notification (Vercel Webhook → Discord)
  VERCEL_WEBHOOK_SECRET?: string;
  DISCORD_RELEASE_WEBHOOK_URL?: string;
  // Vercel Web Analytics（人気ページ集計）。未設定なら同期ごと無効
  VERCEL_API_TOKEN?: string;
  VERCEL_PROJECT_ID?: string;
  /** チームのプロジェクトのみ必要（個人アカウントでは未設定にする） */
  VERCEL_TEAM_ID?: string;
  // ローカル開発専用: "1" で /dev/login の簡易ログインを有効化（本番では NODE_ENV ガードにより常に無効）
  DEV_AUTH?: string;
}

