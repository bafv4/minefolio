-- APIキャッシュテーブルを追加
-- YouTube動画、過去のペース、Twitchストリーム、ライブランのキャッシュ用

CREATE TABLE IF NOT EXISTS api_cache (
  id TEXT PRIMARY KEY,
  cache_key TEXT UNIQUE NOT NULL,
  cache_type TEXT NOT NULL CHECK (cache_type IN ('youtube_videos', 'recent_paces', 'twitch_streams', 'live_runs')),
  data TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_api_cache_key ON api_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_api_cache_type ON api_cache(cache_type);
CREATE INDEX IF NOT EXISTS idx_api_cache_expires ON api_cache(expires_at);
