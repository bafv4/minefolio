-- YouTubeライブ配信キャッシュテーブル
CREATE TABLE IF NOT EXISTS `youtube_live_cache` (
  `id` text PRIMARY KEY NOT NULL,
  `video_id` text NOT NULL,
  `channel_id` text NOT NULL,
  `minefolio_mcid` text,
  `title` text NOT NULL,
  `description` text,
  `thumbnail_url` text,
  `channel_title` text,
  `live_broadcast_content` text NOT NULL,
  `scheduled_start_time` integer,
  `actual_start_time` integer,
  `concurrent_viewers` integer,
  `last_checked_at` integer NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);

-- インデックス
CREATE UNIQUE INDEX IF NOT EXISTS `youtube_live_cache_video_id_unique` ON `youtube_live_cache` (`video_id`);
CREATE INDEX IF NOT EXISTS `idx_youtube_live_video_id` ON `youtube_live_cache` (`video_id`);
CREATE INDEX IF NOT EXISTS `idx_youtube_live_channel_id` ON `youtube_live_cache` (`channel_id`);
CREATE INDEX IF NOT EXISTS `idx_youtube_live_mcid` ON `youtube_live_cache` (`minefolio_mcid`);
CREATE INDEX IF NOT EXISTS `idx_youtube_live_status` ON `youtube_live_cache` (`live_broadcast_content`);
