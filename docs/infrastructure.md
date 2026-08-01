# インフラ・共通基盤 仕様書

## データベース

### 技術スタック

- **ORM**: Drizzle ORM
- **ドライバ**: libSQL（`@libsql/client`）
- **本番環境**: Turso（分散SQLite）
- **ローカル開発**: `file:local.db`（SQLiteファイル）

### 接続設定

`app/lib/db.ts` の `createDb()` で接続を作成:

```typescript
createClient({
  url: process.env.TURSO_DATABASE_URL || "file:local.db",
  authToken: process.env.TURSO_AUTH_TOKEN,
});
```

### Drizzle設定

`drizzle.config.ts`:

- スキーマ: `./app/lib/schema.ts`
- マイグレーション出力: `./drizzle/`
- ダイアレクト: `turso`

### マイグレーション

```bash
pnpm db:generate   # スキーマからマイグレーションSQL生成
pnpm db:migrate    # マイグレーション実行
```

マイグレーションファイルは `drizzle/` ディレクトリに出力される。

### ID生成

- **CUID2**: `@paralleldrive/cuid2` の `createId()` を使用
- 全テーブルの主キーに `$defaultFn(() => createId())` を設定

---

## 国際化 (i18n)

2つのi18nシステムを併用している。

### システム1: カテゴリベース（app/lib/i18n.ts）

```typescript
t(category: string, key: string, params?: Record<string, string>, locale?: Locale)
```

- `translations` オブジェクトにカテゴリ → キー → 翻訳文の階層構造で定義
- 対応言語: `ja`（日本語）、`en`（英語）
- デフォルトロケール: `ja`
- `supportedLocales` で言語名と自国語名を管理

### システム2: ドットパスキー（app/lib/messages/）

```typescript
t(key: MessageKey, params?: Record<string, string | number>, locale?: AppLocale)
```

- `app/lib/messages/pages-ja.ts` にフラットなドットパスキーで翻訳を定義
- 型安全: `MessageKey` 型で補完が効く
- `{param}` 形式のパラメータ補間をサポート
- `getNestedValue()` でドットパスを再帰的に解決

### ロケール検出

優先順位:
1. Cookie（`locale` キー）
2. `Accept-Language` ヘッダー
3. デフォルト: `ja`

### ロケール切替

- `/api/set-locale`: POSTリクエストでCookieにロケールを設定
- `LocaleSwitcher` コンポーネント: ヘッダーに言語切替UIを表示

---

## レイアウト

### メインレイアウト (_layout.tsx)

- ヘッダー・フッター付きの共通レイアウト
- 認証チェック: オプション（`getOptionalSession`）
- Discordアバター同期: ログイン時にDiscordアバターを最新に更新
- ナビゲーション: ホーム、走者一覧、ランキング、統計など

### ダッシュボードレイアウト (me/_layout.tsx)

- サイドバー付きダッシュボードレイアウト
- 認証必須（`getSession` でリダイレクト）
- サイドバーメニュー: プロフィール設定、キーバインド、デバイス設定、プリセット等

---

## OGP・メタタグ

### 全公開ルート共通

各ルートの `meta` 関数で以下を設定:

| プロパティ | 内容 |
|-----------|------|
| `og:type` | `website` |
| `og:title` | ページタイトル（`t()` で国際化） |
| `og:description` | ページ説明 |
| `og:image` | OGP画像URL |
| `twitter:card` | `summary` または `summary_large_image` |

### 動的OGP画像 (/og-image)

`app/routes/og-image.tsx`:

- `@vercel/og` の `ImageResponse` で PNG画像を動的生成
- サイズ: 1200 x 630px
- プレイヤーページ: アバター、プレイヤー名、バッジを含む専用OGP画像
- Discordアバター: `fetchImageAsDataUrl()` で外部画像をBase64データURLに変換（Edge Runtime対応）
- その他ページ: デフォルト画像（`/icon.png`）

