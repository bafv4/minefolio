# ガイド機能 仕様書

## 概要

ユーザーがMinecraft Speedrun関連のガイド記事を作成・公開できる機能。TipTapベースのリッチテキストエディタを搭載し、画像・動画・テーブル等を含む記事を作成可能。

---

## データ構造

### guidesテーブル

| カラム | 型 | 説明 |
|--------|------|------|
| id | string (PK) | ガイドID |
| authorId | string (FK) | 著者のユーザーID |
| slug | string | URLスラッグ。作成時はタイトルから自動生成され、以降は編集画面の設定モーダルの「URL」欄でユーザーが変更できる。ライブ列（ドラフト対象外）。許可文字は `a-z` / `0-9` / `_` / `-`（`app/lib/guide-slug.ts` の `normalizeSlug()` で正規化） |
| title | string | タイトル |
| summary | string | 概要・要約 |
| content | text (HTML) | 本文（TipTapエディタが生成するHTML）。**公開（publish）時のみ**最大50万文字の上限あり（`app/routes/my-guides/edit.tsx` の `MAX_PUBLISHED_CONTENT_LENGTH`、多層防御目的）。仮保存（draft）には上限を適用しない |
| coverImageUrl | string | カバー画像URL（Vercel Blob） |
| isPublished | boolean | 公開状態 |
| tags | JSON配列 | タグ一覧 |
| draftTitle / draftSummary / draftContent / draftCoverImageUrl / draftTags | nullable | 仮保存（ドラフト）用。公開版と独立して編集中の内容を保持 |
| draftUpdatedAt | timestamp (nullable) | ドラフト保存日時。非 null = 未コミットのドラフトあり |
| viewCount | integer | 閲覧数 |
| createdAt | timestamp | 作成日時 |
| updatedAt | timestamp | 更新日時（保存=公開版更新時のみ） |
| isPinned | boolean | プロフィールのガイドタブでのピン留め（先頭・拡大表示）。`/my-guides` 一覧のピンボタン（`_action: "togglePin"`）で切替。グローバル `/guides` の表示には影響しない |

#### 保存モデル（仮保存 / 保存）

- **仮保存（draft）**: ドラフト列 (`draft*`) のみ更新。公開版 (`content` 等) と `isPublished` は変更しない。公開中の表示は変わらない。
- **保存（publish）**: 公開版を書き換え、`isPublished` を反映し、ドラフト列を `null` にクリア（コミット）。`updatedAt` を更新。
- **公開版に戻す（discard / ロールバック）**: ドラフト列を `null` に戻し、編集中の内容を公開版へ復元する。
- 不変条件: **ドラフト列が `null` = ドラフトと公開版が同じ**。読み込み時、未コミットのドラフト (`draftUpdatedAt != null`) があればそれを優先し、無ければ公開版を読み込む。
- 自動保存は廃止。`_action` = `draft` / `publish` / `discard` を FormData で送信して区別する。
- 公開ビュー (`guides/view.tsx`) は常に公開版 (`content`) を読むため、ドラフトは公開表示に影響しない。

### ユニーク制約

- `guides_author_slug_uniq`: `(authorId, slug)` の複合ユニーク制約
- 同一著者内でスラッグが重複しないことを保証
- 異なる著者であれば同じスラッグを使用可能

---

## ガイドエディタ

### エディタ基盤

