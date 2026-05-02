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

`app/routes/developers/index.tsx`。

- 3 つのサブページへのカード型ナビゲーション
- 関連リンクセクション（GitHub Repository / Issues / フィードバック）

---

## API ドキュメント (`/developers/api`)

`app/routes/developers/api.tsx`。

- ソース: `app/content/api.md`
- Vite の `?raw` import でファイル内容を JS バンドルに埋め込み
- `react-markdown` + `remark-gfm` + `rehype-sanitize` でレンダリング
- `prose prose-sm dark:prose-invert max-w-none` クラスでスタイル適用

掲載対象は **認証不要の公開 API のみ**。`/api/me/*` や `/api/auth/*` などの認証必須 API、`/api/cron/*` の Cron 専用 API は掲載しない。

社内開発者用の全 API 仕様（`/api/me/*` 等を含む）は別途 [`docs/api.md`](api.md) に維持されている。

---

## 更新履歴 (`/developers/changelog`)

`app/routes/developers/changelog.tsx`。

- ソース: `app/content/changelog.md`
- レンダリング方式は `/developers/api` と同じ（`?raw` + `react-markdown`）
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
| `app/routes.ts` | 4 ルートの登録 |
