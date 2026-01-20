import { createId } from "@paralleldrive/cuid2";
import { sqliteTable, text, integer, real, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";

// ============================================
// 1. users（ユーザー）
// ============================================
export const users = sqliteTable("users", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  discordId: text("discord_id").unique().notNull(),

  // MCID/UUID（任意）- MCIDがない場合でも登録可能
  mcid: text("mcid").unique(),
  uuid: text("uuid").unique(),

  // URL用スラッグ（必須）- MCIDがある場合はMCID、ない場合は@{内部ID}形式
  slug: text("slug").unique().notNull(),

  displayName: text("display_name"),
  discordAvatar: text("discord_avatar"),
  bio: text("bio"),
  hasImported: integer("has_imported", { mode: "boolean" }).default(false).notNull(),

  // プロフィール設定
  profileVisibility: text("profile_visibility", { enum: ["public", "unlisted", "private"] }).default("public").notNull(),
  profilePose: text("profile_pose", { enum: ["standing", "walking", "waving"] }).default("waving"),
  location: text("location"),
  pronouns: text("pronouns"),
  defaultProfileTab: text("default_profile_tab", { enum: ["profile", "stats", "keybindings", "items", "searchcraft", "devices", "settings"] }).default("keybindings"),
  featuredVideoUrl: text("featured_video_url"),

  // プレイヤー情報
  mainEdition: text("main_edition", { enum: ["java", "bedrock"] }),
  mainPlatform: text("main_platform", { enum: ["pc_windows", "pc_mac", "pc_linux", "switch", "mobile", "other"] }),
  role: text("role", { enum: ["viewer", "runner"] }),
  shortBio: text("short_bio"),

  // Speedrun.com連携
  speedruncomUsername: text("speedruncom_username"),
  speedruncomId: text("speedruncom_id"),
  speedruncomLastSync: integer("speedruncom_last_sync", { mode: "timestamp" }),
  hiddenSpeedrunRecords: text("hidden_speedrun_records"), // JSON配列: 非表示にする記録のrun ID

  // 統計
  profileViews: integer("profile_views").default(0).notNull(),
  lastActive: integer("last_active", { mode: "timestamp" }),

  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
}, (table) => [
  index("idx_users_discord_id").on(table.discordId),
  index("idx_users_mcid").on(table.mcid),
  index("idx_users_uuid").on(table.uuid),
  index("idx_users_slug").on(table.slug),
  index("idx_users_speedruncom_id").on(table.speedruncomId),
]);

// ============================================
// 2. player_configs（プレイヤー設定）
// ============================================
export const playerConfigs = sqliteTable("player_configs", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  userId: text("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),

  // キーボード設定
  keyboardLayout: text("keyboard_layout", { enum: ["JIS", "US", "JIS_TKL", "US_TKL"] }),
  keyboardModel: text("keyboard_model"),

  // マウス設定
  mouseDpi: integer("mouse_dpi"),
  gameSensitivity: real("game_sensitivity"),
  windowsSpeed: integer("windows_speed"),
  windowsSpeedMultiplier: real("windows_speed_multiplier"), // 独自係数（小数）、設定時はwindowsSpeedより優先
  mouseAcceleration: integer("mouse_acceleration", { mode: "boolean" }).default(false),
  rawInput: integer("raw_input", { mode: "boolean" }).default(true),
  cm360: real("cm360"),
  mouseModel: text("mouse_model"),

  // ゲーム内設定
  toggleSprint: integer("toggle_sprint", { mode: "boolean" }),
  toggleSneak: integer("toggle_sneak", { mode: "boolean" }),
  autoJump: integer("auto_jump", { mode: "boolean" }),
  gameLanguage: text("game_language"),
  fov: integer("fov"),
  guiScale: integer("gui_scale"),

  // 指割り当て（JSON）
  fingerAssignments: text("finger_assignments"), // JSON.stringify/parse

  // その他
  notes: text("notes"),

  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

// ============================================
// 3. keybindings（キーバインド）
// ============================================
export const keybindings = sqliteTable("keybindings", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  keyCode: text("key_code").notNull(),
  category: text("category", { enum: ["movement", "combat", "inventory", "ui"] }).notNull(),

  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
}, (table) => [
  uniqueIndex("idx_keybindings_user_action").on(table.userId, table.action),
  index("idx_keybindings_user_id").on(table.userId),
  index("idx_keybindings_category").on(table.category),
]);

// ============================================
// 4. custom_keys（カスタムキー定義）
// ============================================
export const customKeys = sqliteTable("custom_keys", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  keyCode: text("key_code").notNull(),
  keyName: text("key_name").notNull(),
  category: text("category", { enum: ["mouse", "keyboard"] }).notNull(),
  position: text("position"), // JSON { x: number, y: number }
  size: text("size"), // JSON { width: number, height: number }
  notes: text("notes"),

  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
}, (table) => [
  uniqueIndex("idx_custom_keys_user_keycode").on(table.userId, table.keyCode),
]);

