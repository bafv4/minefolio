// drizzle-kit のリモート用設定。.env ではなく .env.remote（gitignore 済み）から
// リモート Turso の接続情報を読み込む。使い方: pnpm db:push:remote
//
// .env を一時的にリモート URL へ書き換える運用は、同時に動いている dev サーバー等が
// 巻き添えでリモート DB に接続してしまう事故のもとなので行わない（この設定ファイルが
// その代替）。push は対話プロンプトの内容（特に TRUNCATE 提案の有無）を必ず確認すること。
// 読み込みとガード（.env.remote 必須・リモート URL 検証）は scripts/lib/db-env.ts に集約。
import type { Config } from "drizzle-kit";
import { loadDbEnv } from "./scripts/lib/db-env";

const { url, authToken } = loadDbEnv({ remote: true });

export default {
  schema: "./app/lib/schema.ts",
  out: "./drizzle",
  dialect: "turso",
  dbCredentials: {
    url,
    authToken,
  },
} satisfies Config;
