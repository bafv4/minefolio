# ホーム画面・ライブ機能 仕様書

## ホーム画面 (/)

### 概要

Minefolioのトップページ。登録ユーザーのアクティビティ、ガイド、動画フィード（YouTube動画 + Twitch VOD）、PaceManペース、ライブランをまとめて表示するフィードを提供する。

### 認証・登録チェック

- `getOptionalSession()` でセッションを取得（未ログインでもアクセス可能）
- セッションがある場合、`users` テーブルから `discordId` で登録済みユーザーを検索
- 登録済みの場合 `isRegistered = true` を返し、ユーザーの表示設定（`showPacemanOnHome`, `showYoutubeOnHome`, `showTwitchOnHome`）を取得

### ホームフィードの構成

#### サーバーサイドで取得（loader）

| データ | ソース | 条件 |
|--------|--------|------|
| 最近更新されたプロフィール | `users` テーブル | `profileVisibility = "public"`、`updatedAt` 降順、最大4件 |
| 最近のガイド | `guides` テーブル + `users` JOIN | `isPublished = true`、`updatedAt` 降順、最大4件 |
| 公開プロフィール数 | `users` テーブル | `profileVisibility = "public"` の COUNT |
| アクティブプロフィール数 | `users` テーブル | 上記 + `updatedAt` が1週間以内 |

#### クライアントサイドで遅延取得（/api/home-feed）

| データ | キャッシュキー | CDNキャッシュ (s-maxage) | stale-while-revalidate |
|--------|---------------|--------------|------|
| YouTube動画 | `youtube_videos` | 30分 | 1日 |
| Twitch VOD | `twitch_vods`（`twitch_vod_cache` テーブル読み） | 15分（空は60秒） | 1日 |
| YouTubeライブ配信 | `youtube_live` | 1分 | 2分 |
| PaceManペース | `recent_paces` | 5分 | 1日 |
| Twitchストリーム | `twitch_streams` | 30秒 | 60秒 |
| ライブラン | `live_runs` | 30秒 | 60秒 |

DBキャッシュ系（PaceManペース / YouTube動画）はデータ鮮度がcron更新間隔（30分 / 2時間）で決まるため、
s-maxage を長めに取り、TTL切れ後も stale-while-revalidate（1日）でエッジから即時配信しつつバックグラウンド再検証する
（低トラフィック時でもコールドスタート・DBアクセスの遅延をユーザーに見せないため）。

- 「ペース」セクションは「**ライブ**」と「**過去のペース**」の2段構成:
  - **ライブ**（旧 `/live` から移設）: `/api/home-feed?type=live-runs` を初回取得＋**15秒間隔で自動更新**。手動の**更新ボタン**（`RefreshCw`、更新中はスピン表示）でも再取得できる。`LivePaceList` で表形式表示。0件時は「現在ペース中の走者はいません」を表示
  - **過去のペース**: **最新12件まで**表示。件数バッジは表示しない。サブ見出し右側の「すべて見る」からペース一覧画面（`/paces`）へ遷移できる（過去のペースが0件のときはこのサブセクション自体を表示しない）
- **ローディングは2段で分離**: 両方読み込み中のときのみセクション全体のスケルトンを表示し、片方が先に完了したらセクションを描画して未完了側のみサブセクション単位のスケルトンにする（ライブ＝外部PaceMan API の遅延が、DBキャッシュ読みで速い過去のペースの表示をブロックしないようにするため）
- セクション自体は、両方の読み込み完了後にライブ・過去のペースがどちらも0件のとき非表示
- **過去のペースカードのタイムラインモーダル**: `PaceFeedCard`（`app/components/pace-feed-card.tsx`、ホームの過去のペース・`/paces`一覧の両方で共用）のカードをクリックすると、そのランの全スプリット（Enter Netherを含む進行順）を表示するモーダルが開く
  - データ取得: `/api/home-feed?type=pace-timeline&mcid=...&runId=...`（`app/lib/paceman-cache.ts` の `getRunTimeline()`）。モーダルを開いたタイミングで遅延取得し、開くたびに再取得する
  - 各スプリット行はキーリマップ種別チップ等と同じ `PaceManSplitMark`（アイコン+名称）で表示
  - モーダル下部に外部リンク「PaceMan.gg で見る」を配置。**カード全体を覆っていた外部リンク（`<a>`）はこのモーダルを開くボタンに置き換わった**ため、PaceMan.ggへの遷移は必ずモーダル経由になる（従来はカードクリック即外部遷移だった）
  - アバター・走者名（`z-10`）はカード全体のクリックハンドラ（`z-0`）より前面にあるため、そちらをクリックした場合は従来通りプレイヤープロフィールへ遷移し、モーダルは開かない

