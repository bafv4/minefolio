CREATE TABLE `content_translations` (
	`id` text PRIMARY KEY NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`locale` text NOT NULL,
	`source_hash` text NOT NULL,
	`glossary_version` integer NOT NULL,
	`title` text,
	`summary` text,
	`content` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`engine` text,
	`model` text,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_translations_target_locale_uniq` ON `content_translations` (`target_type`,`target_id`,`locale`);--> statement-breakpoint
CREATE INDEX `content_translations_status_idx` ON `content_translations` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `guide_likes` (
	`id` text PRIMARY KEY NOT NULL,
	`guide_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`guide_id`) REFERENCES `guides`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `guide_likes_guide_user_uniq` ON `guide_likes` (`guide_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `guide_likes_user_idx` ON `guide_likes` (`user_id`,`guide_id`);--> statement-breakpoint
CREATE TABLE `page_view_stats` (
	`id` text PRIMARY KEY NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`pageviews` integer DEFAULT 0 NOT NULL,
	`window_start` integer NOT NULL,
	`window_end` integer NOT NULL,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `page_view_stats_target_uniq` ON `page_view_stats` (`target_type`,`target_id`);--> statement-breakpoint
CREATE TABLE `playstyles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`versions` text,
	`categories` text,
	`main_version` text,
	`main_category` text,
	`hotbar_switching` text,
	`search_craft` text,
	`half_shift` text,
	`item_layout_policy` text,
	`click_methods` text,
	`drag_tape_type` text,
	`uses_mousepad` text,
	`mousepad_type` text,
	`zero_cycle` text,
	`ground_zero` text,
	`oneshot` text,
	`favorite_bastion` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `playstyles_user_id_unique` ON `playstyles` (`user_id`);--> statement-breakpoint
CREATE TABLE `profile_reactions` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_user_id` text NOT NULL,
	`reactor_user_id` text NOT NULL,
	`emoji` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`profile_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reactor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `profile_reactions_profile_emoji_reactor_uniq` ON `profile_reactions` (`profile_user_id`,`emoji`,`reactor_user_id`);--> statement-breakpoint
CREATE INDEX `profile_reactions_reactor_idx` ON `profile_reactions` (`reactor_user_id`,`profile_user_id`,`emoji`);--> statement-breakpoint
CREATE TABLE `search_craft_loops` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`steps` text NOT NULL,
	`comment` text,
	`timing` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_search_craft_loops_user_sequence` ON `search_craft_loops` (`user_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `search_craft_template_likes` (
	`id` text PRIMARY KEY NOT NULL,
	`template_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`template_id`) REFERENCES `search_craft_templates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `search_craft_template_likes_template_user_uniq` ON `search_craft_template_likes` (`template_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `search_craft_template_likes_user_idx` ON `search_craft_template_likes` (`user_id`,`template_id`);--> statement-breakpoint
CREATE TABLE `twitch_vod_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`vod_id` text NOT NULL,
	`user_login` text NOT NULL,
	`title` text NOT NULL,
	`thumbnail_url` text,
	`channel_title` text,
	`duration_seconds` integer,
	`published_at` integer NOT NULL,
	`last_verified_at` integer NOT NULL,
	`is_available` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `twitch_vod_cache_vod_id_unique` ON `twitch_vod_cache` (`vod_id`);--> statement-breakpoint
CREATE INDEX `idx_twitch_vod_cache_user_login` ON `twitch_vod_cache` (`user_login`);--> statement-breakpoint
CREATE INDEX `idx_twitch_vod_cache_published` ON `twitch_vod_cache` (`published_at`);--> statement-breakpoint
CREATE INDEX `idx_twitch_vod_cache_available` ON `twitch_vod_cache` (`is_available`);--> statement-breakpoint
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
DROP INDEX "idx_config_presets_is_main";--> statement-breakpoint
DROP INDEX "content_translations_target_locale_uniq";--> statement-breakpoint
DROP INDEX "content_translations_status_idx";--> statement-breakpoint
DROP INDEX "idx_custom_actions_user_trigger";--> statement-breakpoint
DROP INDEX "idx_custom_actions_user_id";--> statement-breakpoint
DROP INDEX "idx_custom_actions_category";--> statement-breakpoint
DROP INDEX "idx_custom_keys_user_keycode";--> statement-breakpoint
DROP INDEX "idx_external_stats_user_service";--> statement-breakpoint
DROP INDEX "idx_external_stats_user_id";--> statement-breakpoint
DROP INDEX "idx_external_stats_service";--> statement-breakpoint
DROP INDEX "idx_external_tools_user_trigger_tool";--> statement-breakpoint
DROP INDEX "idx_favorites_user_slug";--> statement-breakpoint
DROP INDEX "idx_favorites_user_id";--> statement-breakpoint
DROP INDEX "guide_likes_guide_user_uniq";--> statement-breakpoint
DROP INDEX "guide_likes_user_idx";--> statement-breakpoint
DROP INDEX "guides_author_slug_uniq";--> statement-breakpoint
DROP INDEX "guides_feed_idx";--> statement-breakpoint
DROP INDEX "guides_author_idx";--> statement-breakpoint
DROP INDEX "idx_item_layouts_user_segment";--> statement-breakpoint
DROP INDEX "idx_key_remaps_user_source_type";--> statement-breakpoint
DROP INDEX "idx_keybindings_user_action";--> statement-breakpoint
DROP INDEX "idx_keybindings_user_id";--> statement-breakpoint
DROP INDEX "idx_keybindings_category";--> statement-breakpoint
DROP INDEX "idx_paceman_paces_mcid";--> statement-breakpoint
DROP INDEX "idx_paceman_paces_mcid_lower";--> statement-breakpoint
DROP INDEX "idx_paceman_paces_user_id";--> statement-breakpoint
DROP INDEX "idx_paceman_paces_date";--> statement-breakpoint
DROP INDEX "idx_paceman_paces_timeline";--> statement-breakpoint
DROP INDEX "idx_paceman_paces_is_nether_enter";--> statement-breakpoint
DROP INDEX "idx_paceman_paces_is_2nd_structure_or_later";--> statement-breakpoint
DROP INDEX "idx_paceman_paces_run_id";--> statement-breakpoint
DROP INDEX "page_view_stats_target_uniq";--> statement-breakpoint
DROP INDEX "player_configs_user_id_unique";--> statement-breakpoint
DROP INDEX "idx_player_rankings_user";--> statement-breakpoint
DROP INDEX "idx_player_rankings_type";--> statement-breakpoint
DROP INDEX "idx_player_rankings_category";--> statement-breakpoint
DROP INDEX "idx_player_rankings_time";--> statement-breakpoint
DROP INDEX "idx_player_rankings_elo";--> statement-breakpoint
DROP INDEX "playstyles_user_id_unique";--> statement-breakpoint
DROP INDEX "profile_reactions_profile_emoji_reactor_uniq";--> statement-breakpoint
DROP INDEX "profile_reactions_reactor_idx";--> statement-breakpoint
DROP INDEX "idx_profile_videos_user_id";--> statement-breakpoint
DROP INDEX "rankings_cache_cache_key_unique";--> statement-breakpoint
DROP INDEX "idx_rankings_cache_key";--> statement-breakpoint
DROP INDEX "idx_rankings_cache_type";--> statement-breakpoint
DROP INDEX "idx_rankings_cache_expires";--> statement-breakpoint
DROP INDEX "idx_rankings_cache_category";--> statement-breakpoint
DROP INDEX "idx_search_craft_loops_user_sequence";--> statement-breakpoint
DROP INDEX "search_craft_template_likes_template_user_uniq";--> statement-breakpoint
DROP INDEX "search_craft_template_likes_user_idx";--> statement-breakpoint
DROP INDEX "idx_search_craft_templates_user_id";--> statement-breakpoint
DROP INDEX "idx_search_craft_templates_published_created";--> statement-breakpoint
DROP INDEX "idx_search_crafts_user_sequence";--> statement-breakpoint
DROP INDEX "idx_social_links_user_id";--> statement-breakpoint
DROP INDEX "idx_social_links_platform";--> statement-breakpoint
DROP INDEX "speedrun_categories_slug_unique";--> statement-breakpoint
DROP INDEX "idx_speedrun_categories_slug";--> statement-breakpoint
DROP INDEX "idx_speedrun_categories_type";--> statement-breakpoint
DROP INDEX "idx_speedrun_categories_speedruncom";--> statement-breakpoint
DROP INDEX "twitch_vod_cache_vod_id_unique";--> statement-breakpoint
DROP INDEX "idx_twitch_vod_cache_user_login";--> statement-breakpoint
DROP INDEX "idx_twitch_vod_cache_published";--> statement-breakpoint
DROP INDEX "idx_twitch_vod_cache_available";--> statement-breakpoint
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
ALTER TABLE `users` ALTER COLUMN "default_profile_tab" TO "default_profile_tab" text;--> statement-breakpoint
CREATE UNIQUE INDEX `api_cache_cache_key_unique` ON `api_cache` (`cache_key`);--> statement-breakpoint
CREATE INDEX `idx_api_cache_key` ON `api_cache` (`cache_key`);--> statement-breakpoint
CREATE INDEX `idx_api_cache_type` ON `api_cache` (`cache_type`);--> statement-breakpoint
CREATE INDEX `idx_api_cache_expires` ON `api_cache` (`expires_at`);--> statement-breakpoint
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
CREATE INDEX `idx_config_presets_is_main` ON `config_presets` (`is_main`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_custom_actions_user_trigger` ON `custom_actions` (`user_id`,`trigger_key`);--> statement-breakpoint
CREATE INDEX `idx_custom_actions_user_id` ON `custom_actions` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_custom_actions_category` ON `custom_actions` (`category`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_custom_keys_user_keycode` ON `custom_keys` (`user_id`,`key_code`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_external_stats_user_service` ON `external_stats` (`user_id`,`service`);--> statement-breakpoint
CREATE INDEX `idx_external_stats_user_id` ON `external_stats` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_external_stats_service` ON `external_stats` (`service`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_external_tools_user_trigger_tool` ON `external_tools` (`user_id`,`trigger_key`,`tool_name`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_favorites_user_slug` ON `favorites` (`user_id`,`favorite_slug`);--> statement-breakpoint
CREATE INDEX `idx_favorites_user_id` ON `favorites` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `guides_author_slug_uniq` ON `guides` (`author_id`,`slug`);--> statement-breakpoint
CREATE INDEX `guides_feed_idx` ON `guides` (`is_published`,`updated_at`);--> statement-breakpoint
CREATE INDEX `guides_author_idx` ON `guides` (`author_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_item_layouts_user_segment` ON `item_layouts` (`user_id`,`segment`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_key_remaps_user_source_type` ON `key_remaps` (`user_id`,`source_key`,`remap_type`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_keybindings_user_action` ON `keybindings` (`user_id`,`action`);--> statement-breakpoint
CREATE INDEX `idx_keybindings_user_id` ON `keybindings` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_keybindings_category` ON `keybindings` (`category`);--> statement-breakpoint
CREATE INDEX `idx_paceman_paces_mcid` ON `paceman_paces` (`mcid`);--> statement-breakpoint
CREATE INDEX `idx_paceman_paces_mcid_lower` ON `paceman_paces` (`lower("mcid")`);--> statement-breakpoint
CREATE INDEX `idx_paceman_paces_user_id` ON `paceman_paces` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_paceman_paces_date` ON `paceman_paces` (`date`);--> statement-breakpoint
CREATE INDEX `idx_paceman_paces_timeline` ON `paceman_paces` (`timeline`);--> statement-breakpoint
CREATE INDEX `idx_paceman_paces_is_nether_enter` ON `paceman_paces` (`is_nether_enter`);--> statement-breakpoint
CREATE INDEX `idx_paceman_paces_is_2nd_structure_or_later` ON `paceman_paces` (`is_2nd_structure_or_later`);--> statement-breakpoint
CREATE INDEX `idx_paceman_paces_run_id` ON `paceman_paces` (`paceman_run_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `player_configs_user_id_unique` ON `player_configs` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_player_rankings_user` ON `player_rankings` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_player_rankings_type` ON `player_rankings` (`ranking_type`);--> statement-breakpoint
CREATE INDEX `idx_player_rankings_category` ON `player_rankings` (`category_id`);--> statement-breakpoint
CREATE INDEX `idx_player_rankings_time` ON `player_rankings` (`time_ms`);--> statement-breakpoint
CREATE INDEX `idx_player_rankings_elo` ON `player_rankings` (`elo_rate`);--> statement-breakpoint
CREATE INDEX `idx_profile_videos_user_id` ON `profile_videos` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `rankings_cache_cache_key_unique` ON `rankings_cache` (`cache_key`);--> statement-breakpoint
CREATE INDEX `idx_rankings_cache_key` ON `rankings_cache` (`cache_key`);--> statement-breakpoint
CREATE INDEX `idx_rankings_cache_type` ON `rankings_cache` (`cache_type`);--> statement-breakpoint
CREATE INDEX `idx_rankings_cache_expires` ON `rankings_cache` (`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_rankings_cache_category` ON `rankings_cache` (`category_id`);--> statement-breakpoint
CREATE INDEX `idx_search_craft_templates_user_id` ON `search_craft_templates` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_search_craft_templates_published_created` ON `search_craft_templates` (`is_published`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_search_crafts_user_sequence` ON `search_crafts` (`user_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `idx_social_links_user_id` ON `social_links` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_social_links_platform` ON `social_links` (`platform`);--> statement-breakpoint
CREATE UNIQUE INDEX `speedrun_categories_slug_unique` ON `speedrun_categories` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_speedrun_categories_slug` ON `speedrun_categories` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_speedrun_categories_type` ON `speedrun_categories` (`category_type`);--> statement-breakpoint
CREATE INDEX `idx_speedrun_categories_speedruncom` ON `speedrun_categories` (`speedruncom_category_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_discord_id_unique` ON `users` (`discord_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_mcid_unique` ON `users` (`mcid`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_uuid_unique` ON `users` (`uuid`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_slug_unique` ON `users` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_users_discord_id` ON `users` (`discord_id`);--> statement-breakpoint
CREATE INDEX `idx_users_mcid` ON `users` (`mcid`);--> statement-breakpoint
CREATE INDEX `idx_users_uuid` ON `users` (`uuid`);--> statement-breakpoint
CREATE INDEX `idx_users_slug` ON `users` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_users_speedruncom_id` ON `users` (`speedruncom_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `youtube_live_cache_video_id_unique` ON `youtube_live_cache` (`video_id`);--> statement-breakpoint
CREATE INDEX `idx_youtube_live_video_id` ON `youtube_live_cache` (`video_id`);--> statement-breakpoint
CREATE INDEX `idx_youtube_live_channel_id` ON `youtube_live_cache` (`channel_id`);--> statement-breakpoint
CREATE INDEX `idx_youtube_live_mcid` ON `youtube_live_cache` (`minefolio_mcid`);--> statement-breakpoint
CREATE INDEX `idx_youtube_live_status` ON `youtube_live_cache` (`live_broadcast_content`);--> statement-breakpoint
CREATE UNIQUE INDEX `youtube_video_cache_video_id_unique` ON `youtube_video_cache` (`video_id`);--> statement-breakpoint
CREATE INDEX `idx_youtube_cache_video_id` ON `youtube_video_cache` (`video_id`);--> statement-breakpoint
CREATE INDEX `idx_youtube_cache_channel_id` ON `youtube_video_cache` (`channel_id`);--> statement-breakpoint
CREATE INDEX `idx_youtube_cache_mcid` ON `youtube_video_cache` (`minefolio_mcid`);--> statement-breakpoint
CREATE INDEX `idx_youtube_cache_published` ON `youtube_video_cache` (`published_at`);--> statement-breakpoint
CREATE INDEX `idx_youtube_cache_available` ON `youtube_video_cache` (`is_available`);--> statement-breakpoint
ALTER TABLE `users` ADD `display_name_alphabet` text;--> statement-breakpoint
ALTER TABLE `users` ADD `rta_started_year_month` text;--> statement-breakpoint
ALTER TABLE `config_presets` ADD `is_main` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `config_presets` ADD `search_craft_loops_data` text;--> statement-breakpoint
ALTER TABLE `search_craft_templates` ADD `loops_data` text;--> statement-breakpoint
CREATE INDEX `idx_paceman_paces_mcid_lower` ON `paceman_paces` (lower("mcid"));