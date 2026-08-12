// schema.ts が定義する全 index（`CREATE INDEX` / `CREATE UNIQUE INDEX`、98件）を local.db / リモートに
// 同期する一回限りの汎用スクリプト。
//
// 背景: `pnpm db:push` は local.db の index 命名ドリフトに起因する `no such index` エラーで
// バッチ全体が中断する（詳細は fix-unique-index-names.ts 冒頭コメント参照）。
// fix-unique-index-names.ts は `.unique()` 由来の named unique index（14件）のみを対象にしたが、
// それを適用した後も `index("idx_...")` で明示定義した通常（非UNIQUE）index が18件欠落しており
// push が別の `no such index` で再度中断した。本スクリプトはその18件を含む、
// test-schema.sql が定義する **index 全件（98件）** を対象に、欠けているものだけ
// `IF NOT EXISTS` 付きで補完する汎用版。fix-unique-index-names.ts の対象は本スクリプトの
// 対象に包含される（両者の役割が重複するが、一回限りスクリプトの性質上許容し、削除・統合はしない）。
//
// DDL は `pnpm gen:test-schema`（drizzle-kit export の出力 = app/lib/__tests__/helpers/test-schema.sql）
// の該当行と完全一致させ、`IF NOT EXISTS` のみ付け足している（ハードコード。実行時に
// test-schema.sql を parse しない）。既存データ・既存の autoindex には一切触れない。
//
// 実行:
//   pnpm exec tsx scripts/fix-missing-indexes.ts                   # ローカル（.env）に dry-run
//   pnpm exec tsx scripts/fix-missing-indexes.ts --apply           # ローカルに適用
//   pnpm exec tsx scripts/fix-missing-indexes.ts --remote          # リモート（.env.remote）に dry-run
//   pnpm exec tsx scripts/fix-missing-indexes.ts --remote --apply  # リモートに適用（要ユーザー承認）
import { createClient } from "@libsql/client";
import { loadDbEnv } from "./lib/db-env";

const { url, authToken } = loadDbEnv();

const apply = process.argv.includes("--apply");
const client = createClient({ url, authToken });

console.log(`モード: ${apply ? "APPLY（実際に適用します）" : "DRY-RUN（表示のみ・変更なし）"}`);

interface IndexTarget {
  name: string;
  table: string;
  ddl: string;
}

