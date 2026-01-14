import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

// Cloudflare Workers環境用: D1インスタンスからDBを作成
export function createDb(d1: D1Database) {
  return drizzle(d1, { schema });
}

// 型エクスポート
export type Database = ReturnType<typeof createDb>;

// スキーマの再エクスポート
export { schema };
