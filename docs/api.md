# APIルート仕様書（内部用・全API）

このドキュメントは Minefolio 内部の全 API ルートを掲載した開発者向け仕様書です。

公開API のみを抜粋した一般公開版は [`app/content/api.md`](../app/content/api.md) にあり、`/developers` ページで閲覧できます。仕様変更時は両方の更新を検討してください。

## 概要

APIルートは `app/routes/api/` 配下に配置され、`app/routes.ts` にて手動登録されている。レイアウト外のため UIコンポーネントは持たず、`loader`（GET）または `action`（POST等）のみをexportする。

## 一覧

| エンドポイント | メソッド | 認証 | 用途 |
|---|---|---|---|
| `/api/auth/*` | GET/POST | better-auth | 認証（ログイン/ログアウト/コールバック） |
| `/api/skin` | GET | 不要 | スキン画像取得 |
| `/api/me/skin` | POST/DELETE | 必須 | カスタムスキン保存・削除 |
| `/api/me/skin/upload-token` | POST | 必須 | スキンアップロードトークン発行 |
| `/api/me/guides/upload-image` | POST | 必須 | ガイド画像アップロードトークン発行 |
| `/api/guides/search` | GET | 不要 | ガイド検索 |
| `/api/favorites` | GET/POST/PUT | GETは任意、POST/PUTは必須 | お気に入り管理（DB） |
| `/api/likes` | POST | 必須 | ガイド・テンプレートのいいね追加/解除 |
| `/api/users/by-slugs` | POST | 不要 | スラッグ配列からユーザー詳細を取得 |
| `/api/home-feed` | GET | 不要 | ホームフィードデータ |
| `/api/videos` | GET | 不要 | 動画一覧（/videos）のページング+検索 |
| `/api/social-stats` | GET | 不要（privateは本人のみ） | プロフィールのYouTube/Twitch統計 |
| `/api/keybindings-csv` | GET | 不要 | キー配置CSVエクスポート |
| `/api/set-locale` | POST | 不要 | ロケール切替（Cookie） |
| `/api/cron/youtube-update` | GET | CRON_SECRET | YouTube動画キャッシュ更新 |
| `/api/cron/twitch-update` | GET | CRON_SECRET | Twitch VODキャッシュ更新 |
| `/api/cron/update-paceman-cache` | GET | CRON_SECRET | PaceManキャッシュ更新 |
| `/api/cron/update-rankings` | GET | CRON_SECRET | ランキングデータ更新 |

---

## 公開API

### `GET /api/skin`

Minecraftスキン画像を返す。

**パラメータ:**
| 名前 | 型 | 必須 | 説明 |
|---|---|---|---|
| `uuid` | string | △ | Minecraft UUID（userIdがなければ必須） |
| `userId` | string | △ | MinefolioユーザーID（優先） |

**スキン取得優先順位:**
1. DBのカスタムスキンURL（userId指定時）
2. Mojang API（UUID経由）
3. Steve デフォルトスキン

**レスポンス:** `image/png`（バイナリ）

**キャッシュ:** `Cache-Control: public, max-age=3600`（1時間）

**関連ファイル:** `app/routes/api/skin.ts`

---

### `GET /api/guides/search`

公開ガイドをタイトルで検索する。

**パラメータ:**
| 名前 | 型 | 必須 | 説明 |
|---|---|---|---|
| `q` | string | ○ | 検索クエリ（1〜100文字） |

**レスポンス:**
```json
{
  "guides": [
    {
      "id": "string",
      "title": "string",
      "slug": "string",
      "summary": "string | null",
      "coverImageUrl": "string | null",
      "authorSlug": "string",
      "authorName": "string",
      "url": "/guides/{authorSlug}/{slug}"
    }
  ]
}
```

- 最大10件、更新日時の降順
- クエリが1文字未満の場合は空配列

**関連ファイル:** `app/routes/api/guides/search.ts`

---

### `GET /api/home-feed`

ホームフィードのデータを種別ごとに取得する。

