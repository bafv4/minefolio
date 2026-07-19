import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { Database } from "./db";
import * as schema from "./schema";
import { isDevAuthEnabled } from "./env.server";

// Cloudflare Workers環境用: 環境変数からauth設定を作成
export function createAuth(db: Database, env: {
  DISCORD_CLIENT_ID: string;
  DISCORD_CLIENT_SECRET: string;
  APP_URL: string;
  BETTER_AUTH_SECRET: string;
}) {
  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: {
        user: schema.authUsers,
        session: schema.authSessions,
        account: schema.authAccounts,
        verification: schema.authVerifications,
      },
    }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.APP_URL,
    // ローカル開発では Discord OAuth 未設定でも起動できるようにする
    socialProviders:
      env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET
        ? {
            discord: {
              clientId: env.DISCORD_CLIENT_ID,
              clientSecret: env.DISCORD_CLIENT_SECRET,
              scope: ["identify", "email"],
              // サインインのたびに Discord プロフィール（アイコン等）を取り込み直す。
              // 既定では作成時のみ取得するため、アイコン変更が反映されない問題を解消。
              overrideUserInfoOnSignIn: true,
            },
          }
        : {},
    // ローカル開発専用の簡易ログイン（/dev/login）。本番では isDevAuthEnabled() が常に false
    emailAndPassword: {
      enabled: isDevAuthEnabled(),
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7日間
      updateAge: 60 * 60 * 24, // 1日ごとに更新
    },
    advanced: {
      cookiePrefix: "minefolio",
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type Session = Auth["$Infer"]["Session"];