- **TipTap 3.x** ベースのリッチテキストエディタ
- v1.5.0 で全面再構築。旧単一ファイル（約 2993 行）を責務ごとにディレクトリ分割。
- 操作モデルは複数の導線を併用:
  - **常設ツールバー**（タブ式リボン、ヘッダー直下に fixed 固定）— `toolbar/desktop-toolbar.tsx`。常時表示: Undo/Redo・保存状態・仮保存/保存・設定・プレビュー。タブ: 「ホーム」(ブロック種別/整形/リスト)・「挿入」(メディア/表/段組/埋め込み)・「テーブル」(行列操作/セル色)。
  - **設定モーダル** — `panels/settings-dialog.tsx`。タイトル・概要・カバー画像・**URL（スラッグ）**・タグ・公開設定を集約（ツールバーの「設定」から開く）。「URL」欄は入力を正規化しつつ `/guides/{authorSlug}/{slug}` のプレビューを表示する。
  - **スラッシュコマンド**（`/` 入力）でブロック挿入 — `slash-command/`（@tiptap/suggestion + ポータル描画）
  - **バブルメニュー**で選択範囲のインライン整形 — `toolbar/bubble-menu.tsx`（@tiptap/extension-bubble-menu）
  - **ブロックハンドル**でブロック種別変更 / 削除 — `toolbar/block-handle.tsx`。デスクトップではテーブル上に表示せず行・列ハンドルへ委譲（タッチはテーブル行列操作メニューを含む従来動作）
  - **テーブル行・列ハンドル**（Notion 風、デスクトップのみ）— `toolbar/table-handles.tsx`。ホバー中の行の左端 / 列の上端にピル型ハンドルを表示。クリックで行・列全体を CellSelection で選択（`.selectedCell` ハイライト）し、メニューから行・列の追加・削除、スタイル一括適用（背景色 / 文字色 / 文字揃え）、テーブル削除ができる
- モバイル/タッチ完全対応: `(hover:none)` で分岐し、バブルの代わりに下部固定ツールバー（`toolbar/mobile-toolbar.tsx`）。ブロックハンドルはタッチ時 `selectionUpdate` ベースで追従。
- アクセシビリティ: `role`/`aria-label`、保存状態の `aria-live`、本文の `role=textbox`。
- 自動保存（`hooks/use-auto-save.ts`、debounce 2000ms、最終保存時刻表示）と未保存離脱警告（`hooks/use-unsaved-warning.ts`、useBlocker + beforeunload）。

#### ディレクトリ構成（`app/components/guide-editor/`）

| 配下 | 役割 |
|------|------|
| `index.tsx` | 宿主。メタ欄 + ツールバー + 本文 + ダイアログの組立（約 280 行） |
| `editor-config.ts` | `buildExtensions()` — 拡張配列の単一ソース |
| `extensions/` | カスタム拡張（callout / toggle-list / guide-link / keybind-embed / searchcraft-embed / columns / table / image / code-block / youtube / slash-command） |
| `node-views/` | React NodeView（表示 + 属性編集） |
| `slash-command/` | items / menu / renderer |
| `toolbar/` | desktop / mobile / bubble / block-handle / table-handles / menu-item / 共通ボタン |
| `panels/` | metadata-fields / color-picker / embed-dialog / guide-link-search |
| `hooks/` | use-guide-editor / use-auto-save / use-image-upload / use-unsaved-warning |
| `lib/block-commands.ts` | ブロック種別・テーブル操作・挿入の共通コマンド |

#### HTML 互換性

- 本文は `editor.getHTML()` の HTML 文字列として保存され、表示側 `routes/guides/view.tsx` が同じ HTML を `xss` でサニタイズして描画する。
- 拡張の `parseHTML`/`renderHTML` は旧実装からバイト等価で移植。`extensions/__tests__/round-trip.test.ts` が parse→render の不動点性（既存ガイドを無編集再保存しても差分ゼロ）を担保する。

### 対応フォーマット

| 機能 | 説明 |
|------|------|
| 見出し | H1, H2, H3 |
| テキスト装飾 | 太字、斜体、取り消し線 |
| コード | インラインコード、コードブロック。コード内の空白（先頭末尾・連続スペース）は編集ラウンドトリップ（`preserveWhitespace: "full"`）・閲覧表示（`white-space: pre-wrap`）の両方で保持される |
| リスト | 箇条書き（ul）、番号付き（ol） |
| 引用 | ブロッククォート |
| 水平線 | `<hr>` |
| リンク | URL設定 |
| 画像 | ファイル選択・クリップボードペースト。幅のドラッグ変更と**横方向の配置**（未設定 / 左 / 中央 / 右）に対応 |
| YouTube埋め込み | YouTube動画のiframe埋め込み |
| テーブル | リサイズ可能（列幅ドラッグ変更） |
| ハイライト | 色付きハイライト |
| テキスト色 | 文字色の変更 |
| 背景色 | 背景色の変更 |
| 文字サイズ | 5段階（極小 0.75em / 小 0.875em / 標準 / 大 1.25em / 特大 1.5em）。単一情報源は `app/lib/guide-font-sizes.ts`。**見出し（h1〜h3）内では変更できない**（下記） |