// ============================================
// 5. key_remaps（キーリマップ）
// ============================================
export const keyRemaps = sqliteTable("key_remaps", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  sourceKey: text("source_key").notNull(),
  targetKey: text("target_key"),
  software: text("software"),
  notes: text("notes"),

  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
}, (table) => [
  uniqueIndex("idx_key_remaps_user_source").on(table.userId, table.sourceKey),
]);

// ============================================
// 6. external_tools（外部ツール連携）
// ============================================
export const externalTools = sqliteTable("external_tools", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  triggerKey: text("trigger_key").notNull(),
  toolName: text("tool_name").notNull(),
  actionName: text("action_name").notNull(),
  description: text("description"),

  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
}, (table) => [
  uniqueIndex("idx_external_tools_user_trigger_tool").on(table.userId, table.triggerKey, table.toolName),
]);

// ============================================
// 7. item_layouts（アイテム配置）
// ============================================
export const itemLayouts = sqliteTable("item_layouts", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  segment: text("segment").notNull(), // "overworld" | "nether" | "end" | "stronghold" | "custom_*"
  slots: text("slots").notNull(), // JSON配列
  offhand: text("offhand"), // JSON配列
  notes: text("notes"),
  displayOrder: integer("display_order").default(0).notNull(),

  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
}, (table) => [
  uniqueIndex("idx_item_layouts_user_segment").on(table.userId, table.segment),
]);

// ============================================
// 8. search_crafts（サーチクラフト）
// ============================================
export const searchCrafts = sqliteTable("search_crafts", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(),
  items: text("items").notNull(), // JSON配列
  keys: text("keys").notNull(), // JSON配列
  searchStr: text("search_str"),
  comment: text("comment"),

  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
}, (table) => [
  uniqueIndex("idx_search_crafts_user_sequence").on(table.userId, table.sequence),
]);

// ============================================
// 9. social_links（ソーシャルリンク）
// ============================================
export const socialLinks = sqliteTable("social_links", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  platform: text("platform", { enum: ["speedruncom", "youtube", "twitch", "twitter"] }).notNull(),
  identifier: text("identifier").notNull(), // ユーザー名やチャンネルID
  displayOrder: integer("display_order").default(0).notNull(),

  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
}, (table) => [
  index("idx_social_links_user_id").on(table.userId),
  index("idx_social_links_platform").on(table.platform),
]);

// ============================================
// 10. category_records（記録・目標統合）
// ============================================
export const categoryRecords = sqliteTable("category_records", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),

  // カテゴリ情報
  category: text("category").notNull(),
  categoryDisplayName: text("category_display_name").notNull(),
  subcategory: text("subcategory"),
  version: text("version"),

  // 記録タイプ
  recordType: text("record_type", { enum: ["speedruncom", "ranked", "custom"] }).notNull(),

  // 自己ベスト（手動入力用）
  personalBest: integer("personal_best"), // ミリ秒
  pbDate: integer("pb_date", { mode: "timestamp" }),
  pbVideoUrl: text("pb_video_url"),
  pbNotes: text("pb_notes"),

  // 目標
  targetTime: integer("target_time"), // ミリ秒
  targetDeadline: integer("target_deadline", { mode: "timestamp" }),
  targetNotes: text("target_notes"),
  achieved: integer("achieved", { mode: "boolean" }).default(false).notNull(),
  achievedAt: integer("achieved_at", { mode: "timestamp" }),

  // 表示設定
  isVisible: integer("is_visible", { mode: "boolean" }).default(true).notNull(),
  displayOrder: integer("display_order").default(0).notNull(),

  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
}, (table) => [
  uniqueIndex("idx_category_records_user_category_type").on(table.userId, table.category, table.recordType),
  index("idx_category_records_user_id").on(table.userId),
  index("idx_category_records_category").on(table.category),
  index("idx_category_records_type").on(table.recordType),
]);

