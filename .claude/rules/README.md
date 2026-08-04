# 規約索引（rules index）

このディレクトリはコーディング／デザイン規約。`.claude/agents/` の各サブエージェントは、
タスク着手時にまずここで「担当領域の必読ファイル」と「ソース起点」を確認してから作業する。
リポジトリ運用ルール（コマンド・DB反映・ルーティング等）はリポジトリ直下の `CLAUDE.md` を参照。

## 運用モデル（担当の呼び出され方）

- **ルーティングはメイン（トップレベルの Claude）が行う**。タスクの機能ドメインを判定し、該当する実装ワーカーへ
  直接委譲し、diff をレビューする。
- 実装ワーカー（機能ワーカー ＋ `chores-worker` / `test-worker` / `commit-worker`）は**サブエージェントを起動できない**
  （この環境ではサブエージェント内から委譲用の `Agent` ツールが使えない）。他機能への波及や共有スキーマ変更が
  必要になったら、自分で広げず**呼び出し元（メイン）に差し戻す**。
- `director` は**読み取り専用の計画・レビュー担当**。着手前の設計や仕上げの査読を独立視点で入れたいときに、
  メインが任意で呼ぶ。director も実装・委譲はしない（成果物＝計画/レビュー結果をメインに返すだけ）。
- `research-worker` も**読み取り専用**。コードは書かず、調査結果（根拠つき）をメインに返すだけ。実装が必要な
  結論が出たら、メインが適切な機能ワーカーへ引き継ぐ。
- `commit-worker` は実装が完了・レビュー済みの変更を**コミット/PR化するだけ**の担当。何を実装するかの判断はせず、
  対象範囲の確認と Git Safety Protocol の遵守に専念する。

## 規約ファイル

- [general.md](./general.md) — コーディング規約（import順・命名・エクスポート・Loader/Action・エラー処理・翻訳・DBクエリ）
- [ui.md](./ui.md) — UIデザイン規約（shadcn/ui 選定・テーマトークン・カラー・タブ/ダイアログ/トーストの既定構造）

## ワーカー別 必読マップ

ワーカーは **UI/ロジックのレイヤーではなく機能ドメインで分割**。各機能ワーカーは担当領域の UI とロジックを
一気通貫で実装するため、`general.md` と `ui.md` の**両方**＋担当機能の `docs/` を読む。

| ワーカー | 担当機能 | まず読む規約 / 仕様書 | 主に触るソース |
|---|---|---|---|
| `keybindings-worker` | キー配置・マウス・プリセット・アイテム/サーチクラフト | general.md ＋ ui.md ／ `docs/keybindings.md`, `presets.md`, `items-searchcraft.md`, `search-craft-templates.md` | `routes/keybindings*`, `routes/me/`, `components/keybindings/`, `virtual-keyboard`, `remap-*`, `preset-*`, `search-craft-*`, `app/lib/keybindings*`, `preset-*`, `remap-utils` |
| `profiles-worker` | プロフィール・me・お気に入り・閲覧/比較・スキン | general.md ＋ ui.md ／ `docs/profiles.md`, `favorites.md`, `browse-compare.md` | `routes/player/`, `routes/me/index\|edit\|records`, `routes/browse\|compare\|favorites`, `player-card`, `minecraft-avatar`, `skin-uploader`, `app/lib/browse-query`, `mojang`, `favorites` |
| `guides-worker` | ガイド記事（TipTap）執筆・公開 | general.md ＋ ui.md ／ `docs/guides.md` | `routes/my-guides/`, `routes/guides/`, `components/guide-editor/`, `guide-*`, `app/lib/guide-*` |
| `rankings-worker` | ホーム・ペース/ライブ・ランキング・統計 | general.md ＋ ui.md ／ `docs/home-live.md`, `rankings-stats.md` | `routes/home\|paces\|rankings\|stats`, `routes/api/cron/`, `pace-*`, `live-pace-list`, `app/lib/paceman*`, `rankings-query`, `external-stats` |
| `platform-worker` | 認証・API/基盤・共通レイアウト・DBスキーマ・開発者向け/What's New/フィードバック | general.md ＋ ui.md ／ `docs/auth.md`, `api.md`, `infrastructure.md`, `developers.md`, `whats-new.md`, `tech-stack.md` | `routes/login\|onboarding\|developers/\|feedback`, `routes/api/`, `components/layout/`, `app/root.tsx`, `app/app.css`, `app/lib/{env,db,auth,session,schema,messages}` |
| `chores-worker` | 横断: ドキュメント/changelog/翻訳/雑務 | general.md（＋ ui.md 参照） | `docs/`, `app/content/changelog.md`, `app/lib/messages/pages-ja.ts` |
| `test-worker` | 横断: Vitest テスト | general.md | `**/__tests__/*.test.ts(x)`（コード同居）, `vitest.config.ts` |
| `commit-worker` | 横断: コミット作成・PR作成/更新 | general.md（コミット規約は `CLAUDE.md` の git 運用） | 変更差分（`git diff`/`git status`）、`gh` CLI。コードは書かない |
| `research-worker` | 横断: 調査・Web検索（読み取り専用・実装/委譲はしない） | 対象トピックに応じて general.md / ui.md / docs を横断参照 | Context7・WebSearch・WebFetch・リポジトリ内検索。コードは書かない |
| `director` | 計画・レビュー（読み取り専用・実装/委譲はしない） | 両方（レビュー観点で全体） | 調査・査読のみ（Edit/Write/Agent なし） |

