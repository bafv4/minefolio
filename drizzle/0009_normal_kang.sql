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
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `guides_author_slug_uniq` ON `guides` (`author_id`,`slug`);--> statement-breakpoint
CREATE INDEX `guides_feed_idx` ON `guides` (`is_published`,`updated_at`);--> statement-breakpoint
CREATE INDEX `guides_author_idx` ON `guides` (`author_id`);--> statement-breakpoint
ALTER TABLE `social_links` ADD `custom_label` text;--> statement-breakpoint
ALTER TABLE `social_links` ADD `custom_url` text;