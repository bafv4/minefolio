CREATE TABLE `slug_history` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `slug_history_slug_uniq` ON `slug_history` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_slug_history_user_id` ON `slug_history` (`user_id`);--> statement-breakpoint
ALTER TABLE `search_crafts` ADD `search_variations` text;