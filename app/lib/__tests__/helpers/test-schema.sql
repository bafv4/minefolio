CREATE TABLE `api_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`cache_key` text NOT NULL,
	`cache_type` text NOT NULL,
	`data` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);

CREATE UNIQUE INDEX `api_cache_cache_key_unique` ON `api_cache` (`cache_key`);
CREATE INDEX `idx_api_cache_key` ON `api_cache` (`cache_key`);
CREATE INDEX `idx_api_cache_type` ON `api_cache` (`cache_type`);
CREATE INDEX `idx_api_cache_expires` ON `api_cache` (`expires_at`);
CREATE TABLE `app_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);

CREATE TABLE `auth_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `auth_users`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE `auth_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `auth_users`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE UNIQUE INDEX `auth_sessions_token_unique` ON `auth_sessions` (`token`);
CREATE TABLE `auth_users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`email` text,
	`email_verified` integer,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);

CREATE UNIQUE INDEX `auth_users_email_unique` ON `auth_users` (`email`);
CREATE TABLE `auth_verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);

CREATE TABLE `category_records` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`category` text NOT NULL,
	`category_display_name` text NOT NULL,
	`subcategory` text,
	`version` text,
	`category_ref_id` text,
	`record_type` text NOT NULL,
	`personal_best` integer,
	`pb_date` integer,
	`pb_video_url` text,
	`pb_notes` text,
	`target_time` integer,
	`target_deadline` integer,
	`target_notes` text,
	`achieved` integer DEFAULT false NOT NULL,
	`achieved_at` integer,
	`is_visible` integer DEFAULT true NOT NULL,
	`display_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`is_pinned` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE UNIQUE INDEX `idx_category_records_user_category_type` ON `category_records` (`user_id`,`category`,`record_type`);
CREATE INDEX `idx_category_records_user_id` ON `category_records` (`user_id`);
CREATE INDEX `idx_category_records_category` ON `category_records` (`category`);
CREATE INDEX `idx_category_records_type` ON `category_records` (`record_type`);
CREATE TABLE `config_history` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`change_type` text NOT NULL,
	`change_description` text NOT NULL,
	`previous_data` text,
	`new_data` text,
	`preset_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`preset_id`) REFERENCES `config_presets`(`id`) ON UPDATE no action ON DELETE set null
);

CREATE INDEX `idx_config_history_user_id` ON `config_history` (`user_id`);
CREATE INDEX `idx_config_history_created_at` ON `config_history` (`created_at`);
CREATE INDEX `idx_config_history_change_type` ON `config_history` (`change_type`);
CREATE TABLE `config_presets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`is_active` integer DEFAULT false NOT NULL,
	`is_main` integer DEFAULT false NOT NULL,
	`keybindings_data` text,
	`player_config_data` text,
	`remaps_data` text,
	`finger_assignments_data` text,
	`item_layouts_data` text,
	`search_crafts_data` text,
	`custom_keys_data` text,
	`custom_actions_data` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE INDEX `idx_config_presets_user_id` ON `config_presets` (`user_id`);
CREATE INDEX `idx_config_presets_is_active` ON `config_presets` (`is_active`);
CREATE INDEX `idx_config_presets_is_main` ON `config_presets` (`is_main`);
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

CREATE UNIQUE INDEX `content_translations_target_locale_uniq` ON `content_translations` (`target_type`,`target_id`,`locale`);
CREATE INDEX `content_translations_status_idx` ON `content_translations` (`status`,`updated_at`);
CREATE TABLE `custom_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`action_name` text NOT NULL,
	`description` text,
	`category` text DEFAULT 'other' NOT NULL,
	`trigger_key` text NOT NULL,
	`display_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE UNIQUE INDEX `idx_custom_actions_user_trigger` ON `custom_actions` (`user_id`,`trigger_key`);
CREATE INDEX `idx_custom_actions_user_id` ON `custom_actions` (`user_id`);
CREATE INDEX `idx_custom_actions_category` ON `custom_actions` (`category`);
CREATE TABLE `custom_fields` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`field_name` text NOT NULL,
	`field_value` text NOT NULL,
	`field_type` text DEFAULT 'text' NOT NULL,
	`display_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE `custom_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`key_code` text NOT NULL,
	`key_name` text NOT NULL,
	`category` text NOT NULL,
	`position` text,
	`size` text,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE UNIQUE INDEX `idx_custom_keys_user_keycode` ON `custom_keys` (`user_id`,`key_code`);
CREATE TABLE `external_stats` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`service` text NOT NULL,
	`data` text NOT NULL,
	`last_fetched` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE UNIQUE INDEX `idx_external_stats_user_service` ON `external_stats` (`user_id`,`service`);
CREATE INDEX `idx_external_stats_user_id` ON `external_stats` (`user_id`);
CREATE INDEX `idx_external_stats_service` ON `external_stats` (`service`);
CREATE TABLE `external_tools` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`trigger_key` text NOT NULL,
	`tool_name` text NOT NULL,
	`action_name` text NOT NULL,
	`description` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE UNIQUE INDEX `idx_external_tools_user_trigger_tool` ON `external_tools` (`user_id`,`trigger_key`,`tool_name`);
CREATE TABLE `favorites` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`favorite_slug` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE UNIQUE INDEX `idx_favorites_user_slug` ON `favorites` (`user_id`,`favorite_slug`);
CREATE INDEX `idx_favorites_user_id` ON `favorites` (`user_id`);
CREATE TABLE `guide_likes` (
	`id` text PRIMARY KEY NOT NULL,
	`guide_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`guide_id`) REFERENCES `guides`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE UNIQUE INDEX `guide_likes_guide_user_uniq` ON `guide_likes` (`guide_id`,`user_id`);
