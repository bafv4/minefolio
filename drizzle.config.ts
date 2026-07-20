// drizzle-kit のローカル用設定（db:push / db:generate / db:studio）。
// .env は常にローカル（file:local.db）固定の運用。リモート DB へ適用する場合は
// .env を書き換えるのではなく、.env.remote を読み込む drizzle.remote.config.ts を使う
// （pnpm db:push:remote）。誤って .env にリモート URL を書いた場合はここで中断する。
import { config } from "dotenv";
import type { Config } from "drizzle-kit";

config({ path: ".env", quiet: true });

const url = process.env.TURSO_DATABASE_URL || "file:local.db";
if (!url.startsWith("file:")) {
  throw new Error(
    ".env の TURSO_DATABASE_URL がリモートを指しています。.env は file:local.db 固定とし、リモートへの適用は pnpm db:push:remote（.env.remote を読み込む）を使ってください。",
  );
}

export default {
  schema: "./app/lib/schema.ts",
  out: "./drizzle",
  dialect: "turso",
  dbCredentials: {
    url,
  },
} satisfies Config;
