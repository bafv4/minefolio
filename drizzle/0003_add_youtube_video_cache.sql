-- YouTube動画キャッシュテーブルを追加
-- 動画情報を永続的にキャッシュし、定期的に存在確認を行う

CREATE TABLE IF NOT EXISTS youtube_video_cache (
  id TEXT PRIMARY KEY,
  video_id TEXT UNIQUE NOT NULL,
  channel_id TEXT NOT NULL,
  minefolio_mcid TEXT,
  title TEXT NOT NULL,
  description TEXT,
  thumbnail_url TEXT,
  channel_title TEXT,
  published_at INTEGER NOT NULL,
  last_verified_at INTEGER NOT NULL DEFAULT (unixepoch()),
  is_available INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_youtube_cache_video_id ON youtube_video_cache(video_id);
CREATE INDEX IF NOT EXISTS idx_youtube_cache_channel_id ON youtube_video_cache(channel_id);
CREATE INDEX IF NOT EXISTS idx_youtube_cache_mcid ON youtube_video_cache(minefolio_mcid);
CREATE INDEX IF NOT EXISTS idx_youtube_cache_published ON youtube_video_cache(published_at);
CREATE INDEX IF NOT EXISTS idx_youtube_cache_available ON youtube_video_cache(is_available);
