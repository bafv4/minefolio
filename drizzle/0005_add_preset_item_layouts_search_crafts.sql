-- Add item_layouts_data and search_crafts_data columns to config_presets
ALTER TABLE `config_presets` ADD COLUMN `item_layouts_data` text;
--> statement-breakpoint
ALTER TABLE `config_presets` ADD COLUMN `search_crafts_data` text;
--> statement-breakpoint
-- Migrate existing item_layouts and search_crafts to active presets
-- This is done via application code after schema push, as SQLite doesn't support complex UPDATE with JOIN
