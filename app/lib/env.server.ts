import type { Env } from "../env";
import { isLocalDbUrl } from "./db-url";

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
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    FEEDBACK_EMAIL: process.env.FEEDBACK_EMAIL,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    VERCEL_WEBHOOK_SECRET: process.env.VERCEL_WEBHOOK_SECRET,
    DISCORD_RELEASE_WEBHOOK_URL: process.env.DISCORD_RELEASE_WEBHOOK_URL,
    VERCEL_API_TOKEN: process.env.VERCEL_API_TOKEN,
    VERCEL_PROJECT_ID: process.env.VERCEL_PROJECT_ID,
    VERCEL_TEAM_ID: process.env.VERCEL_TEAM_ID,
    DEV_AUTH: process.env.DEV_AUTH,
    FEATURE_PROFILE_REACTIONS: process.env.FEATURE_PROFILE_REACTIONS,
  };
}

/**
 * ローカル開発専用の簡易ログイン（/dev/login）が有効かどうか。
 * 本番混入を防ぐため二重ゲート: NODE_ENV が production では DEV_AUTH の値に関わらず常に無効。
 * さらに、接続先がリモート DB（libsql:// 等）の場合も無効（.env の書き換えにより
 * 開発用ログインが誤ってリモート DB へユーザーを作成する事故の防止。
 * URL 未設定時は createDb() が file:local.db にフォールバックするためローカル扱い）。
 */
export function isDevAuthEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.DEV_AUTH === "1" &&
    isLocalDbUrl(process.env.TURSO_DATABASE_URL ?? "file:local.db")
  );
}

/**
 * プロフィール絵文字リアクション機能が有効かどうか（docs/profile-reactions.md）。
 *
 * isDevAuthEnabled() とは異なり **NODE_ENV ガードを持たない**。Vercel Preview / Dev環境の
 * デプロイは NODE_ENV=production のため、NODE_ENV ゲートを付けると Dev環境だけを先行有効化する
 * という要件（本番は環境変数未設定のまま、Devだけ FEATURE_PROFILE_REACTIONS=1 を設定する）を
 * 満たせない。ローカルDB限定でもない（isLocalDbUrl 相当のガードもなし）。
 *
 * 安全性は「フラグ未設定＝OFF」がすべての呼び出し元（profile loader・APIルート）で
 * profile_reactions テーブルを一切参照しない設計で担保する（テーブル未作成の本番DBに
 * デプロイしても壊れない）。
 */
export function isProfileReactionsEnabled(): boolean {
  return process.env.FEATURE_PROFILE_REACTIONS === "1";
}
