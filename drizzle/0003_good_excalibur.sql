CREATE TABLE `paceman_paces` (
	`id` text PRIMARY KEY NOT NULL,
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
--> statement-breakpoint
CREATE INDEX `idx_paceman_paces_mcid` ON `paceman_paces` (`mcid`);--> statement-breakpoint
CREATE INDEX `idx_paceman_paces_user_id` ON `paceman_paces` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_paceman_paces_date` ON `paceman_paces` (`date`);--> statement-breakpoint
CREATE INDEX `idx_paceman_paces_timeline` ON `paceman_paces` (`timeline`);--> statement-breakpoint
CREATE INDEX `idx_paceman_paces_is_nether_enter` ON `paceman_paces` (`is_nether_enter`);--> statement-breakpoint
CREATE INDEX `idx_paceman_paces_is_2nd_structure_or_later` ON `paceman_paces` (`is_2nd_structure_or_later`);--> statement-breakpoint
ALTER TABLE `users` ADD `show_paceman_stats` integer DEFAULT true;