// test-schema.sql の全 `CREATE [UNIQUE] INDEX` 行（98件）をハードコード。
// 定義文字列は同ファイルと完全一致（IF NOT EXISTS のみ追加）。
const TARGETS: IndexTarget[] = [
  { name: "api_cache_cache_key_unique", table: "api_cache", ddl: "CREATE UNIQUE INDEX IF NOT EXISTS `api_cache_cache_key_unique` ON `api_cache` (`cache_key`)" },
  { name: "idx_api_cache_key", table: "api_cache", ddl: "CREATE INDEX IF NOT EXISTS `idx_api_cache_key` ON `api_cache` (`cache_key`)" },
  { name: "idx_api_cache_type", table: "api_cache", ddl: "CREATE INDEX IF NOT EXISTS `idx_api_cache_type` ON `api_cache` (`cache_type`)" },
  { name: "idx_api_cache_expires", table: "api_cache", ddl: "CREATE INDEX IF NOT EXISTS `idx_api_cache_expires` ON `api_cache` (`expires_at`)" },
  { name: "auth_sessions_token_unique", table: "auth_sessions", ddl: "CREATE UNIQUE INDEX IF NOT EXISTS `auth_sessions_token_unique` ON `auth_sessions` (`token`)" },
  { name: "auth_users_email_unique", table: "auth_users", ddl: "CREATE UNIQUE INDEX IF NOT EXISTS `auth_users_email_unique` ON `auth_users` (`email`)" },
  { name: "idx_category_records_user_category_type", table: "category_records", ddl: "CREATE UNIQUE INDEX IF NOT EXISTS `idx_category_records_user_category_type` ON `category_records` (`user_id`,`category`,`record_type`)" },
  { name: "idx_category_records_user_id", table: "category_records", ddl: "CREATE INDEX IF NOT EXISTS `idx_category_records_user_id` ON `category_records` (`user_id`)" },
  { name: "idx_category_records_category", table: "category_records", ddl: "CREATE INDEX IF NOT EXISTS `idx_category_records_category` ON `category_records` (`category`)" },
  { name: "idx_category_records_type", table: "category_records", ddl: "CREATE INDEX IF NOT EXISTS `idx_category_records_type` ON `category_records` (`record_type`)" },
  { name: "idx_config_history_user_id", table: "config_history", ddl: "CREATE INDEX IF NOT EXISTS `idx_config_history_user_id` ON `config_history` (`user_id`)" },
  { name: "idx_config_history_created_at", table: "config_history", ddl: "CREATE INDEX IF NOT EXISTS `idx_config_history_created_at` ON `config_history` (`created_at`)" },
  { name: "idx_config_history_change_type", table: "config_history", ddl: "CREATE INDEX IF NOT EXISTS `idx_config_history_change_type` ON `config_history` (`change_type`)" },
  { name: "idx_config_presets_user_id", table: "config_presets", ddl: "CREATE INDEX IF NOT EXISTS `idx_config_presets_user_id` ON `config_presets` (`user_id`)" },
  { name: "idx_config_presets_is_active", table: "config_presets", ddl: "CREATE INDEX IF NOT EXISTS `idx_config_presets_is_active` ON `config_presets` (`is_active`)" },
  { name: "idx_config_presets_is_main", table: "config_presets", ddl: "CREATE INDEX IF NOT EXISTS `idx_config_presets_is_main` ON `config_presets` (`is_main`)" },
  { name: "content_translations_target_locale_uniq", table: "content_translations", ddl: "CREATE UNIQUE INDEX IF NOT EXISTS `content_translations_target_locale_uniq` ON `content_translations` (`target_type`,`target_id`,`locale`)" },
  { name: "content_translations_status_idx", table: "content_translations", ddl: "CREATE INDEX IF NOT EXISTS `content_translations_status_idx` ON `content_translations` (`status`,`updated_at`)" },
  { name: "idx_custom_actions_user_trigger", table: "custom_actions", ddl: "CREATE UNIQUE INDEX IF NOT EXISTS `idx_custom_actions_user_trigger` ON `custom_actions` (`user_id`,`trigger_key`)" },
  { name: "idx_custom_actions_user_id", table: "custom_actions", ddl: "CREATE INDEX IF NOT EXISTS `idx_custom_actions_user_id` ON `custom_actions` (`user_id`)" },
  { name: "idx_custom_actions_category", table: "custom_actions", ddl: "CREATE INDEX IF NOT EXISTS `idx_custom_actions_category` ON `custom_actions` (`category`)" },
  { name: "idx_custom_keys_user_keycode", table: "custom_keys", ddl: "CREATE UNIQUE INDEX IF NOT EXISTS `idx_custom_keys_user_keycode` ON `custom_keys` (`user_id`,`key_code`)" },
  { name: "idx_external_stats_user_service", table: "external_stats", ddl: "CREATE UNIQUE INDEX IF NOT EXISTS `idx_external_stats_user_service` ON `external_stats` (`user_id`,`service`)" },
  { name: "idx_external_stats_user_id", table: "external_stats", ddl: "CREATE INDEX IF NOT EXISTS `idx_external_stats_user_id` ON `external_stats` (`user_id`)" },
  { name: "idx_external_stats_service", table: "external_stats", ddl: "CREATE INDEX IF NOT EXISTS `idx_external_stats_service` ON `external_stats` (`service`)" },
  { name: "idx_external_tools_user_trigger_tool", table: "external_tools", ddl: "CREATE UNIQUE INDEX IF NOT EXISTS `idx_external_tools_user_trigger_tool` ON `external_tools` (`user_id`,`trigger_key`,`tool_name`)" },
  { name: "idx_favorites_user_slug", table: "favorites", ddl: "CREATE UNIQUE INDEX IF NOT EXISTS `idx_favorites_user_slug` ON `favorites` (`user_id`,`favorite_slug`)" },
  { name: "idx_favorites_user_id", table: "favorites", ddl: "CREATE INDEX IF NOT EXISTS `idx_favorites_user_id` ON `favorites` (`user_id`)" },
  { name: "guide_likes_guide_user_uniq", table: "guide_likes", ddl: "CREATE UNIQUE INDEX IF NOT EXISTS `guide_likes_guide_user_uniq` ON `guide_likes` (`guide_id`,`user_id`)" },
  { name: "guide_likes_user_idx", table: "guide_likes", ddl: "CREATE INDEX IF NOT EXISTS `guide_likes_user_idx` ON `guide_likes` (`user_id`,`guide_id`)" },
  { name: "guides_author_slug_uniq", table: "guides", ddl: "CREATE UNIQUE INDEX IF NOT EXISTS `guides_author_slug_uniq` ON `guides` (`author_id`,`slug`)" },
  { name: "guides_feed_idx", table: "guides", ddl: "CREATE INDEX IF NOT EXISTS `guides_feed_idx` ON `guides` (`is_published`,`updated_at`)" },
  { name: "guides_author_idx", table: "guides", ddl: "CREATE INDEX IF NOT EXISTS `guides_author_idx` ON `guides` (`author_id`)" },
  { name: "idx_item_layouts_user_segment", table: "item_layouts", ddl: "CREATE UNIQUE INDEX IF NOT EXISTS `idx_item_layouts_user_segment` ON `item_layouts` (`user_id`,`segment`)" },
  { name: "idx_key_remaps_user_source_type", table: "key_remaps", ddl: "CREATE UNIQUE INDEX IF NOT EXISTS `idx_key_remaps_user_source_type` ON `key_remaps` (`user_id`,`source_key`,`remap_type`)" },
  { name: "idx_keybindings_user_action", table: "keybindings", ddl: "CREATE UNIQUE INDEX IF NOT EXISTS `idx_keybindings_user_action` ON `keybindings` (`user_id`,`action`)" },
  { name: "idx_keybindings_user_id", table: "keybindings", ddl: "CREATE INDEX IF NOT EXISTS `idx_keybindings_user_id` ON `keybindings` (`user_id`)" },
  { name: "idx_keybindings_category", table: "keybindings", ddl: "CREATE INDEX IF NOT EXISTS `idx_keybindings_category` ON `keybindings` (`category`)" },
  { name: "idx_paceman_paces_mcid", table: "paceman_paces", ddl: "CREATE INDEX IF NOT EXISTS `idx_paceman_paces_mcid` ON `paceman_paces` (`mcid`)" },
  { name: "idx_paceman_paces_mcid_lower", table: "paceman_paces", ddl: "CREATE INDEX IF NOT EXISTS `idx_paceman_paces_mcid_lower` ON `paceman_paces` (lower(\"mcid\"))" },
  { name: "idx_paceman_paces_user_id", table: "paceman_paces", ddl: "CREATE INDEX IF NOT EXISTS `idx_paceman_paces_user_id` ON `paceman_paces` (`user_id`)" },
  { name: "idx_paceman_paces_date", table: "paceman_paces", ddl: "CREATE INDEX IF NOT EXISTS `idx_paceman_paces_date` ON `paceman_paces` (`date`)" },
  { name: "idx_paceman_paces_timeline", table: "paceman_paces", ddl: "CREATE INDEX IF NOT EXISTS `idx_paceman_paces_timeline` ON `paceman_paces` (`timeline`)" },
  { name: "idx_paceman_paces_is_nether_enter", table: "paceman_paces", ddl: "CREATE INDEX IF NOT EXISTS `idx_paceman_paces_is_nether_enter` ON `paceman_paces` (`is_nether_enter`)" },
  { name: "idx_paceman_paces_is_2nd_structure_or_later", table: "paceman_paces", ddl: "CREATE INDEX IF NOT EXISTS `idx_paceman_paces_is_2nd_structure_or_later` ON `paceman_paces` (`is_2nd_structure_or_later`)" },
  { name: "idx_paceman_paces_run_id", table: "paceman_paces", ddl: "CREATE INDEX IF NOT EXISTS `idx_paceman_paces_run_id` ON `paceman_paces` (`paceman_run_id`)" },
  { name: "page_view_stats_target_uniq", table: "page_view_stats", ddl: "CREATE UNIQUE INDEX IF NOT EXISTS `page_view_stats_target_uniq` ON `page_view_stats` (`target_type`,`target_id`)" },
  { name: "player_configs_user_id_unique", table: "player_configs", ddl: "CREATE UNIQUE INDEX IF NOT EXISTS `player_configs_user_id_unique` ON `player_configs` (`user_id`)" },
  { name: "idx_player_rankings_user", table: "player_rankings", ddl: "CREATE INDEX IF NOT EXISTS `idx_player_rankings_user` ON `player_rankings` (`user_id`)" },
  { name: "idx_player_rankings_type", table: "player_rankings", ddl: "CREATE INDEX IF NOT EXISTS `idx_player_rankings_type` ON `player_rankings` (`ranking_type`)" },
  { name: "idx_player_rankings_category", table: "player_rankings", ddl: "CREATE INDEX IF NOT EXISTS `idx_player_rankings_category` ON `player_rankings` (`category_id`)" },
  { name: "idx_player_rankings_time", table: "player_rankings", ddl: "CREATE INDEX IF NOT EXISTS `idx_player_rankings_time` ON `player_rankings` (`time_ms`)" },
  { name: "idx_player_rankings_elo", table: "player_rankings", ddl: "CREATE INDEX IF NOT EXISTS `idx_player_rankings_elo` ON `player_rankings` (`elo_rate`)" },
  { name: "playstyles_user_id_unique", table: "playstyles", ddl: "CREATE UNIQUE INDEX IF NOT EXISTS `playstyles_user_id_unique` ON `playstyles` (`user_id`)" },
  { name: "profile_reactions_profile_emoji_reactor_uniq", table: "profile_reactions", ddl: "CREATE UNIQUE INDEX IF NOT EXISTS `profile_reactions_profile_emoji_reactor_uniq` ON `profile_reactions` (`profile_user_id`,`emoji`,`reactor_user_id`)" },
  { name: "profile_reactions_reactor_idx", table: "profile_reactions", ddl: "CREATE INDEX IF NOT EXISTS `profile_reactions_reactor_idx` ON `profile_reactions` (`reactor_user_id`,`profile_user_id`,`emoji`)" },
  { name: "idx_profile_videos_user_id", table: "profile_videos", ddl: "CREATE INDEX IF NOT EXISTS `idx_profile_videos_user_id` ON `profile_videos` (`user_id`)" },
  { name: "rankings_cache_cache_key_unique", table: "rankings_cache", ddl: "CREATE UNIQUE INDEX IF NOT EXISTS `rankings_cache_cache_key_unique` ON `rankings_cache` (`cache_key`)" },
  { name: "idx_rankings_cache_key", table: "rankings_cache", ddl: "CREATE INDEX IF NOT EXISTS `idx_rankings_cache_key` ON `rankings_cache` (`cache_key`)" },
  { name: "idx_rankings_cache_type", table: "rankings_cache", ddl: "CREATE INDEX IF NOT EXISTS `idx_rankings_cache_type` ON `rankings_cache` (`cache_type`)" },
  { name: "idx_rankings_cache_expires", table: "rankings_cache", ddl: "CREATE INDEX IF NOT EXISTS `idx_rankings_cache_expires` ON `rankings_cache` (`expires_at`)" },
  { name: "idx_rankings_cache_category", table: "rankings_cache", ddl: "CREATE INDEX IF NOT EXISTS `idx_rankings_cache_category` ON `rankings_cache` (`category_id`)" },
  { name: "idx_search_craft_loops_user_sequence", table: "search_craft_loops", ddl: "CREATE UNIQUE INDEX IF NOT EXISTS `idx_search_craft_loops_user_sequence` ON `search_craft_loops` (`user_id`,`sequence`)" },
  { name: "search_craft_template_likes_template_user_uniq", table: "search_craft_template_likes", ddl: "CREATE UNIQUE INDEX IF NOT EXISTS `search_craft_template_likes_template_user_uniq` ON `search_craft_template_likes` (`template_id`,`user_id`)" },
  { name: "search_craft_template_likes_user_idx", table: "search_craft_template_likes", ddl: "CREATE INDEX IF NOT EXISTS `search_craft_template_likes_user_idx` ON `search_craft_template_likes` (`user_id`,`template_id`)" },
  { name: "idx_search_craft_templates_user_id", table: "search_craft_templates", ddl: "CREATE INDEX IF NOT EXISTS `idx_search_craft_templates_user_id` ON `search_craft_templates` (`user_id`)" },
  { name: "idx_search_craft_templates_published_created", table: "search_craft_templates", ddl: "CREATE INDEX IF NOT EXISTS `idx_search_craft_templates_published_created` ON `search_craft_templates` (`is_published`,`created_at`)" },
  { name: "idx_search_crafts_user_sequence", table: "search_crafts", ddl: "CREATE UNIQUE INDEX IF NOT EXISTS `idx_search_crafts_user_sequence` ON `search_crafts` (`user_id`,`sequence`)" },
  { name: "idx_social_links_user_id", table: "social_links", ddl: "CREATE INDEX IF NOT EXISTS `idx_social_links_user_id` ON `social_links` (`user_id`)" },
  { name: "idx_social_links_platform", table: "social_links", ddl: "CREATE INDEX IF NOT EXISTS `idx_social_links_platform` ON `social_links` (`platform`)" },
  { name: "speedrun_categories_slug_unique", table: "speedrun_categories", ddl: "CREATE UNIQUE INDEX IF NOT EXISTS `speedrun_categories_slug_unique` ON `speedrun_categories` (`slug`)" },
  { name: "idx_speedrun_categories_slug", table: "speedrun_categories", ddl: "CREATE INDEX IF NOT EXISTS `idx_speedrun_categories_slug` ON `speedrun_categories` (`slug`)" },
  { name: "idx_speedrun_categories_type", table: "speedrun_categories", ddl: "CREATE INDEX IF NOT EXISTS `idx_speedrun_categories_type` ON `speedrun_categories` (`category_type`)" },
  { name: "idx_speedrun_categories_speedruncom", table: "speedrun_categories", ddl: "CREATE INDEX IF NOT EXISTS `idx_speedrun_categories_speedruncom` ON `speedrun_categories` (`speedruncom_category_id`)" },
  { name: "twitch_vod_cache_vod_id_unique", table: "twitch_vod_cache", ddl: "CREATE UNIQUE INDEX IF NOT EXISTS `twitch_vod_cache_vod_id_unique` ON `twitch_vod_cache` (`vod_id`)" },
  { name: "idx_twitch_vod_cache_user_login", table: "twitch_vod_cache", ddl: "CREATE INDEX IF NOT EXISTS `idx_twitch_vod_cache_user_login` ON `twitch_vod_cache` (`user_login`)" },
  { name: "idx_twitch_vod_cache_published", table: "twitch_vod_cache", ddl: "CREATE INDEX IF NOT EXISTS `idx_twitch_vod_cache_published` ON `twitch_vod_cache` (`published_at`)" },
  { name: "idx_twitch_vod_cache_available", table: "twitch_vod_cache", ddl: "CREATE INDEX IF NOT EXISTS `idx_twitch_vod_cache_available` ON `twitch_vod_cache` (`is_available`)" },
  { name: "users_discord_id_unique", table: "users", ddl: "CREATE UNIQUE INDEX IF NOT EXISTS `users_discord_id_unique` ON `users` (`discord_id`)" },
  { name: "users_mcid_unique", table: "users", ddl: "CREATE UNIQUE INDEX IF NOT EXISTS `users_mcid_unique` ON `users` (`mcid`)" },
  { name: "users_uuid_unique", table: "users", ddl: "CREATE UNIQUE INDEX IF NOT EXISTS `users_uuid_unique` ON `users` (`uuid`)" },
  { name: "users_slug_unique", table: "users", ddl: "CREATE UNIQUE INDEX IF NOT EXISTS `users_slug_unique` ON `users` (`slug`)" },
  { name: "idx_users_discord_id", table: "users", ddl: "CREATE INDEX IF NOT EXISTS `idx_users_discord_id` ON `users` (`discord_id`)" },
  { name: "idx_users_mcid", table: "users", ddl: "CREATE INDEX IF NOT EXISTS `idx_users_mcid` ON `users` (`mcid`)" },
  { name: "idx_users_uuid", table: "users", ddl: "CREATE INDEX IF NOT EXISTS `idx_users_uuid` ON `users` (`uuid`)" },
  { name: "idx_users_slug", table: "users", ddl: "CREATE INDEX IF NOT EXISTS `idx_users_slug` ON `users` (`slug`)" },
  { name: "idx_users_speedruncom_id", table: "users", ddl: "CREATE INDEX IF NOT EXISTS `idx_users_speedruncom_id` ON `users` (`speedruncom_id`)" },
  { name: "youtube_live_cache_video_id_unique", table: "youtube_live_cache", ddl: "CREATE UNIQUE INDEX IF NOT EXISTS `youtube_live_cache_video_id_unique` ON `youtube_live_cache` (`video_id`)" },
  { name: "idx_youtube_live_video_id", table: "youtube_live_cache", ddl: "CREATE INDEX IF NOT EXISTS `idx_youtube_live_video_id` ON `youtube_live_cache` (`video_id`)" },
  { name: "idx_youtube_live_channel_id", table: "youtube_live_cache", ddl: "CREATE INDEX IF NOT EXISTS `idx_youtube_live_channel_id` ON `youtube_live_cache` (`channel_id`)" },
  { name: "idx_youtube_live_mcid", table: "youtube_live_cache", ddl: "CREATE INDEX IF NOT EXISTS `idx_youtube_live_mcid` ON `youtube_live_cache` (`minefolio_mcid`)" },
  { name: "idx_youtube_live_status", table: "youtube_live_cache", ddl: "CREATE INDEX IF NOT EXISTS `idx_youtube_live_status` ON `youtube_live_cache` (`live_broadcast_content`)" },
  { name: "youtube_video_cache_video_id_unique", table: "youtube_video_cache", ddl: "CREATE UNIQUE INDEX IF NOT EXISTS `youtube_video_cache_video_id_unique` ON `youtube_video_cache` (`video_id`)" },
  { name: "idx_youtube_cache_video_id", table: "youtube_video_cache", ddl: "CREATE INDEX IF NOT EXISTS `idx_youtube_cache_video_id` ON `youtube_video_cache` (`video_id`)" },
  { name: "idx_youtube_cache_channel_id", table: "youtube_video_cache", ddl: "CREATE INDEX IF NOT EXISTS `idx_youtube_cache_channel_id` ON `youtube_video_cache` (`channel_id`)" },
  { name: "idx_youtube_cache_mcid", table: "youtube_video_cache", ddl: "CREATE INDEX IF NOT EXISTS `idx_youtube_cache_mcid` ON `youtube_video_cache` (`minefolio_mcid`)" },
  { name: "idx_youtube_cache_published", table: "youtube_video_cache", ddl: "CREATE INDEX IF NOT EXISTS `idx_youtube_cache_published` ON `youtube_video_cache` (`published_at`)" },
  { name: "idx_youtube_cache_available", table: "youtube_video_cache", ddl: "CREATE INDEX IF NOT EXISTS `idx_youtube_cache_available` ON `youtube_video_cache` (`is_available`)" },
];