#### 文字サイズと見出しの関係

見出しは `app/app.css` で h1=1.875em / h2=1.5em / h3=1.15em の固定サイズを持つため、そこに span の `font-size` を重ねると見出し階層の一貫性が壊れる。**見出し内では文字サイズを変更できない**よう3層で担保している:

1. **UI**: `isFontSizeEditable(editor)`（`panels/font-size-picker.tsx`、`!editor.isActive("heading")`）が false のとき `PickerTrigger` を `disabled` にし、ラベルを「見出しでは文字サイズを変更できません」に切り替える（ツールバー・バブルメニューの両方）
2. **コマンド**: `applyGuideFontSize(editor, value)` が同じ判定でガードする（サイズ指定済みのテキストを見出しへ変換した直後など、UI を経由しない経路の保険）
3. **表示**: 既存ガイドや外部ペーストで焼き付いた指定は `.guide-content.prose :is(h1…h6) span[style*="font-size"] { font-size: inherit !important; }` で打ち消す。**インラインスタイルはセレクタの詳細度では勝てないため `!important` が必須**。サニタイズ（cssfilter）は要素単位の判定しかできず親が見出しかを知れないため、この層は CSS が担う

### テーブル機能

- `resizable: true` 設定で列幅のドラッグ変更が可能
- セル単位での色変更に対応
- 列単位での色変更に対応
- **行・列ハンドル**（デスクトップ）: セルにホバーすると行の左端 / 列の上端にハンドルが表示され、クリックで行・列を選択してメニューを開く
  - 行・列の追加（前後）・削除、テーブルのコピー・削除
  - 行・列単位のスタイル一括適用: 背景色 / 文字色 / 文字揃え（`lib/block-commands.ts` の `selectTableLine` + `setTableCellsStyle`）
  - メニューを閉じると CellSelection をテキスト選択へ畳む。メニュー表示中のキー入力も先にメニューを閉じて畳んでから処理する（キー入力による行・列全体の上書き事故を防止）
  - 誤操作対策: 開いた直後（300ms）の閉トグルは無視（ダブルクリックで「開→即閉」になるのを防ぐ）。ただし外側クリックによる dismiss はこのガードを通さず即閉じる。ピルの消滅猶予タイマーは、ポインタがピル付近にある間は発火しない（エディタ外から接近する経路でピルが消えるレースを防ぐ）。メニュー表示中の修飾キー単独・Ctrl+C では閉じない（行・列選択のキーボードコピーを許可）
- **セル選択バブルメニュー**（`toolbar/table-cell-bubble-menu.tsx`）: セルを跨いで選択（CellSelection）すると、文字列選択のバブルと同じ見た目で表編集メニュー（セルの結合 / 分割・文字揃え・背景色 / 文字色・テーブルをコピー）を表示する。行・列ハンドルのメニュー表示中は重ならないよう抑制する（`lib/table-ui-state.ts` の共有フラグ）。文字整形バブルは従来どおり CellSelection では表示しない
- **テーブルをコピー**（`lib/block-commands.ts` の `copyTableToClipboard`）: テーブル全体を `text/html`（スキーマ直列化。エディタへの貼り付けで属性込みの完全復元が可能）+ `text/plain`（TSV。表計算ソフト向け）でクリップボードへコピーする。行・列ハンドルメニューとセル選択バブルから実行できる。TSV は TableMap でグリッド展開するため結合セル（colspan/rowspan）でも列位置が揃い、セル内の段落境界はスペースで区切る
- **列幅スナップ**（`extensions/column-snap.ts`）: 列幅のドラッグ確定時、新しい幅が同じテーブルの既存列幅と ±8px 以内なら、その幅にぴったり揃える。ドラッグ確定 tr のみ対象（列境界ホバー中やドラッグ中の無関係な doc 変更・undo 等では発火しない。plugin state の dragging 判定 + 旧新の列幅比較で担保）
- **公開ページの表示**: エディタは列幅未指定の列を 25px 換算で表の `min-width` に算入するため、そのままでは狭い画面で未指定列が潰れる。公開ページでは `normalizeGuideTables()`（`app/lib/guide-tables.ts`）が表の `min-width` を「固定列合計 + 未指定列 × 160px」に再計算し、収まらない分は `.table-scroll-wrapper` の横スクロールで表示する。全列をドラッグ指定した表（`style="width: ..."`）は作者の指定幅をそのまま尊重する

