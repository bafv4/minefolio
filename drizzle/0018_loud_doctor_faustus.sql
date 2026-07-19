DROP INDEX `idx_key_remaps_user_source`;--> statement-breakpoint
ALTER TABLE `key_remaps` ADD `remap_type` text DEFAULT 'unset' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_key_remaps_user_source_type` ON `key_remaps` (`user_id`,`source_key`,`remap_type`);