**パラメータ:**
| 名前 | 型 | 必須 | 説明 |
|---|---|---|---|
| `type` | string | ○ | フィード種別 |
| `mcid` | string | `type=pace-timeline`時のみ○ | 対象プレイヤーのMCID |
| `runId` | string | `type=pace-timeline`時のみ○ | PaceManのラン ID（`pacemanRunId`） |

**種別一覧:**

| type | 内容 | CDNキャッシュ (s-maxage / SWR) | メモリキャッシュ |
|---|---|---|---|
| `live-runs` | PaceManライブラン | 30秒 / 60秒 | 30秒 |
| `recent-paces` | 最近のペース記録 | 5分 / 1日 | — |
| `pace-timeline` | 特定ラン（`mcid`+`runId`必須）の全スプリット。過去のペースカードのタイムラインモーダル用 | 5分 / 1日 | 5分 |
| `twitch-streams` | Twitchライブ配信 | 30秒 / 60秒 | 60秒 |
| `youtube-videos` | YouTube動画 | 30分 / 1日 | DB依存 |
| `twitch-vods` | Twitch配信アーカイブ（VOD） | 15分 / 1日（空は60秒） | DB依存（cronが30分毎に更新） |
| `youtube-live` | YouTubeライブ（現在無効） | 60秒 / 2分 | — |

**レスポンス例（live-runs）:**
```json
{
  "liveRuns": [...],
  "mcidToUuid": { "mcid": "uuid" },
  "mcidToSkinUrl": { "mcid": "url" }
}
```

- レスポンスはユーザー非依存（新しい順）。お気に入りを先頭に出す並べ替えはクライアント側で適用
- 環境変数未設定のサービスはスキップ
- `youtube-videos` / `twitch-vods` はどちらもキャッシュテーブル（cron蓄積: YouTube 2時間毎 /
  Twitch 30分毎）からの読み出しで、可視性ゲート（公開プロフィールのみ・viewer除外）と
  ユーザー紐付けを `/api/videos` と共通の `getPublicVideoFeed` に委譲し、
  **統一形式 `FeedVideo`**（platform / videoId / title / thumbnailUrl / durationSeconds /
  紐付けユーザー情報）で新しい順に最大10件返す

**関連ファイル:** `app/routes/api/home-feed.ts`

---

### `GET /api/videos`

動画一覧ページ（`/videos`）の遅延ロード・無限スクロール用API。
`youtube_video_cache` と `twitch_vod_cache` を統一形式 `FeedVideo` にマージして返す（保持期間90日）。

**パラメータ:**
| 名前 | 型 | 必須 | 説明 |
|---|---|---|---|
| `page` | number | △ | 1始まりのページ番号（デフォルト: 1、24件/ページ） |
| `q` | string | △ | プレイヤー検索（MCID・表示名・slug・チャンネル名の部分一致） |
| `platform` | string | △ | `youtube` / `twitch` |
| `from` / `to` | string | △ | 時期（YYYY-MM-DD、JST解釈） |

**レスポンス:** `{ "items": FeedVideo[], "page": number, "total": number, "hasMore": boolean }`（`use-infinite-scroll` フックの規約）

- 可視性: 公開プロフィール（viewer除外）に紐付く動画・VODのみ（/paces と同じ「公開のみ」ルール）
- レスポンスはユーザー非依存。「自分の動画を隠す」設定はクライアント側で適用
- CDNキャッシュ: `s-maxage=300, stale-while-revalidate=3600`

**関連ファイル:** `app/routes/api/videos.ts`, `app/lib/videos-feed.server.ts`

---

### `GET /api/social-stats`

プロフィールページ「リンク」カード用に、対象ユーザーの YouTube / Twitch チャンネル統計を返す。
APIキーがサーバー専用のため、クライアントから任意 identifier を受けるオープンプロキシにはせず、
slug 経由でDB保存済みのソーシャルリンクに対してのみ統計を返す。

**パラメータ:**
| 名前 | 型 | 必須 | 説明 |
|---|---|---|---|
| `slug` | string | ○ | 対象ユーザーのslug（大文字小文字は無視） |

