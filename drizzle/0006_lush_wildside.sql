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
--> statement-breakpoint
CREATE UNIQUE INDEX `rankings_cache_cache_key_unique` ON `rankings_cache` (`cache_key`);--> statement-breakpoint
CREATE INDEX `idx_rankings_cache_key` ON `rankings_cache` (`cache_key`);--> statement-breakpoint
CREATE INDEX `idx_rankings_cache_type` ON `rankings_cache` (`cache_type`);--> statement-breakpoint
CREATE INDEX `idx_rankings_cache_expires` ON `rankings_cache` (`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_rankings_cache_category` ON `rankings_cache` (`category_id`);--> statement-breakpoint
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
--> statement-breakpoint
CREATE UNIQUE INDEX `speedrun_categories_slug_unique` ON `speedrun_categories` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_speedrun_categories_slug` ON `speedrun_categories` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_speedrun_categories_type` ON `speedrun_categories` (`category_type`);--> statement-breakpoint
CREATE INDEX `idx_speedrun_categories_speedruncom` ON `speedrun_categories` (`speedruncom_category_id`);--> statement-breakpoint
ALTER TABLE `category_records` ADD `category_ref_id` text;