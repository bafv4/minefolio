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

## Webフォント

外部（Google Fonts等）への通信を排除するため、ページ用フォントはすべて npm パッケージとしてセルフホストしている。

- **本文**: Zen Kaku Gothic New（ウェイト 400 / 500 / 700）— `@fontsource/zen-kaku-gothic-new`
- **等幅**: JetBrains Mono（ウェイト 400 / 500 / 600）— `@fontsource/jetbrains-mono`
- 読み込みは `app/app.css` 冒頭の `@import "@fontsource/.../{weight}.css"`（ウェイトごと）。各 `{weight}.css` は unicode-range で分割された `@font-face` 群を含み、ブラウザは実際に使う文字範囲のサブセットのみを取得する
- `--font-sans` / `--font-mono`（`@theme` ブロック）でフォールバックチェーンを定義。フォント本体を伴わない未使用のフォールバック名（旧 `Inter`）は削除済み
- `app/root.tsx` の `links` に Google Fonts の `preconnect` / `stylesheet` は置かない（過去に置いていたが撤去済み）
- ライセンス: 両パッケージとも OFL-1.1（パッケージ内に LICENSE 同梱）

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
- **描画フォント（Zen Kaku Gothic New 400/700）**: `@vercel/og`（satori）は woff2 非対応（TTF/OTF/WOFF のみ）のため、
  `@fontsource` のサブセット済み woff2 は使えない。代わりに unicode-range 分割前の完全グリフセットの TTF を
  `public/fonts/ZenKakuGothicNew-{Regular,Bold}.ttf`（OFL-1.1、ライセンスは同ディレクトリの `OFL.txt`）として同梱し、
  `loadOgFonts(origin)` が自ホストへ `fetch(`${origin}/fonts/...`)` で self-fetch する。
  - **ウェイト単位の独立キャッシュ**: Regular(400) / Bold(700) をそれぞれ独立の Promise でキャッシュし、
    成功したウェイトだけを返す。片方が一過性に失敗しても、もう片方は使える（日本語が全滅しない）。
    失敗したウェイトはキャッシュに残さず、次回リクエストで再取得を試みる
  - **TTF マジックバイト検証**: 取得した応答の先頭4バイトが sfnt version 1.0（`00 01 00 00`）と
    一致しない場合は例外にする。200 応答でも中身が HTML（リライト誤設定・保護画面等）のケースを
    成功として恒久キャッシュしてしまうのを防ぐ
  - 両ウェイトとも成功した場合は、返却する配列オブジェクトの同一性を保ってキャッシュする
    （satori 内部の WeakMap フォントキャッシュが fonts 配列の同一性をキーにしているため）
  - 取得失敗（非2xx・TTF検証失敗等）は `console.error` に記録する
  - 空配列（全ウェイト失敗）の場合は呼び出し側で `@vercel/og` のバンドル既定フォントにフォールバックする
  - 外部（Google Fonts）への通信は行わない。JetBrains Mono は OGP 描画では未使用のため同梱していない
- 旧実装（Google Fonts css2 API に描画テキスト全体を `text=` クエリで渡してサブセット TTF を取得する方式）は、
  表示名・MCID・bio 等の PII を外部送信していたため撤去済み

---

## 法務ページ（プライバシーポリシー・利用規約）

### 概要

- `/privacy`（プライバシーポリシー）・`/terms`（利用規約）は、フッターの「プライバシーポリシー」「利用規約」リンクから遷移できる公開ページ
- 本文の正本は `app/content/privacy.md` / `app/content/terms.md`。**この2ファイルはポリシー文言そのものであり、内容変更は法務的な判断を要するため、実装作業のついでに書き換えない**
- ルート実装は `app/routes/privacy.tsx` / `app/routes/terms.tsx`。アイコン + h1 + prose シェル（`?raw` import + `react-markdown` + `remark-gfm` + `rehype-sanitize`、`prose prose-sm dark:prose-invert max-w-none`）は `/developers/api` `/developers/changelog` と共通の `app/components/markdown-doc-page.tsx`（`MarkdownDocPage`）を使う。OGP meta（title/description/og:image）の組み立ても5ページ共通で `app/lib/og-meta.ts`（`buildOgMeta`）を使う
- 認証不要・`app/routes.ts` の公開レイアウト（`routes/_layout.tsx`）配下に登録

### 冒頭のドラフトメモ（HTML コメント）

両 md ファイルの冒頭には、公開前に運営者が確認すべき事項を記した HTML コメント（`<!-- ... -->`）が入っている。
`react-markdown` は `allowDangerousHtml` を指定しない既定設定では mdast の `html` ノードをそのまま破棄する
（`mdast-util-to-hast` の挙動）ため、このコメントは**レンダリング結果に一切出力されない**。今後この方式を変更する
（`rehype-raw` の導入や `allowDangerousHtml: true` 化など）場合は、コメントが可視化されないことを都度確認すること。

### 関連リンク