### /api/home-feed

遅延読み込み対応のAPIエンドポイント。クエリパラメータ `type` で取得するデータ種別を指定する。

- **レスポンスはユーザー非依存**: セッション・お気に入りを一切参照しない（お気に入りを先頭に出す並べ替えはクライアント側 `useFavorites()` で適用）。これによりレスポンスがユーザー間で完全に共有可能になり、CDNキャッシュが正しく機能する
- **UserDataCache**: 登録ユーザーのMCID・UUID・表示名・カスタムスキンURLをインメモリキャッシュ（TTL: 1分）。`app/lib/home-user-data.server.ts` の `getUserData()` に共通化されており、ホームSSR loader（`home.tsx`）と `/api/home-feed` の両方が同一キャッシュを参照する（毎リクエストの全ユーザースキャンを回避）
- **TwitchLinkCache**: Twitchソーシャルリンク一覧をキャッシュ（TTL: 5分）
- **CDNキャッシュヘッダー**: `Cache-Control: public, s-maxage=N, stale-while-revalidate=M` を設定（上記の表を参照）

### 動画フィード（YouTube + Twitch VOD）

- YouTube動画（`type=youtube-videos`、`youtube_video_cache`）と Twitch 配信アーカイブ
  （`type=twitch-vods`、`twitch_vod_cache`）を並列取得し、クライアント側で
  統一形式 `FeedVideo`（`app/components/feed-video-card.tsx`）にマージして新しい順に表示する
- **どちらも cron 蓄積の専用テーブル読み**（YouTube: `youtube-update` 2時間毎 / Twitch: `twitch-update` 30分毎）。
  保持期間は**90日**（`videos-feed.server.ts` の `VIDEO_FEED_RETENTION_DAYS`。cron がそれ以前の行を削除）
- **ホームは新着6件のみ表示**（`HOME_VIDEO_DISPLAY_COUNT`。新着順で切り出してからお気に入りを先頭に並べ替え）。
  セクションヘッダーの「すべて見る」から動画一覧ページ（`/videos`）へ遷移できる
- カードは `FeedVideoCard`:
  - **サムネイルクリックでその場に埋め込みプレイヤーを表示**（YouTube: `youtube.com/embed/{id}?autoplay=1`、
    Twitch: `player.twitch.tv/?video={id}&parent={hostname}&autoplay=true`。parent が必須のため
    埋め込みURLはクリック後にクライアント側で生成する）
  - **タイトル・外部リンクアイコンからプラットフォームの視聴ページへ**（新規タブ）
  - プラットフォームバッジ（YouTube=赤 / Twitch=紫）、Twitch VOD は配信時間バッジを表示
- セクションのスケルトンは両方の読み込みが完了するまで表示。マージ後0件ならセクション非表示

### 表示制御フラグ

ユーザーごとに以下のフラグで表示/非表示を制御する（`users` テーブル）:

| フラグ | デフォルト | 説明 |
|--------|-----------|------|
| `showPacemanOnHome` | `true` | PaceManペースの表示 |
| `showTwitchOnHome` | `true` | 自分のTwitch VODをホームの動画フィードに表示 |
| `showYoutubeOnHome` | `true` | 自分のYouTube動画をホームの動画フィードに表示 |

### カスタムスキン対応

