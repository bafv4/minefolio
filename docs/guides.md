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
| slug | string | URLスラッグ。作成時にユーザーが必ず入力し（自動生成しない）、以降は編集画面の設定モーダルの「URL」欄で変更できる。ライブ列（ドラフト対象外）。許可文字は `a-z` / `0-9` / `_` / `-`（`app/lib/guide-slug.ts` の `normalizeSlug()` で正規化。入力欄では `softNormalizeSlug()`） |
| title | string | タイトル。最大**200文字**（作成時 `new.tsx` ・編集時 `edit.tsx` の両方で検証。draft保存でも同じ上限を適用する） |
| summary | string | 概要・要約。最大**500文字**（`edit.tsx` で検証。作成時 `new.tsx` には入力欄が無く、後から編集で追加する） |
| content | text (HTML) | 本文（TipTapエディタが生成するHTML）。**公開（publish）時のみ**最大50万文字の上限あり（`app/routes/my-guides/edit.tsx` の `MAX_PUBLISHED_CONTENT_LENGTH`、多層防御目的）。仮保存（draft）には上限を適用しない |
| coverImageUrl | string | カバー画像URL（Vercel Blob） |
| isPublished | boolean | 公開状態 |
| tags | JSON配列 | タグ一覧。読み出し側は `app/lib/guide-tags.ts` の `parseGuideTags()` で防御的にパースする（不正なJSONが1行混入していても、その行だけ空配列に落ちて一覧・詳細全体が500にならない） |
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
| `panels/` | metadata-fields / color-picker / font-size-picker / embed-dialog / guide-link-search / image-crop-dialog / video-to-gif-dialog |
| `hooks/` | use-guide-editor / use-auto-save / use-image-upload / use-unsaved-warning |
| `lib/block-commands.ts` | ブロック種別・テーブル操作・挿入の共通コマンド |
| `lib/image-processing.ts` | アップロード前の縮小・再エンコードと、トリミングの切り出し（canvas） |
| `lib/image-crop.ts` | トリミング矩形の計算（純粋関数 / DOM 非依存） |
| `lib/video-to-gif.ts` | 動画→GIF 変換（`<video>` のシーク走査） |
| `lib/gif-crop.ts` | GIF のトリミング（omggif で全フレーム復元 → 切り出し） |
| `lib/gif-encode.ts` | GIF 書き出しの共通処理（パレット作成 + gifenc）。上の 2 つが共有 |

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
| 画像 | ファイル選択・クリップボードペースト。幅のドラッグ変更、**横方向の配置**（未設定 / 左 / 中央 / 右）、**トリミング**に対応 |
| GIF（動画から変換） | 短い動画をブラウザ内で GIF に変換して挿入（下記） |
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
- アップロード前に `lib/image-processing.ts` の `prepareImageForUpload()` がブラウザ側で長辺を縮小し webp（不可なら jpeg）へ再エンコードする。**GIF はアニメーション保持のため無加工**で通す（サイズ上限のみ検査）

#### 参照されなくなった Blob の回収（手動運用）

アプリ側で `del()` を呼ぶのは**カスタムスキンの差し替え/削除**と、**ガイド削除時のカバー画像**だけ。本文画像・差し替え前のカバー・ドラフトのカバーには削除経路がなく、参照されなくなっても Blob に残る。トリミングも元画像を残す（同じ Blob が他のガイドやドラフト/公開版から参照されている可能性があり、参照追跡なしに消すと表示が壊れるため）。

cron は置かず、**`scripts/` のスクリプトを必要なときに手で実行**して回収する。

```bash
pnpm exec tsx scripts/audit-orphan-blobs.ts --remote     # 実測（読み取りのみ）
pnpm exec tsx scripts/delete-orphan-blobs.ts --remote    # 削除対象の確認（dry-run）
pnpm exec tsx scripts/delete-orphan-blobs.ts --remote --apply  # 実際に削除
```

- **参照判定は `scripts/lib/blob-refs.ts` に集約**している。監査と削除で別実装にすると「監査では参照ありなのに削除側では孤児」という食い違いが画像消失に直結するため、必ずここを共有すること。走査対象には**ドラフト列（`draft_content` / `draft_cover_image_url`）を必ず含める**（公開版から消しただけでドラフトがまだ参照している状態がある）
- 突き合わせは URL 文字列ではなく**パス（pathname）**。Blob の URL はストア ID をホスト名に含むため、文字列比較だとホストが変わった瞬間に全件を孤児と誤判定する
- 削除スクリプトの安全装置:
  - **既定は dry-run**（`--apply` を付けたときだけ削除）
  - `--min-age-days`（既定 7）— アップロード直後のファイルは対象外。「上げたがまだ保存していない編集中の画像」を守る
  - `--max-orphan-ratio`（既定 0.6）— 孤児の割合が異常に高いと中断。**最も多い事故である「DB の取り違え」**（本番 Blob をローカル DB と突き合わせて全件孤児に見える）を機械的に止める
  - 壊れた参照（DB にあるのに Blob に無い）が 1 件でもあれば中断（`--allow-broken-refs` で解除）
  - `--max-delete`（既定 500）で 1 回の実行の影響範囲を限定