async function indexExists(name: string) {
  const res = await client.execute({
    sql: "SELECT name FROM sqlite_master WHERE type='index' AND name=?;",
    args: [name],
  });
  return res.rows.length > 0;
}

const pending: IndexTarget[] = [];
for (const t of TARGETS) {
  if (await indexExists(t.name)) {
    console.log(`ℹ️  ${t.name}（${t.table}）は既に存在します。`);
  } else {
    console.log(`${t.name}（${t.table}）を追加します。`);
    pending.push(t);
  }
}

if (apply) {
  // 1件の失敗（例: 対象テーブル自体が存在しない）でバッチ全体を止めない。
  // 個別に成否を記録し、テーブル欠落などの別カテゴリの問題は「作成できなかった」として
  // 最後にまとめて報告する（このスクリプトの責務は index の同期のみ）。
  const failed: { target: IndexTarget; error: string }[] = [];
  for (const t of pending) {
    try {
      await client.execute(t.ddl);
    } catch (e) {
      failed.push({ target: t, error: e instanceof Error ? e.message : String(e) });
    }
  }

  const stillMissing: IndexTarget[] = [];
  for (const t of TARGETS) {
    if (!(await indexExists(t.name))) stillMissing.push(t);
  }

  const succeeded = pending.length - failed.length;
  console.log(`成功: ${succeeded}件 / 失敗: ${failed.length}件（対象全${TARGETS.length}件中 ${pending.length}件が未適用だった）`);

  if (failed.length > 0) {
    console.log("失敗した index（対象テーブルの欠落など、index 以外の問題の可能性があります）:");
    for (const f of failed) {
      console.log(`  ❌ ${f.target.name}（${f.target.table}）: ${f.error}`);
    }
  }

  if (stillMissing.length > 0) {
    console.error(
      `⚠️  未作成の index が残っています: ${stillMissing.map((t) => t.name).join(", ")}`,
    );
    process.exit(1);
  }
  console.log(`✅ 適用完了（${succeeded}件の index を追加。対象全${TARGETS.length}件を確認）。`);
} else {
  console.log("実行予定のSQL:");
  if (pending.length === 0) {
    console.log("  （新規に実行するDDLはありません。全て適用済みです）");
  } else {
    for (const t of pending) {
      console.log(`  ${t.ddl};`);
    }
  }
  console.log(`ℹ️  dry-run のため変更していません（対象全${TARGETS.length}件中 ${pending.length}件が未適用。--apply 付きで実行すると適用します）。`);
}

process.exit(0);