- `mcidToSkinUrl` マップ: MCIDからカスタムスキンURLへのマッピング
- カスタムスキンが設定されているユーザーは、Mojang APIの代わりにカスタムスキンURLを使用
- `customSkinUrl` は Vercel Blob に保存

### フィード状態管理

クライアントサイドでは `useReducer` によるFeed状態管理を行う:

```
interface FeedState {
  recentVideos: CachedYouTubeVideo[];
  twitchVods: FeedVideo[];
  recentPaces: CachedPace[];
  mcidToUuid: Record<string, string>;
  mcidToDisplayName: Record<string, string>;
  loading: { videos: boolean; twitchVods: boolean; paces: boolean; };
}
```

### メタタグ

- `og:type`: `website`
- `og:title`: `t("home.title")`
- `og:image`: `/icon.png`
- `twitter:card`: `summary`

---

## ペース一覧画面 (/paces)

### 概要

ホームの「最近のペース」フィードの全件表示版。DBキャッシュ（`pacemanPaces` テーブル、**過去2か月分**を保持）にあるペースを検索・無限スクロールで閲覧できる。

### データ取得

共通ロジックは `app/lib/paces-feed.server.ts` に集約（loaderと `/api/paces` で共用）。レスポンスをCDNキャッシュ可能にするため、セッション非依存の一覧取得と、ログインユーザー固有の表示設定取得を2関数に分離している:

- **`getPublicPaceFeed(db, filters)`**（セッション非依存）
  - 登録ユーザー（MCID・UUIDあり、視聴者ロール除外）の `mcidToUuid` / `mcidToDisplayName` / `mcidToSkinUrl` マップを構築
  - `getPaceFeedEntries(registeredMcids, query)`（`app/lib/paceman-cache.ts`）で取得
    - Enter Nether を除外、保持期間（2か月）外をガード
    - 同一 `pacemanRunId` は最も進んだ Split（rta最大）のみ採用（区間指定時はその区間の行）
    - 日時降順ソート（同秒タイは `pacemanRunId` 降順でタイブレーク — offsetページングの安定性のため）。ホームフィードはこの共通関数に `{ limit: 12 }` を渡して利用する
  - フィード全体は区間キー毎にインメモリキャッシュ（TTL 60秒）し、無限スクロールのページ毎にテーブル全体を走査しない。プレイヤー・時期・タイムはキャッシュ済みリストへのJSフィルタで適用
  - 「自分のペースを隠す」設定（`showPacemanOnHome`）はここでは適用しない（レスポンスをユーザー間で共有可能にするため）
- **`getViewerPacePrefs(db, auth, request)`**（セッション依存）: `getOptionalSession()` でセッションを取得し、ログインユーザーの `mcid` / `showPacemanOnHome` を返す（未ログイン・未登録ユーザーはフィルタなし扱い）
- 「自分のペースを隠す」フィルタは `getViewerPacePrefs` の結果を使い、`/paces` ページのクライアント側（`paces.tsx`）でMCID一致除外として適用する（ホームの `/api/home-feed` と同じパターン）

### 検索

URLクエリパラメータで指定（`parsePaceSearchParams()` で解析、共有可能なURL）:

| パラメータ | 条件 | 備考 |
|-----------|------|------|
| `q` | プレイヤー | MCID・表示名の部分一致（大文字小文字無視） |
| `split` | 区間 | `PACE_FEED_SPLITS`（`app/lib/pace-splits.ts`）のいずれか。指定時はその区間のRTAで表示・絞り込み |
| `from` / `to` | 時期 | `YYYY-MM-DD`（JSTとして解釈、`to` はその日の終わりまで） |
| `maxTime` | タイム上限 | `m:ss` 形式。表示される区間のRTAに対して適用 |

### 遅延ロード・無限スクロール

- loader（SSR）は先頭60件と総件数のみ返す
- スクロールで `IntersectionObserver` が `/api/paces?offset=N&limit=60`（+検索条件）を呼び、順次追加
- 追加読み込み中に一覧がずれた場合は `pacemanRunId` で重複除去
- 検索条件の変更時は一覧の状態をリセット（`key` による再マウント）
- 読み込み失敗時は「再試行」ボタンを表示

