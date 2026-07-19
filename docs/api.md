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
| `/api/users/by-slugs` | POST | 不要 | スラッグ配列からユーザー詳細を取得 |
| `/api/home-feed` | GET | 不要 | ホームフィードデータ |
| `/api/keybindings-csv` | GET | 不要 | キー配置CSVエクスポート |
| `/api/set-locale` | POST | 不要 | ロケール切替（Cookie） |
| `/api/cron/youtube-update` | GET | CRON_SECRET | YouTube動画キャッシュ更新 |
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

**種別一覧:**

| type | 内容 | CDNキャッシュ | メモリキャッシュ |
|---|---|---|---|
| `live-runs` | PaceManライブラン | 10秒 | 10秒 |
| `recent-paces` | 最近のペース記録 | 60秒 | 5分 |
| `twitch-streams` | Twitchライブ配信 | 30秒 | 60秒 |
| `youtube-videos` | YouTube動画 | 5分 | DB依存 |
| `youtube-live` | YouTubeライブ（現在無効） | 60秒 | — |

**レスポンス例（live-runs）:**
```json
{
  "liveRuns": [...],
  "mcidToUuid": { "mcid": "uuid" },
  "mcidToSkinUrl": { "mcid": "url" }
}
```

- お気に入り（Cookie）によるソートを適用
- 環境変数未設定のサービスはスキップ

**関連ファイル:** `app/routes/api/home-feed.ts`

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

### `POST /api/users/by-slugs`

スラッグ配列からユーザー詳細を取得する（未ログインユーザーがlocalStorageのお気に入り一覧から走者カードを表示するために使用）。

**リクエストボディ（JSON）:**
```json
{ "slugs": ["slug1", "slug2"] }
```

最大100件まで。

**レスポンス:** `{ "users": [{ slug, mcid, uuid, displayName, shortBio, location, updatedAt, customSkinUrl, slimSkin }, ...] }`

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