---

## フィードバック

### フィードバックフォーム (/feedback)

- ユーザーからのフィードバックを受け付けるフォーム
- カテゴリ選択、メッセージ入力

### メール送信

- **Resend API** でフィードバック内容をメール送信
- 環境変数: `FEEDBACK_EMAIL`（送信先）、`RESEND_API_KEY`（APIキー）
- `app/lib/email.server.ts` でメール送信処理

---

## レガシーインポート

### /me/import

MCSRer Hotkeys（旧サービス）からのデータインポート機能。

| ファイル | 説明 |
|---------|------|
| `app/lib/import-parser.ts` | インポートデータのパーサー |
| `app/lib/legacy-import.ts` | レガシーデータの変換・取り込みロジック |

- `users.hasImported` フラグでインポート済みかどうかを管理
- `LEGACY_API_URL` 環境変数で旧APIのURLを指定

---

## CSVエクスポート

### フロー

1. フッター（`app/components/layout/footer.tsx`）の「CSVエクスポート」ボタンをクリック
2. モーダルダイアログで出力項目を選択
3. `/api/keybindings-csv` にリクエスト送信
4. CSV ファイルをダウンロード

### 出力項目

| 項目 | 説明 |
|------|------|
| キー配置 | 全キーバインド（アクション名 + キーコード） |
| リマップ | キーリマップ設定（ソース → ターゲット） |
| カスタムアクション | ユーザー定義アクション |
| マウス設定 | DPI、感度、cm/360等 |

### 形式

- UTF-8 BOM付きCSV（Excel互換）
- Content-Type: `text/csv; charset=utf-8`

---

## 環境変数

### 必須

| 変数名 | 説明 |
|--------|------|
| `TURSO_DATABASE_URL` | TursoデータベースURL（ローカル: `file:local.db`） |
| `DISCORD_CLIENT_ID` | Discord OAuth クライアントID |
| `DISCORD_CLIENT_SECRET` | Discord OAuth クライアントシークレット |
| `APP_URL` | アプリケーションのベースURL |
| `BETTER_AUTH_SECRET` | Better Auth シークレットキー（32文字以上） |

### 任意

| 変数名 | 説明 |
|--------|------|
| `TURSO_AUTH_TOKEN` | Turso認証トークン（本番環境で必要） |
| `TWITCH_CLIENT_ID` | Twitch API クライアントID |
| `TWITCH_CLIENT_SECRET` | Twitch API クライアントシークレット |
| `YOUTUBE_API_KEY` | YouTube Data API キー |
| `RESEND_API_KEY` | Resend メール送信APIキー |
| `ANTHROPIC_API_KEY` | 利用者コンテンツの自動翻訳（`docs/translation.md`）。未設定なら機能ごと無効 |
| `FEEDBACK_EMAIL` | フィードバック送信先メールアドレス |
| `LEGACY_API_URL` | レガシーAPI（MCSRer Hotkeys）のURL |
| `VERCEL_WEBHOOK_SECRET` | Vercel Webhook の署名検証シークレット（リリース通知） |
| `DISCORD_RELEASE_WEBHOOK_URL` | リリース通知先の Discord Webhook URL |
| `VERCEL_API_TOKEN` | Vercel Web Analytics API のアクセストークン（ページビュー集計 → `/api/cron/update-page-views`） |
| `VERCEL_PROJECT_ID` | ページビュー集計対象の Vercel プロジェクトID |
| `VERCEL_TEAM_ID` | チームのプロジェクトのみ必要（個人アカウントのプロジェクトでは設定しない） |

### アクセス方法

- サーバーサイド: `app/lib/env.server.ts` の `getEnv()` で `process.env` から取得
- 型定義: `app/env.d.ts` の `Env` インターフェース（実行時バリデーションは行わず、必須変数は `getEnv()` 内の非 null アサーションで前提とする）