### 画像アップロード

- **ファイル選択**: ファイルダイアログからアップロード
- **クリップボードペースト**: コピーした画像をエディタに直接ペースト
- アップロード先は **Vercel Blob**
- APIエンドポイント: `/api/me/guides/upload-image`

### カバー画像

- ガイド本文とは別にカバー画像をアップロード可能
- 一覧表示時のサムネイルとして使用

---

## ガイド表示

### HTMLサニタイゼーション

`xss` ライブラリ（+ `cssfilter`）を使用してサーバーサイドでHTMLをサニタイズ。
設定は `app/lib/guide-sanitize.server.ts` に集約されている。

- **許可タグ**: 必要最小限のHTMLタグのみ許可
- **許可属性**: 各タグに対して安全な属性のみ許可（`class` は全タグ共通で許可）
- **許可スタイル**: インラインスタイルは許可プロパティ（color / background-color / **font-size** / text-align / min-width / width）のみ通す
  - **color / background-color / font-size は値も検査する**。パレット色・段階サイズ以外は除去される。判定関数は `app/lib/guide-colors.ts`（`isPaletteTextColor` / `isPaletteBgColor`）と `app/lib/guide-font-sizes.ts`（`isAllowedFontSize`）が持ち、**エディタのペースト時（入口）と表示時サニタイズ（出口）で同じ判定を共有する**。外部からのペーストで焼き付いた任意の色・サイズ（`14px` 等）はどちらでも落ちる
- **画像の配置**: `<img>` は `style` を許可しないため、横方向の配置は `data-align="left|center|right"` 属性で表す（未設定は属性ごと出力しない）。表示は `app/app.css` の `.guide-content.prose img[data-align=...]` が担い、エディタ側は `image-node-view.tsx` のラッパーが同じ見た目を作る
- **colgroup/colタグ**: テーブルの列幅指定用に許可
- **iframe**: YouTube 埋め込みホスト（www.youtube.com / www.youtube-nocookie.com）のみ src を許可

### スタイリング

- `.guide-content.prose` CSSクラスを適用
- Tailwind CSS の `prose` クラスベースのタイポグラフィスタイリング

---

## 公開ページ（ルーティング）

### /guides — ガイド一覧

- 全ユーザーの公開ガイドを一覧表示（著者が公開プロフィールのもののみ）
- **グリッド表示**: カード形式で表示。カバー画像がない場合はプレースホルダーを表示
- **リスト表示**: リスト形式で表示。カバー画像を左端に表示
- 表示切替が可能
- **並び替え**: `?sort=` で「更新順（既定、`updatedAt` 降順）」と「人気順（いいね数降順）」を切り替えられる（`ContentSortSelect`）。同数時は `updatedAt` → `id` でタイブレークする。検索フォームは hidden input で並び順を持ち越す
- **いいね**: 各カードにいいね数を表示し、ログイン中はカード内のグッドボタンで直接いいねできる（自分のガイドは件数のみ）。詳細は [`docs/likes.md`](./likes.md)
  - カード全体のクリックは**オーバーレイのリンク**（`absolute inset-0`）が担う。`<a>` の子孫にインタラクティブ要素を置くのは不正なHTMLのため、カード全体を `<Link>` で包む構造は使えない

### /guides/:authorSlug — 著者別ガイド一覧

- 特定著者のガイドのみをフィルタ表示

### /guides/:authorSlug/:guideSlug — ガイド閲覧

- 個別ガイドの全文表示
- カバー画像、タイトル、著者情報、本文を表示
- 閲覧時に viewCount をインクリメント
- メタ帯（著者・更新日・閲覧数）の右端に**いいねボタン**を置く。自分のガイドでは押せず件数のみ表示する
- **ローダーは表示に使うフィールドだけを返す**（`guide`: id / slug / title / summary / coverImageUrl / tags / viewCount / updatedAt / sanitizedContent / likeCount、`author`: slug / mcid / uuid / displayName / customSkinUrl）。行をそのまま展開すると、著者の未公開ドラフト（`draftTitle` / `draftContent` 等）とサニタイズ前の生 `content` が全閲覧者のSSRペイロードに載るため。ドラフトプレビュー（`?draft=1`、本人のみ）では表示値にドラフトを採用するが、ドラフト列そのものは渡さない。回帰テスト: `app/routes/guides/__tests__/view.test.ts`

