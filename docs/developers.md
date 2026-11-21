# 開発者向けページ (`/developers`) 仕様書

## 概要

`/developers` は v1.4.0 で新設された開発者向けハブページ。フッターの「Developers」リンクからアクセスできる。次のサブページから構成される：

- **API ドキュメント** — Minefolio が提供する公開 API の仕様
- **更新履歴 (Changelog)** — リリースノート
- **データエクスポート** — 公開プロフィールの設定データを CSV でダウンロード

旧フッターの「CSVエクスポート」ボタンは廃止し、`/developers/export` に統合した。

---

## ルート構成

```
/developers           — ハブ（カード型ナビ＋関連リンク）
/developers/api       — API ドキュメント
/developers/changelog — 更新履歴
/developers/export    — データエクスポート（CSV）
```

`app/routes.ts` で公開レイアウト（`routes/_layout.tsx`）の直下に登録。

---

## ハブページ (`/developers`)

> 日本語以外のロケールでは、本文が日本語のみの API ドキュメント・更新履歴のカードにだけ小さな「日本語のみ」の印を付ける（入口ページ全体の断り書きは出さない）。更新履歴の見出しの読み替え（「キー設定」→「操作設定」）はロケールによらず日本語で行い、版の見出しの括弧だけ日本語は全角・それ以外は半角にする。

`app/routes/developers/index.tsx`。

- 3 つのサブページへのカード型ナビゲーション
- 関連リンクセクション（GitHub Repository / Issues / フィードバック）

---

## API ドキュメント (`/developers/api`)

`app/routes/developers/api.tsx`。

- ソース: `app/content/api.md`
- Vite の `?raw` import でファイル内容を JS バンドルに埋め込み
- 共通コンポーネント `app/components/markdown-doc-page.tsx`（`MarkdownDocPage`）で `react-markdown` + `remark-gfm` + `rehype-sanitize` レンダリング、`doc-content prose max-w-none` クラスを適用（`/privacy` `/terms` `/developers/changelog` と共通）。配色は `app/app.css` の `.doc-content.prose` がテーマトークンへ割り当てる（ガイド本文と同じ割り当て。`prose-invert` / `dark:` は使わない）。本文は `text-base`、1行は 42em まで（表の器とコードブロックは幅を使う）。注記（blockquote）は斜体にしない
- `/privacy`・`/terms`・`/developers/api` は冒頭に h2 の目次（ページ内リンク）を出す（`toc`。API 文書は12エンドポイントの節を持つため）。h2 の id と目次のリンクは同じ `docHeadingId` から作る
- 表は横スクロールの器（`overflow-x-auto`）で包み、コードブロック（`pre`）は prose の `overflow-x: auto` のまま使う。狭い画面でもページ全体は横に動かない。4列以上の表は md 未満で `min-width: 36rem`（`app.css`）を持ち、器の中で横に動く（はみ出しているときは表の上に「横にスクロールできます」を出す）。本文の h2 は `text-xl`・h3 は `text-lg`（h1 は `text-2xl`）、畳んだ節の h2 も `text-xl`。はみ出しているときだけ、器に `tabindex="0"`・`role="region"`・`aria-label`（`common.tableScrollRegion` / `common.codeScrollRegion`）を付けてキーボードで横スクロールできるようにする（収まっているときは Tab の停止点を増やさない）

掲載対象は **認証不要の公開 API のみ**。`/api/me/*` や `/api/auth/*` などの認証必須 API、`/api/cron/*` の Cron 専用 API は掲載しない。

社内開発者用の全 API 仕様（`/api/me/*` 等を含む）は別途 [`docs/api.md`](api.md) に維持されている。

---

## 更新履歴 (`/developers/changelog`)

`app/routes/developers/changelog.tsx`。