### /api/paces

ページング+検索用APIエンドポイント。`{ paces, total, hasMore }` を返す。`limit` は最大100。レスポンスは `getPublicPaceFeed()` のみを使いセッション非依存（「自分のペースを隠す」フィルタは適用しない）のため、`Cache-Control: public, s-maxage=30, stale-while-revalidate=300` を付与しCDNキャッシュ可能にしている。

---

## 動画一覧画面 (/videos)

### 概要

ホームの動画フィードの全件表示版。`youtube_video_cache`（YouTube動画）と `twitch_vod_cache`（Twitch VOD）に
蓄積された**直近90日**の動画を、検索・無限スクロールで閲覧できる。カードはホームと同じ `FeedVideoCard`
（埋め込み再生 + 外部リンク）。/paces と同じ構成。

### データ取得

共通ロジックは `app/lib/videos-feed.server.ts` に集約（loaderと `/api/videos` で共用）:

- **`getPublicVideoFeed(db, filters)`**（セッション非依存）
  - 両テーブルの保持期間内・`isAvailable=true` の行を取得し、統一形式 `FeedVideo` にマージして新しい順にソート
  - 可視性: 公開プロフィール（viewer除外）に紐付く動画・VODのみ（/paces と同じ「公開のみ」ルール）。
    YouTube は `minefolioMcid`、Twitch は `userLogin` → `social_links.identifier` で読み時に紐付ける
  - フィード全体はインメモリキャッシュ（キー `videos:feed:all`、TTL 60秒）。フィルタはJSで適用
- **`getViewerVideoPrefs(db, auth, request)`**（セッション依存）: `mcid` / `showYoutubeOnHome` / `showTwitchOnHome` を返す。
  「自分の動画を隠す」フィルタはクライアント側でプラットフォーム別に適用

### 検索

| パラメータ | 条件 | 備考 |
|-----------|------|------|
| `q` | プレイヤー | MCID・表示名・slug・チャンネル名の部分一致（大文字小文字無視） |
| `platform` | プラットフォーム | `youtube` / `twitch` |
| `from` / `to` | 時期 | `YYYY-MM-DD`（JSTとして解釈、`to` はその日の終わりまで） |

### 遅延ロード・無限スクロール

- loader（SSR）は先頭24件と総件数のみ返す
- スクロールで `IntersectionObserver` が `/api/videos?offset=N&limit=24`（+検索条件）を呼び、順次追加
- 重複除去キーは `platform:videoId`。検索条件の変更時は `key` による再マウントでリセット

---

## 旧ライブ画面 (/live) — 廃止済み

- v1.9.0 で `/live` ルートは廃止。**ライブペースはホームのペースフィード内へ移設**した（上記「ホームフィードの構成」参照）
- 旧URLへのアクセスは `app/routes/live-redirect.ts` がホーム（`/`）へリダイレクトする（ブックマーク・外部リンク対策）
- 旧画面にあった配信中セクション（Twitch / YouTube Live）の表示面は廃止。`/api/home-feed` の `twitch-streams` / `youtube-live` エンドポイント自体は公開APIとして残存
- `StreamCard` / `YouTubeLiveCard` コンポーネントは未使用となったため削除済み（必要になればgit履歴から復元可能）

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

保持期間は90日（`VIDEO_FEED_RETENTION_DAYS`）。cron `youtube-update?action=update` が超過行を削除する。

### twitchVodCache

Twitch配信アーカイブ（VOD）のキャッシュ。cron `/api/cron/twitch-update` が30分毎に蓄積する。