---

## リリース通知（Discord）

`POST /api/webhooks/vercel`（`app/routes/api/webhooks/vercel.ts`）で、本番デプロイ時のリリース通知を自動化している。

### 仕組み

1. Vercel ダッシュボードで登録した Webhook（`deployment.succeeded` イベント）がこのエンドポイントに届く
2. `x-vercel-signature` ヘッダーで署名検証する（リクエストボディの HMAC-SHA1、シークレットは Webhook 作成時に発行される）
3. **`payload.target === "production"` のデプロイのみ**処理する（プレビュー・dev環境はスキップ）
4. バンドルされた `package.json` のバージョンと、`app_meta` テーブルの最終通知バージョン（key: `release_notify:last_version`）を比較し、**バージョンが上がった場合のみ** Discord Webhook に通知する
   - バージョンを上げないデプロイや同一コミットの再デプロイでは通知されない
5. 通知内容は `app/content/changelog.md` の該当バージョンのセクション（`parseChangelog()` で抽出、`###` 見出しは太字に変換、embed 上限に切り詰め）

### エイリアス切替レース対策

通知内容にはリクエストを処理するデプロイ自身にバンドルされたファイルを使うため、処理するのは**通知対象のデプロイ自身**である必要がある。Webhook ペイロードのコミットSHA と自身の `VERCEL_GIT_COMMIT_SHA` が一致しない場合（本番ドメインの切替が完了する前に旧デプロイに届いた場合）は 503 を返し、Vercel のリトライで新デプロイに処理させる。

### 設定

- Vercel ダッシュボード → Team Settings → Webhooks で作成: イベント `deployment.succeeded`、プロジェクト `minefolio`、URL `https://minefolio.me/api/webhooks/vercel`
- 環境変数（Vercel の Production 環境に設定）:
  - `VERCEL_WEBHOOK_SECRET` — Webhook 作成時に表示されるシークレット
  - `DISCORD_RELEASE_WEBHOOK_URL` — Discord のチャンネル設定 → 連携サービス → ウェブフックで発行した素のURL（`/github` サフィックスなし）
- `VERCEL_WEBHOOK_SECRET` 未設定時は 503、`DISCORD_RELEASE_WEBHOOK_URL` 未設定時は通知をスキップする

---

## ページビュー集計（Vercel Web Analytics）

`/player/:slug`・`/guides/:authorSlug/:guideSlug` のページビューを Vercel Web Analytics から集計し、走者一覧（`/browse`）・ガイド一覧（`/guides`）の「人気順」ソートに使う。

### 仕組み

1. cron `/api/cron/update-page-views`（`20 */6 * * *`、6時間毎）が、他の cron と同じ `CRON_SECRET` で認証する（`app/lib/cron-auth.server.ts` の `requireCronAuth()`）
2. `VERCEL_API_TOKEN` / `VERCEL_PROJECT_ID` が未設定なら 500 を返して終了する（`isPageViewSyncConfigured()`）。ローカル開発では通常未設定でよく、その場合は人気順が全件0扱いとなりいいね数・更新日時へ自然に落ちる
3. Vercel Web Analytics API（`GET https://api.vercel.com/v1/query/web-analytics/visits/aggregate`）へ `/player/` と `/guides/` それぞれの接頭辞で問い合わせ、**直近7日**・**上位100パス**の requestPath 別ページビューを取得する（`app/lib/vercel-analytics.server.ts` の `fetchTopPaths()`）
4. 取得した path を `parseAnalyticsPath()`（`app/lib/page-view-paths.ts`）でプロフィール / ガイドへ解釈し、slug から `users.id` / `guides.id` を引いて `page_view_stats` テーブルへ**種別（プロフィール / ガイド）ごとに全置換**保存する（`app/lib/page-view-stats.server.ts` の `syncPageViewStats()`）
5. **片側（プロフィール or ガイド）の API 呼び出しが失敗しても、もう片側の更新は継続**する。失敗した種別は旧スナップショットを維持する（並びがいきなり更新順へ落ちるより、少し古い人気順の方が体験がよいため）