- ソース: `app/content/changelog.md`
- レンダリング方式は `/developers/api` と同じ（`?raw` + `MarkdownDocPage`）
- 最新の3版だけを開いて出し、それより古い版は版の見出し（h2）を summary にした `details` に畳む（`app/lib/changelog.ts` の `parseChangelog` で版ごとに分ける。分けられない形式なら全文をそのまま出す）
- 一般ユーザー向けに、技術用語を抑えた文体で記述する方針

---

## データエクスポート (`/developers/export`)

`app/routes/developers/export.tsx`。

### 対象データ

CSV のセクション選択（複数選択可）：

| セクション | 内容 |
|---|---|
| `actions` | キー配置 |
| `remaps` | キーリマップ |
| `custom-actions` | カスタムアクション |
| `mouse` | マウス設定 |

### 対象ユーザー

- デフォルトは設定登録済み（キー配置・リマップ・カスタムアクションのいずれかを保存している）の全公開ユーザー
- ページ上の検索 UI（slug / MCID / 表示名で部分一致）から個別ユーザーを選択して絞り込み可能
- 何も選択していない場合は「全ユーザー」が対象

### API

```
GET /api/keybindings-csv?sections=actions,remaps&userSlugs=alice,bob
```

| パラメータ | 必須 | 説明 |
|---|---|---|
| `sections` | ○ | カンマ区切り。`actions` / `remaps` / `custom-actions` / `mouse` |
| `userSlugs` | × | カンマ区切り。指定すると対象を絞り込む |

レスポンス: `text/csv`（UTF-8 BOM 付き、ブラウザがダウンロード）

### UI

- 各セクションを大きなクリッカブルカードで表示（選択時は primary 色のボーダー＋背景でハイライト）
- 各カードに含まれる CSV 列名を Badge で表示
- ページ末尾に固定ダウンロードバー（`{選択セクション数} 項目 × {対象ユーザー数} 人` を表示）

---

## フッター動線

`app/components/layout/footer.tsx`：

```
フィードバック | GitHub | Donate Me! | Developers
```

- v1.4.0 で `Developers` リンクを `Donate Me!` の隣に追加
- 旧 `CSVエクスポート` ボタンはフッターから削除（`/developers/export` に移動）

---

## コンテンツファイルの管理

`app/content/` 配下の Markdown は **公開用の正本** として扱う：

- `app/content/api.md` — `/developers/api` のソース
- `app/content/changelog.md` — `/developers/changelog` のソース

これらは `.vercelignore` の `*.md` 除外対象だが、Vite が `?raw` import で**ビルド時にバンドルへ埋め込む**ため、デプロイ後も問題なく動作する。

書き換え時の注意：

- `app/content/api.md` は `/developers/api` でレンダリングされる前提で書く（H4 を使いすぎない、表のカラム数を抑える）
- `app/content/changelog.md` は **一般ユーザー向け** の文体で書く（テーブル名・API パス・Cookie 名・内部用語は避ける）

---

## 関連ファイル

| ファイル | 役割 |
|---|---|
| `app/routes/developers/index.tsx` | ハブページ |
| `app/routes/developers/api.tsx` | API ドキュメントページ |
| `app/routes/developers/changelog.tsx` | 更新履歴ページ |
| `app/routes/developers/export.tsx` | データエクスポートページ |
| `app/content/api.md` | 公開 API 仕様の正本 |
| `app/content/changelog.md` | 公開更新履歴の正本 |
| `app/routes/api/keybindings-csv.ts` | CSV エクスポート API（`sections` + `userSlugs` パラメータ対応） |
| `app/components/layout/footer.tsx` | フッター（Developers リンク） |
| `app/components/markdown-doc-page.tsx` | `/developers/api` `/developers/changelog`（`/privacy` `/terms` も）共通の markdown 表示シェル |
| `app/lib/og-meta.ts` | ハブ・api・changelog（`/privacy` `/terms` も）共通の OGP meta ビルダー |
| `app/routes.ts` | 4 ルートの登録 |
