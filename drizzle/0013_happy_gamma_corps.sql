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
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_search_craft_templates_user_id` ON `search_craft_templates` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_search_craft_templates_published_created` ON `search_craft_templates` (`is_published`,`created_at`);