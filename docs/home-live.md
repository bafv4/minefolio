# ホーム画面・ライブ機能 仕様書

## ホーム画面 (/home)

### 概要

Minefolioのトップページ。登録ユーザーのアクティビティ、ガイド、YouTube動画、PaceManペース、Twitchストリーム、ライブランをまとめて表示するフィードを提供する。

### 認証・登録チェック

- `getOptionalSession()` でセッションを取得（未ログインでもアクセス可能）
- セッションがある場合、`users` テーブルから `discordId` で登録済みユーザーを検索
- 登録済みの場合 `isRegistered = true` を返し、ユーザーの表示設定（`showPacemanOnHome`, `showYoutubeOnHome`）を取得

### ホームフィードの構成

#### サーバーサイドで取得（loader）

| データ | ソース | 条件 |
|--------|--------|------|
| 最近更新されたプロフィール | `users` テーブル | `profileVisibility = "public"`、`updatedAt` 降順、最大4件 |
| 最近のガイド | `guides` テーブル + `users` JOIN | `isPublished = true`、`updatedAt` 降順、最大4件 |
| 公開プロフィール数 | `users` テーブル | `profileVisibility = "public"` の COUNT |
| アクティブプロフィール数 | `users` テーブル | 上記 + `updatedAt` が1週間以内 |

#### クライアントサイドで遅延取得（/api/home-feed）

| データ | キャッシュキー | CDNキャッシュ |
|--------|---------------|--------------|
| YouTube動画 | `youtube_videos` | 5分 |
| YouTubeライブ配信 | `youtube_live` | 1分 |
| PaceManペース | `recent_paces` | 1分 |
| Twitchストリーム | `twitch_streams` | 30秒 |
| ライブラン | `live_runs` | 10秒 |

### /api/home-feed

遅延読み込み対応のAPIエンドポイント。クエリパラメータ `type` で取得するデータ種別を指定する。

- **UserDataCache**: 登録ユーザーのMCID・UUID・表示名・カスタムスキンURLをインメモリキャッシュ（TTL: 1分）
- **TwitchLinkCache**: Twitchソーシャルリンク一覧をキャッシュ（TTL: 5分）
- **CDNキャッシュヘッダー**: `Cache-Control: public, s-maxage=N` を設定（Nはデータ種別により10秒〜5分）

### 表示制御フラグ

ユーザーごとに以下のフラグで表示/非表示を制御する（`users` テーブル）:

| フラグ | デフォルト | 説明 |
|--------|-----------|------|
| `showPacemanOnHome` | `true` | PaceManペースの表示 |
| `showTwitchOnHome` | `true` | Twitchストリームの表示 |
| `showYoutubeOnHome` | `true` | YouTube動画の表示 |

### カスタムスキン対応

- `mcidToSkinUrl` マップ: MCIDからカスタムスキンURLへのマッピング
- カスタムスキンが設定されているユーザーは、Mojang APIの代わりにカスタムスキンURLを使用
- `customSkinUrl` は Vercel Blob に保存

### フィード状態管理

クライアントサイドでは `useReducer` によるFeed状態管理を行う:

```
interface FeedState {
  recentVideos: CachedYouTubeVideo[];
  recentPaces: CachedPace[];
  mcidToUuid: Record<string, string>;
  mcidToDisplayName: Record<string, string>;
  loading: { videos: boolean; paces: boolean; };
}
```

### メタタグ

- `og:type`: `website`
- `og:title`: `t("home.title")`
- `og:image`: `/icon.png`
- `twitter:card`: `summary`

---

## ライブ画面 (/live)

### 概要

リアルタイムのMinecraftスピードラン状況を表示する画面。ライブラン（PaceMan API）、Twitchストリーム、YouTubeライブ配信を統合表示する。

### データ取得

#### loader

- セッションチェック（オプション）でユーザーの表示設定を取得
- 全登録ユーザーのMCID・UUID・slug・displayName・customSkinUrlを取得
- `mcidToUuid`, `mcidToSkinUrl`, `mcidToSlug`, `mcidToDisplayName` マップを構築
- `registeredMcids` リストを作成（PaceManデータと登録ユーザーの照合用）

#### クライアントサイドポーリング