> **ルーティングはメインが担当**（上記「運用モデル」）。director は任意の計画/レビュー役で、委譲はしない。
> **DBスキーマ（`app/lib/schema.ts`）は全機能で共有**。スキーマ変更は `platform-worker` に集約し、着手前に影響範囲を確認する。

## Context7 でのドキュメント確認

学習知識（古いバージョン前提のことがある）だけで外部ライブラリの API を推測しない。実装・調査で外部ライブラリの
API に触れる際は、**Context7 MCP tool が利用可能なら** `ToolSearch`（query 例: `"context7 resolve-library-id get-library-docs"`）
でツールを読み込み、`resolve-library-id` → `get-library-docs` の順で**本リポジトリが実際に使っているバージョン**の
最新ドキュメントを確認してから実装する。未接続の場合はこのステップを省いてよいが、`package.json` のバージョンと
既存コードのパターンを最優先の正とする。

対象バージョンは `package.json` を都度確認するのが正だが、目安（2026-07 時点）:

| ライブラリ | バージョン | 主な担当 |
|---|---|---|
| react / react-dom | 19.2.x | 全ワーカー |
| react-router / @react-router/dev,node,serve | 8.2.0 | 全ワーカー（ルーティング・loader/action） |
| @vercel/react-router | 1.3.x | platform-worker |
| tailwindcss / @tailwindcss/vite | 4.3.x | UI を書く全ワーカー |
| radix-ui / @radix-ui/react-* | 1.6.x / 各種 | UI を書く全ワーカー（shadcn/ui 経由） |
| drizzle-orm / drizzle-kit | 0.45.x / 0.31.x | platform-worker（スキーマ）、各機能ワーカー（クエリ） |
| @libsql/client | 0.15.x | platform-worker |
| better-auth | 1.6.x | platform-worker |
| @tiptap/* | 3.27.x | guides-worker |
| zod | 4.4.x | フォーム/バリデーションを書く全ワーカー |
| @tanstack/react-table, react-virtual | 8.21.x / 3.14.x | keybindings-worker |
| @dnd-kit/* | 6.3.x / 10.x / 3.2.x | keybindings-worker |
| vite / vitest | 8.1.x / 4.1.x | test-worker、全ワーカーの実行環境 |
| typescript | 7.0.x | 全ワーカー |

## ソース起点マップ（cold start 用）

各ワーカーは会話履歴を持たないため、迷ったらここから辿る。

- **環境変数**: `getEnv()` → `app/lib/env.server.ts`（`process.env` の型付きラッパ）
- **DB**: `createDb()` → `app/lib/db.ts` ／ スキーマ → `app/lib/schema.ts`（全体像・ER図 → `docs/database.md`）／ クエリは `db.query.*` ＋ `with`（別クエリにしない）
- **認証**: `createAuth()` → `app/lib/auth.ts` ／ セッション → `app/lib/session.ts`（`getSession` / `getOptionalSession` ほか）
- **i18n**: コンポーネントは `useT()`（`@/hooks/use-locale`）／ ローダー・meta は `t(key, params, locale)` ／ 文言実体 → `app/lib/messages/pages-ja.ts`（日本語・全キー）と `pages-en.ts`（英語・部分集合、未翻訳は ja へフォールバック）／ ロケール検出 → `@/lib/locale`。詳細は `docs/i18n.md`
- **テーマ／トークン**: `app/app.css`（oklch の CSS 変数）／ 切替 UI → `app/components/layout/theme-toggle.tsx`（`THEME_OPTIONS`、`light` / `dark` / `ultra-dark`）
- **タブ**: `app/components/ui/tabs.tsx`（フォルダ型。消費側の不変条件は ui.md「タブ」節を厳守）
- **ルート登録**: `app/routes.ts`（**手動定義**。ファイル追加だけでは認識されない）
- **ルート型**: `import type { Route } from "./+types/<ファイル名>"`（`pnpm typecheck` で再生成）
- **外部API**: `app/lib/mojang.ts` / `paceman.ts` / `external-stats.ts`

## 変更時に更新するもの（忘れやすい）

- **仕様・機能の追加変更** → `docs/` 配下の該当ドキュメント（`app/content/changelog.md` は**都度更新しない**。リリース指示時にまとめて作成 — CLAUDE.md「バージョン管理・Changelog」参照）
- **規約そのものの変更** → このディレクトリの `general.md` / `ui.md`（併せてこの索引の記述もずれていないか確認）
- **UI 文言の追加** → `app/lib/messages/pages-ja.ts`（キー追加 → `t("...")` で参照）