**レスポンス:**
```json
{
  "youtube": { "subscriberCount": 12000, "latestVideoAt": "ISO8601 | null" },
  "twitch": { "followerCount": 3400, "isLive": false, "lastStreamAt": "ISO8601 | null" }
}
```

- リンク未登録・APIキー未設定・取得失敗のプラットフォームは `null`
- YouTubeの `subscriberCount` は登録者数非公開チャンネルで `null`。`latestVideoAt` は uploads プレイリスト先頭（配信アーカイブ含む）
- Twitchの `lastStreamAt` は配信中なら開始日時、それ以外は最新アーカイブの `created_at`（VOD無効なら `null`）
- **可視性ゲート**: `private` プロフィールは本人のみ 200（`Cache-Control: private, no-store`）、他人は 404
- **キャッシュ**: DBキャッシュ（`api_cache` / `cacheType: "social_stats"`）YouTube 6時間（失敗時15分）・Twitch 5分。CDN `s-maxage=300, stale-while-revalidate=3600`

**関連ファイル:** `app/routes/api/social-stats.ts`, `app/lib/youtube.ts`（`getChannelStats`）, `app/lib/twitch.ts`（`getChannelStats`）

---

### `GET /api/keybindings-csv`

キー配置データをCSVでダウンロードする。

**パラメータ:**
| 名前 | 型 | 必須 | 説明 |
|---|---|---|---|
| `sections` | string | △ | カンマ区切り（デフォルト: `actions`） |

**セクション:**

| 値 | CSV列 |
|---|---|
| `actions` | Player, 前進, 後退, 左移動, ... (19アクション) |
| `remaps` | Player, Source Key, Target Key, Type |
| `custom-actions` | Player, Trigger Key, Action Name |
| `mouse` | Player, DPI, Sensitivity (%), cm/360, Win Sens Multiplier, Cursor Speed, Raw Input, Mouse Accel |

- `remaps` の Type 列はリマップ種別（小文字: `all` / `trigger` / `chat`、`unset` は空文字）。末尾列として追加
- `mouse` の `cm/360` `Cursor Speed` は計算できない場合は空欄。`Win Sens Multiplier` も `windowsSpeed` / `windowsSpeedMultiplier` が未設定なら空欄（`1` にフォールバックしない）。`Sensitivity (%)` は有効範囲（0〜200%）外の値も生データのまま出力（詳細: [`docs/keybindings.md`](./keybindings.md)）
- 複数セクション指定時は空行で区切って連結
- UTF-8 BOM付き（Excel互換）
- 公開プロフィールのみ対象

**レスポンス:** `text/csv; charset=utf-8`、`Content-Disposition: attachment; filename="keybindings.csv"`

**関連ファイル:** `app/routes/api/keybindings-csv.ts`

---

### `GET /api/favorites`

ログイン中ユーザーのお気に入り一覧（slug配列）を返す。未認証の場合は空配列。

**レスポンス:** `{ "favorites": ["slug1", "slug2"] }`

旧 Cookie `minefolio_favorites` が残っていれば自動削除（`Set-Cookie: ... Max-Age=0`）。

### `POST /api/favorites`

お気に入りの追加・削除を行う。**認証必須**。

**リクエストボディ（JSON）:**
```json
{ "slug": "playerSlug", "action": "add" | "remove" }
```

**レスポンス:** `{ "favorites": ["slug1", "slug2", ...] }`（更新後の一覧）

### `PUT /api/favorites`

localStorage → DB 一括同期用。**認証必須**。

**リクエストボディ（JSON）:**
```json
{ "slugs": ["slug1", "slug2"] }
```

DB に存在しない slug のみ追加（重複は無視）。レスポンスは `POST` と同形式。

**関連ファイル:** `app/routes/api/favorites.ts`, `app/lib/favorites.ts`, `app/lib/favorites-client.ts`, `app/hooks/use-favorites.tsx`

---

### `POST /api/likes`

ガイド・サーチクラフトテンプレートへの「いいね」を追加・解除する。**認証必須**。

