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
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_custom_actions_user_trigger` ON `custom_actions` (`user_id`,`trigger_key`);--> statement-breakpoint
CREATE INDEX `idx_custom_actions_user_id` ON `custom_actions` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_custom_actions_category` ON `custom_actions` (`category`);--> statement-breakpoint
ALTER TABLE `key_remaps` ADD `output_mode` text DEFAULT 'key';--> statement-breakpoint
ALTER TABLE `key_remaps` ADD `output_character` text;