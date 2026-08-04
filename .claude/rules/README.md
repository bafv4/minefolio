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
  **ただしコミット/PR の既定はメインが `commit` / `create-pr` スキルで直接行う。** コミット本文の「なぜ」
  （原因・判断根拠）を書けるのは実装の文脈を持つメインだけで、会話履歴を持たない `commit-worker` に丸投げすると
  diff から復元できる範囲まで本文が痩せるため。委譲するのは**差分が大きい／多数のコミットに分割する**ときに限り、
  その場合はメインが「何を・なぜ・どう分割するか」をプロンプトで明示的に渡す。

## 規約ファイル

- [general.md](./general.md) — コーディング規約（import順・命名・エクスポート・Loader/Action・エラー処理・翻訳・DBクエリ）
- [ui.md](./ui.md) — UIデザイン規約（shadcn/ui 選定・テーマトークン・カラー・タブ/ダイアログ/トーストの既定構造）

## ルーティング表（メインが担当を選ぶ）

ワーカーは **UI/ロジックのレイヤーではなく機能ドメインで分割**。各機能ワーカーは担当領域の UI とロジックを
一気通貫で実装する。**「変更するルート／画面」で引く。**

| 変更対象 | ワーカー |
|---|---|
| `/keybindings*`・`/playground`・`/me/{keybindings,devices,presets,import,items,search-craft}`／仮想キーボード・リマップ・プリセット・サーチクラフト | `keybindings-worker` |
| `/player/:slug*`・`/me/{index,edit,playstyle,records}`・`/browse`・`/compare`・`/favorites`・`/random-player`／スキン・アバター・リアクション | `profiles-worker` |
| `/guides/*`・`/my-guides/*`／TipTap エディタ・ガイド画像・いいね | `guides-worker` |
| `/`（ホーム）・`/paces`・`/live`・`/videos`・`/rankings`・`/stats`／`api/cron/*`・PaceMan・外部統計 | `rankings-worker` |
| `/login`・`/onboarding`・`/developers*`・`/feedback`・`api/*`（cron 以外）・共通レイアウト・`app/root.tsx`・`app/app.css`・**`app/lib/schema.ts`** | `platform-worker` |
| `docs/`・`changelog.md`・翻訳キー（`pages-ja.ts`）・依存の軽微更新・ファイル整理 | `chores-worker` |
| `**/__tests__/*`（Vitest） | `test-worker` |
| コミット作成・PR 作成／更新（**コードは書かない**）※既定は `commit` / `create-pr` スキル。差分が大きい／多数に分割するときだけ委譲 | `commit-worker` |
| ブラウザでの実機検証・UI 回帰確認（**読み取り専用**） | `ui-verifier` |
| 調査・Web 検索（**読み取り専用**） | `research-worker` |
| 着手前の計画・実装後の diff レビュー（**読み取り専用**） | `director` |

各ワーカーの詳細な担当ファイル・参照する `docs/` は **`.claude/agents/<ワーカー名>.md` の「担当領域」**に
書いてあるので、ここには重複させない。規約は全ワーカー共通で `general.md`、UI を書くワーカー
（keybindings / profiles / guides / rankings / platform）は `ui.md` も読む。

> **ルーティングはメインが担当**（上記「運用モデル」）。director は任意の計画/レビュー役で、委譲はしない。
> **DBスキーマ（`app/lib/schema.ts`）は全機能で共有**。スキーマ変更は `platform-worker` に集約し、着手前に影響範囲を確認する。
> **ワーカーがあるドメインの実装を `general-purpose` / `Explore` に投げない。** 担当ワーカーが規約・仕様書・
> ソース起点を最初から知っているため、汎用エージェントより手戻りが少ない。

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
