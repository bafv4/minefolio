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
pnpm db:push          # スキーマをローカルDB（.env = file:local.db）に直接反映
pnpm db:push:remote   # スキーマをリモートTurso（.env.remote）に直接反映
```

### git依存パッケージの更新（`@bafv4/mcitems` 等）

`package.json` で `github:bafv4/mcitems` のように指定された git 依存を更新する場合:

1. `pnpm update @bafv4/mcitems` で最新コミットを取得（lockfile がコミットにピン留めされる）。
2. **更新後は必ず開発サーバーを再起動する**。Vite のプリバンドルキャッシュ（`node_modules/.vite/deps/`）が旧バージョンを保持したままだと、node/tsx では新版でもブラウザ側だけ旧挙動になる。表示が更新されない時はこのキャッシュを疑い、`node_modules/.vite` 削除または `--force` 付き起動で再バンドルさせる。

## サブエージェント運用（重要）

このリポジトリは機能ドメインごとに実装ワーカー（サブエージェント）を `.claude/agents/` に定義している。
**実装タスクは原則としてメイン（トップレベルの Claude）が担当ワーカーへ委譲し、返ってきた diff をレビューする。**

1. タスクの機能ドメインを判定する
2. `.claude/rules/README.md` の「ワーカー別 必読マップ」で担当ワーカーを選び、Agent ツールで起動する
3. 返ってきた差分をメインがレビューする（必要なら `director` に読み取り専用の計画/査読を依頼する）

| ドメイン | ワーカー |
|---|---|
| キー配置・マウス・プリセット・アイテム/サーチクラフト | `keybindings-worker` |
| プロフィール・me・お気に入り・閲覧/比較・スキン | `profiles-worker` |
| ガイド記事（TipTap） | `guides-worker` |
| ホーム・ペース/ライブ・ランキング・統計 | `rankings-worker` |
| 認証・API/基盤・共通レイアウト・DBスキーマ | `platform-worker` |
| ドキュメント/changelog/翻訳キー/雑務 | `chores-worker` |
| Vitest テスト | `test-worker` |
| コミット・PR作成 | `commit-worker` |
| 調査・Web検索（読み取り専用） | `research-worker` |

- **DBスキーマ（`app/lib/schema.ts`）の変更は `platform-worker` に集約する**（全機能で共有するため）
- ワーカーはサブエージェントを起動できない。担当外へ波及したらメインに差し戻させ、メインが別ワーカーへ振り直す
- 会話・質問への回答・調査のみで済むもの・1ファイルの軽微な修正は、委譲せずメインが直接実行してよい
- 委譲の詳細な運用モデルとソース起点マップは `.claude/rules/README.md` が単一情報源

## バージョン管理・Changelog

- **バージョン番号は指示があるまで変えない**（勝手に上げない）
- **Changelog（`app/content/changelog.md`）も同様に、変更のたびにエントリを追加しない**。
  バージョンリリースの指示があった段階で、`origin/main` と `dev` の間のコミットを精査してまとめて作成する

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
- 設定: `drizzle.config.ts` = ローカル用（`.env` を読み込み。リモートURLならエラーで中断）、
  `drizzle.remote.config.ts` = リモート用（`.env.remote` を読み込み。`pnpm db:push:remote` で使用）

#### 接続先の分離運用（重要）

- **`.env` は常に `file:local.db` 固定**。リモートTursoの接続情報は `.env.remote`（gitignore済み）に分離する
- `.env` を一時的にリモートURLへ書き換える運用は**禁止**（起動中のdevサーバーや別スクリプトが巻き添えでリモートDBに接続する事故のもと）
- リモートへの反映: `pnpm db:push:remote`、または `scripts/` の一回限りスクリプトに `--remote` フラグ
  （共通ローダー `scripts/lib/db-env.ts` が `.env.remote` を読み込み、URLスキームを検証して取り違えを中断する）
- `pnpm db:push` はfalsyデフォルトの新規NOT NULL列で**TRUNCATE（データ損失）を提案する**ことがある。
  その場合はpushせず、`scripts/` に dry-run既定 + `--apply` フラグの一回限りtsxスクリプトを作って手動DDLで適用する
- ガード: `.env` にリモートURLが入ると `drizzle.config.ts`・各スクリプト・`/dev/login`（`isDevAuthEnabled()`）がすべて拒否する

### i18n（国際化）

日本語（既定）と英語に対応。**英語は主要導線から段階的**に広げており、未翻訳キーは日本語へフォールバックする。

- 文言: `app/lib/messages/`（ドットパスキー + `{param}` 補間）。`pages-ja.ts` が全キーの基準、`pages-en.ts` は部分集合
- コンポーネントは `useT()`（`@/hooks/use-locale`）。`t()` を直接呼ぶと常に日本語になる
- ロケール検出: `app/lib/locale.ts` の `resolveLocale()` — Cookie（`minefolio_locale`）→ Accept-Language（q値順）→ 既定 `ja`
- 切替UIはヘッダー。`/api/set-locale` に Cookie を保存して再検証する
- 詳細: `docs/i18n.md`

### ドキュメント・ルールファイル

- `docs/` — 機能ごとの仕様書（auth, profiles, keybindings, guides, rankings-stats 等）
- `.claude/rules/README.md` — 規約索引・サブエージェントの運用モデル・担当マップ
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

任意: `TWITCH_CLIENT_ID/SECRET`, `YOUTUBE_API_KEY`, `RESEND_API_KEY`, `CRON_SECRET`, `ANTHROPIC_API_KEY`, `FEATURE_PROFILE_REACTIONS`

ローカル開発は `TURSO_DATABASE_URL=file:local.db`（ローカルSQLite）+ `DEV_AUTH=1`（`/dev/login` の簡易ログイン、本番・リモートDB接続時は常に無効）で Turso / Discord OAuth なしに動かせる。リモートTursoの接続情報は `.env` ではなく `.env.remote` に置く（上記「接続先の分離運用」参照）。詳細: `docs/local-development.md`

サーバー専用の環境変数は `app/lib/env.server.ts` の `getEnv()` 経由でアクセス。

### 外部連携

- **Mojang API** (`app/lib/mojang.ts`): MCID→UUID変換、スキン解決
- **PaceMan** (`app/lib/paceman.ts`): リアルタイムスピードランペース追跡
- **Speedrun.com / MCSR Ranked**: プレイヤー統計取得（`app/lib/external-stats.ts`）
- **Vercel Blob**: スキンファイル・ガイド画像の保存
- **`/og-image`**: `@vercel/og` による動的OGP画像生成
