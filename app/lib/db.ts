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

/** UNIQUE 制約違反かどうかをエラーメッセージ（cause チェーン含む）から判定する */
export function isUniqueConstraintError(e: unknown): boolean {
  let current: unknown = e;
  while (current instanceof Error) {
    if (
      current.message.includes("UNIQUE constraint failed") ||
      current.message.includes("SQLITE_CONSTRAINT")
    ) {
      return true;
    }
    current = current.cause;
  }
  return false;
}
