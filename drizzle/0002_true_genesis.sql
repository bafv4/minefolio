CREATE TABLE `api_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`cache_key` text NOT NULL,
	`cache_type` text NOT NULL,
	`data` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_cache_cache_key_unique` ON `api_cache` (`cache_key`);--> statement-breakpoint
CREATE INDEX `idx_api_cache_key` ON `api_cache` (`cache_key`);--> statement-breakpoint
CREATE INDEX `idx_api_cache_type` ON `api_cache` (`cache_type`);--> statement-breakpoint
CREATE INDEX `idx_api_cache_expires` ON `api_cache` (`expires_at`);--> statement-breakpoint
CREATE TABLE `youtube_live_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`video_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`minefolio_mcid` text,
	`title` text NOT NULL,
	`description` text,
	`thumbnail_url` text,
	`channel_title` text,
	`live_broadcast_content` text NOT NULL,
	`scheduled_start_time` integer,
	`actual_start_time` integer,
	`concurrent_viewers` integer,
	`last_checked_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `youtube_live_cache_video_id_unique` ON `youtube_live_cache` (`video_id`);--> statement-breakpoint
CREATE INDEX `idx_youtube_live_video_id` ON `youtube_live_cache` (`video_id`);--> statement-breakpoint
CREATE INDEX `idx_youtube_live_channel_id` ON `youtube_live_cache` (`channel_id`);--> statement-breakpoint
CREATE INDEX `idx_youtube_live_mcid` ON `youtube_live_cache` (`minefolio_mcid`);--> statement-breakpoint
CREATE INDEX `idx_youtube_live_status` ON `youtube_live_cache` (`live_broadcast_content`);--> statement-breakpoint
CREATE TABLE `youtube_video_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`video_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`minefolio_mcid` text,
	`title` text NOT NULL,
	`description` text,
	`thumbnail_url` text,
	`channel_title` text,
	`published_at` integer NOT NULL,
	`last_verified_at` integer NOT NULL,
	`is_available` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `youtube_video_cache_video_id_unique` ON `youtube_video_cache` (`video_id`);--> statement-breakpoint
CREATE INDEX `idx_youtube_cache_video_id` ON `youtube_video_cache` (`video_id`);--> statement-breakpoint
CREATE INDEX `idx_youtube_cache_channel_id` ON `youtube_video_cache` (`channel_id`);--> statement-breakpoint
CREATE INDEX `idx_youtube_cache_mcid` ON `youtube_video_cache` (`minefolio_mcid`);--> statement-breakpoint
CREATE INDEX `idx_youtube_cache_published` ON `youtube_video_cache` (`published_at`);--> statement-breakpoint
CREATE INDEX `idx_youtube_cache_available` ON `youtube_video_cache` (`is_available`);--> statement-breakpoint
DROP INDEX "api_cache_cache_key_unique";--> statement-breakpoint
DROP INDEX "idx_api_cache_key";--> statement-breakpoint
DROP INDEX "idx_api_cache_type";--> statement-breakpoint
DROP INDEX "idx_api_cache_expires";--> statement-breakpoint
DROP INDEX "auth_sessions_token_unique";--> statement-breakpoint
DROP INDEX "auth_users_email_unique";--> statement-breakpoint
DROP INDEX "idx_category_records_user_category_type";--> statement-breakpoint
DROP INDEX "idx_category_records_user_id";--> statement-breakpoint
DROP INDEX "idx_category_records_category";--> statement-breakpoint
DROP INDEX "idx_category_records_type";--> statement-breakpoint
DROP INDEX "idx_config_history_user_id";--> statement-breakpoint
DROP INDEX "idx_config_history_created_at";--> statement-breakpoint
DROP INDEX "idx_config_history_change_type";--> statement-breakpoint
DROP INDEX "idx_config_presets_user_id";--> statement-breakpoint
DROP INDEX "idx_config_presets_is_active";--> statement-breakpoint
DROP INDEX "idx_custom_keys_user_keycode";--> statement-breakpoint
DROP INDEX "idx_external_stats_user_service";--> statement-breakpoint
DROP INDEX "idx_external_stats_user_id";--> statement-breakpoint
DROP INDEX "idx_external_stats_service";--> statement-breakpoint
DROP INDEX "idx_external_tools_user_trigger_tool";--> statement-breakpoint
DROP INDEX "idx_favorites_user_mcid";--> statement-breakpoint
DROP INDEX "idx_favorites_user_id";--> statement-breakpoint
DROP INDEX "idx_item_layouts_user_segment";--> statement-breakpoint
DROP INDEX "idx_key_remaps_user_source";--> statement-breakpoint
DROP INDEX "idx_keybindings_user_action";--> statement-breakpoint
DROP INDEX "idx_keybindings_user_id";--> statement-breakpoint
DROP INDEX "idx_keybindings_category";--> statement-breakpoint
DROP INDEX "player_configs_user_id_unique";--> statement-breakpoint
DROP INDEX "idx_search_crafts_user_sequence";--> statement-breakpoint
DROP INDEX "idx_social_links_user_id";--> statement-breakpoint
DROP INDEX "idx_social_links_platform";--> statement-breakpoint
DROP INDEX "users_discord_id_unique";--> statement-breakpoint
DROP INDEX "users_mcid_unique";--> statement-breakpoint
DROP INDEX "users_uuid_unique";--> statement-breakpoint
DROP INDEX "users_slug_unique";--> statement-breakpoint
DROP INDEX "idx_users_discord_id";--> statement-breakpoint
DROP INDEX "idx_users_mcid";--> statement-breakpoint
DROP INDEX "idx_users_uuid";--> statement-breakpoint
DROP INDEX "idx_users_slug";--> statement-breakpoint
DROP INDEX "idx_users_speedruncom_id";--> statement-breakpoint
DROP INDEX "youtube_live_cache_video_id_unique";--> statement-breakpoint
DROP INDEX "idx_youtube_live_video_id";--> statement-breakpoint
DROP INDEX "idx_youtube_live_channel_id";--> statement-breakpoint
DROP INDEX "idx_youtube_live_mcid";--> statement-breakpoint
DROP INDEX "idx_youtube_live_status";--> statement-breakpoint
DROP INDEX "youtube_video_cache_video_id_unique";--> statement-breakpoint
DROP INDEX "idx_youtube_cache_video_id";--> statement-breakpoint
DROP INDEX "idx_youtube_cache_channel_id";--> statement-breakpoint
DROP INDEX "idx_youtube_cache_mcid";--> statement-breakpoint
DROP INDEX "idx_youtube_cache_published";--> statement-breakpoint
DROP INDEX "idx_youtube_cache_available";--> statement-breakpoint
ALTER TABLE `users` ALTER COLUMN "mcid" TO "mcid" text;--> statement-breakpoint
CREATE UNIQUE INDEX `auth_sessions_token_unique` ON `auth_sessions` (`token`);--> statement-breakpoint
CREATE UNIQUE INDEX `auth_users_email_unique` ON `auth_users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_category_records_user_category_type` ON `category_records` (`user_id`,`category`,`record_type`);--> statement-breakpoint
CREATE INDEX `idx_category_records_user_id` ON `category_records` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_category_records_category` ON `category_records` (`category`);--> statement-breakpoint
CREATE INDEX `idx_category_records_type` ON `category_records` (`record_type`);--> statement-breakpoint
CREATE INDEX `idx_config_history_user_id` ON `config_history` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_config_history_created_at` ON `config_history` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_config_history_change_type` ON `config_history` (`change_type`);--> statement-breakpoint
CREATE INDEX `idx_config_presets_user_id` ON `config_presets` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_config_presets_is_active` ON `config_presets` (`is_active`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_custom_keys_user_keycode` ON `custom_keys` (`user_id`,`key_code`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_external_stats_user_service` ON `external_stats` (`user_id`,`service`);--> statement-breakpoint
CREATE INDEX `idx_external_stats_user_id` ON `external_stats` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_external_stats_service` ON `external_stats` (`service`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_external_tools_user_trigger_tool` ON `external_tools` (`user_id`,`trigger_key`,`tool_name`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_favorites_user_mcid` ON `favorites` (`user_id`,`favorite_mcid`);--> statement-breakpoint
CREATE INDEX `idx_favorites_user_id` ON `favorites` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_item_layouts_user_segment` ON `item_layouts` (`user_id`,`segment`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_key_remaps_user_source` ON `key_remaps` (`user_id`,`source_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_keybindings_user_action` ON `keybindings` (`user_id`,`action`);--> statement-breakpoint
CREATE INDEX `idx_keybindings_user_id` ON `keybindings` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_keybindings_category` ON `keybindings` (`category`);--> statement-breakpoint
CREATE UNIQUE INDEX `player_configs_user_id_unique` ON `player_configs` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_search_crafts_user_sequence` ON `search_crafts` (`user_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `idx_social_links_user_id` ON `social_links` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_social_links_platform` ON `social_links` (`platform`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_discord_id_unique` ON `users` (`discord_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_mcid_unique` ON `users` (`mcid`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_uuid_unique` ON `users` (`uuid`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_slug_unique` ON `users` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_users_discord_id` ON `users` (`discord_id`);--> statement-breakpoint
CREATE INDEX `idx_users_mcid` ON `users` (`mcid`);--> statement-breakpoint
CREATE INDEX `idx_users_uuid` ON `users` (`uuid`);--> statement-breakpoint
CREATE INDEX `idx_users_slug` ON `users` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_users_speedruncom_id` ON `users` (`speedruncom_id`);--> statement-breakpoint
ALTER TABLE `users` ALTER COLUMN "uuid" TO "uuid" text;--> statement-breakpoint
ALTER TABLE `users` ADD `slug` text NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `slim_skin` integer DEFAULT false;--> statement-breakpoint
ALTER TABLE `users` ADD `input_method` text;--> statement-breakpoint
ALTER TABLE `users` ADD `input_method_badge` text;--> statement-breakpoint
ALTER TABLE `users` ADD `show_paceman_on_home` integer DEFAULT true;--> statement-breakpoint
ALTER TABLE `users` ADD `show_twitch_on_home` integer DEFAULT true;--> statement-breakpoint
ALTER TABLE `users` ADD `show_youtube_on_home` integer DEFAULT true;--> statement-breakpoint
ALTER TABLE `users` ADD `show_ranked_stats` integer DEFAULT true;--> statement-breakpoint
ALTER TABLE `config_presets` ADD `item_layouts_data` text;--> statement-breakpoint
ALTER TABLE `config_presets` ADD `search_crafts_data` text;--> statement-breakpoint
ALTER TABLE `player_configs` ADD `controller_settings` text;