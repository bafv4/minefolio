# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

MinefolioはMinecraftスピードランナー向けのポートフォリオプラットフォーム。キー配置・マウス設定・スピードラン記録の管理、ガイド記事の執筆・公開ができる。日本語/英語対応。

## コマンド

```bash
pnpm dev              # 開発サーバー起動 (http://localhost:5173)
pnpm build            # プロダクションビルド
pnpm typecheck        # React Router typegen + tsc --noEmit
pnpm test             # Vitest実行
pnpm db:generate      # スキーマ変更からDrizzleマイグレーション生成
pnpm db:migrate       # マイグレーション実行
pnpm db:push          # スキーマを直接Tursoに反映（マイグレーションファイルなし）
```

### git依存パッケージの更新（`@bafv4/mcitems` 等）

`package.json` で `github:bafv4/mcitems` のように指定された git 依存を更新する場合:

1. `pnpm update @bafv4/mcitems` で最新コミットを取得（lockfile がコミットにピン留めされる）。
2. **更新後は必ず開発サーバーを再起動する**。Vite のプリバンドルキャッシュ（`node_modules/.vite/deps/`）が旧バージョンを保持したままだと、node/tsx では新版でもブラウザ側だけ旧挙動になる。表示が更新されない時はこのキャッシュを疑い、`node_modules/.vite` 削除または `--force` 付き起動で再バンドルさせる。

## 技術スタック

- **フレームワーク**: React 19 + React Router 8（SSR、Vite）
- **スタイリング**: Tailwind CSS 4、shadcn/ui（Radix UI）
- **データベース**: Drizzle ORM + libSQL（Turso）、SQLite方言
- **認証**: better-auth + Discord OAuth
- **リッチテキスト**: TipTap（ガイドエディタ）
- **デプロイ**: Vercel（Cron、Blob Storage、OG画像生成）

## アーキテクチャ

### ルーティング

ルートは `app/routes.ts` で**手動定義**されている。`app/routes/` にファイルを追加しただけではルートとして認識されない。新しいルートは必ず `app/routes.ts` に登録すること。

- 公開ページは `layout("routes/_layout.tsx", [...])` でラップ（ヘッダー/フッター付き）
- APIルートはレイアウト外（UIコンポーネントなし、`loader`/`action`のみexport）
- `/me/*` 配下はネストされた `me/_layout.tsx`（サイドバー付き）で保護

### ルートファイルの規約

- 自動生成型は `.react-router/types/` に格納 — `pnpm typecheck` で再生成
- Loader/Actionは `Route.LoaderArgs` / `Route.ActionArgs`（`./+types/<ルート名>` からimport）
- APIのみの `.ts` ファイルは `react-router` から直接 `LoaderFunctionArgs` を使用可能

### 標準的なLoaderパターン

```typescript
export async function loader({ request }: Route.LoaderArgs) {
  const env = getEnv(); // app/lib/env.server.ts（process.env から取得）
  const db = createDb();
  const auth = createAuth(db, env);
  const session = await getOptionalSession(request, auth); // 認証必須の場合は getSession()
  // ...Drizzle ORMでクエリ
}
```

React Router 8 の `context` は `RouterContextProvider`（`context.get()` ベース）。本プロジェクトでは
`getLoadContext` を使っておらず、環境変数は常に `getEnv()`（process.env）経由で取得する。

### データベース

- スキーマ: `app/lib/schema.ts`（Drizzle ORM、SQLite/Turso方言）
- マイグレーション: `drizzle/` ディレクトリ、`pnpm db:generate` + `pnpm db:migrate` で管理
- ID生成: `@paralleldrive/cuid2` によるCUID2
- 設定: `drizzle.config.ts`（Turso URLがない場合は `file:local.db` にフォールバック）

### i18n（国際化）

2つのシステムを併用:
- `app/lib/i18n.ts`: カテゴリベースの `t(category, key)` でロケールパラメータ付き
- `app/lib/messages/`: ドットパスキー（例: `t("playerProfile.keybindingsTab")`）と `{param}` 補間
- デフォルトロケール: `"ja"`、Cookie → Accept-Languageヘッダーの順で検出

### ドキュメント・ルールファイル

- `docs/` — 機能ごとの仕様書（auth, profiles, keybindings, guides, rankings-stats 等）
- `.claude/rules/general.md` — コーディング規約
- `.claude/rules/ui.md` — UIデザイン規約

仕様や機能に変更が生じた場合は、対応するドキュメント・ルールファイルも適宜更新すること。

### 主要ディレクトリ

- `app/routes/` — ページルートとAPIエンドポイント
- `app/components/ui/` — shadcn/uiプリミティブ（Radix UIベース）
- `app/components/layout/` — ヘッダー、フッター、テーマ切替
- `app/components/guide-editor/` — TipTapリッチテキストエディタ
- `app/components/` — ドメインコンポーネント（アバター、キーボード、カード等）
- `app/lib/` — サーバーユーティリティ、スキーマ、認証、外部APIクライアント

### 環境変数

必須: `TURSO_DATABASE_URL`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `APP_URL`, `BETTER_AUTH_SECRET`

任意: `TWITCH_CLIENT_ID/SECRET`, `YOUTUBE_API_KEY`, `RESEND_API_KEY`, `CRON_SECRET`

ローカル開発は `TURSO_DATABASE_URL=file:local.db`（ローカルSQLite）+ `DEV_AUTH=1`（`/dev/login` の簡易ログイン、本番では常に無効）で Turso / Discord OAuth なしに動かせる。詳細: `docs/local-development.md`

サーバー専用の環境変数は `app/lib/env.server.ts` の `getEnv()` 経由でアクセス。

### 外部連携

- **Mojang API** (`app/lib/mojang.ts`): MCID→UUID変換、スキン解決
- **PaceMan** (`app/lib/paceman.ts`): リアルタイムスピードランペース追跡
- **Speedrun.com / MCSR Ranked**: プレイヤー統計取得（`app/lib/external-stats.ts`）
- **Vercel Blob**: スキンファイル・ガイド画像の保存
- **`/og-image`**: `@vercel/og` による動的OGP画像生成
