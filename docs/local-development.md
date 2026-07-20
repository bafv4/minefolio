# ローカル開発環境

Turso や Discord OAuth を用意しなくても、ローカルSQLiteファイルと簡易ログインだけで開発できる構成。

## セットアップ手順

1. `.env` を作成（`.env.example` 参照）し、最低限以下を設定する:

   ```bash
   # ローカルSQLiteファイルを使用（Turso不要）
   TURSO_DATABASE_URL=file:local.db

   # 簡易ログインを有効化
   DEV_AUTH=1

   APP_URL=http://localhost:5173
   # 任意のランダム文字列でよい
   BETTER_AUTH_SECRET=local-dev-secret
   ```

   Discord OAuth（`DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET`）は**未設定でも起動できる**
   （`createAuth` が未設定時は Discord プロバイダを登録しない）。

2. スキーマを反映する（`local.db` が無ければ自動作成される）:

   ```bash
   pnpm db:push
   ```

3. （任意）スピードランカテゴリのシードデータを投入する:

   ```bash
   npx tsx app/lib/seed-categories.ts
   ```

4. 開発サーバーを起動し、`/dev/login` からログインする:

   ```bash
   pnpm dev
   ```

## ローカルDB

- `app/lib/db.ts` の `createDb()` と `drizzle.config.ts` は、`TURSO_DATABASE_URL` 未設定時に
  `file:local.db` へフォールバックする。明示的に `TURSO_DATABASE_URL=file:local.db` と書いておくと、
  アプリと drizzle-kit（`db:push` / `db:studio`）の両方が確実に同じローカルファイルを指す
- `local.db` は `.gitignore` 済みのリポジトリ直下に作られる。壊れたら削除して `pnpm db:push` で作り直せる
- 内容の確認は `pnpm db:studio`

## リモートDB（本番Turso）への適用

**`.env` は常に `file:local.db` 固定**とし、リモートの接続情報は `.env.remote`
（gitignore 済み）に分離する。`.env` を一時的にリモート URL へ書き換える運用は、
同時に動いている dev サーバーや別スクリプトが巻き添えでリモート DB に接続する
事故のもとなので行わない。

```bash
# .env.remote（gitignore 済み・リモート適用時のみ使用）
TURSO_DATABASE_URL=libsql://xxxx.turso.io
TURSO_AUTH_TOKEN=...
```

- **スキーマ反映**: `pnpm db:push:remote`
  （`drizzle.remote.config.ts` が `.env.remote` を読み込む。対話プロンプト、
  特に **TRUNCATE 提案の有無を必ず確認**してから承認する）
- **一回限りスクリプト**（`scripts/*.ts`。falsy デフォルトの新規列など db:push が
  TRUNCATE を提案するケースの手動 DDL）: `--remote` フラグで `.env.remote` を読み込む

  ```bash
  pnpm exec tsx scripts/<script>.ts --remote          # リモートに dry-run
  pnpm exec tsx scripts/<script>.ts --remote --apply  # リモートに適用
  ```

  フラグなしは `.env`（ローカル）。共通ローダー `scripts/lib/db-env.ts` が
  「`--remote` なのにローカル URL」「フラグなしなのにリモート URL」をどちらも中断する
- **ガード**: `.env` にリモート URL を書くと `drizzle.config.ts`・各スクリプトが
  エラーで中断し、`/dev/login` も自動的に無効になる（下記）

### リモートDB に接続して dev サーバーを起動（`pnpm dev:remote`）

```bash
pnpm dev:remote   # react-router dev --mode remote
```

`.env` を書き換えずにリモート DB へ繋いだ dev サーバーを起動する。仕組みは Vite の
モード別 env ファイル: React Router の dev サーバーは `vite.loadEnv(mode, ...)` で
env を読み込むため、`--mode remote` を渡すと **`.env.remote` が `.env` の上に重なる**
（`TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` だけがリモート値で上書きされ、その他の
変数は `.env` のまま）。通常の `pnpm dev`（mode=development）は `.env.remote` を
読まないので、ローカルと同時に立ち上げても互いに巻き添えにならない。

- `.env.remote` が必要（未設定なら DB 接続で失敗する）。上記のリモート接続情報を記載しておく
- 接続先がリモート（`libsql://`）になるため `/dev/login` は自動的に無効。実データを扱うため
  破壊的な操作に注意する
- `NODE_ENV` は development のまま（Vite のモードと NODE_ENV は別物）

## 簡易ログイン（/dev/login）

- **有効化条件（三重ゲート）**: `DEV_AUTH=1` **かつ** `NODE_ENV !== "production"`
  **かつ** `TURSO_DATABASE_URL` がローカル（`file:` または未設定）。
  いずれかを満たさなければルートは 404 を返し、better-auth の email/password 認証自体も無効のまま
  （本番・プレビュー環境の Vercel は `NODE_ENV=production` のため、誤って `DEV_AUTH=1` を
  設定しても有効にならない。DB ゲートは、`.env` の書き換え等で接続先がリモートに
  なったまま開発用ログインがリモート DB にユーザーを作成する事故を防ぐ）
- 仕組み: ローカル限定で better-auth の `emailAndPassword` を有効にし、ユーザー名から
  `{username}@dev.local` + 固定パスワードでサインアップ/サインインする。
  セッション確立後は `/login` 経由で通常のオンボーディングフローに合流する
  （`users` 行の作成は本番と同じ `/onboarding` が担う）
- 同じユーザー名を入力すれば同じアカウントに再ログインできる。複数の開発アカウントを
  使い分けたい場合はユーザー名を変えるだけでよい
- `/login` ページにも、有効時のみ「開発用ログイン」への導線が表示される

## 関連ファイル

| ファイル | 役割 |
|---|---|
| `app/routes/dev-login.tsx` | 簡易ログインのルート（loader/action とも 404 ゲート付き） |
| `app/lib/env.server.ts` | `isDevAuthEnabled()`（二重ゲートの単一実装） |
| `app/lib/auth.ts` | `emailAndPassword` のローカル限定有効化・Discord プロバイダの条件付き登録 |
| `app/lib/seed-categories.ts` | カテゴリシード（`npx tsx` で実行） |
| `scripts/lib/db-env.ts` | 一回限りスクリプト共通の環境ローダー（`--remote` で `.env.remote`） |
| `package.json` (`dev:remote`) | `react-router dev --mode remote`。Vite のモード別 env で `.env.remote` を重ねてリモート DB に接続 |
| `drizzle.remote.config.ts` | `pnpm db:push:remote` 用のリモート drizzle 設定 |
