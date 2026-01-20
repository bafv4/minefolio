-- MCID任意化のマイグレーション
-- SQLiteではALTER TABLEでNOT NULL制約を削除できないため、テーブル再作成が必要

-- 外部キー制約を一時的に無効化
PRAGMA foreign_keys=OFF;

-- Step 1: 新しいusersテーブルを作成（mcid/uuidをnullable、slugを追加）
CREATE TABLE `users_new` (
	`id` text PRIMARY KEY NOT NULL,
	`discord_id` text NOT NULL,
	`mcid` text,
	`uuid` text,
	`slug` text NOT NULL,
	`display_name` text,
	`discord_avatar` text,
	`bio` text,
	`has_imported` integer DEFAULT false NOT NULL,
	`profile_visibility` text DEFAULT 'public' NOT NULL,
	`profile_pose` text DEFAULT 'waving',
	`location` text,
	`pronouns` text,
	`default_profile_tab` text DEFAULT 'keybindings',
	`featured_video_url` text,
	`main_edition` text,
	`main_platform` text,
	`role` text,
	`short_bio` text,
	`speedruncom_username` text,
	`speedruncom_id` text,
	`speedruncom_last_sync` integer,
	`hidden_speedrun_records` text,
	`profile_views` integer DEFAULT 0 NOT NULL,
	`last_active` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);

-- Step 2: 既存データを移行（slugはmcidから生成）
INSERT INTO `users_new`
SELECT
	`id`,
	`discord_id`,
	`mcid`,
	`uuid`,
	`mcid` as `slug`,  -- 既存ユーザーはslug=mcid
	`display_name`,
	`discord_avatar`,
	`bio`,
	`has_imported`,
	`profile_visibility`,
	`profile_pose`,
	`location`,
	`pronouns`,
	`default_profile_tab`,
	`featured_video_url`,
	`main_edition`,
	`main_platform`,
	`role`,
	`short_bio`,
	`speedruncom_username`,
	`speedruncom_id`,
	`speedruncom_last_sync`,
	`hidden_speedrun_records`,
	`profile_views`,
	`last_active`,
	`created_at`,
	`updated_at`
FROM `users`;

-- Step 3: 旧テーブルを削除
DROP TABLE `users`;

-- Step 4: 新テーブルをリネーム
ALTER TABLE `users_new` RENAME TO `users`;

-- Step 5: インデックスとユニーク制約を再作成
CREATE UNIQUE INDEX `users_discord_id_unique` ON `users` (`discord_id`);
CREATE UNIQUE INDEX `users_mcid_unique` ON `users` (`mcid`);
CREATE UNIQUE INDEX `users_uuid_unique` ON `users` (`uuid`);
CREATE UNIQUE INDEX `users_slug_unique` ON `users` (`slug`);
CREATE INDEX `idx_users_discord_id` ON `users` (`discord_id`);
CREATE INDEX `idx_users_mcid` ON `users` (`mcid`);
CREATE INDEX `idx_users_uuid` ON `users` (`uuid`);
CREATE INDEX `idx_users_slug` ON `users` (`slug`);
CREATE INDEX `idx_users_speedruncom_id` ON `users` (`speedruncom_id`);

-- 外部キー制約を再有効化
PRAGMA foreign_keys=ON;
