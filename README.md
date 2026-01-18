# Minefolio

Minecraftスピードランナーのポートフォリオプラットフォーム

## 機能

- プロフィール管理（キーバインド、デバイス設定、記録）
- 外部API連携（Speedrun.com、PaceMan、Twitch、YouTube）
- プレイヤー検索・比較
- Cloudflare Pages + D1（SQLite）でデプロイ

## 技術スタック

- React 19 + React Router 7
- TypeScript
- TailwindCSS 4
- Drizzle ORM
- better-auth
- Cloudflare Pages & D1

## セットアップ

### 1. 依存関係のインストール

```bash
pnpm install
```

### 2. 環境変数の設定

`.env.example`をコピーして`.dev.vars`を作成し、必要な環境変数を設定してください。

```bash
cp .env.example .dev.vars
```

必要な環境変数:

- `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET`: Discord OAuth認証用
- `BETTER_AUTH_SECRET`: セッション暗号化用（`openssl rand -base64 32`で生成）
- `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET`: Twitchストリーム連携用
- `YOUTUBE_API_KEY`: YouTube動画連携用
- `APP_URL`: アプリケーションのURL

**⚠️ 重要**: API キーは絶対にGitにコミットしないでください。`.dev.vars`は`.gitignore`に含まれています。

### 3. データベースのセットアップ

ローカル開発用のD1データベースを作成:

```bash
pnpm wrangler d1 create minefolio_db --local
```

マイグレーション実行:

```bash
pnpm db:local
```

### 4. 開発サーバーの起動

```bash
pnpm dev
```

アプリケーションは `http://localhost:5173` で利用可能です。

## Cloudflare Pagesへのデプロイ

### 環境変数の設定

Cloudflare Dashboardで以下の環境変数を設定してください:

1. Settings > Environment variables に移動
2. 以下の変数を追加:
   - `DISCORD_CLIENT_ID`
   - `DISCORD_CLIENT_SECRET`
   - `BETTER_AUTH_SECRET`
   - `TWITCH_CLIENT_ID`
   - `TWITCH_CLIENT_SECRET`
   - `YOUTUBE_API_KEY`
   - `APP_URL`（本番URL）

### デプロイコマンド

```bash
pnpm deploy
```

## データベース管理

```bash
# スキーマ変更を生成
pnpm db:generate

# ローカルDBにマイグレーション
pnpm db:local

# 本番DBにマイグレーション
pnpm db:remote

# Drizzle Studio起動
pnpm db:studio
```

## スクリプト

- `pnpm dev`: 開発サーバー起動
- `pnpm build`: 本番ビルド
- `pnpm start`: 本番サーバー起動
- `pnpm typecheck`: 型チェック
- `pnpm deploy`: Cloudflare Pagesにデプロイ

## セキュリティ

- すべてのAPIキーは環境変数で管理
- `.dev.vars`ファイルは`.gitignore`に含まれており、Gitにコミットされません
- 本番環境ではCloudflare Dashboardで環境変数を設定

## ライセンス

MIT