### `page_view_stats` テーブル

| カラム | 型 | 説明 |
|---|---|---|
| `targetType` | enum | `"profile"` \| `"guide"` |
| `targetId` | text | `users.id` / `guides.id`（多態の弱参照、FKなし。対象が消えても次回同期の全置換で孤児行は消える） |
| `pageviews` | integer | 集計窓内のページビュー数（大小文字違いのプロフィールURLは合算済み） |
| `windowStart` / `windowEnd` | timestamp | 集計窓の開始・終了 |
| `fetchedAt` | timestamp | この行を書き込んだ時刻（鮮度確認用） |

索引: `page_view_stats_target_uniq(target_type, target_id)`（UNIQUE。対象1行を保証しつつ、人気順の相関サブクエリのカバリング索引を兼ねる）

読み取り側は `guidePageViewsSql()` / `profilePageViewsSql()`（同ファイル）の相関サブクエリで、`likes.server.ts` と同じ理由（内側テーブルを `id` なしで包む）で書かれている。適用箇所の詳細は [`docs/likes.md`](./likes.md#ガイド一覧の並び順guidelistorderby)（ガイド一覧の `popular`）と [`docs/browse-compare.md`](./browse-compare.md#ソート)（走者一覧の `popular`）を参照。

---

## 関連ファイル

### データベース
- `app/lib/db.ts` - DB接続作成（`createDb`）
- `app/lib/schema.ts` - 全テーブル定義（Drizzle ORM スキーマ）
- `drizzle.config.ts` - Drizzle Kit 設定
- `drizzle/` - マイグレーションファイル

### 国際化
- `app/lib/i18n.ts` - カテゴリベースi18n（システム1）
- `app/lib/messages/index.ts` - ドットパスキーi18n（システム2）エントリポイント
- `app/lib/messages/pages-ja.ts` - 日本語メッセージ定義

### レイアウト
- `app/routes/_layout.tsx` - メインレイアウト（ヘッダー/フッター）
- `app/routes/me/_layout.tsx` - ダッシュボードレイアウト（サイドバー）

### OGP
- `app/routes/og-image.tsx` - 動的OGP画像生成

### リリース通知
- `app/routes/api/webhooks/vercel.ts` - Vercel Webhook 受信エンドポイント
- `app/lib/app-meta.server.ts` - app_meta テーブルの読み書きユーティリティ
- `app/lib/changelog.ts` - changelog.md パースユーティリティ（What's New と共用）

### ページビュー集計
- `app/routes/api/cron/update-page-views.ts` - ページビュー集計Cron
- `app/lib/vercel-analytics.server.ts` - Vercel Web Analytics APIクライアント（`fetchTopPaths`）
- `app/lib/page-view-paths.ts` - Analytics の requestPath → 対象（プロフィール/ガイド）解釈（純粋関数）
- `app/lib/page-view-stats.server.ts` - 同期処理（`syncPageViewStats`）＋人気順の相関サブクエリ（`guidePageViewsSql` / `profilePageViewsSql`）

### その他
- `app/lib/env.server.ts` - サーバーサイド環境変数アクセス
- `app/env.d.ts` - 環境変数の型定義（`Env`）
- `app/lib/email.server.ts` - メール送信（Resend）
- `app/lib/import-parser.ts` - レガシーインポートパーサー
- `app/lib/legacy-import.ts` - レガシーインポートロジック
- `app/routes/api/keybindings-csv.ts` - CSVエクスポートAPI
- `app/routes/api/set-locale.ts` - ロケール設定API
- `app/routes/feedback.tsx` - フィードバックフォーム
- `app/components/layout/footer.tsx` - フッター（CSVエクスポートモーダル含む）