- **Blob の接続先は常に `.env` の `BLOB_READ_WRITE_TOKEN`**（ストアは 1 つ）。`--remote` は DB 側だけを切り替えるので、本番の回収には必ず `--remote` を付ける
- 両スクリプトは `process.exit()` を使わず `runScript()` 経由で終了コードを返す。ローカル DB（`file:`）のネイティブクライアントを開いたまま強制終了すると Windows の libuv が assert で落ち、**終了コードが 127 に化けて成否を判定できなくなる**（リモート DB では再現しないので気づきにくい）

#### トリミング

画像にホバー（またはタッチで選択）すると出るツールバーの ✂ ボタンで、挿入済みの画像を切り出せる。

- **矩形の計算は `lib/image-crop.ts` の純粋関数**（DOM 非依存 / `lib/__tests__/image-crop.test.ts` で検証）。座標は画像サイズに依存しない **0..1 の正規化値**で保持し、画面表示（%）と切り出し（px）で同じ値を使う
- 比率プリセット（自由 / 1:1 / 4:3 / 3:4 / 16:9 / 9:16）。正規化系は画像の縦横比の分だけ歪むため、ピクセル比は `toNormalizedAspect()` で変換してから使う。**比率固定中は角ハンドルのみ**を出す（辺ハンドルでは比率を保てないため）
- 適用すると `cropImageFromUrl()` が元 URL を CORS fetch → canvas で切り出し → PNG（可逆）で返し、通常のアップロード経路（webp 再エンコード）に載せて**新しい Blob** として保存し、ノードの `src` を差し替える。元の Blob は消さない（他ガイドからの参照や履歴を壊さないため）
- 表示幅（`width` 属性）は残した領域の割合だけ縮める。切り出した部分の画面上の大きさが操作前と変わらず、レイアウトが跳ねない

##### GIF のトリミング（アニメーション保持）

GIF を canvas に描くと 1 フレーム目の静止画に潰れるため、専用経路（`lib/gif-crop.ts`）へ振り分ける。振り分けは `isAnimatedImageUrl()`（拡張子 + data URL の MIME）で判定する。