---

## 管理ページ（ルーティング）

`/me` 配下から切り離され、`/my-guides` 系として独立したルートになっている。ヘッダーのユーザードロップダウン（「設定」の直下）からアクセスできる。

### /my-guides — 自分のガイド一覧

- ログインユーザーが作成した全ガイド（公開・非公開含む）を表示

### /my-guides/new — 新規作成

- ガイドエディタを表示し、新規ガイドを作成

### /my-guides/:guideSlug/edit — 編集

- 既存ガイドの編集画面（`(authorId, slug)` で本人のガイドを特定）
- **独立レイアウト**: `me/_layout` のサイドバーに依存しないフルスクリーン編集画面
- タイトル/本文/サマリー/タグ inputs はブラウザ標準の綴りバリデーション（`spellcheck`）を無効化
- スティッキーヘッダーとツールバーは背景透明（`backdrop-blur-sm` のみ）
- **URL（スラッグ）の編集**: 設定モーダルの「URL」欄で変更できる。仮保存・保存いずれの保存でも即反映される（`slug` はライブ列）。
  - 保存時、`normalizeSlug()` で正規化した値が現在と異なれば、同一著者内での重複を確認する。重複時は `meGuides.errorSlugTaken` を返し、その保存自体を中止（トースト表示、他フィールドも保存されない）。正規化結果が空なら `meGuides.errorSlugRequired`。
  - スラッグ変更に成功すると、action は新しい `slug` を返し、クライアントは `/my-guides/{新slug}/edit` へ `navigate(replace)` する（同一ルートのためエディタは再マウントされず、編集中の本文・状態は保持される）。
  - 旧スラッグからのリダイレクトは行わない（旧URLは404になる）。
  - action の戻り値は素の object（`{ success, mode, slug }` / `{ error }`）。`hooks/use-guide-save.ts` が `fetcher.data` として受け取り、宿主（`index.tsx`）がトースト表示とURL差し替えを行う。

### 公開ガイド表示時の編集導線

- `/guides/:authorSlug/:guideSlug` でログイン中ユーザーがそのガイドのオーナーの場合、ページ上部に編集ボタンが表示され `/my-guides/:guideSlug/edit` へ遷移できる

### APIエンドポイント

| エンドポイント | メソッド | 説明 |
|----------------|----------|------|
| /api/me/guides/upload-image | POST | 画像アップロード（Vercel Blob保存） |
| /api/guides/search | GET | ガイド検索 |

---

## /developers ページとの関係

v1.4.0 で新設された [`/developers`](developers.md) ページが、API ドキュメント・更新履歴・データエクスポートを掲載するハブとなっている。フッターの `Developers` リンクからアクセス可能。

- 公開 API の仕様は `app/content/api.md`（`/developers/api` でレンダリング）
- ユーザー向け更新履歴は `app/content/changelog.md`（`/developers/changelog` でレンダリング）
- ガイド機能の API（`/api/guides/search`）も `app/content/api.md` に掲載されている

詳細は [`docs/developers.md`](developers.md) 参照。

---

## 関連ファイル

### 公開ページ

- `app/routes/guides/view.tsx` — ガイド閲覧ページ
- `app/routes/guides/index.tsx` — ガイド一覧ページ
- `app/routes/guides/user.tsx` — 著者別ガイド一覧ページ

### 管理ページ

- `app/routes/my-guides/edit.tsx` — ガイド編集ページ
- `app/routes/my-guides/new.tsx` — ガイド新規作成ページ
- `app/routes/my-guides/index.tsx` — 自分のガイド一覧ページ

### コンポーネント

- `app/components/guide-editor/index.tsx` — TipTapガイドエディタ
- `app/components/guide-list-views.tsx` — ガイド一覧のグリッド/リスト表示

### API

- `app/routes/api/me/guides/upload-image.ts` — 画像アップロードAPI
- `app/routes/api/guides/search.ts` — ガイド検索API
