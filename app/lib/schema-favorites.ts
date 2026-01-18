// お気に入りプレイヤーのスキーマ拡張
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { createId } from "@paralleldrive/cuid2";
import { users } from "./schema";

/**
 * お気に入りプレイヤー
 * 認証済みユーザーが他のプレイヤーをお気に入りに追加できる
 */
export const favorites = sqliteTable(
  "favorites",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // お気に入りに追加されたプレイヤーのMCID
    favoriteMcid: text("favorite_mcid").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    // ユーザーごとのお気に入り一覧を高速に取得
    index("idx_favorites_user_id").on(table.userId),
    // 同じプレイヤーを重複して追加できないようにユニーク制約
    index("idx_favorites_user_mcid").on(table.userId, table.favoriteMcid),
  ]
);
