// drizzle-kit のローカル用設定（db:push / db:generate / db:studio）。
// 接続先の分離運用: .env は常にローカル（file:local.db）固定。リモート DB へ適用する場合は
// .env を書き換えるのではなく drizzle.remote.config.ts（pnpm db:push:remote）を使う。
// 読み込みとガード（.env にリモート URL が入っていたら中断）は scripts/lib/db-env.ts に集約。
import type { Config } from "drizzle-kit";
import { loadDbEnv } from "./scripts/lib/db-env";

const { url } = loadDbEnv({ remote: false, fallbackLocal: true });

export default {
  schema: "./app/lib/schema.ts",
  out: "./drizzle",
  dialect: "turso",
  dbCredentials: {
    url,
  },
} satisfies Config;
