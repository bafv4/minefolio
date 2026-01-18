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
CREATE INDEX `idx_config_history_change_type` ON `config_history` (`change_type`);
