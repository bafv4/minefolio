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

## 簡易ログイン（/dev/login）

- **有効化条件（二重ゲート）**: `DEV_AUTH=1` **かつ** `NODE_ENV !== "production"`。
  どちらかを満たさなければルートは 404 を返し、better-auth の email/password 認証自体も無効のまま
  （本番・プレビュー環境の Vercel は `NODE_ENV=production` のため、誤って `DEV_AUTH=1` を
  設定しても有効にならない）
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
