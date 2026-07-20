// drizzle-kit のリモート用設定。.env ではなく .env.remote（gitignore 済み）から
// リモート Turso の接続情報を読み込む。使い方: pnpm db:push:remote
//
// .env を一時的にリモート URL へ書き換える運用は、同時に動いている dev サーバー等が
// 巻き添えでリモート DB に接続してしまう事故のもとなので行わない（この設定ファイルが
// その代替）。push は対話プロンプトの内容（特に TRUNCATE 提案の有無）を必ず確認すること。
import { existsSync } from "node:fs";
import { config } from "dotenv";
import type { Config } from "drizzle-kit";

if (!existsSync(".env.remote")) {
  throw new Error(
    ".env.remote がありません。リモートの TURSO_DATABASE_URL / TURSO_AUTH_TOKEN を .env.remote に記載してください。",
  );
}

// override: 事前に .env 等から読み込まれた値より .env.remote を優先する
config({ path: ".env.remote", override: true, quiet: true });

const url = process.env.TURSO_DATABASE_URL;
if (!url || url.startsWith("file:")) {
  throw new Error(
    ".env.remote の TURSO_DATABASE_URL がリモート URL（libsql://...）ではありません。",
  );
}

console.warn(`⚠️  リモート DB に接続します: ${url}`);

export default {
  schema: "./app/lib/schema.ts",
  out: "./drizzle",
  dialect: "turso",
  dbCredentials: {
    url,
    authToken: process.env.TURSO_AUTH_TOKEN,
  },
} satisfies Config;
