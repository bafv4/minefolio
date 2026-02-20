ALTER TABLE `paceman_paces` ADD `paceman_run_id` integer NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_paceman_paces_run_id` ON `paceman_paces` (`paceman_run_id`);