**リクエストボディ（JSON）:**
```json
{ "targetType": "guide" | "template", "targetId": "<cuid2>", "action": "like" | "unlike" }
```

**レスポンス:** `{ "liked": boolean, "count": number }`（書き込み後の権威ある件数）

| ステータス | 条件 |
|---|---|
| 400 | JSON不正 / `targetType`・`targetId`・`action` が不正、`targetId` が64文字超 |
| 401 | 未ログイン、またはセッションはあるが `users` 行が無い（未オンボーディング） |
| 403 | 自分の投稿にいいねしようとした |
| 404 | 不存在・未公開・著者が非公開（すべて同一の応答。存在の列挙オラクルにしない） |
| 405 | POST 以外 |

- `action` は絶対指定（トグルではない）で冪等。二重送信・再送でも状態がずれない
- 対象は **id**（`guides.slug` は著者内でしか一意でないため）
- いいね可否の可視性は public + unlisted（`publiclyReferencableCondition`）。解除は無検査
- `Cache-Control: private, no-store`

**関連ファイル:** `app/routes/api/likes.ts`, `app/lib/likes.server.ts`, `app/hooks/use-likes.tsx`, `app/components/like-button.tsx`（詳細: `docs/likes.md`）

---

### `POST /api/users/by-slugs`

スラッグ配列からユーザー詳細を取得する（未ログインユーザーがlocalStorageのお気に入り一覧から走者カードを表示するために使用）。

**リクエストボディ（JSON）:**
```json
{ "slugs": ["slug1", "slug2"] }
```

最大100件まで。

**レスポンス:** `{ "users": [{ slug, mcid, uuid, displayName, displayNameAlphabet, pronouns, role, mainEdition, mainPlatform, shortBio, location, updatedAt, customSkinUrl, slimSkin }, ...] }`

入力順にソートされる。

**関連ファイル:** `app/routes/api/users/by-slugs.ts`

---

### `POST /api/set-locale`

表示言語を切り替える。

**リクエストボディ（FormData）:**
| 名前 | 型 | 必須 | 説明 |
|---|---|---|---|
| `locale` | string | ○ | `ja` または `en` |

**レスポンス:** リファラーへの302リダイレクト + `Set-Cookie`（ロケール設定）

**関連ファイル:** `app/routes/api/set-locale.ts`

---

## 認証必須API

### `POST /api/me/skin`

カスタムスキンURLをDBに保存する。

**リクエストボディ（JSON）:**
```json
{
  "url": "string (Vercel Blob URL、必須)",
  "model": "default | slim (省略時: default)"
}
```

**レスポンス:**
```json
{
  "success": true,
  "customSkinUrl": "string",
  "customSkinModel": "default | slim"
}
```

### `DELETE /api/me/skin`

カスタムスキンを削除し、Vercel Blobからもクリーンアップする。

**レスポンス:** `{ "success": true }`

**認証:** `auth.api.getSession()` によるセッション検証（401エラー）

**関連ファイル:** `app/routes/api/me/skin.ts`

---

### `POST /api/me/skin/upload-token`

Vercel Blobへのクライアントアップロード用トークンを発行する。

**制約:**
- 形式: PNG のみ
- サイズ: 最大1MB
- パス: `skins/{userId}/` 配下のみ許可
- `addRandomSuffix: true` で毎回一意なblobパスに保存（固定パスへの再アップロードが「既に存在する」で失敗するのを防ぐ。旧blobは `POST /api/me/skin` が削除）

**関連ファイル:** `app/routes/api/me/skin/upload-token.ts`

---

### `POST /api/me/guides/upload-image`

ガイド画像のアップロードトークンを発行する。

**制約:**
- 形式: PNG, JPEG, GIF, WebP
- サイズ: 最大5MB
- パス: `guides/{userId}/` 配下のみ許可

**関連ファイル:** `app/routes/api/me/guides/upload-image.ts`

---

## 認証ルート

### `/api/auth/*`

better-authが提供する認証エンドポイント。すべてのリクエストを `auth.handler(request)` に委譲する。

