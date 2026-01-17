ALTER TABLE `player_configs` ADD `fov` integer;--> statement-breakpoint
ALTER TABLE `player_configs` ADD `gui_scale` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `default_profile_tab` text DEFAULT 'keybindings';--> statement-breakpoint
ALTER TABLE `users` ADD `featured_video_url` text;