- `/api/home-feed?type=live_runs`: ライブランデータ（10秒間隔）
- `/api/home-feed?type=twitch`: Twitchストリームデータ
- `/api/home-feed?type=youtube_live`: YouTubeライブ配信データ
- 定期的なポーリングで自動更新

### 表示コンポーネント

| コンポーネント | 説明 |
|---------------|------|
| `LivePaceList` | PaceMan APIからのライブラン一覧。スプリットタイムライン表示 |
| `StreamCard` | Twitchストリームカード。サムネイル、配信者名、視聴者数 |
| `YouTubeLiveCard` | YouTubeライブ配信カード。サムネイル、タイトル、同時視聴者数 |

### 型定義

```
PaceManLiveRun  // PaceMan APIのライブランデータ
TwitchStream    // Twitchストリームデータ
CachedYouTubeLive // YouTubeライブ配信キャッシュデータ
```

### メタタグ

- `og:title`: `t("live.metaTitle")`
- `og:description`: "リアルタイムのMinecraftスピードラン状況"
- `og:image`: `/og-image`（動的OGP画像）
- `twitter:card`: `summary`

---

## キャッシュテーブル

### youtubeVideoCache

YouTube動画のキャッシュ。

| カラム | 型 | 説明 |
|--------|-----|------|
| `videoId` | text (UNIQUE) | YouTube動画ID |
| `channelId` | text | チャンネルID |
| `minefolioMcid` | text | Minefolioユーザーとの紐付け |
| `title` | text | 動画タイトル |
| `description` | text | 動画説明 |
| `thumbnailUrl` | text | サムネイルURL |
| `channelTitle` | text | チャンネル名 |
| `publishedAt` | timestamp | 公開日時 |
| `lastVerifiedAt` | timestamp | 最終確認日時 |
| `isAvailable` | boolean | 動画が利用可能か |

### youtubeLiveCache

YouTubeライブ配信のキャッシュ。

| カラム | 型 | 説明 |
|--------|-----|------|
| `videoId` | text (UNIQUE) | YouTube動画ID |
| `channelId` | text | チャンネルID |
| `minefolioMcid` | text | Minefolioユーザーとの紐付け |
| `title` | text | 配信タイトル |
| `thumbnailUrl` | text | サムネイルURL |
| `liveBroadcastContent` | enum | `live` / `upcoming` / `none` |
| `scheduledStartTime` | timestamp | 配信予定開始時刻 |
| `actualStartTime` | timestamp | 実際の開始時刻 |
| `concurrentViewers` | integer | 同時視聴者数 |
| `lastCheckedAt` | timestamp | 最終チェック日時 |

### apiCache

汎用APIキャッシュ。

| カラム | 型 | 説明 |
|--------|-----|------|
| `cacheKey` | text (UNIQUE) | キャッシュキー |
| `cacheType` | enum | `youtube_videos` / `recent_paces` / `twitch_streams` / `live_runs` |
| `data` | text | JSONデータ |
| `expiresAt` | timestamp | 有効期限 |

---

## 関連ファイル

### ルート
- `app/routes/home.tsx` - ホーム画面
- `app/routes/live.tsx` - ライブ画面
- `app/routes/api/home-feed.ts` - ホームフィード遅延読み込みAPI

### ライブラリ
- `app/lib/youtube.ts` - YouTube API連携
- `app/lib/youtube-cache.ts` - YouTube動画・ライブキャッシュ管理
- `app/lib/twitch.ts` - Twitch API連携（トークン取得、ストリーム取得）
- `app/lib/paceman.ts` - PaceMan API連携（ライブラン取得）
- `app/lib/paceman-cache.ts` - PaceManペースキャッシュ管理
- `app/lib/cache.ts` - 汎用インメモリキャッシュ（`getCached`, `setCached`）

### コンポーネント
- `app/components/video-card.tsx` - YouTube動画カード
- `app/components/youtube-live-card.tsx` - YouTubeライブ配信カード
- `app/components/stream-card.tsx` - Twitchストリームカード
- `app/components/live-pace-list.tsx` - ライブラン一覧
- `app/components/recent-pace-card.tsx` - PaceManペースカード
- `app/components/profile-feed-card.tsx` - プロフィールフィードカード
- `app/components/paceman-split-mark.tsx` - PaceManスプリットマーク
