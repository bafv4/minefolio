import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./schema";

// Turso/libSQL環境用: データベースクライアントを作成
export function createDb(url?: string, authToken?: string) {
  const client = createClient({
    url: url || process.env.TURSO_DATABASE_URL || "file:local.db",
    authToken: authToken || process.env.TURSO_AUTH_TOKEN,
  });
  return drizzle(client, { schema });
}

// 型エクスポート
export type Database = ReturnType<typeof createDb>;

// スキーマの再エクスポート
export { schema };
