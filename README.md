# Minefolio

[English](./README.en.md)

Minecraft RTA走者向けのポートフォリオ/設定共有アプリです。

- ライセンス: [Apache License 2.0](./LICENSE)（対象外のアセット等は[ライセンス](#ライセンス)節を参照）
- [プライバシーポリシー](./app/content/privacy.md) ／ [利用規約](./app/content/terms.md)（サイト上では `/privacy` `/terms` で公開）

## サイト概要

Minefolio は、Minecraft RTA走者が自分のプロフィールやプレイ設定を整理し、他の走者と共有するためのサイトです。  
「どんな環境で、どんなキー配置で、どんな操作をしているか」を見やすく可視化し、学習・比較・自己紹介に使えることを目的としています。

主な利用シーン:

- 自分のプロフィールページを公開して、SNS で共有する
- 他の走者のキー配置・デバイス情報を参考にする
- サーチクラフトやリマップ設定を記録し、再現しやすくする
- 設定をプリセット化して、用途ごとに切り替える

## コア仕様（機能のあらまし）

### 1. プロフィール公開

- 公開プロフィールページ（`/player/:slug`）を作成できます
- 表示項目の例:
  - 表示名 / MCID / 代名詞
  - ロール（例: 走者）
  - 一言（short bio）や自己紹介
  - エディション、入力方法、プラットフォームなどのバッジ
- 公開範囲設定（`public` / `unlisted` / `private`、下記「権限と公開範囲」参照）に応じて一覧ページでの露出・閲覧可否を制御します

### 2. キー配置管理

- キーごとの操作割り当てを編集できます
- キー編集モーダルで、操作割り当て・リマップ・カスタムアクションをまとめて編集できます
- モーダル内の編集は即時反映ではなく、`保存` を押した時点で確定します
- 一括保存（`save-all`）で各設定をまとめて更新します

### 3. リマップ機能

- 複数リマップを登録できます
- 変更元キーは修飾キー組み合わせ（Ctrl/Shift/Alt/Meta）に対応します
- 変更先は以下の3種で扱います:
  - キー（Web `KeyboardEvent.code` 判定）
  - 文字
  - 無効化
- プレースホルダー文字列（`__character__` など）は保存時に無効化されるよう保護しています

### 4. カスタムアクション

- 任意のアクション名・説明・カテゴリを持つアクションを作成できます
- トリガーは通常キー・修飾キー組み合わせに対応します
- 専用タブだけでなく、キー編集モーダルからも追加・編集できます

### 5. サーチクラフト表示

- 検索文字列と入力キーを対応づけて表示できます
- リマップを考慮した表示に対応しています
- 修飾キーはマーク表示（例: `◆` `⇧` `⌥` `◇`）で視認性を高めています

### 6. 一覧・検索

- `browse`:
  - 走者一覧、フィルタ、ソート、ページネーション
  - 検索は検索ボタン押下時に実行
  - ローディング表示は結果エリアのみ
- `keybindings`:
  - 走者ごとのキー配置/マウス設定比較
  - 検索は検索ボタン押下時に実行
  - ローディング表示は結果テーブル領域のみ

### 7. プリセット

- 現在設定をプリセットとして保存できます
- プリセットの複製・切替（復元）に対応しています
- プリセットはキー配置・リマップ・指割り当て・アイテム配置・サーチクラフト・カスタムアクションなど全設定種別をまとめて1単位として保存・復元します（種別単位での部分コピーは非対応）

## 画面構成（代表）

- `/` : ホーム（フィード）
- `/browse` : 走者一覧
- `/keybindings` : キー配置一覧
- `/player/:slug` : 公開プロフィール
- `/guides` : ガイド記事一覧
- `/rankings` : ランキング
- `/stats` : 統計
- `/privacy` `/terms` : プライバシーポリシー・利用規約
- `/me/*` : 自分の設定管理（編集・キー配置・プリセット など）
- `/my-guides/*` : 自分のガイド記事の執筆・管理

ルートの完全な一覧は [`app/routes.ts`](./app/routes.ts) に定義されています（手動管理）。

## 権限と公開範囲（仕様）

- 認証ユーザーは自分の設定を編集可能
- プロフィールの公開範囲（`profileVisibility`）は3段階:
  - `public` : 誰でも閲覧可能、一覧・検索の対象
  - `unlisted` : URLを知っていれば閲覧可能、一覧・検索の対象外
  - `private` : 本人のみ閲覧可能
- 一覧・ランキング系は `public` のプロフィールのみを対象に表示

## 技術スタック

- React 19 + React Router 8（SSR、Vite）
- TypeScript
- Tailwind CSS 4 + shadcn/ui（Radix UI）
- Drizzle ORM + libSQL（Turso）/ `@libsql/client`
- better-auth（Discord OAuth）
- TipTap（ガイドエディタ）
- デプロイ: Vercel（Cron、Blob Storage、OG画像生成）

詳細は [`docs/tech-stack.md`](./docs/tech-stack.md) を参照してください。

## セットアップ

### 1. 依存関係のインストール

```bash
pnpm install
```

### 2. 環境変数の設定

`.env.example` をコピーして `.env` を作成し、値を設定してください。

```bash
cp .env.example .env
```

必須:

- `TURSO_DATABASE_URL`（未設定時は `file:local.db` にフォールバック）
- `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET`
- `APP_URL`
- `BETTER_AUTH_SECRET`

任意（機能ごとに有効化。未設定でも起動は可能）:

- `TURSO_AUTH_TOKEN` — 本番Turso（リモート）接続時
- `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` — Twitch連携
- `YOUTUBE_API_KEY` — YouTube連携
- `ANTHROPIC_API_KEY` — ガイド・自己紹介の自動翻訳。未設定なら機能ごと無効
- `RESEND_API_KEY` / `FEEDBACK_EMAIL` — フィードバックのメール送信
- `GITHUB_FEEDBACK_TOKEN` / `GITHUB_FEEDBACK_REPO` — フィードバックのGitHub Issue自動作成（オプトイン機能。未設定なら機能自体が無効）
- `CRON_SECRET` — Vercel Cronの認証（Vercelへデプロイする場合は必須）
- `VERCEL_API_TOKEN` / `VERCEL_PROJECT_ID` / `VERCEL_TEAM_ID` — Vercel Web Analyticsのページビュー集計
- `VERCEL_WEBHOOK_SECRET` / `DISCORD_RELEASE_WEBHOOK_URL` — 本番デプロイ時のリリース通知
- `BLOB_READ_WRITE_TOKEN` — Vercel Blob（スキン・ガイド画像のアップロード）。Vercel上では自動付与
- `LEGACY_API_URL` — レガシーサービス（MCSRer Hotkeys）からのインポート
- `DEV_AUTH=1` — ローカル専用の簡易ログイン（`/dev/login`）を有効化。詳細は [`docs/local-development.md`](./docs/local-development.md)

環境変数の完全な一覧は [`docs/infrastructure.md`](./docs/infrastructure.md#環境変数) を参照してください。

### 3. 開発サーバー起動

```bash
pnpm dev
```

デフォルト: `http://localhost:5173`

## 利用可能スクリプト

```bash
# 開発
pnpm dev
pnpm dev:remote       # リモートTursoに接続した開発サーバー（.env.remote が必要）

# ビルド / 実行
pnpm build
pnpm start

# 型チェック / テスト
pnpm typecheck
pnpm test
pnpm test:ui
pnpm test:coverage

# DB（Drizzle）
pnpm db:generate
pnpm db:migrate
pnpm db:push          # ローカルDB（.env = file:local.db）へスキーマ反映
pnpm db:push:remote   # リモートTurso（.env.remote）へスキーマ反映
pnpm db:studio
pnpm db:studio:remote
```

## プライバシーポリシー・利用規約

- [プライバシーポリシー](./app/content/privacy.md) — 取得する情報・利用目的・外部サービスへの送信先・Cookie・アカウント削除など。電気通信事業法の外部送信規律に基づく公表（アクセス解析・動画埋め込みで端末から送信される情報）も含みます
- [利用規約](./app/content/terms.md) — アカウント・投稿コンテンツの権利・禁止事項・免責など

いずれも本サイト上で `/privacy` `/terms` として公開しているものと同じ内容です（リポジトリ内の md ファイルが正本）。ソースコードのライセンス（下記）とは独立に適用されます。

## ライセンス

このリポジトリのソースコードは [Apache License 2.0](./LICENSE) で公開しています（Copyright 2026 bfmkn (bafv4)。[NOTICE](./NOTICE) も参照）。

以下はライセンスの**対象外**です:

- `public/mcitems/` — Minecraft のアイテムテクスチャ。Mojang / Microsoft の資産であり、[Minecraft 利用ガイドライン](https://www.minecraft.net/usage-guidelines)の範囲で使用しています。再利用する場合は同ガイドラインに従ってください
- `public/fonts/` — Zen Kaku Gothic New（SIL Open Font License 1.1。同梱の [`OFL.txt`](./public/fonts/OFL.txt) 参照）
- 「Minefolio」の名称・アイコン等のブランド要素（Apache License 2.0 第6条のとおり、商標の使用は許諾されません）

Minefolio は Mojang / Microsoft とは無関係の非公式ファンサイトです。NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.