CREATE INDEX `guide_likes_user_idx` ON `guide_likes` (`user_id`,`guide_id`);
CREATE TABLE `guides` (
	`id` text PRIMARY KEY NOT NULL,
	`author_id` text NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`summary` text,
	`content` text DEFAULT '' NOT NULL,
	`cover_image_url` text,
	`is_published` integer DEFAULT false NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`view_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`draft_title` text,
	`draft_summary` text,
	`draft_content` text,
	`draft_cover_image_url` text,
	`draft_tags` text,
	`draft_updated_at` integer,
	`is_pinned` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE UNIQUE INDEX `guides_author_slug_uniq` ON `guides` (`author_id`,`slug`);
CREATE INDEX `guides_feed_idx` ON `guides` (`is_published`,`updated_at`);
CREATE INDEX `guides_author_idx` ON `guides` (`author_id`);
CREATE TABLE `item_layouts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`segment` text NOT NULL,
	`slots` text NOT NULL,
	`offhand` text,
	`notes` text,
	`display_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE UNIQUE INDEX `idx_item_layouts_user_segment` ON `item_layouts` (`user_id`,`segment`);
CREATE TABLE `key_remaps` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`source_key` text NOT NULL,
	`target_key` text,
	`software` text,
	`notes` text,
	`output_mode` text DEFAULT 'key',
	`output_character` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`remap_type` text DEFAULT 'unset' NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE UNIQUE INDEX `idx_key_remaps_user_source_type` ON `key_remaps` (`user_id`,`source_key`,`remap_type`);
CREATE TABLE `keybindings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`action` text NOT NULL,
	`key_code` text NOT NULL,
	`category` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE UNIQUE INDEX `idx_keybindings_user_action` ON `keybindings` (`user_id`,`action`);
CREATE INDEX `idx_keybindings_user_id` ON `keybindings` (`user_id`);
CREATE INDEX `idx_keybindings_category` ON `keybindings` (`category`);
CREATE TABLE `paceman_paces` (
	`id` text PRIMARY KEY NOT NULL,
	`paceman_run_id` integer NOT NULL,
	`mcid` text NOT NULL,
	`user_id` text,
	`timeline` text NOT NULL,
	`rta` integer NOT NULL,
	`igt` integer,
	`date` integer NOT NULL,
	`is_nether_enter` integer DEFAULT false NOT NULL,
	`is_2nd_structure_or_later` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);

CREATE INDEX `idx_paceman_paces_mcid` ON `paceman_paces` (`mcid`);
CREATE INDEX `idx_paceman_paces_mcid_lower` ON `paceman_paces` (lower("mcid"));
CREATE INDEX `idx_paceman_paces_user_id` ON `paceman_paces` (`user_id`);
CREATE INDEX `idx_paceman_paces_date` ON `paceman_paces` (`date`);
CREATE INDEX `idx_paceman_paces_timeline` ON `paceman_paces` (`timeline`);
CREATE INDEX `idx_paceman_paces_is_nether_enter` ON `paceman_paces` (`is_nether_enter`);
CREATE INDEX `idx_paceman_paces_is_2nd_structure_or_later` ON `paceman_paces` (`is_2nd_structure_or_later`);
CREATE INDEX `idx_paceman_paces_run_id` ON `paceman_paces` (`paceman_run_id`);
CREATE TABLE `page_view_stats` (
	`id` text PRIMARY KEY NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`pageviews` integer DEFAULT 0 NOT NULL,
	`window_start` integer NOT NULL,
	`window_end` integer NOT NULL,
	`fetched_at` integer NOT NULL
);

CREATE UNIQUE INDEX `page_view_stats_target_uniq` ON `page_view_stats` (`target_type`,`target_id`);
CREATE TABLE `player_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`keyboard_layout` text,
	`keyboard_model` text,
	`mouse_dpi` integer,
	`game_sensitivity` real,
	`windows_speed` integer,
	`windows_speed_multiplier` real,
	`mouse_acceleration` integer DEFAULT false,
	`raw_input` integer DEFAULT true,
	`cm360` real,
	`mouse_model` text,
	`toggle_sprint` integer,
	`toggle_sneak` integer,
	`auto_jump` integer,
	`game_language` text,
	`fov` integer,
	`gui_scale` integer,
	`finger_assignments` text,
	`controller_settings` text,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE UNIQUE INDEX `player_configs_user_id_unique` ON `player_configs` (`user_id`);
CREATE TABLE `player_rankings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`ranking_type` text NOT NULL,
	`category_id` text,
	`speedruncom_run_id` text,
	`speedruncom_player_id` text,
	`verification_status` text DEFAULT 'verified',
	`time_ms` integer,
	`time_formatted` text,
	`elo_rate` integer,
	`wins` integer,
	`losses` integer,
	`win_rate` real,
	`record_date` text,
	`video_url` text,
	`run_weblink` text,
	`last_fetched` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `speedrun_categories`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE INDEX `idx_player_rankings_user` ON `player_rankings` (`user_id`);
CREATE INDEX `idx_player_rankings_type` ON `player_rankings` (`ranking_type`);
CREATE INDEX `idx_player_rankings_category` ON `player_rankings` (`category_id`);
CREATE INDEX `idx_player_rankings_time` ON `player_rankings` (`time_ms`);
CREATE INDEX `idx_player_rankings_elo` ON `player_rankings` (`elo_rate`);
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

CREATE UNIQUE INDEX `playstyles_user_id_unique` ON `playstyles` (`user_id`);
CREATE TABLE `profile_reactions` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_user_id` text NOT NULL,
	`reactor_user_id` text NOT NULL,
	`emoji` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`profile_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reactor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE UNIQUE INDEX `profile_reactions_profile_emoji_reactor_uniq` ON `profile_reactions` (`profile_user_id`,`emoji`,`reactor_user_id`);
CREATE INDEX `profile_reactions_reactor_idx` ON `profile_reactions` (`reactor_user_id`,`profile_user_id`,`emoji`);
CREATE TABLE `profile_videos` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`url` text NOT NULL,
	`title` text,
	`is_pinned` integer DEFAULT false NOT NULL,
	`display_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE INDEX `idx_profile_videos_user_id` ON `profile_videos` (`user_id`);
CREATE TABLE `rankings_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`cache_key` text NOT NULL,
	`cache_type` text NOT NULL,
	`category_id` text,
	`data` text NOT NULL,
	`expires_at` integer NOT NULL,
	`last_fetched` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `speedrun_categories`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE UNIQUE INDEX `rankings_cache_cache_key_unique` ON `rankings_cache` (`cache_key`);
CREATE INDEX `idx_rankings_cache_key` ON `rankings_cache` (`cache_key`);
CREATE INDEX `idx_rankings_cache_type` ON `rankings_cache` (`cache_type`);
CREATE INDEX `idx_rankings_cache_expires` ON `rankings_cache` (`expires_at`);
CREATE INDEX `idx_rankings_cache_category` ON `rankings_cache` (`category_id`);
CREATE TABLE `search_craft_template_likes` (
	`id` text PRIMARY KEY NOT NULL,
	`template_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`template_id`) REFERENCES `search_craft_templates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE UNIQUE INDEX `search_craft_template_likes_template_user_uniq` ON `search_craft_template_likes` (`template_id`,`user_id`);
CREATE INDEX `search_craft_template_likes_user_idx` ON `search_craft_template_likes` (`user_id`,`template_id`);
CREATE TABLE `search_craft_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`crafts_data` text NOT NULL,
	`remaps_data` text,
	`is_published` integer DEFAULT true NOT NULL,
	`apply_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`game_language` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE INDEX `idx_search_craft_templates_user_id` ON `search_craft_templates` (`user_id`);
CREATE INDEX `idx_search_craft_templates_published_created` ON `search_craft_templates` (`is_published`,`created_at`);
CREATE TABLE `search_crafts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`items` text NOT NULL,
	`keys` text NOT NULL,
	`search_str` text,
	`comment` text,
	`timing` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`with_shift` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE UNIQUE INDEX `idx_search_crafts_user_sequence` ON `search_crafts` (`user_id`,`sequence`);
CREATE TABLE `social_links` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`platform` text NOT NULL,
	`identifier` text NOT NULL,
	`custom_label` text,
	`custom_url` text,
	`display_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE INDEX `idx_social_links_user_id` ON `social_links` (`user_id`);
CREATE INDEX `idx_social_links_platform` ON `social_links` (`platform`);
CREATE TABLE `speedrun_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`speedruncom_game_id` text,
	`speedruncom_category_id` text,
	`speedruncom_variables` text,
	`category_type` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`display_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);

CREATE UNIQUE INDEX `speedrun_categories_slug_unique` ON `speedrun_categories` (`slug`);
CREATE INDEX `idx_speedrun_categories_slug` ON `speedrun_categories` (`slug`);
CREATE INDEX `idx_speedrun_categories_type` ON `speedrun_categories` (`category_type`);
CREATE INDEX `idx_speedrun_categories_speedruncom` ON `speedrun_categories` (`speedruncom_category_id`);
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

CREATE UNIQUE INDEX `twitch_vod_cache_vod_id_unique` ON `twitch_vod_cache` (`vod_id`);
CREATE INDEX `idx_twitch_vod_cache_user_login` ON `twitch_vod_cache` (`user_login`);
CREATE INDEX `idx_twitch_vod_cache_published` ON `twitch_vod_cache` (`published_at`);
CREATE INDEX `idx_twitch_vod_cache_available` ON `twitch_vod_cache` (`is_available`);
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`discord_id` text NOT NULL,
	`mcid` text,
	`uuid` text,
	`slug` text NOT NULL,
	`display_name` text,
	`display_name_alphabet` text,
	`discord_avatar` text,
	`bio` text,
	`has_imported` integer DEFAULT false NOT NULL,
	`profile_visibility` text DEFAULT 'public' NOT NULL,
	`profile_pose` text DEFAULT 'waving',
	`slim_skin` integer DEFAULT false,
	`location` text,
	`pronouns` text,
	`default_profile_tab` text DEFAULT 'keybindings',
	`featured_video_url` text,
	`main_edition` text,
	`main_platform` text,
	`role` text,
	`input_method` text,
	`input_method_badge` text,
	`short_bio` text,
	`speedruncom_username` text,
	`speedruncom_id` text,
	`speedruncom_last_sync` integer,
	`hidden_speedrun_records` text,
	`show_paceman_on_home` integer DEFAULT true,
	`show_twitch_on_home` integer DEFAULT true,
	`show_youtube_on_home` integer DEFAULT true,
	`show_ranked_stats` integer DEFAULT true,
	`show_paceman_stats` integer DEFAULT true,
	`profile_views` integer DEFAULT 0 NOT NULL,
	`last_active` integer,
	`custom_skin_url` text,
	`custom_skin_model` text,
	`custom_skin_updated_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`pinned_speedrun_records` text,
	`rta_started_year_month` text
);

CREATE UNIQUE INDEX `users_discord_id_unique` ON `users` (`discord_id`);
CREATE UNIQUE INDEX `users_mcid_unique` ON `users` (`mcid`);
CREATE UNIQUE INDEX `users_uuid_unique` ON `users` (`uuid`);
CREATE UNIQUE INDEX `users_slug_unique` ON `users` (`slug`);
CREATE INDEX `idx_users_discord_id` ON `users` (`discord_id`);
CREATE INDEX `idx_users_mcid` ON `users` (`mcid`);
CREATE INDEX `idx_users_uuid` ON `users` (`uuid`);
CREATE INDEX `idx_users_slug` ON `users` (`slug`);
CREATE INDEX `idx_users_speedruncom_id` ON `users` (`speedruncom_id`);
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

CREATE UNIQUE INDEX `youtube_live_cache_video_id_unique` ON `youtube_live_cache` (`video_id`);
CREATE INDEX `idx_youtube_live_video_id` ON `youtube_live_cache` (`video_id`);
CREATE INDEX `idx_youtube_live_channel_id` ON `youtube_live_cache` (`channel_id`);
CREATE INDEX `idx_youtube_live_mcid` ON `youtube_live_cache` (`minefolio_mcid`);
CREATE INDEX `idx_youtube_live_status` ON `youtube_live_cache` (`live_broadcast_content`);
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

CREATE UNIQUE INDEX `youtube_video_cache_video_id_unique` ON `youtube_video_cache` (`video_id`);
CREATE INDEX `idx_youtube_cache_video_id` ON `youtube_video_cache` (`video_id`);
CREATE INDEX `idx_youtube_cache_channel_id` ON `youtube_video_cache` (`channel_id`);
CREATE INDEX `idx_youtube_cache_mcid` ON `youtube_video_cache` (`minefolio_mcid`);
CREATE INDEX `idx_youtube_cache_published` ON `youtube_video_cache` (`published_at`);
CREATE INDEX `idx_youtube_cache_available` ON `youtube_video_cache` (`is_available`);
