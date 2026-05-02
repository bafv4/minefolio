# Minefolio API ドキュメント

Minefolio が提供する公開 API の仕様書です。認証なしで利用可能なエンドポイントを掲載しています。

> **注意**: 認証必須の API（`/api/me/*`、`/api/auth/*` 等）はこのページには掲載していません。これらは Minefolio 内部からのみ利用される想定です。

---

## エンドポイント一覧

| エンドポイント | メソッド | 用途 |
|---|---|---|
| `/api/skin` | GET | Minecraft スキン画像取得 |
| `/api/guides/search` | GET | ガイド検索 |
| `/api/favorites` | GET | お気に入り一覧取得（未認証時は空配列） |
| `/api/users/by-slugs` | POST | スラッグ配列からユーザー詳細を取得 |
| `/api/home-feed` | GET | ホームフィード（ライブ・ペース・動画・配信） |
| `/api/keybindings-csv` | GET | キー配置データの CSV エクスポート |
| `/api/set-locale` | POST | 表示言語の切替（Cookie） |

---

## `GET /api/skin`

Minecraft スキン画像を返す。

**パラメータ:**

| 名前 | 型 | 必須 | 説明 |
|---|---|---|---|
| `uuid` | string | △ | Minecraft UUID（`userId` がない場合は必須） |
| `userId` | string | △ | Minefolio ユーザーID（指定時に優先） |

**取得優先順位:**

1. DB のカスタムスキン URL（`userId` 指定時）
2. Mojang API（UUID 経由）
3. Steve デフォルトスキン

**レスポンス:** `image/png`（バイナリ）

**キャッシュ:** `Cache-Control: public, max-age=3600`（1時間）

---

## `GET /api/guides/search`

公開ガイドをタイトル・サマリーで全文検索する。

**パラメータ:**

| 名前 | 型 | 必須 | 説明 |
|---|---|---|---|
| `q` | string | ○ | 検索クエリ |
| `limit` | number | × | 取得件数（デフォルト 20、最大 50） |

**レスポンス:**

```json
{
  "guides": [
    {
      "id": "...",
      "slug": "...",
      "title": "...",
      "summary": "...",
      "authorSlug": "...",
      "updatedAt": "..."
    }
  ]
}
```

---

## `GET /api/favorites`

お気に入り一覧（slug配列）を取得する。

未認証ユーザーは空配列を返す。認証済みユーザーは DB に保存された自分のお気に入りを返す。

**レスポンス:**

```json
{ "favorites": ["slug1", "slug2"] }
```

旧 `minefolio_favorites` Cookie が残っていれば自動削除される（`Set-Cookie: ... Max-Age=0`）。

---

## `POST /api/users/by-slugs`

スラッグ配列から複数ユーザーの基本情報を取得する。最大 100 件。

**リクエストボディ（JSON）:**

```json
{ "slugs": ["slug1", "slug2"] }
```

**レスポンス:**

```json
{
  "users": [
    {
      "slug": "...",
      "mcid": "...",
      "uuid": "...",
      "displayName": "...",
      "shortBio": "...",
      "location": "...",
      "updatedAt": "...",
      "customSkinUrl": "...",
      "slimSkin": false
    }
  ]
}
```

入力された `slugs` の順序を維持して返す。

---

## `GET /api/home-feed`

ホーム画面のフィードデータを取得する。複数の種別がクエリパラメータで指定できる。

**パラメータ:**

| 名前 | 型 | 必須 | 説明 |
|---|---|---|---|
| `type` | string | ○ | `live-runs` / `recent-paces` / `twitch-streams` / `youtube-videos` |

**レスポンス例（`type=live-runs`）:**

```json
{
  "liveRuns": [...],
  "mcidToUuid": { "...": "..." },
  "mcidToSkinUrl": { "...": "..." }
}
```

CDN キャッシュ付き（種別ごとに 10秒〜5分）。視聴者ロールのユーザーは含まれない。

---

## `GET /api/keybindings-csv`

ログイン中ユーザーの設定データを CSV 形式でダウンロードする。

> **注意**: このエンドポイントは認証セッション Cookie を必要とする。Minefolio にログインした状態でブラウザから直接アクセスして利用する。

**パラメータ:**

| 名前 | 型 | 必須 | 説明 |
|---|---|---|---|
| `sections` | string | ○ | カンマ区切り。`actions` / `remaps` / `custom-actions` / `mouse` |

**レスポンス:** `text/csv`（ブラウザがダウンロード）

選択したセクションごとに CSV を生成して結合する。

---

## `POST /api/set-locale`

表示言語を切り替える。

**リクエストボディ（FormData）:**

| 名前 | 型 | 必須 | 説明 |
|---|---|---|---|
| `locale` | string | ○ | `ja` / `en` |

**レスポンス:** Set-Cookie で言語設定を保存し、リファラーへリダイレクト。

---

## 利用上の注意

- 各エンドポイントは予告なく仕様変更される可能性があります。
- レート制限は明示的には設けていませんが、過剰なリクエストは控えてください。
- 不具合や仕様への要望は [GitHub Issue](https://github.com/bafv4/minefolio/issues) または [フィードバックフォーム](/feedback) からお知らせください。
