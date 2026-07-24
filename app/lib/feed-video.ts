// 動画フィード（YouTube動画 / Twitch VOD）の共有ドメイン型・ユーティリティ。
// クライアント（カード・ページ）とサーバー（キャッシュ層・API）の両方から import されるため、
// DBアクセス等のサーバー専用コードは置かない（クエリは videos-feed.server.ts / 各キャッシュ層に置く）

/** 動画・VODの保持期間（日）。cron のクリーンアップと表示フィルタの両方で使用 */
export const VIDEO_FEED_RETENTION_DAYS = 90;

/** 保持期間の下限日時（これより古い動画・VODは表示・保持しない） */
export function videoRetentionCutoff(now: number = Date.now()): Date {
  return new Date(now - VIDEO_FEED_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * 動画フィードの統一アイテム（YouTube動画 / Twitch VOD）。
 * publishedAt はAPIレスポンス由来のためISO文字列とDateの両方を許容する
 */
export interface FeedVideo {
  platform: "youtube" | "twitch";
  videoId: string;
  title: string;
  thumbnailUrl: string | null;
  channelTitle: string | null;
  publishedAt: string | Date;
  /** 配信時間（秒）。Twitch VODのみ */
  durationSeconds?: number | null;
  /** 紐付けMinefolioユーザーのMCID（「自分の動画を隠す」フィルタ用） */
  minefolioMcid: string | null;
  uuid: string | null;
  slug: string | null;
  displayName: string | null;
  discordAvatar: string | null;
  customSkinUrl: string | null;
}

/** フィード内の一意キー（動画IDはプラットフォームごとの名前空間なので単独では衝突し得る） */
export function feedVideoKey(video: Pick<FeedVideo, "platform" | "videoId">): string {
  return `${video.platform}:${video.videoId}`;
}

/** 「自分の動画/VODを表示しない」設定（ホーム・/videos 共通） */
export interface OwnVideoPrefs {
  mcid: string | null;
  showYoutubeOnHome: boolean;
  showTwitchOnHome: boolean;
}

/**
 * 自分の動画/VODをプラットフォーム別フラグに従って除外する。
 * レスポンス自体はユーザー非依存（CDNキャッシュ対象）のため、このフィルタは
 * 常にクライアント側で適用する（ホーム・/videos 共通の規約）
 */
export function filterOwnVideos<T extends FeedVideo>(videos: T[], prefs: OwnVideoPrefs): T[] {
  const myMcid = prefs.mcid?.toLowerCase();
  if (!myMcid || (prefs.showYoutubeOnHome && prefs.showTwitchOnHome)) return videos;
  return videos.filter((video) => {
    if (!video.minefolioMcid || video.minefolioMcid.toLowerCase() !== myMcid) return true;
    return video.platform === "youtube" ? prefs.showYoutubeOnHome : prefs.showTwitchOnHome;
  });
}