| カラム | 型 | 説明 |
|--------|-----|------|
| `vodId` | text (UNIQUE) | Twitch VOD ID |
| `userLogin` | text | 配信者のlogin名（小文字）。`social_links.identifier` と読み時に突合 |
| `title` | text | VODタイトル |
| `thumbnailUrl` | text | サムネイルURL（処理中VODは null） |
| `channelTitle` | text | 配信者の表示名 |
| `durationSeconds` | integer | 配信時間（秒） |
| `publishedAt` | timestamp | 公開日時 |
| `lastVerifiedAt` | timestamp | 最終確認日時 |
| `isAvailable` | boolean | VODが利用可能か（Twitch側で自動削除されたものは false） |

保持期間は90日。`verify` アクション（8時間毎）が削除済みVODを `isAvailable=false` にマークする
（Twitch VODは配信者設定により14〜60日で自動削除されるため）。

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

### pacemanPaces

PaceManペースのキャッシュ。Cron（`/api/cron/update-paceman-cache`）がPaceMan APIから直近1週間分を取得し、**蓄積型**で保存する:

- 取得したランと同じ `pacemanRunId` の既存行のみ削除して挿入（取得ウィンドウ外の過去ペースは保持）
- 削除→挿入→プルーニングは1トランザクションで実行（途中失敗による蓄積データの消失を防ぐ）
- 保持期間は**過去2か月**。それより古い行はCron実行時に削除される
- 読み取り側（`getPaceFeedEntries`）にも保持期間ガードがあり、Cronが止まっても期間外データは配信されない

### apiCache

汎用APIキャッシュ。

| カラム | 型 | 説明 |
|--------|-----|------|
| `cacheKey` | text (UNIQUE) | キャッシュキー |
| `cacheType` | enum | `youtube_videos` / `recent_paces` / `twitch_streams` / `live_runs` / `social_stats` / `twitch_vods` |
| `data` | text | JSONデータ |
| `expiresAt` | timestamp | 有効期限 |

---

## 関連ファイル

### ルート
- `app/routes/home.tsx` - ホーム画面
- `app/routes/paces.tsx` - ペース一覧画面（検索・無限スクロール）
- `app/routes/videos.tsx` - 動画一覧画面（検索・無限スクロール）
- `app/routes/live-redirect.ts` - 旧 `/live` のホームへのリダイレクト
- `app/routes/api/home-feed.ts` - ホームフィード遅延読み込みAPI
- `app/routes/api/paces.ts` - ペース一覧のページング+検索API
- `app/routes/api/videos.ts` - 動画一覧のページング+検索API
- `app/routes/api/cron/twitch-update.ts` - Twitch VODキャッシュ更新Cron

### ライブラリ
- `app/lib/youtube.ts` - YouTube API連携
- `app/lib/youtube-cache.ts` - YouTube動画・ライブキャッシュ管理
- `app/lib/twitch.ts` - Twitch API連携（トークン取得、ストリーム取得、VOD取得）
- `app/lib/twitch-vod-cache.ts` - Twitch VODキャッシュ管理（蓄積・存在確認・クリーンアップ）
- `app/lib/videos-feed.server.ts` - 動画一覧の共通ロジック（マージ・検索条件解析・保持期間定数）
- `app/lib/paceman.ts` - PaceMan API連携（ライブラン取得）
- `app/lib/paceman-cache.ts` - PaceManペースキャッシュ管理（蓄積・保持期間・フィード取得）
- `app/lib/paces-feed.server.ts` - ペース一覧の共通ロジック（検索条件解析・表示対象の絞り込み）
- `app/lib/pace-splits.ts` - フィード対象区間の定数
- `app/lib/cache.ts` - 汎用インメモリキャッシュ（`getCached`, `setCached`）

### コンポーネント
- `app/components/feed-video-card.tsx` - 動画フィードカード（YouTube/Twitch VOD統一・埋め込み再生対応）
- `app/components/live-pace-list.tsx` - ライブラン一覧（ホームのペースフィード内で使用）
- `app/components/pace-feed-card.tsx` - ペースフィードカード（ホーム・ペース一覧で共用）
- `app/components/recent-pace-card.tsx` - PaceManペースカード
- `app/components/profile-feed-card.tsx` - プロフィールフィードカード
- `app/components/paceman-split-mark.tsx` - PaceManスプリットマーク