- デコードは [omggif](https://github.com/deanm/omggif)（MIT / 依存なし）。**ブラウザ内蔵の `ImageDecoder` は使わない** — Safari が未対応で、使うと Safari だけ機能が消えるため。omggif なら全ブラウザで同じ経路になる
- GIF はフレームごとに**部分矩形だけを更新**し、透過画素は下の絵を透かす。さらに廃棄方法（disposal: 2=背景で消去 / 3=直前へ復元）で次フレームの下地が決まる。`cropFrames()` がこれを論理画面バッファ上で正しく合成してから、`cropRgbaBuffer()` で矩形を切り出す（canvas を通さないのでアルファがそのまま残る）
- パレットは全フレームを見てから決めるが、GIF は前フレームに依存して途中から復元できない。全フレームを保持するとメモリを食うため**デコードを 2 周**する（シーク不要で十分速い）
- 出力は常に「合成済みの全画面フレーム」なので、透過を含む場合は各フレームに **disposal 2 を書く**。書かないと透過画素から前フレームが透け、元 GIF で消去されていた領域に残像が出る
- 表示時間（センチ秒）とループ設定（`toGifRepeat()`）は元の GIF から引き継ぐ
- 上限を超えた場合は `GifTooLargeError` を投げ、「切り出す範囲を狭めてください」とトーストで案内する

#### 動画から GIF への変換

`/` メニューまたはツールバーの「動画をGIFに変換」から、短い動画を GIF にして本文へ挿入できる。**変換はすべてブラウザ内で完結し、動画自体はサーバへ送らない**（アップロードされるのは生成後の GIF だけ）。

- 実装は `lib/video-to-gif.ts`。`<video>` を目的の時刻へシーク → canvas へ描画 → `getImageData` でフレームを取り出し、`lib/gif-encode.ts`（[gifenc](https://github.com/mattdesl/gifenc) / MIT / 依存なし）へ渡す。gifenc も omggif も**動的 import** なので SSR では評価されず、実行するまで読み込まれない
- **パレットはグローバル 1 枚**（`lib/gif-encode.ts`、GIF のトリミングと共通）。範囲全体から最大 6 フレームをサンプリングして連結し、まとめて `quantize()` する。フレームごとにパレットを作ると色がちらつき、ローカルカラーテーブルでファイルも太る。透過画素があれば `rgba4444`、なければ `rgb565`（色の再現性が高い）を自動で選ぶ
- フレームは**逐次シークしながら 1 枚ずつ**エンコーダへ渡す（全フレームを抱えないのでメモリが増えない）
- 上限: 長さ **15 秒**（`GIF_MAX_DURATION_SEC`）、フレーム数 **200**（`GIF_MAX_FRAMES`）、出力サイズ **15MB**（`MAX_UPLOAD_BYTES` と共通）。フレーム数の上限に当たった場合は範囲全体へ均等配分し、遅延も伸ばして**再生速度を実時間どおりに保つ**
- 指定できるのは切り出し範囲（開始 / 終了、再生位置からの取り込み可）・幅（320 / 480 / 640px）・フレームレート（8 / 10 / 12 / 15）
- MediaRecorder 由来の webm は `duration` が `Infinity` になることがあるため、`resolveVideoDuration()` が巨大時刻へのシークで実長を確定させる
- 純粋関数（`scaleToWidth` / `planGifFrames` / `clampTrimRange`）は `lib/__tests__/video-to-gif.test.ts` で検証している。実デコードとエンコードは JSDOM で再現できないためブラウザ実機での確認が必要

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
- **本文の行長制限は設けない**: 本文（段落・見出し・リスト・引用・コールアウト・トグル）はコンテナ幅（`article` 側の `max-w-5xl`）いっぱいの左寄せで表示する。一度 `max-width: 65ch`（のち 36rem 固定カラム＋中央寄せ）の行長制限を導入したが、改修前の全幅レイアウトの方がよいというユーザー判断で撤廃済み（`app/app.css` の Guide content セクションに再導入しない旨の注記あり）。なお ch 単位の制限は各要素のフォントサイズ基準のため見出しと段落で左端が階段状にずれる問題もあった

---

## 公開ページ（ルーティング）

### /guides — ガイド一覧

- 全ユーザーの公開ガイドを一覧表示（著者が公開プロフィールのもののみ）
- **グリッド表示**: カード形式で表示。カバー画像がない場合はプレースホルダーを表示
- **リスト表示**: リスト形式で表示。カバー画像を左端に表示
- 表示切替が可能
- **並び替え**: `?sort=` で「更新順（既定、`updatedAt` 降順）」「いいね数順（総いいね数降順）」「閲覧数順（`guides.viewCount` 累計降順）」「人気順（直近7日のページビュー降順）」の4種を切り替えられる（`ContentSortSelect`）。並び順の定義は `guideListOrderBy()`（`app/lib/likes.server.ts`）が単一情報源で、いずれも `updatedAt` → `id` でタイブレークする。検索フォームは hidden input で並び順を持ち越す。旧「おすすめ順」（`?sort=recommended`）は廃止済みで、更新順へフォールバックする。詳細は [`docs/likes.md`](./likes.md#並び替え)
  - 選択肢を開くと、各項目の下段に「何を基準に並ぶか」の1行説明（例: いいね数順→「総いいね数」、人気順→「直近7日でよく見られた順」）が表示される（`ContentSortSelect` の `descriptions`）。トリガー自体は選択中の項目名のみの1行表示のまま
  - 人気順のページビューは Vercel Web Analytics を cron で集計した `page_view_stats` を参照し、未集計時はいいね数順へ自然に落ちる。人気順を選んでいる間は、各カードに累計閲覧数の隣に直近7日PV（`TrendingUp` アイコン）を根拠数値として表示する。`page_view_stats` がまだ1件も無い（cron 未稼働・集計前）環境では、一覧上部に「閲覧データを収集中のため、現在はいいね数・更新日時順で表示しています」の注記（`guides.popularPending`）を出す
  - ツールバー（検索フォーム＋並び替え＋表示切替）は狭い画面では縦積みになる（`flex-col sm:flex-row`）。1行のままだと検索入力が潰れるため、テンプレート一覧と同じレイアウトに揃えている
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

- タイトルと **URL（スラッグ）** を入力して空のガイドを作り、`/my-guides/{slug}/edit` へ遷移する
- **スラッグは必須入力**。タイトルからの自動生成は行わない（日本語のみのタイトルは `normalizeSlug()` で空になり、`guide-<ランダム6文字>` のような意味のないURLで公開されてしまうため）
  - 入力欄は `softNormalizeSlug()` でタイプ中に許可外文字を落とすため、日本語だけを打つと空のままになり、`required` でそのまま送信できない
  - サーバー側でも `normalizeSlug()` 後に空なら `errorSlugRequired`、同一著者内で重複していれば `errorSlugTaken` を返す（重複時に連番・乱数を自動付与しない）
  - `/guides/{authorSlug}/{slug}` のプレビューを入力欄の下に表示する（編集画面の設定モーダルと同じ体裁）

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