**主要エンドポイント:**
- `/api/auth/signin/discord` — Discord OAuthログイン開始
- `/api/auth/callback/discord` — OAuthコールバック
- `/api/auth/logout` — ログアウト（GETリクエスト）
- `/api/auth/session` — セッション情報取得

**関連ファイル:** `app/routes/api/auth/splat.tsx`, `app/lib/auth.ts`

---

## Cronジョブ

すべてのCronジョブは `Authorization: Bearer {CRON_SECRET}` ヘッダーで認証される。

### `GET /api/cron/youtube-update`

YouTube動画・ライブ配信のキャッシュを更新する。

**パラメータ:**
| 名前 | 型 | 説明 |
|---|---|---|
| `action` | string | `update`（デフォルト）/ `verify` / `live` |

**アクション:**

| action | 実行内容 | 推奨間隔 |
|---|---|---|
| `update` | 登録チャンネルの新着動画取得・キャッシュ | 2時間 |
| `verify` | キャッシュ済み動画の存在確認・削除 | 12時間 |
| `live` | ライブ配信状況の確認・キャッシュ | 5分 |

**必須環境変数:** `YOUTUBE_API_KEY`

**レスポンス例:**
```json
{
  "success": true,
  "action": "update",
  "channels": 15,
  "added": 3,
  "updated": 0
}
```

**関連ファイル:** `app/routes/api/cron/youtube-update.ts`

- `update` は保持期間（90日）を超えた動画キャッシュ行の削除も行う

---

### `GET /api/cron/twitch-update`

Twitch配信アーカイブ（VOD）のキャッシュを更新する。

**パラメータ:**
| 名前 | 型 | 説明 |
|---|---|---|
| `action` | string | `update`（デフォルト）/ `verify` |

**アクション:**

| action | 実行内容 | 推奨間隔 |
|---|---|---|
| `update` | 公開プロフィールのTwitchリンクを対象に新着VOD取得・upsert + 保持期間（90日）超過分の削除 | 30分 |
| `verify` | キャッシュ済みVODの存在確認（最大100件/回。Twitch VODは配信者設定により14〜60日で自動削除されるため）| 8時間 |

**必須環境変数:** `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`

**レスポンス例:**
```json
{
  "success": true,
  "action": "update",
  "channels": 12,
  "added": 3,
  "updated": 1,
  "cleaned": 0
}
```

**関連ファイル:** `app/routes/api/cron/twitch-update.ts`, `app/lib/twitch-vod-cache.ts`

---

### `GET /api/cron/update-paceman-cache`

PaceManのペースデータをキャッシュする。

**処理内容:**
1. MCIDを持つ全ユーザーを取得
2. PaceMan APIから過去7日間のデータ取得
3. 5回以上プレイしたユーザーのみフィルタ
4. 最大100ペースをDBにキャッシュ

**レスポンス例:**
```json
{
  "success": true,
  "message": "PaceMan cache updated successfully",
  "usersCount": 42,
  "cachedPaces": 87,
  "timestamp": "2026-04-05T12:00:00.000Z"
}
```

**関連ファイル:** `app/routes/api/cron/update-paceman-cache.ts`

---

### `GET /api/cron/update-rankings`

スピードラン記録とランク情報を外部APIから同期する。

**処理内容:**
1. 公開プロフィールの全ユーザーをループ
2. **Speedrun.com API**: ユーザーID解決 → PB取得 → ペンディングラン取得
3. **MCSR Ranked API**: ベストタイム・ELOレーティング取得
4. categoryRecordsテーブルに保存

**レート制限:**
- Speedrun.com: リクエスト間500ms
- MCSR Ranked: リクエスト間200ms

**レスポンス例:**
```json
{
  "success": true,
  "stats": {
    "usersProcessed": 50,
    "categoriesCount": 12,
    "speedruncomUpdates": 8,
    "rankedPbUpdates": 15,
    "rankedEloUpdates": 15,
    "speedruncomIdResolved": 2
  },
  "timestamp": "2026-04-05T12:00:00.000Z"
}
```

**関連ファイル:** `app/routes/api/cron/update-rankings.ts`, `app/lib/external-stats.ts`
