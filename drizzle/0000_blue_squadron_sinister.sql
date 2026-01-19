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
--> statement-breakpoint
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
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_sessions_token_unique` ON `auth_sessions` (`token`);--> statement-breakpoint
CREATE TABLE `auth_users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`email` text,
	`email_verified` integer,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_users_email_unique` ON `auth_users` (`email`);--> statement-breakpoint
CREATE TABLE `auth_verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `category_records` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`category` text NOT NULL,
	`category_display_name` text NOT NULL,
	`subcategory` text,
	`version` text,
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
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_category_records_user_category_type` ON `category_records` (`user_id`,`category`,`record_type`);--> statement-breakpoint
CREATE INDEX `idx_category_records_user_id` ON `category_records` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_category_records_category` ON `category_records` (`category`);--> statement-breakpoint
CREATE INDEX `idx_category_records_type` ON `category_records` (`record_type`);--> statement-breakpoint
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
--> statement-breakpoint
CREATE INDEX `idx_config_history_user_id` ON `config_history` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_config_history_created_at` ON `config_history` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_config_history_change_type` ON `config_history` (`change_type`);--> statement-breakpoint
CREATE TABLE `config_presets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`is_active` integer DEFAULT false NOT NULL,
	`keybindings_data` text,
	`player_config_data` text,
	`remaps_data` text,
	`finger_assignments_data` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_config_presets_user_id` ON `config_presets` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_config_presets_is_active` ON `config_presets` (`is_active`);--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_custom_keys_user_keycode` ON `custom_keys` (`user_id`,`key_code`);--> statement-breakpoint
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
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_external_stats_user_service` ON `external_stats` (`user_id`,`service`);--> statement-breakpoint
CREATE INDEX `idx_external_stats_user_id` ON `external_stats` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_external_stats_service` ON `external_stats` (`service`);--> statement-breakpoint
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
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_external_tools_user_trigger_tool` ON `external_tools` (`user_id`,`trigger_key`,`tool_name`);--> statement-breakpoint
CREATE TABLE `favorites` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`favorite_mcid` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_favorites_user_mcid` ON `favorites` (`user_id`,`favorite_mcid`);--> statement-breakpoint
CREATE INDEX `idx_favorites_user_id` ON `favorites` (`user_id`);--> statement-breakpoint
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
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_item_layouts_user_segment` ON `item_layouts` (`user_id`,`segment`);--> statement-breakpoint
CREATE TABLE `key_remaps` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`source_key` text NOT NULL,
	`target_key` text,
	`software` text,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_key_remaps_user_source` ON `key_remaps` (`user_id`,`source_key`);--> statement-breakpoint
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
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_keybindings_user_action` ON `keybindings` (`user_id`,`action`);--> statement-breakpoint
CREATE INDEX `idx_keybindings_user_id` ON `keybindings` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_keybindings_category` ON `keybindings` (`category`);--> statement-breakpoint
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
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `player_configs_user_id_unique` ON `player_configs` (`user_id`);--> statement-breakpoint
CREATE TABLE `search_crafts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`items` text NOT NULL,
	`keys` text NOT NULL,
	`search_str` text,
	`comment` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_search_crafts_user_sequence` ON `search_crafts` (`user_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `social_links` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`platform` text NOT NULL,
	`identifier` text NOT NULL,
	`display_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_social_links_user_id` ON `social_links` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_social_links_platform` ON `social_links` (`platform`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`discord_id` text NOT NULL,
	`mcid` text NOT NULL,
	`uuid` text NOT NULL,
	`display_name` text,
	`discord_avatar` text,
	`bio` text,
	`has_imported` integer DEFAULT false NOT NULL,
	`profile_visibility` text DEFAULT 'public' NOT NULL,
	`profile_pose` text DEFAULT 'waving',
	`location` text,
	`pronouns` text,
	`default_profile_tab` text DEFAULT 'keybindings',
	`featured_video_url` text,
	`main_edition` text,
	`main_platform` text,
	`role` text,
	`short_bio` text,
	`speedruncom_username` text,
	`speedruncom_id` text,
	`speedruncom_last_sync` integer,
	`hidden_speedrun_records` text,
	`profile_views` integer DEFAULT 0 NOT NULL,
	`last_active` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_discord_id_unique` ON `users` (`discord_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_mcid_unique` ON `users` (`mcid`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_uuid_unique` ON `users` (`uuid`);--> statement-breakpoint
CREATE INDEX `idx_users_discord_id` ON `users` (`discord_id`);--> statement-breakpoint
CREATE INDEX `idx_users_mcid` ON `users` (`mcid`);--> statement-breakpoint
CREATE INDEX `idx_users_uuid` ON `users` (`uuid`);--> statement-breakpoint
CREATE INDEX `idx_users_speedruncom_id` ON `users` (`speedruncom_id`);