md 内の `[フィードバックフォーム](/feedback)` のような相対リンクは、`react-markdown` により通常の `<a href="/feedback">`
としてレンダリングされる（React Router の `Link` には変換されないため、クリック時はフルページ遷移になる。既存の
`/developers/*` ページと同じ挙動）。

---

## フィードバック

### フィードバックフォーム (/feedback)

- ユーザーからのフィードバックを受け付けるフォーム（ログイン必須）
- カテゴリ選択（`bug` / `feature` / `other`）、件名（5〜100文字）、本文（10〜2000文字）入力
- バリデーションは `app/lib/feedback-schema.ts`（zod）

### メール送信

- **Resend API** でフィードバック内容をメール送信（主経路・必須）
- 環境変数: `FEEDBACK_EMAIL`（送信先）、`RESEND_API_KEY`（APIキー）
- `app/lib/email.server.ts` でメール送信処理。送信者の Discord ID / MCID / 表示名はメール本文にのみ含まれる

### GitHub Issue の自動作成（オプトイン）

- フォームに「フィードバックをGitHubのIssueに発行する」チェックボックスを表示する（既定オフ）。表示条件は
  `GITHUB_FEEDBACK_TOKEN` が設定されていること（loader の `canCreateIssue`）
- **Issue本文には個人情報を一切含めない**: タイトル＝件名そのまま、本文＝カテゴリ表記＋本文＋末尾に
  相関ID行（`Feedback-ID: <8文字>`）のみ。discordId / mcid / displayName は載せない
- 相関ID（`createId().slice(0, 8)`）は action 内で1つ生成し、**メール本文（送信者特定用）と Issue 本文
  （突き合わせ用）の両方**に入れる
- ラベル: 常に `feedback` ＋ `category === "bug"` なら `bug`、`category === "feature"` なら `enhancement`
  （`other` は `feedback` のみ）
- 処理順: **メール送信（常に必須の主経路）→ 成功した場合のみ Issue 作成**。チェックボックスがオンかつ
  `GITHUB_FEEDBACK_TOKEN` 設定時のみ Issue 作成を試み、**失敗してもフィードバック送信全体は成功扱い**
  （`console.error` に残すのみ、UIには警告トーストを出す）。Issue を先に作るとメール失敗時に
  突き合わせ先のない公開 Issue が残り、再送信で重複 Issue が生まれるため、この順序は変えない
- クライアント: `app/lib/github.server.ts` の `createFeedbackIssue()`（`POST /repos/{repo}/issues`、
  fine-grained PAT・`AbortSignal.timeout(10000)`）
- 環境変数: `GITHUB_FEEDBACK_TOKEN`（fine-grained PAT。未設定なら機能自体が無効）、
  `GITHUB_FEEDBACK_REPO`（省略時 `"bafv4/minefolio"`）
- 作成に成功した場合、送信成功画面（`sent` 表示）に Issue へのリンクを表示する

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
| `GITHUB_FEEDBACK_TOKEN` | フィードバックのGitHub Issue自動作成用トークン（fine-grained PAT）。未設定なら機能自体が無効 |
| `GITHUB_FEEDBACK_REPO` | Issue作成先リポジトリ（`owner/repo`形式）。省略時 `"bafv4/minefolio"` |
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

### Webフォント
- `app/app.css` - `@fontsource/zen-kaku-gothic-new` / `@fontsource/jetbrains-mono` の `@import`、`--font-sans` / `--font-mono`
- `public/fonts/` - OGP描画用 TTF（`ZenKakuGothicNew-{Regular,Bold}.ttf`）と `OFL.txt`

### OGP
- `app/routes/og-image.tsx` - 動的OGP画像生成（`loadOgFonts` が `public/fonts/` を self-fetch）

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
- `app/lib/github.server.ts` - GitHub Issues APIクライアント（フィードバックのIssue自動作成）
- `app/lib/feedback-schema.ts` - フィードバックフォームのバリデーション（zod）
- `app/lib/import-parser.ts` - レガシーインポートパーサー
- `app/lib/legacy-import.ts` - レガシーインポートロジック
- `app/routes/api/keybindings-csv.ts` - CSVエクスポートAPI
- `app/routes/api/set-locale.ts` - ロケール設定API
- `app/routes/feedback.tsx` - フィードバックフォーム
- `app/routes/privacy.tsx` - プライバシーポリシー（`app/content/privacy.md` をレンダリング）
- `app/routes/terms.tsx` - 利用規約（`app/content/terms.md` をレンダリング）
- `app/content/privacy.md` / `app/content/terms.md` - プライバシーポリシー・利用規約の本文（正本）
- `app/components/layout/footer.tsx` - フッター（CSVエクスポートモーダル含む。プライバシーポリシー・利用規約リンクも配置）
- `app/components/markdown-doc-page.tsx` - markdown 静的ドキュメントページ共通シェル（privacy / terms / developers/changelog / developers/api）
- `app/lib/og-meta.ts` - OGP meta 配列ビルダー（privacy / terms / developers/{index,api,changelog}）