// ============================================
// 11. custom_fields（カスタム項目）
// ============================================
export const customFields = sqliteTable("custom_fields", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  fieldName: text("field_name").notNull(),
  fieldValue: text("field_value").notNull(),
  fieldType: text("field_type", { enum: ["text", "number", "url", "date"] }).default("text").notNull(),
  displayOrder: integer("display_order").default(0).notNull(),

  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

// ============================================
// 12. external_stats（外部サービス統計キャッシュ）
// ============================================
export const externalStats = sqliteTable("external_stats", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  service: text("service", { enum: ["speedruncom", "ranked"] }).notNull(),
  data: text("data").notNull(), // JSON
  lastFetched: integer("last_fetched", { mode: "timestamp" }).notNull(),

  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
}, (table) => [
  uniqueIndex("idx_external_stats_user_service").on(table.userId, table.service),
  index("idx_external_stats_user_id").on(table.userId),
  index("idx_external_stats_service").on(table.service),
]);

// ============================================
// Better Auth 用テーブル
// ============================================
export const authUsers = sqliteTable("auth_users", {
  id: text("id").primaryKey(),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const authSessions = sqliteTable("auth_sessions", {
  id: text("id").primaryKey(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  token: text("token").unique().notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const authAccounts = sqliteTable("auth_accounts", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp" }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp" }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const authVerifications = sqliteTable("auth_verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

// ============================================
// Relations（リレーション定義）
// ============================================
export const usersRelations = relations(users, ({ one, many }) => ({
  playerConfig: one(playerConfigs, {
    fields: [users.id],
    references: [playerConfigs.userId],
  }),
  keybindings: many(keybindings),
  customKeys: many(customKeys),
  keyRemaps: many(keyRemaps),
  externalTools: many(externalTools),
  itemLayouts: many(itemLayouts),
  searchCrafts: many(searchCrafts),
  socialLinks: many(socialLinks),
  categoryRecords: many(categoryRecords),
  customFields: many(customFields),
  externalStats: many(externalStats),
  configPresets: many(configPresets),
  configHistory: many(configHistory),
  favorites: many(favorites),
}));

export const playerConfigsRelations = relations(playerConfigs, ({ one }) => ({
  user: one(users, {
    fields: [playerConfigs.userId],
    references: [users.id],
  }),
}));

export const keybindingsRelations = relations(keybindings, ({ one }) => ({
  user: one(users, {
    fields: [keybindings.userId],
    references: [users.id],
  }),
}));

export const customKeysRelations = relations(customKeys, ({ one }) => ({
  user: one(users, {
    fields: [customKeys.userId],
    references: [users.id],
  }),
}));

export const keyRemapsRelations = relations(keyRemaps, ({ one }) => ({
  user: one(users, {
    fields: [keyRemaps.userId],
    references: [users.id],
  }),
}));

export const externalToolsRelations = relations(externalTools, ({ one }) => ({
  user: one(users, {
    fields: [externalTools.userId],
    references: [users.id],
  }),
}));

export const itemLayoutsRelations = relations(itemLayouts, ({ one }) => ({
  user: one(users, {
    fields: [itemLayouts.userId],
    references: [users.id],
  }),
}));

export const searchCraftsRelations = relations(searchCrafts, ({ one }) => ({
  user: one(users, {
    fields: [searchCrafts.userId],
    references: [users.id],
  }),
}));

export const socialLinksRelations = relations(socialLinks, ({ one }) => ({
  user: one(users, {
    fields: [socialLinks.userId],
    references: [users.id],
  }),
}));

export const categoryRecordsRelations = relations(categoryRecords, ({ one }) => ({
  user: one(users, {
    fields: [categoryRecords.userId],
    references: [users.id],
  }),
}));

export const customFieldsRelations = relations(customFields, ({ one }) => ({
  user: one(users, {
    fields: [customFields.userId],
    references: [users.id],
  }),
}));

export const externalStatsRelations = relations(externalStats, ({ one }) => ({
  user: one(users, {
    fields: [externalStats.userId],
    references: [users.id],
  }),
}));

// ============================================
// 型エクスポート
// ============================================
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type PlayerConfig = typeof playerConfigs.$inferSelect;
export type NewPlayerConfig = typeof playerConfigs.$inferInsert;
export type Keybinding = typeof keybindings.$inferSelect;
export type NewKeybinding = typeof keybindings.$inferInsert;
export type CustomKey = typeof customKeys.$inferSelect;
export type KeyRemap = typeof keyRemaps.$inferSelect;
export type ExternalTool = typeof externalTools.$inferSelect;
export type ItemLayout = typeof itemLayouts.$inferSelect;
export type SearchCraft = typeof searchCrafts.$inferSelect;
export type SocialLink = typeof socialLinks.$inferSelect;
export type CategoryRecord = typeof categoryRecords.$inferSelect;
export type CustomField = typeof customFields.$inferSelect;
export type ExternalStat = typeof externalStats.$inferSelect;

// ============================================
// 13. config_presets（設定プリセット）
// ============================================
export const configPresets = sqliteTable("config_presets", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  isActive: integer("is_active", { mode: "boolean" }).default(false).notNull(),

  // 設定データ（JSON）
  keybindingsData: text("keybindings_data"), // JSON: キーバインドのスナップショット
  playerConfigData: text("player_config_data"), // JSON: プレイヤー設定のスナップショット
  remapsData: text("remaps_data"), // JSON: リマップのスナップショット
  fingerAssignmentsData: text("finger_assignments_data"), // JSON: 指割り当て

  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
}, (table) => [
  index("idx_config_presets_user_id").on(table.userId),
  index("idx_config_presets_is_active").on(table.isActive),
]);

// ============================================
// 14. config_history（設定変更履歴）
// ============================================
export const configHistory = sqliteTable("config_history", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  changeType: text("change_type", { enum: ["keybinding", "device", "game_setting", "remap", "preset_switch"] }).notNull(),
  changeDescription: text("change_description").notNull(),

  // 変更前後のデータ（JSON）
  previousData: text("previous_data"), // JSON
  newData: text("new_data"), // JSON

  // 関連プリセット（あれば）
  presetId: text("preset_id").references(() => configPresets.id, { onDelete: "set null" }),

  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
}, (table) => [
  index("idx_config_history_user_id").on(table.userId),
  index("idx_config_history_created_at").on(table.createdAt),
  index("idx_config_history_change_type").on(table.changeType),
]);

export const configPresetsRelations = relations(configPresets, ({ one, many }) => ({
  user: one(users, {
    fields: [configPresets.userId],
    references: [users.id],
  }),
  history: many(configHistory),
}));

export const configHistoryRelations = relations(configHistory, ({ one }) => ({
  user: one(users, {
    fields: [configHistory.userId],
    references: [users.id],
  }),
  preset: one(configPresets, {
    fields: [configHistory.presetId],
    references: [configPresets.id],
  }),
}));

export type ConfigPreset = typeof configPresets.$inferSelect;
export type NewConfigPreset = typeof configPresets.$inferInsert;
export type ConfigHistoryEntry = typeof configHistory.$inferSelect;
export type NewConfigHistoryEntry = typeof configHistory.$inferInsert;

// ============================================
// 15. favorites（お気に入りプレイヤー）
// ============================================
export const favorites = sqliteTable("favorites", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  favoriteMcid: text("favorite_mcid").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
}, (table) => [
  uniqueIndex("idx_favorites_user_mcid").on(table.userId, table.favoriteMcid),
  index("idx_favorites_user_id").on(table.userId),
]);

export const favoritesRelations = relations(favorites, ({ one }) => ({
  user: one(users, {
    fields: [favorites.userId],
    references: [users.id],
  }),
}));

export type Favorite = typeof favorites.$inferSelect;
export type NewFavorite = typeof favorites.$inferInsert;

// ============================================
// 16. api_cache（APIキャッシュ）
// ============================================
export const apiCache = sqliteTable("api_cache", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  cacheKey: text("cache_key").unique().notNull(),
  cacheType: text("cache_type", { enum: ["youtube_videos", "recent_paces", "twitch_streams", "live_runs"] }).notNull(),
  data: text("data").notNull(), // JSON
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
}, (table) => [
  index("idx_api_cache_key").on(table.cacheKey),
  index("idx_api_cache_type").on(table.cacheType),
  index("idx_api_cache_expires").on(table.expiresAt),
]);

export type ApiCache = typeof apiCache.$inferSelect;
export type NewApiCache = typeof apiCache.$inferInsert;

// ============================================
// 17. youtube_video_cache（YouTube動画キャッシュ）
// ============================================
export const youtubeVideoCache = sqliteTable("youtube_video_cache", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  videoId: text("video_id").unique().notNull(),
  channelId: text("channel_id").notNull(),
  minefolioMcid: text("minefolio_mcid"), // Minefolioユーザーとの紐付け
  title: text("title").notNull(),
  description: text("description"),
  thumbnailUrl: text("thumbnail_url"),
  channelTitle: text("channel_title"),
  publishedAt: integer("published_at", { mode: "timestamp" }).notNull(),
  // キャッシュ管理
  lastVerifiedAt: integer("last_verified_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  isAvailable: integer("is_available", { mode: "boolean" }).default(true).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
}, (table) => [
  index("idx_youtube_cache_video_id").on(table.videoId),
  index("idx_youtube_cache_channel_id").on(table.channelId),
  index("idx_youtube_cache_mcid").on(table.minefolioMcid),
  index("idx_youtube_cache_published").on(table.publishedAt),
  index("idx_youtube_cache_available").on(table.isAvailable),
]);

export type YoutubeVideoCache = typeof youtubeVideoCache.$inferSelect;
export type NewYoutubeVideoCache = typeof youtubeVideoCache.$inferInsert;

// ============================================
// 18. youtube_live_cache（YouTubeライブ配信キャッシュ）
// ============================================
export const youtubeLiveCache = sqliteTable("youtube_live_cache", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  videoId: text("video_id").unique().notNull(),
  channelId: text("channel_id").notNull(),
  minefolioMcid: text("minefolio_mcid"), // Minefolioユーザーとの紐付け
  title: text("title").notNull(),
  description: text("description"),
  thumbnailUrl: text("thumbnail_url"),
  channelTitle: text("channel_title"),
  // ライブ配信情報
  liveBroadcastContent: text("live_broadcast_content", { enum: ["live", "upcoming", "none"] }).notNull(),
  scheduledStartTime: integer("scheduled_start_time", { mode: "timestamp" }), // 配信予定開始時刻
  actualStartTime: integer("actual_start_time", { mode: "timestamp" }), // 実際の開始時刻
  concurrentViewers: integer("concurrent_viewers"), // 同時視聴者数
  // キャッシュ管理
  lastCheckedAt: integer("last_checked_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
}, (table) => [
  index("idx_youtube_live_video_id").on(table.videoId),
  index("idx_youtube_live_channel_id").on(table.channelId),
  index("idx_youtube_live_mcid").on(table.minefolioMcid),
  index("idx_youtube_live_status").on(table.liveBroadcastContent),
]);

export type YoutubeLiveCache = typeof youtubeLiveCache.$inferSelect;
export type NewYoutubeLiveCache = typeof youtubeLiveCache.$inferInsert;
