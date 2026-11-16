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
| content | text (HTML) | 本文（TipTapエディタが生成するHTML）。**公開（publish）時のみ**最大50万文字の上限あり（`app/routes/my-guides/edit.tsx` の `MAX_PUBLISHED_CONTENT_LENGTH`、多層防御目的）。下書き保存（draft）には上限を適用しない |
| coverImageUrl | string | カバー画像URL（Vercel Blob） |
| isPublished | boolean | 公開状態 |
| tags | JSON配列 | タグ一覧。読み出し側は `app/lib/guide-tags.ts` の `parseGuideTags()` で防御的にパースする（不正なJSONが1行混入していても、その行だけ空配列に落ちて一覧・詳細全体が500にならない） |
| draftTitle / draftSummary / draftContent / draftCoverImageUrl / draftTags | nullable | 下書き保存（ドラフト）用。公開版と独立して編集中の内容を保持 |
| draftUpdatedAt | timestamp (nullable) | ドラフト保存日時。非 null = 未コミットのドラフトあり |
| viewCount | integer | 閲覧数 |
| createdAt | timestamp | 作成日時 |
| updatedAt | timestamp | 更新日時（保存=公開版更新時のみ） |
| allowAutoTranslation | boolean | 自動翻訳を許可するか（既定 true）。ライブ列（ドラフト対象外・ロールバック対象外）。編集画面の設定モーダルのスイッチで切り替える（下記「自動翻訳」） |
| isPinned | boolean | プロフィールのガイドタブでのピン留め（先頭に並べ、タイトルにピンを付ける。カードの大きさ・枠はほかと同じ）。`/my-guides` 一覧のピンボタン（`_action: "togglePin"`）で切替。グローバル `/guides` の表示には影響しない |

#### 保存モデル（下書き保存 / 保存）

- **下書き保存（draft）**: ドラフト列 (`draft*`) のみ更新。公開版 (`content` 等) と `isPublished` は変更しない。公開中の表示は変わらない（設定モーダルで公開スイッチを変えていても、下書き保存では公開状態は変わらない）。
  - エディタが下書き保存を出すのは**公開版があるとき（保存済みの `isPublished` が true）だけ**（`hasDraftSave`、`hooks/use-guide-save.ts`）。下書き保存は「公開版を変えずに保存する」ためのものなので、一度も公開していないガイドと公開を取り下げたガイドでは保存ボタンは1つ（publish）だけになる。公開日時の列は無く公開版の有無は `isPublished` でしか分からないため、取り下げたガイドも「公開版が無い」側に入る（取り下げた本文は読者に見えず、守る公開版が無い）
  - 公開版が無いガイドの保存は publish モードになるので、本文の 50 万文字の上限が掛かる。自動翻訳は未公開のガイドを訳さない（`translateGuide` が `isPublished` を見る）ので、保存のたびに外部へ送られることはない
  - 下書き保存が非公開のガイドにも出ていた頃のドラフトが残っている場合は、通知を「前に下書き保存した内容を編集中です。「{action}」で保存するか、最後に保存した内容に戻せます」（`guideEditor.ui.draftBannerUnpublished`）、ボタンを「保存した内容に戻す」にする
- **保存（publish）**: 公開版を書き換え、`isPublished` を反映し、ドラフト列を `null` にクリア（コミット）。`updatedAt` を更新。エディタのボタンの文言は公開状態で変わる（下記「保存ボタンと公開状態」）。
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
  - **常設ツールバー**（タブ式リボン、ヘッダー直下に fixed 固定）— `toolbar/desktop-toolbar.tsx`。常時表示: 1段目の右に書き方の手引き・設定・プレビュー・保存状態・公開状態のピル・下書き保存/保存（公開）、2段目の左に Undo/Redo。保存状態は保存ボタンの隣（1段目）に置き、「保存済み」は平常なので muted（色で知らせるのは「未保存」の warning だけ）、未保存のときは見た目は短い「未保存」、読み上げは「未保存の変更があります」（`unsavedShort` ＋ sr-only の `unsavedChanges`）。挿入タブの文字付きの埋め込みで2段目の幅を使うため、デスクトップの幅（`max-w-5xl`）で1段ずつに収まるようにした（1280px で ja / en とも、テーブルタブ・「公開中（非公開は未保存）」・下書き保存済みの最も長い状態を実測。挿入タブのコールアウトは文字を出さずアイコン＋シェブロン。設定ボタンの見える文字は「設定」で名前は「ガイド設定」）。書き方の手引き（公式ガイド `GUIDE_WRITING_GUIDE_PATH`、`app/lib/official-guides.ts`）は1段目の幅に余裕が無いのでアイコン（`CircleHelp`）だけにし、新しいタブで開く。名前とツールチップは「書き方の手引き（新しいタブで開きます）」（`meGuides.writingGuide` ＋ `meGuides.opensInNewTab`）。このアイコン（約 32px）を足した後の 1280px での収まりは未実測。それでも足りないときは1段目の操作の塊ごと次の行へ回す（`flex-wrap`。はみ出して切れないように）。タブ: 「ホーム」(ブロック種別/整形/リスト)・「挿入」(メディア/表/段組/埋め込み)・「テーブル」(行列操作/セル色)。ツールバーの面は不透明（`bg-background`。半透明だと下を流れる本文と重なる）。ブロック種別のボタンの名前は見えている種別名で始める（「見出し 2（ブロックの種別）」、`guideEditor.toolbar.ariaBlockTypeNamed`。label in name）。
    挿入タブの末尾の Minefolio 固有の埋め込み（ガイドリンク・リマップ・サーチクラフト・テンプレート）は、区切りのあとに文字付きのボタンのグループ（`role=group`、名前「Minefolio の埋め込み」）で並べる（アイコン＋短い文字〔`guideEditor.toolbar.embedShort*`〕、説明はツールチップ）。語は `/` メニューと同じタブは `role=tablist/tab`（roving tabindex。左右の矢印・Home/End でフォーカスと選択を移す）、2 段目のタブごとのツール群が `role=tabpanel`（`aria-labelledby` で選択中のタブと結ぶ。Undo/Redo はタブに依らないので外）。
  - **保存ボタンと公開状態**（`hooks/use-guide-save.ts` の `getPublishAction` / `PUBLISH_ACTION_MESSAGES`）: 公開状態は保存（publish）でだけ書き換わるので、「保存済みの `isPublished`（loader の公開版スナップショット。保存のたびの再検証で更新）」と「設定モーダルの公開スイッチ」の組で決める。

    | 保存済み | スイッチ | ボタン | ツールチップ | ピル |
    |---|---|---|---|---|
    | 非公開 | オン | 公開 | 保存して、読者に公開します | 非公開（公開は未保存） |
    | 公開中 | オン | 更新を公開 | 公開中のガイドを、今の内容に更新します | 公開中 |
    | 公開中 | オフ | 保存 | 保存して、公開を取り下げます | 公開中（非公開は未保存） |
    | 非公開 | オフ | 保存 | 非公開のまま保存します | 非公開 |

    「下書き保存」（公開中のガイドだけ。上記「保存モデル」）のツールチップは「公開版は変えずに、下書きとして保存します」と `Ctrl S`。公開版が無いガイドは保存ボタンが1つで、`Ctrl S` はそのボタンのツールチップと `aria-keyshortcuts` に付く。ピルは ui.md 6 章の丸ピルで、スイッチが保存済みと違うときは警告色。下書きの通知（`guideEditor.ui.draftBanner`）はそのときのボタン名を差し込む
  - **Ctrl/⌘+S**: 公開中のガイドは下書き保存、公開版が無いガイドは唯一の保存ボタンと同じ保存（publish。`getShortcutSaveMode`）。ただし**初めて公開することになる保存（非公開→公開）はショートカットでは行わず**、トーストで「公開」ボタンを案内する（習慣の Ctrl+S で公開されないように。このときボタンのツールチップに Ctrl S も出さない）。`index.tsx` の window の keydown。ブラウザの「ページを保存」は `preventDefault` で止める。Ctrl+Shift+S は打ち消し線なので対象外。保存中・未保存の変更が無いとき・設定モーダルが開いている間は保存しない（設定モーダルは「適用」前の値を持つため）
  - **プレビュー**は `?draft=1` で下書き保存した内容（無ければ公開版）を新しいタブで開く。未保存の変更があるときはツールチップで「未保存の変更は含まれません」と伝える
  - **ダイアログを閉じたあとのフォーカス**（`lib/dialog-return-focus.ts` の `useDialogReturnFocus(open)`）: エディタのダイアログ（設定・リンク・YouTube・ガイドリンク・動画→GIF・画像の切り抜き・埋め込み〔リマップ／サーチクラフト〕・テンプレート埋め込み。挿入も変更も）はすべてトリガー（`DialogTrigger`）を持たず state で開くので、Radix の既定では閉じたあとフォーカスが body に落ちる。これを1つのフックで扱う
    - 開いた時点（`open` が true になった layout effect。中身のマウント前）で、フォーカスを持っていた要素を覚える。`onOpenAutoFocus` では取らない（中の入力欄に `autoFocus` があると、FocusScope の mount 時には既にダイアログ内にフォーカスがあり、`onOpenAutoFocus` が呼ばれない）
    - `onCloseAutoFocus` で、`document.activeElement` が body か DOM から外れた要素のときだけ戻す。戻し先は覚えた要素がまだ DOM にあればそれ、無い（バブルメニューが消えた等）かエディタ本体なら `editor.view.focus()`（選択位置ごと戻る）。挿入などの確定で `editor.chain().focus()` がエディタへ置いたフォーカスは奪わない
    - 戻し先のエディタは `DialogReturnFocusEditorContext`（`index.tsx` が配る。NodeView から開く画像の切り抜きにも EditorContent のポータル経由で届く）。開いている間に届く `onCloseAutoFocus`（開発時の StrictMode の effect 二重実行）は無視する
    - 対象外: 未保存離脱の確認（`components/unsaved-changes-dialog.tsx`。共有部品で、閉じると画面を離れる）、ツールバーの Popover・DropdownMenu（トリガーがあるので Radix の既定で戻る）
  - **本文の上のタイトルと概要**: 公開ビューと同じ大きさで表示する（読み取り専用。`h1` の中のボタンで、押すと設定モーダルが開く。押せる範囲は概要まで広げる）。設定モーダルで「適用」した未保存の値もここに出る。タイトルが空なら「タイトルが未設定です（押して設定）」
    - **先頭の見出しがタイトルと同じとき**（`panels/leading-title-heading-note.tsx`）: 公開ページ・プレビューは本文の最初のブロックがタイトルと同じ文の見出しなら出さない（「公開表示の本文」）。エディタでは見えたままなので、一致している間だけ、タイトル・概要の直下に muted の1行「本文の先頭の見出しはタイトルと同じなので、公開ページでは表示しません」（`guideEditor.ui.leadingTitleHeadingNote`）と「この見出しを削除」（`removeLeadingTitleHeading`、outline のボタン）を出す
      - 判定は公開ページと同じ `leadingHeadingMatchesTitle`。タイトルは設定モーダルで「適用」した未保存の値。本文全体は直列化せず、最初のブロック（`doc.firstChild`）が見出しのときだけ、そのノード1つを HTML にして比べる（`lib/leading-title-heading.ts` の `leadingBlockMatchesTitle`）。購読（`transaction`）はこの小さな部品の中に閉じ、ノードの参照が変わったとき（先頭のブロックを編集したとき）だけ再描画・再判定する（宿主の `GuideEditor` は毎キー再描画しない）
      - 「この見出しを削除」は1つのトランザクションで先頭の見出しを取り除き（Undo で戻せる。本文が見出しだけなら空の段落に置き換える）、エディタの先頭へフォーカスを移す（ボタンは注記ごと消えるため。`deleteLeadingHeading`）
      - live region は付けない（先頭の見出しを打っている間に一致が出入りするたびに読み上げが割り込むため）。注記は本文の直前にあるので読み順で届く
  - エディタ本文（contenteditable）は `aria-label`「本文」（`guideEditor.ui.editorAriaLabel`、`hooks/use-guide-editor.ts`）
  - **設定モーダル** — `panels/settings-dialog.tsx`。タイトル・概要・カバー画像・**URL（スラッグ）**・タグ・公開設定を集約（ツールバーの「設定」から開く）。「URL」欄は入力を正規化しつつ `/guides/{authorSlug}/{slug}` のプレビューを表示する。「適用」でエディタの状態へ入れる（保存はしない）。値が実際に変わったときだけ未保存にする（`isSettingsChanged`。開いて「適用」しただけでは未保存にしない）。公開スイッチは見えるラベル「公開する」が名前で、オン/オフは `role=switch` の状態で伝える。オンの色は brand（`data-[state=checked]:bg-brand`。基底の Switch は primary のまま）。
    説明文（`settingsDesc` / `settingsDescSingle`・スイッチの下の `publishOnLive` / `publishOnNew` / `publishOffLive` / `publishOffNew`）は、ボタンを位置（「右端の」）で指さず、いまのボタンの文言（モーダルのスイッチの値で決まる保存ボタン名と「下書き保存」）を差し込んで指す。公開版が無いガイドでは下書き保存の話と「公開中のガイドは…」を出さない。カバー画像の欄のボタンは「カバー画像を追加」（欄名と同じ語）タグ入力は Enter かカンマで追加・空欄で Backspace を押すと最後のタグを削除（入力欄の下に案内。IME の変換確定の Enter では追加しない）
  - **スラッシュコマンド**（`/` 入力）でブロック挿入 — `slash-command/`（@tiptap/suggestion + ポータル描画）。フォーカスはエディタに残したまま、エディタ本体（`role=textbox`）に `aria-haspopup="listbox"` を常に付け（`hooks/use-guide-editor.ts`）、メニューが開いている間だけ `aria-controls`（listbox の id）/ `aria-activedescendant`（選択中の option）を付ける（`renderer.ts`）。開閉はこの2つの有無で伝える（`aria-expanded` は textbox では無効な属性なので付けない）。埋め込みの項目名は「リマップの埋め込み」「サーチクラフトの埋め込み」「サーチクラフトテンプレートの埋め込み」（呼び名は記事の見出し「— リマップ」と同じ語にそろえた。キーワードには旧名の「キー配置」と「keyboard」「controls」も残し、検索で見つかるようにする）。メニューは `role=listbox` ＞ グループごとの `role=group` ＞ `role=option`（`aria-selected`）。項目は任意の補足（`descriptionKey`）を持てる
  - **表の挿入口の補足**: スラッシュコマンドの「表」の補足と、挿入タブの表ボタンのツールチップで「サーチ文字列を載せるなら、サーチクラフト（テンプレート）の埋め込みで等幅・コピー付きで表示できる」と案内する（`guideEditor.ui.tableSearchStrHint`）。表の中のサーチ文字列用の書式は作らない
  - **バブルメニュー**で選択範囲のインライン整形 — `toolbar/bubble-menu.tsx`（@tiptap/extension-bubble-menu）。ノード選択（`NodeSelection`。画像・埋め込み・動画・区切り線などの atom）では出さない
  - **ブロックハンドル**でブロック種別変更 / 削除 — `toolbar/block-handle.tsx`。デスクトップではテーブル上に表示せず行・列ハンドルへ委譲（タッチはテーブル行列操作メニューを含む従来動作）
  - **テーブル行・列ハンドル**（Notion 風、デスクトップのみ）— `toolbar/table-handles.tsx`。ホバー中の行の左端 / 列の上端にピル型ハンドルを表示。クリックで行・列全体を CellSelection で選択（`.selectedCell` ハイライト）し、メニューから行・列の追加・削除、スタイル一括適用（背景色 / 文字色 / 文字揃え）、テーブル削除ができる
- モバイル/タッチ完全対応: `(hover:none)` で分岐し、バブルの代わりに下部固定ツールバー（`toolbar/mobile-toolbar.tsx`）。ブロックハンドルはタッチ時 `selectionUpdate` ベースで追従。
- アクセシビリティ: `role`/`aria-label`、保存状態の `aria-live`、本文の `role=textbox`。
- 未保存離脱警告（`hooks/use-unsaved-warning.ts`、useBlocker + beforeunload）。

#### ディレクトリ構成（`app/components/guide-editor/`）

| 配下 | 役割 |
|------|------|
| `index.tsx` | 宿主。メタ欄 + ツールバー + 本文 + ダイアログの組立（約 280 行） |
| `editor-config.ts` | `buildExtensions()` — 拡張配列の単一ソース |
| `extensions/` | カスタム拡張（callout / toggle-list / guide-link / keybind-embed / searchcraft-embed / searchcraft-template-embed / columns / table / image / code-block / youtube / slash-command） |
| `node-views/` | React NodeView（表示 + 属性編集） |
| `slash-command/` | items / menu / renderer |
| `toolbar/` | desktop / mobile / bubble / block-handle / table-handles / menu-item / 共通ボタン |
| `panels/` | metadata-fields / color-picker / font-size-picker / settings-dialog / embed-dialog / template-embed-dialog / youtube-dialog / link-dialog / guide-link-search / image-crop-dialog / video-to-gif-dialog |
| `hooks/` | use-guide-editor / use-guide-save / use-editor-rerender / use-image-upload / use-unsaved-warning |
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
| 画像 | ファイル選択・クリップボードペースト。幅のドラッグ変更、**横方向の配置**（未設定 / 左 / 中央 / 右）、**トリミング**、**代替テキスト（alt）**に対応 |
| GIF（動画から変換） | 短い動画をブラウザ内で GIF に変換して挿入（下記） |
| YouTube埋め込み | YouTube動画の埋め込み（保存は TipTap の iframe。公開表示で本文の直下の動画は押してから読み込む。下記「公開表示の本文」） |
| サーチクラフトテンプレート埋め込み | 公開済みテンプレート（`search_craft_templates`）を ID で参照して差し込む（下記） |
| テーブル | リサイズ可能（列幅ドラッグ変更） |
| ハイライト | 色付きハイライト |
| テキスト色 | 文字色の変更 |
| 背景色 | 背景色の変更 |
| 文字サイズ | 5段階（極小 0.75em / 小 0.875em / 標準 / 大 1.25em / 特大 1.5em）。単一情報源は `app/lib/guide-font-sizes.ts`。**見出し（h1〜h3）内では変更できない**（下記） |

#### 公開表示での見出しレベル

ページタイトルが `h1` を占有するため、公開閲覧（`/guides/:author/:slug`、自動翻訳・ドラフトプレビュー含む）では本文見出しを、**本文中の最小レベルが h2 になるようシフトして表示する**（h1 始まりは +1、h2 始まりは 0、h3 始まりは -1。相対的な階層は保ち h6 を超えない。見出しが無ければ何もしない）。保存データ・エディタの見出しレベルは変えない。変換は `app/lib/guide-heading-demote.ts` の `demoteGuideHeadings`（サニタイズ・目次生成の後に適用。目次は元のレベル 1〜3 のまま扱い、id は保持される）。降格後の開きタグには元のレベルを `data-guide-level` として付与し、`.guide-content-demoted`（`app/app.css`）がその属性で、エディタで選んだレベルの見た目（サイズ）を保つ。エディタ内は変換しない（`.guide-content` のみ）。

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

### リマップ / サーチクラフト埋め込み

呼び名はエディタ（ツールバー・`/` メニュー・ダイアログ・ノードビュー）も記事の見出し（「走者名 — リマップ」）も「リマップ」にそろえる（以前のエディタは「キー配置」で、記事と食い違っていた）。ノード名・属性・保存 HTML（`keybindEmbed` / `data-keybind-embed`）は互換のため変えていない。

- TipTap ノード `keybindEmbed` / `searchCraftEmbed`（atom・block）。属性は `userSlug` と `presetName`（任意）。保存 HTML は `<div data-keybind-embed data-user-slug="…" [data-preset-name="…"]>`（サーチクラフトは `data-searchcraft-embed`）。属性の形は変えていない（保存済みのガイドと互換）
- **挿入ダイアログ**（`panels/embed-dialog.tsx`）: 走者は combobox（Popover＋Command。`shouldFilter={false}`）で選ぶ。既定はログイン中の作者自身。入力すると自サイトの走者検索 `/api/browse?q=`（公開プロフィールの走者を MCID・表示名で探す。限定公開・非公開は候補に出ない）で候補を出す。プリセットは選んだ走者のプリセット一覧からの Select（「既定（プロフィールに表示中の設定）」は番兵値で持ち、挿入時は属性なし。名前の重複は先勝ちで1つ）。選んだ組み合わせは下の「記事に表示される内容」に要約（下記）を出し、走者が解決できない（存在しない・非公開）ときは「見つかりません」を出して「挿入」を押せなくする。解決できたが中身が 0 件（リマップなし・サーチクラフト未登録。`isEmbedEmpty`）のときは、要約に warning 色で「記事には「〜が設定されていません」とだけ表示されます（走者が後から設定すれば表示されます）」を出し、ボタンを「このまま挿入」にする（走者が後から設定することがあるので無効にはしない。引用する文は記事と同じ `playerProfile.noRemaps` / `noSearchCraft`）。保存する `userSlug` は解決した走者の slug
- **解決は公開ページと同じ規則**: `resolveEmbedUsers`（`app/lib/guide-embed-users.server.ts`。slug → 未一致分は MCID、`publiclyReferencableCondition`＝非公開は除く、既定の表示はメインのプリセットかライブ）を、公開ページの loader（`guides/view.tsx`）とエディタ用の `GET /api/guides/embed-resolve?user=`（全プリセットを返す。プリセットの一覧と中身は走者画面でも `?preset=` で選んで見られる公開情報。ただし要約に使う項目〔名前・リマップ・サーチクラフト・キーボードの配列〕だけに絞り、キー配置の行・Loop・指の割り当て・プレイヤー設定のほかの項目は空にして送る）が共用する。どのデータを出すか（プリセット名の指定・見つからないプリセット名は既定の表示に戻る・Trigger 種別のリマップは除く・壊れた JSON は既定に戻る）は `app/lib/guide-embed-data.ts`（`selectKeybindEmbedSource` / `selectSearchCraftEmbedSource`）にあり、公開ページの描画（`guide-embeds.tsx`）とエディタの要約が同じ関数を使う。規則が分かれると「エディタでは見つかるのに記事では出ない」が起きるため
- **ノードビュー**（`node-views/embed-node-view.tsx`。外枠は `embed-node-actions.tsx` の `EmbedNodeFrame`）: 外の余白・カード（`rounded-xl border-border/70 bg-card`）・ヘッダー帯は公開ページの `UserEmbedHeader` と同じ（ヘッダー帯は「走者名（プリセット名）— 種別」。解決できるまでは種別だけ）。その下に中身の要約を出す（ダイアログのプレビューは従来どおり走者名・`@MCID`・プリセット名〔無ければ「既定の設定」〕の行も出す。`EmbedSummary` の `showIdentity`）（`panels/embed-summary.tsx`、ダイアログのプレビューと共用）。要約はサーチクラフトが「OW 29・Bastion 3（計 32 件）」のようなグループごとの件数（一覧と同じ順。`summarizeSearchCraftEmbed`）、リマップが「リマップ {n} 件」（`summarizeKeybindEmbed`）。0 件ならダイアログと同じ warning 色の「記事には「…」とだけ表示されます」。読み込み中（スピナー）・通信の失敗・見つからない（破線の枠と destructive 色の文）を出し分け、プリセット名が見つからないときは「記事には既定の設定が表示されます」と警告色で添える。取得は `lib/embed-user-cache.ts`（モジュール内キャッシュ。同じ走者への同時の問い合わせは1つにまとめる。ダイアログでは取り直す）
- テンプレート埋め込みのノードビューも同じ 3 状態（ヘッダー帯は公開ページと同じ「テンプレート名 — [アバター 20px] 作者名  ゲーム内言語」。本文は作者・クラフト数と、未公開なら警告のバッジ）（読み込み中・見つからない・タイトル／言語／作者／クラフト数）にした（以前は読み込み中も見つからないときも ID を出していた）。ガイドリンクはタイトル等を属性に持つので対象外
- **挿入済みの埋め込みの変更と削除**（3 種とも。`node-views/embed-node-actions.tsx`）: ヘッダー帯の右に「変更」と削除（ゴミ箱、名前は「{種別}の埋め込みを削除」）のボタン（ヘッダー帯の右）。ノードを選択しているとき・ホバーしているとき・中にフォーカスがあるとき（`group-focus-within`）に見える。どちらも処理は `onClick`（`onMouseDown` は `preventDefault` だけでエディタのフォーカスと選択を奪わない）なので Enter / Space でも押せ、Tab でも届く。「変更」は保存済みの属性（走者・プリセット／テンプレート ID）を初期値にしてダイアログを開き（見出しは「…の埋め込みを変更」、ボタンは「適用」／0 件なら「このまま適用」）、確定するとそのノードを `updateAttributes` で書き換える（挿入はしない）。保存済みのプリセット名が今の一覧に無いときは「{名前}（見つかりません）」として選択肢に残す（空欄にしない。要約が既定の設定が出ることを警告する）。宿主（`index.tsx`）のダイアログへの橋渡しは `lib/embed-edit-context.ts`（editor ごとの WeakMap。拡張の定義と保存 HTML には触れない）。トリガーを持たないダイアログなので、閉じたあとフォーカスを開く前の要素（「変更」ボタン）へ戻す（下の「ダイアログを閉じたあとのフォーカス」）

### サーチクラフトテンプレート埋め込み

- TipTap ノード `searchCraftTemplateEmbed`（atom・block。`extensions/searchcraft-template-embed.ts`）。属性は `templateId` のみ。保存 HTML は `<div data-sctemplate-embed data-template-id="…">`。`parseHTML` で読み戻すので編集→再保存で ID は消えない
- 挿入口は既存の埋め込みと同じ: 「挿入」タブ（LayoutTemplate アイコン）とスラッシュコマンド。ダイアログは `panels/template-embed-dialog.tsx`。タイトル検索（候補にタイトル・作者・ゲーム内言語・クラフト数）と、テンプレート詳細の URL（`/guides/templates/:id`）または ID の貼り付けに対応。自分のテンプレートは非公開を含めて先頭に出し、非公開には「公開すると記事に表示されます」を付ける
- 検索 API: `GET /api/guides/templates-search`。`?q=` はタイトル部分一致（公開済み＋作者 `public`、および自分のテンプレート）、`?id=` は ID 指定（公開済み＋作者が `private` でない、または自分のもの。他人の非公開は返さない）
- 編集中表示（`node-views/template-embed-node-view.tsx`）は ID しか持たないため、タイトル・言語・作者・クラフト数を `lib/template-embed-meta.ts`（モジュール内キャッシュ。挿入時は選択結果で先に埋める）で軽く取得する。読み込み中は「読み込み中…」、取れなければ「テンプレートが見つかりません」（破線の枠）
- サニタイズ: `data-sctemplate-embed` / `data-template-id` を許可。ID は cuid2 形式（`isValidTemplateId`、`lib/guide-embed-attrs.ts`）で検証し、形式外は属性ごと除去する
- 公開表示: `guides/view.tsx` の loader が本文から ID を集め（`extractTemplateEmbedIds`）、`inArray` の1クエリで「公開済み・作者が `private` でない」ものだけ作者名つきで取得する（テンプレート詳細ページの閲覧規則と同じ。N+1 なし）。`splitContentAtEmbeds` が `sctemplate-embed` セグメントを返し、`SearchCraftTemplateEmbedView`（`guide-embeds.tsx`）が描く。見出し行はテンプレート名・作者・ゲーム内言語・「テンプレートを見る」、その下にサーチクラフト一覧（繋ぎ方 Loop があれば併せて）。描画本体は `SearchCraftEmbedBody` で、ユーザー参照のサーチクラフト埋め込みと共用する
- 一覧の見た目（ユーザー参照のサーチクラフト埋め込みも同じ）: テンプレート詳細・走者画面と同じ `SearchCraftGroupedList`（`framed={false}`）の高密度の行（アイテム・等幅のサーチ文字列＋コピー・キーバッジ・キー入力順）と `KeyBadgeLegend`。繋ぎ方（Loop）は `makeLoopGroupExtra` でタイミンググループの中に出す。面は埋め込みの外枠 1 枚だけ。タイミングのグループが 2 つ以上なら開閉でき（`collapsible`。数え方は `countSearchCraftGroups`）、**lg 以上では全グループを開いて始め**（`openAllFromLg`）、lg 未満では最初のグループのクラフトが 10 件以下（`SEARCH_CRAFT_OPEN_FIRST_MAX`、`openFirstMaxCount`）ならそれだけ開いて、多ければ全部閉じて始まる（件数は先頭のグループのクラフトの数。Loop は数えない）。1 つだけなら開閉は出さない。テンプレート詳細も同じ開閉と枠（下記）。
  - グループ見出しの段は、**その埋め込みより前で最後に現れる本文の見出し（降格した後の段）の1つ下**（上限 h6。前に見出しが無ければ h3＝記事のタイトルが h1、本文の最上位が h2）。本文の見出しは公開表示で降格し、埋め込みは本文のどの段の見出しの下にも置けるので、固定の段だと段が飛ぶ（本文 h2 → h4）か並ぶ（本文 h3 → h3）。`GuideContent`（`guides/view.tsx`）が `embedGroupHeadingLevels`（`guide-embeds.tsx`。直前の見出しは `lastHeadingLevel`〔`lib/guide-view-html.ts`〕で、セグメントをまたいで持ち越す。段は降格後のタグ名で取り、`data-guide-level` は見ない）で求め、`SearchCraftGroupedList` の `groupHeadingLevel`（h3〜h6）に渡す。本文は loader が降格まで済ませた HTML なので、SSR とハイドレーションで一致する。リマップの埋め込みには見出しが無い。`app/app.css` の本文の h3 の規則は、h4〜h6 と同じく埋め込み（`.not-prose`）の中を除く（当たると部品の `text-base`・`mb-2` に勝つ）
  - 幅による初期状態は SSR とハイドレーションでずれないよう CSS で出し分ける（lg 未満だけ閉じるグループの本体に `max-lg:hidden`、シェブロンは `lg:rotate-180`、「すべて開く／閉じる」は両方の文言を描いて出し分け）。この間は見た目が幅で変わるので、見出しボタンに `aria-expanded` を付けない。マウント後に `matchMedia("(min-width: 64rem)")` を読んで開閉の状態を確定し、`aria-expanded` と `hidden` 属性を見た目にそろえる（見た目は変わらない）。開閉を一度でも操作したら以後は操作の結果に従い、それまでは幅の変化にも追従する（操作の時点の実効の状態から反転するので、lg で 1 つ閉じても他は開いたまま）
  - 閉じたグループの本体も DOM に残す（`keepClosedMounted`）。属性は `hidden="until-found"` で、ページ内検索（Ctrl+F）やテキストフラグメントで中身が見つかるとブラウザが開き、`beforematch` で開閉の状態も開にそろえる。React 19.3 は `hidden` を真偽属性として `hidden=""` で出す（`"until-found"` を値として出せず、`onBeforeMatch` も無い）ため、属性値は `useLayoutEffect` で書き換え、`beforematch` は `addEventListener` で受ける。SSR の HTML にもサーチ文字列が入り、`aria-controls` の先が常にある。非対応のブラウザでは通常の hidden として隠れる（Firefox 160・Edge 157 は対応を確認）
  - 走者画面（`profile.tsx`）はこの 2 つの props を渡さないので従来どおり（先頭のグループだけ開く・閉じた本体は描かない）
  - グループの開閉の見出しボタンは、モバイルで押せる範囲 44px（`-my-1.5 py-2.5`、sm 以上は従来の 32px。共有部品の全画面で同じ。見出しを `flow-root` にして負のマージンを閉じ込めるので、見出し・走者画面の貼り付き枠の高さは 32px のまま〔375px で実測。閉じ込めないとマージンが見出しの外へ抜けて 44px に伸びる〕）。「すべて開く／すべて閉じる」もモバイルで押せる範囲 44px（負のマージンで見た目の行の高さは変えない）。lg 未満の行は「サーチ文字列」と「入力キー」を1段に並べ、入りきらないときだけ入力キーを次の段へ折り返す（`SearchCraftGroupedList` の既定。走者画面・テンプレート詳細・記事の全部で同じ。lg 以上は従来の3列）。破損しうる生 JSON（プリセットスナップショット・テンプレート）は、渡す前に `normalizeEmbedCrafts`・`coerceStringArray`・`toSafeLoopSteps`（transition の検証）と `resolveCraftTiming`（enum 外の timing は「その他」）で直す。キー入力順の鍵盤は、ユーザー参照ならその走者（プリセット指定時はそのプリセット）のレイアウト、テンプレートは US
- リマップの鍵盤は出さない（本文の流れを切るため）。リマップが含まれるときは「リマップあり」と示し、入力キーの表示にはリマップを反映する。詳細ページで鍵盤を確認できる
- 見つからない・未公開・削除済み・ID 不正のときは「このテンプレートは表示できません」の短い表示（下書きプレビューで作者本人が見る場合も同じ）
- 自動翻訳: 埋め込み div は翻訳対象外（`guide-translate-html.server.ts` の `EMBED_ATTRS`）で、訳文でも同じ経路で描かれる
- アイテム名は閲覧者の UI ロケールで表示する（既存のサーチクラフト埋め込みと同じ。テンプレート詳細ページはテンプレートの `gameLanguage` で出す）。サーチ文字列は言語依存なので、見出し行にゲーム内言語を出している

### 画像の代替テキスト（alt）

- 画像ツールバー（ホバー / タッチで選択）の字幕アイコンから Popover で入力・編集する。入力は即時に node の `alt` 属性へ反映され、空なら装飾画像（`alt=""`）扱い。挿入直後の alt は空（以前はファイル名を自動で入れていた）
- alt は `guide-sanitize.server.ts` の許可属性（`img`）・`guide-translate-html.server.ts`（翻訳対象）を通って落ちない
- リマップの埋め込み（`app/components/guide-embeds.tsx`）は横長になるため `HorizontalScrollArea` で包み、実際にはみ出しているときは**どの幅でも**「横にスクロールできます」のヒントを出す（`hintAtAllWidths`。鍵盤は約 1,150px で、デスクトップの本文幅より広いことがある。共有部品の既定は md 未満のみのまま。縮小表示はしない）（詳細は [`docs/keybindings.md`](./keybindings.md)）。ヘッダーの「プロフィールを見る」リンクは、文字サイズ・ヘッダー高さを変えずに padding＋負マージンで当たり判定を約40pxへ広げている。リマップ／サーチクラフト埋め込みのヘッダー（`UserEmbedHeader`）は、375px でも語の途中で折れないよう、種別（「— リマップ」）と右のリンクを `shrink-0 whitespace-nowrap` にし、長い走者名・プリセット名だけを省略（truncate）する。テンプレート埋め込みのヘッダーの「テンプレートを見る」も折り返さない
- 旧エディタが入れていた固定値 `alt="image"` は、公開表示時に `lib/guide-image-alt.ts` の `blankGenericImageAlt()` で `alt=""` に変換する（保存データは書き換えない。`/guides/:author/:slug` の loader で見出し降格と同じ段階に適用。`lib/__tests__/guide-image-alt.test.ts`）

### 画像アップロード

- **ファイル選択**: ファイルダイアログからアップロード
- **クリップボードペースト**: コピーした画像をエディタに直接ペースト
- アップロード先は **Vercel Blob**
- APIエンドポイント: `/api/me/guides/upload-image`
- アップロード前に `lib/image-processing.ts` の `prepareImageForUpload()` がブラウザ側で長辺を縮小し webp（不可なら jpeg）へ再エンコードする。**GIF はアニメーション保持のため無加工**で通す（サイズ上限のみ検査）

#### 参照されなくなった Blob の回収

**ガイド削除時**（`app/routes/my-guides/index.tsx` の `_action="delete"` → `app/lib/content-cleanup.server.ts` の `deleteGuide()`）は、翻訳キャッシュ削除 + `guides` 行削除を `db.transaction()` で原子化したうえで、トランザクション成功後に `cleanupGuideBlobs()` を `runAfterResponse()` 経由で呼ぶ。`cleanupGuideBlobs()` は `guides/<userId>/<guideId>/` 配下の Blob（本文画像・カバー・ドラフトカバー）と、削除された行の本文/カバー/ドラフト列が参照していた `guides/<userId>/` 配下の Blob をあわせて削除する。ただし著者の残ガイド（他ガイド・ドラフト）がまだ参照しているパスは保護し、削除対象から外す（同一著者内のコピー参照を壊さないため）。この保護判定用クエリは、著者の残ガイドのうち本文/カバー/ドラフト列のいずれかが Blob ホスト文字列（`%blob.vercel-storage.com%`）を含む行だけを対象にする LIKE 事前絞り込みを行う（Blob 参照ゼロのガイドの本文転送を削減する最適化。**候補 pathname ごとの LIKE 絞りは percent-encoding 不一致で誤削除を招くため行わない**）。**他ユーザーのガイドへコピーされた画像参照までは保護しない**（cross-user 参照は現状のカバー画像即時削除と同じ意味論として許容する）。`BLOB_READ_WRITE_TOKEN` 未設定なら no-op。

**アカウント削除時**（`app/routes/me/edit.tsx` の `_action="delete_account"` → `deleteUserAccount()`）は、本体削除のトランザクション成功後に `cleanupUserBlobs()` を `runAfterResponse()` 経由で呼ぶ。`cleanupUserBlobs()` は `guides/<userId>/` と `skins/<userId>/` と `capes/<userId>/` の3 prefix を丸ごと削除する（著者の全ガイド・カスタムスキン・カスタムマントをまとめて消す）。

上記2経路でカバーしきれない残骸（トリミングで残る元画像・差し替えで参照が外れた画像・cross-user 参照の孤児など）は、cron を置かず **`scripts/` のスクリプトを必要なときに手で実行**して回収する。トリミングは元画像を残す（同じ Blob が他のガイドやドラフト/公開版から参照されている可能性があり、参照追跡なしに消すと表示が壊れるため）。

```bash
pnpm exec tsx scripts/audit-orphan-blobs.ts --remote     # 実測（読み取りのみ）
pnpm exec tsx scripts/delete-orphan-blobs.ts --remote    # 削除対象の確認（dry-run）
pnpm exec tsx scripts/delete-orphan-blobs.ts --remote --apply  # 実際に削除
```

- **参照判定は `scripts/lib/blob-refs.ts` に集約**している（Blob URL → pathname 変換・本文からの URL 抽出そのものは `app/lib/blob-url.ts` の `blobUrlToPathname` / `collectBlobPathnames` が実装元で、`cleanupGuideBlobs()` の削除判定とも共有している）。監査と削除で別実装にすると「監査では参照ありなのに削除側では孤児」という食い違いが画像消失に直結するため、必ずここを共有すること。走査対象には**ドラフト列（`draft_content` / `draft_cover_image_url`）を必ず含める**（公開版から消しただけでドラフトがまだ参照している状態がある）
- **Blob の列挙（cursorページング）・バッチ削除（100件ずつ・バッチ単位で失敗続行）の実装は `app/lib/blob-storage.server.ts` に集約**している。`app/lib/content-cleanup.server.ts`（アプリ内の削除経路）と `scripts/lib/blob-refs.ts` / `scripts/delete-orphan-blobs.ts`（本スクリプト）の両方がこれを呼ぶ
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
- **テンプレート埋め込み**: `div` の `data-sctemplate-embed` / `data-template-id` を許可。`data-template-id` は cuid2 形式のみ（`onTagAttr` で検証し、形式外は属性ごと除去）

### スタイリング

- `.guide-content.prose` CSSクラスを適用（エディタ本体も同じクラスを持つので、レイヤー外の `.guide-content.prose` 規則は公開表示とエディタの両方に効く）
- Tailwind CSS の `prose` クラスベースのタイポグラフィスタイリング
- **長い語の折り返し**: 本文の段落・リスト項目・リンク・表のセルは `overflow-wrap: anywhere`（`app/app.css`）。参考文献の生 URL などが狭い画面でページ幅をはみ出させない。表の列が潰れない幅は従来どおり `normalizeGuideTables()` の表の `min-width` が決める
- **埋め込みには本文の上書きを当てない**: 本文の段落・h4〜h6・インライン code・画像の上書き（`app/app.css`、レイヤー外）は `:not(:where(.not-prose *))` で、本文に差し込む React の埋め込み（`.not-prose`: サーチクラフト・キー配置・テンプレート・YouTube）の中を除く。レイヤー外の規則は Tailwind のクラスに勝つので、当たると共有部品の見た目がテンプレート詳細ページとずれる（アイテムアイコンの img に上下の余白が付く等）
- **本文の縦の余白**（公開ページ・プレビュー・エディタで同じ値。`app/app.css`「縦の余白」）: 3 段に分ける。隣り合う余白は margin の相殺で大きいほうになるので、塊どうしが続いても二重にならない
  - 文の間: 段落どうし・段落とリストは `0.8em`（行間 1.8 で約 13px）
  - 塊の前後: 表・画像・コード・コールアウト・トグル・段組・ガイドリンクカード・YouTube・記事内の埋め込み（サーチクラフト・リマップ・テンプレート）は上下 `1.5rem`（24px、`--guide-gap-block`）。コールアウト・トグル・表のセル・リスト・段組の中では `0.75rem` に下げ、中の先頭・末尾の余白は 0 にする
  - 見出し: 直下は 8px（直後が段落でも表でもコールアウトでも、見出しが続くときも。直後の要素の上余白を 0 にして見出しの下余白で決める）。上は最上位 48px・2 段目 32px・3 段目 24px・それ以下 20px（`rem` 固定。公開は `data-guide-level`、エディタは h1〜h6）。埋め込みで分かれた本文のかたまりが見出しで終わるときも、見出しと埋め込みの間は 8px
  - 本文の最後の要素の下余白は 0（いいね行との間を広げない）。表の `table` 自体の余白は 0（器が持つ）
  - 表のセル（th も同じ）は中の最初の段落の上と最後の段落の下の余白を 0 にし、段落が複数あるときの間は `0.4em`。`vertical-align: top`（エディタと同じ）なので、1 行のセルは「文字の高さ＋上下 padding」になる
  - 空行: 作者が入れた空の段落（公開 HTML では `<p></p>`）は、エディタ（ProseMirror の trailing break）と同じく行間 1 行ぶん（`min-height: 1lh`）の高さで描く。先頭・末尾・連続・リスト・セル・コールアウトの中でもエディタと同じ。保存データは変えない
- **エディタと公開ページで本文の見た目をそろえる**（方針）: エディタの本文は公開ページと同じ `.guide-content.prose` の規則で描く。共有する値（文字・行間・色・余白・枠・角丸・背景）は `app/app.css` のレイヤー外の `.guide-content.prose` 規則に 1 か所だけ持ち、エディタ専用の規則は編集のための要素（NodeView の外枠・選択枠・ハンドル）に限る。色は `prose-invert` / `dark:` ではなくトークンで 3 テーマに対応する（エディタの器は `guide-content prose max-w-none`。公開と同じ）。公開ページを正とし、差が出たらエディタを寄せる。エディタの NodeView が公開 HTML と違う DOM を作る要素（画像・コード・表の器・段組・埋め込み）は、外枠の余白と中身の大きさが公開と同じになるよう NodeView 側を直す。表のセルに縦線は付けない（公開は行の区切り線だけ。エディタのセルの枠を外した。列の境目はリサイズハンドルと選択セルの枠で分かる）。確認は同じ幅（2xl 以上）でエディタと `?draft=1` のプレビューを開き、要素ごとの `getComputedStyle` と `getBoundingClientRect`（上端の位置と高さ）を比べる
  - **意図して残す差**: ①編集のための見た目（選択枠・プレースホルダー・ブロックのハンドル・画像のホバーのツールバー・コードのコピーボタン・段組のホバー時の破線と「N 列」ラベル・表のリサイズハンドルと選択セルの枠・空のセルの最小幅 `2em`・エディタ本文の `min-height`）②トグルは常に開いて見える（NodeView が `details open`。summary は入力欄）③YouTube はエディタが iframe（公開の本文直下は押してから読み込む `YouTubeClickEmbed`。縦横比 16:9 と余白は同じ）④長い表の見出し行を貼り付ける `position: sticky` と、その見出しの下線の引き方（公開だけ。見た目は同じ線）⑤本文の幅: 公開は目次（見出し 2 つ以上）が出る xl〜2xl 未満で本文が 912px（左に目次の欄）、エディタには目次が無いので常に 960px。2xl 以上と目次の無い記事では同じ 960px ⑥記事内の埋め込み（リマップ・サーチクラフト・テンプレート）は、外枠・角丸・ヘッダー帯・余白は公開と同じで、中身は公開の鍵盤・一覧ではなく要約（下の「ノードビュー」）。ヘッダー帯の右には公開の「プロフィールを見る」等の代わりに「変更」「削除」が出る
  - 公開ページ側の見た目を変えた点: 見出しの h4 レベル（`h4`〜`h6`・降格後の `data-guide-level="4"` 以上）の行間を 1.5 に固定（以前は降格後のタグで 1.5 / 1.8 に分かれた）。ガイドリンクカードの印は保存 HTML の絵文字（📄）のまま、CSS の mask で lucide の `FileText` の線画（16px・muted 色）に置き換え（ui.md 14 章のアイコンの統一。エディタも同じ span を描く）
- **ブロックの面と角丸**（`.claude/rules/ui.md` 6 章に合わせる）: 本文直下のブロック（コールアウト・トグル・コード・表の器・画像・ガイドリンクカード・YouTube）の角丸は `rounded-xl`（`--guide-radius`）。コールアウト・トグル・表のセルの中では 1 段ずつ下げる（`rounded-lg` → `rounded-md`）。インラインの code は `rounded` のまま。ブロックの外枠は `border/70`、表の行の区切りは `/60`、水平線は欄の区切りと同じ `foreground/15`
- **コールアウト**: 面は意味色 `/10`、枠 `/40`（tip→success / info→info / warning→warning / danger→destructive）。アイコンは挿入メニュー（`desktop-toolbar.tsx`）と同じ lucide の Lightbulb / Info / TriangleAlert / Siren を CSS の mask で意味色に塗る（公開表示は `.callout::before`、エディタは NodeView の `.callout-icon`。同じ規則）。アイコンは装飾で、種類は公開表示の `role="note"` ＋種類名の `aria-label`（`guideEditor.callout.*`）で読み上げる。種類はクリックで切り替えない（従来どおり）
- **トグル**: 印は目次の節の開閉と同じ右向きシェブロン（muted 色、開くと 90° 回す。`prefers-reduced-motion` では回転のトランジションなし）。`summary` は枠の左右いっぱい・高さ 44px で押せる
- **ガイドリンクカード**: 本文の中の埋め込み（キー配置・サーチクラフト・テンプレート）と同じ `bg-card`・枠 `/70`。ホバーは枠 `primary/40`＋影で、浮かせない
- **背景色（ハイライト・表のセル色）の暗いテーマ**: 保存データはライトの淡い色（`GUIDE_BG_COLORS` ＋旧 `#FEF08A`）のままで、dark / ultra-dark では前景色の文字が約 1.1:1 になる。`app/app.css` の「Guide background palette」が `.guide-content` 配下の inline style を色の部分一致（hex〔大文字小文字を問わない〕・`rgb(r, g, b)`・`rgb(r,g,b)`）で捕まえ、テーマ別のトークン `--guide-bg-*` へ `!important` で置き換える。ライトのトークンは保存色と同じ hex（見た目は変わらない）、dark は同じ色相の oklch L 0.30、ultra-dark は L 0.27（前景色に対して 12.8〜14.7:1）。単一情報源は `app/lib/guide-colors.ts` の `GUIDE_BG_COLOR_TOKENS`（オレンジと黄は同じ色なので 1 つ）。エディタのカラーピッカーの見本も `guideBgColorVar()` でトークンを使い、適用後の見た目と揃える。`lib/__tests__/guide-colors.test.ts` が CSS のセレクタとトークン定義の漏れを検出する。文字色パレットは置き換えない

### 公開表示の本文（`/guides/:author/:slug`）

loader が `app/lib/guide-view-html.ts` の変換を掛ける。先頭のタイトルの見出しの除去はサニタイズの直後（表の正規化・目次の生成より前）、それ以外（コールアウト・YouTube）はサニタイズ・表の正規化・目次・見出し降格の後（サニタイザの許可属性に無い属性を足すため）。どれも保存データ・エディタは変えない。

- **本文の先頭のタイトルの見出し**: サニタイズの直後（表の正規化・目次の生成より前）に、本文の最初のブロックが見出し（h1〜h6）で、その文がタイトルと一致すれば取り除く（`leadingHeadingMatchesTitle` → `removeLeadingHeading`）。旧仕様の新規作成が本文を `<h1>タイトル</h1>` で始めていたため、ページのタイトルの h1 の直後に同じ文の見出しが重なって見えていた（2026-11 時点で公開 24 本中 13 本）。目次の生成は取り除いた後の本文で行うので、目次にも出ない（見出しの id `heading-N` は 1 つずつ繰り上がる）。
  - 一致は、タグを除き文字参照を復号して空白の並び（全角・半角・改行）を1つにそろえた（目次の文と同じ正規化、`headingText`）うえでの完全一致。言い換えた見出し（「Magyar(ハンガリー語)サーチクラフト」に対する「ハンガリー語サーチクラフト」など）は残す。タイトルか見出しが空なら取り除かない
  - 見るのは本文の直下の最初のブロックだけ。段組み・コールアウトなどの中の見出しは見ない（実データの先頭の見出しはすべて本文の直下にあった。公開ページの DOM で `<div>` に入って見えるのは、埋め込みの前で本文を分割したセグメントの入れ物）
  - 下書きのプレビュー（`?draft=1`）も同じ。自動翻訳の訳文では、訳文のタイトルと訳文の本文で比べるほか、**原文のタイトルと原文の本文が一致していれば訳文の先頭の見出しも取り除く**（タイトルと本文の見出しは翻訳の入力で別の要素なので、訳が食い違うことがある。訳文は本文の構造を保つので、訳文の先頭の見出しは原文の先頭の見出しの訳）
  - 保存データ・エディタの本文は変えない（作者が自分で消せる）
  - エディタでは、本文の先頭がタイトルと一致する間だけ、タイトル・概要の下に注記と「この見出しを削除」を出す（下記「エディタ基盤」の「本文の上のタイトルと概要」）
- **コールアウト**: `annotateGuideCallouts` が `role="note"` と種類名の `aria-label` を付ける
- **YouTube**: `titleGuideYouTubeIframes` が iframe に番号付きの `title`（`guideView.youtubeTitle`「YouTube 動画 {n}」。番号は本文中の出現順）と `loading="lazy"` を付ける。`splitContentAtEmbeds`（`guide-embeds.tsx`）は**本文の直下（要素の深さ 0）**の動画だけを `youtube` セグメントに分け、`YouTubeClickEmbed`（押してから youtube-nocookie.com の iframe を読み込む。サムネイルは i.ytimg.com）で描く。再生ボタンの名前は `guideView.youtubePlay`「YouTube 動画 {n} を再生」。埋め込み URL は iframe の src から `getYouTubeEmbedUrl()` で作り直し、`start` だけ引き継ぐ。src が無い（許可外ホストでサニタイズが除去した）直下の動画は描かない。再生リスト（TipTap の `/embed/videoseries?list=…`・`list` 付き）は動画 1 本の URL に直すと再生リストが失われるので、直下でも iframe のまま残す。コールアウト・トグル・段組の中の動画は、そこで切ると開閉タグが別の断片に分かれて構造が壊れるため、iframe のまま残す（従来どおり表示時に読み込む）
- **コードブロックのコピーボタン**（`useCodeCopyButtons`）: 見た目 28px、押せる範囲は `::after` で 44px。タッチ端末（`hover: none`）では常に表示し、コードの 1 行目が隠れないよう `pre` の右に余白を取る。成功すると名前を「コピーしました」（`guideView.copied`）に替え、`role="status"` の sr-only 領域でも読み上げる。原文/訳文の切替で本文が差し替わっても差し込み直す（`html` を依存に持つ）
- **表**（`useGuideTableScroll`）: 表の実幅と器（`.table-scroll-wrapper`）の幅を ResizeObserver で比べる（`isGuideTableOverflowing`、`app/lib/guide-tables.ts`。1px までの差は収まっている扱い）
  - はみ出している表は横スクロールのまま、器に `tabindex="0"`・`role="region"`・`aria-label`（`guideView.tableScrollRegion`「表（横にスクロールできます）」）を付け、キーボードで横スクロールできるようにする（フォーカスリングあり）
  - 収まっている表は器に `data-fits` を付けて `overflow: clip`（スクロール容器にしない）にし、**最初の行が全部 `th` なら見出し行をページに貼り付ける**（`position: sticky`。位置はサイトヘッダー 64px ＋ xl 未満の目次バーの実測の高さ〔`--guide-toc-bar-height`。目次バーに `data-guide-toc-bar`〕、重なりは目次バーの `z-30` より下。見出しセルの面は不透明）。`overflow: auto` の器の中では sticky がページに効かないための切り替え。はみ出す表の見出しは貼り付かない
  - JS 前（SSR）は従来どおり横スクロールの器（`data-fits` なし）。エディタ内の表には適用しない
- **フォーカス**: 本文のリンクとトグルの `summary` に `:focus-visible` のリング（`--ring`、2px。リンクは外側 2px、summary は枠の内側）
- **本文の行長制限は設けない**: 本文（段落・見出し・リスト・引用・コールアウト・トグル）はコンテナ幅（`article` 側の `max-w-5xl`）いっぱいの左寄せで表示する。一度 `max-width: 65ch`（のち 36rem 固定カラム＋中央寄せ）の行長制限を導入したが、改修前の全幅レイアウトの方がよいというユーザー判断で撤廃済み（`app/app.css` の Guide content セクションに再導入しない旨の注記あり）。なお ch 単位の制限は各要素のフォントサイズ基準のため見出しと段落で左端が階段状にずれる問題もあった

---

## 公開ページ（ルーティング）

### /guides — ガイド一覧

- 全ユーザーの公開ガイドを一覧表示（著者が公開プロフィールのもののみ）
- **グリッド表示**: カード形式で表示。カバー画像がないカードは帯（プレースホルダー）を出さず、タイトルから始める（フッター直前の `flex-1` で兄弟カードと区切り線の高さは揃う）。カバー画像の下端には `border-b border-border/60` を付け、白地の画像（国旗など）がカードの面に溶けないようにする
- **リスト表示**: リスト形式で表示。カバー画像を左端に表示（サムネイルにも `border border-border/60`）
- 表示切替が可能
- **件数とページ送り**: ローダーは絞り込み後の全件を返し、クライアントが `GuidePagedList`（`guide-paged-list.tsx`）で最初の 24 件（`GUIDE_PAGE_SIZE`）だけ描画する。残りは「もっと見る（残り n 件）」で 24 件ずつ出し、追加分の最初のカードのタイトルリンクへフォーカスを移す。24 件以下ならボタンは出ない。条件（検索語・タグ・並び順）が変わると出す件数は 24 に戻る（`key` に `searchParams`）。`/guides/:authorSlug` も同じ
- **件数表示**: 並び替えの行の左に「n 件」（絞り込み中は「n 件（検索: …、タグ: …）」）を出す（`aria-live="polite"` は件数の `<p>` だけ）。この `<p>`（`id="guide-results"`、`tabIndex=-1`）は一覧の先頭で、タグの後ろにあるスキップリンク「結果へスキップ」（フォーカス時だけ見える）の飛び先になる
- **テンプレート一覧の言語絞り込み**: 言語を選ぶと即時に絞り込む（`setSearchParams`。並び替えと同じ形で `q` / `sort` は保ち、「すべての言語」は `lang` を外す）。並び替えの行の左に件数「n 件」（絞り込み中は「n 件（検索: …、言語: …）」。`aria-live="polite"` は件数の `<p>` だけ）と、絞り込み中は「絞り込みをリセット」（検索語・言語だけ外し並び順は保つ。0件の EmptyState も同じ）を出す。適用数（`Download` アイコン＋数字）は、アイコンと数字を `aria-hidden`、`sr-only` の「適用 n回」で読ませる
- **ツールバーの組み方**（テンプレート一覧と共通）: ページ見出し＋説明文（`guides.pageDesc`）→ 検索（`role="search"`、入力欄は `aria-label`。検索ボタンは狭い画面は入力欄の右端、sm 以上は右隣）→ 絞り込み（ガイドはタグ、テンプレートは言語）→ 並び替え（→ ガイドのみ表示切替）。並び順の既定の呼び名は、ガイドが「更新順」（`updatedAt` 基準）、テンプレートが「新着順」（`createdAt` 基準）で、並べ替えに使う列が違うため別の名前のままにしている
- ガイド／テンプレートを切り替えるタブ（`ContentTabs`）の `nav` には `aria-label`（`guides.contentTabsLabel`）が付き、タブの高さはモバイル 44px（`h-11 sm:h-9`）
- **並び替え**: `?sort=` で「更新順（既定、`updatedAt` 降順）」「いいね数順（総いいね数降順）」「閲覧数順（`guides.viewCount` 累計降順）」「人気順（直近7日のページビュー降順）」の4種を切り替えられる（`ContentSortSelect`）。並び順の定義は `guideListOrderBy()`（`app/lib/likes.server.ts`）が単一情報源で、いずれも `updatedAt` → `id` でタイブレークする。検索フォームは hidden input で並び順を持ち越す。旧「おすすめ順」（`?sort=recommended`）は廃止済みで、更新順へフォールバックする。詳細は [`docs/likes.md`](./likes.md#並び替え)
  - 選択肢を開くと、各項目の下段に「何を基準に並ぶか」の1行説明（例: いいね数順→「総いいね数」、人気順→「直近7日でよく見られた順」）が表示される（`ContentSortSelect` の `descriptions`）。トリガー自体は選択中の項目名のみの1行表示のまま
  - 人気順のページビューは Vercel Web Analytics を cron で集計した `page_view_stats` を参照し、未集計時はいいね数順へ自然に落ちる。人気順を選んでいる間は、各カードに累計閲覧数の隣に直近7日PVを根拠数値として表示する（`PageViews7dMeta`。`TrendingUp` アイコン＋短いラベル「7日」/ "7d"＋数字。見た目のラベルは `aria-hidden` で、読み上げは `sr-only` の「直近7日の閲覧数」を数字の前に読む。累計は目のアイコン＋数字なので、ラベルの有無で区別する）。`page_view_stats` がまだ1件も無い（cron 未稼働・集計前）環境では、一覧上部に「閲覧データを収集中のため、現在はいいね数・更新日時順で表示しています」の注記（`guides.popularPending`）を出す
  - 検索フォームは狭い画面では縦積みになる（`flex-col sm:flex-row`）。1行のままだと検索入力が潰れる
- **カードのメタ行の読み上げ**: 閲覧数（Eye）・いいね数（静的表示の `LikeButton`）は、アイコンを `aria-hidden`、見える数字を `aria-hidden` にして `sr-only` の「閲覧 N」「いいね N 件」を読ませる（裸の数字にしない。見た目は数字のまま）
- **著者の顔**: `/guides`（カード・リスト）のメタ行は、著者名の左に `MinecraftAvatar` 20px（`rounded-md`・`alt=""`）を出す。`GuideItem.authorAvatar`（`{ uuid, skinUrl }`）を渡した一覧だけが出し、ローダーは著者の `users.uuid` / `customSkinUrl` を同じ JOIN で取る（追加クエリなし）。ホームの新着ガイドも同じ列を渡す。著者が全部同じ一覧（`/guides/:authorSlug`・走者画面のガイドタブ）はもともと著者名を出さないので顔も出さない。テンプレート一覧の行も著者名の左に同じ 20px の顔を出す
- **作成者の表記と顔（統一）**: 走者の名前を出す箇所は「作成者:」＋名前に揃え（`templates.byAuthorPrefix`。旧 `templates.byAuthor`「by {name}」は廃止）、名前の前に `MinecraftAvatar` 20px（`rounded-md`・`alt=""`）を置く。対象: テンプレート一覧の行・テンプレート詳細（loader が `users.uuid` / `customSkinUrl` を同じ関連読み込みで取る）・記事内のテンプレート埋め込み（`EmbedTemplateData` の `authorUuid` / `authorSkinUrl`。`resolveEmbedTemplates` の既存 JOIN に列を足した）・エディタのテンプレート埋め込み検索（`/api/guides/templates-search` が `authorUuid` / `authorSkinUrl` を返す）・エディタのガイドリンク検索（`/api/guides/search` が同じ2列を返す）。記事の筆者行（36px）・著者ヘッダー（44px）・「この走者のほかのガイド」（36px）は ui.md 6 章どおりの既存の寸法。保存済みのガイドリンクカード（`guide-link` ノードの HTML 属性）は名前だけで顔は出さない（属性に uuid を保存していないため）
- **テンプレート一覧の行**: sm 未満はゲーム言語（`Languages` アイコンは `text-primary`・`text-xs font-medium`）を1行目、タイトルを2行目（`line-clamp-2`）に置く。sm 以上はタイトル左・言語右の横並び（`line-clamp-1`）。両方を描いて CSS で出し分ける（非表示側は読み上げにも出ない）
- **いいね**: 各カードにいいね数を表示し、ログイン中はカード内のグッドボタンで直接いいねできる（自分のガイドは件数のみ）。詳細は [`docs/likes.md`](./likes.md)
  - カード全体のクリックは**オーバーレイのリンク**が担う。`<a>` の子孫にインタラクティブ要素を置くのは不正なHTMLのため、カード全体を `<Link>` で包む構造は使えない。リンクは**タイトル見出しの中のリンクの `::after`** をカード外枠（`group relative`）いっぱいに広げて敷く（読み上げがタイトル1回になる。サムネイルの `alt=""`・Pin は `aria-hidden`）。`line-clamp` は flex の見出しではなく内側の span に付ける
  - カードのタイトルの見出しレベルは `titleLevel`（既定 h3）。`/guides`・`/guides/:authorSlug` は h1 の直下なので h2 を渡す
- **タグの絞り込み**: タグのピルは `Badge asChild` の `Link`（`?tag=`。検索語・並び順は保ち、tag だけ入れ替える／外す）。選択中は `aria-current="true"` で、色は brand（`bg-brand text-brand-foreground`）。押せる範囲は見た目（22px のピル）を変えず `::after` で広げる（`GUIDE_TAG_HIT_AREA`、`guide-list-views.tsx`。記事のタグも共用）。狭い画面は高さ 44px・幅は文字幅か 44px の大きいほう、md（記事は sm）以上は 24px 以上。`::after` は padding box 基準なので inset ではなく `h-11` / `w-full min-w-11` で寸法を指定する。md 未満は1行の横スクロールのレール（各タグを高さ 44px の枠に入れる。選択中のタグが外にあれば初回にレール内だけをスクロールして見える位置へ寄せる）。タグの並びは並び替えに依存せず、「件数の多い順 → 同数は名前順（`localeCompare`、表示言語）」で上位 20 個（`rankGuideTags`、`app/lib/guide-tags.ts`）、md 以上は折り返し表示。モバイルの検索ボタンは入力欄右端のアイコンボタン（`sr-only` のラベル、44px）で、sm 以上は従来のボタン。検索欄・並び替え・表示切替（`ViewToggle`）はモバイルで 44px、sm 以上で縮む。検索語・タグで0件のときは EmptyState の action から絞り込み（検索語＋タグ。並び順は保つ）を解除できる

### /guides/:authorSlug — 著者別ガイド一覧

- 特定著者のガイドのみをフィルタ表示
- 著者名が h1（文字のみ。リンクにしない）。プロフィール（`/player/:slug`）へは見出し行の右の `SectionHeaderLink`（「プロフィールを見る」、モバイルは 44px のアイコン）。カードのタイトルは h2
- 身元の顔は `MinecraftAvatar` 44px（`rounded-xl`・`alt=""`。ui.md 6 章のアバターの大きさ別の角丸。ページの顔なので記事の筆者行の 36px より一段大きい）。戻るリンクは記事・テンプレート詳細と同じ `h-11 sm:h-8`
- 著者が存在しない・非公開のときの 404 は「走者が見つかりません」（`guides.userNotFound`）。「ガイド一覧」へ戻るほか「走者を探す」（`/browse`）を出す

### /guides/:authorSlug/:guideSlug — ガイド閲覧

- 個別ガイドの全文表示
- カバー画像、タイトル、著者情報、本文を表示
- 閲覧数（`viewCount`）は**ページ表示時にクライアントから `POST /api/guides/view-count` を1回送って**加算する（`GuideViewPage` の effect、`guide.id` 単位）。loader では数えない — 原文/訳文切替（`?original=1`）など同一ページ内の search param 変更でも loader が再実行され、切替のたびに水増しされるため。ドラフトプレビューは送らず、API は公開済みガイドのみ加算する。JS を実行しないクローラは数えない
- **ヘッダーの並び**: 戻る／編集 → 下書きプレビュー・非公開の通知（`rounded-xl`、warning。下記）→ タイトル h1＋要約 → **筆者の行** → タグ → 自動翻訳の注記 → カバー画像（モバイルは 2:1、sm 以上は高さ `min(40vh, 320px)` の上限付き `object-cover`・`rounded-xl`・`alt=""`＝隣の h1 と重複して読ませない。最初の1画面に本文が入るよう上限を付けている）→ 目次バー（xl 未満）→ 本文。罫線で挟んだメタ行は廃止し筆者の行へ統合した
- **非公開・下書きプレビューの通知**: 著者本人が非公開のガイドを見ているとき（`unpublished`＝`!guide.isPublished`。非公開を見せる経路は `?draft=1` の本人のプレビューだけで、`?draft=1` なしや本人以外は 404）は「非公開のガイドです。読者には見えません。」（`guideView.unpublishedPreviewNotice`）。公開済みガイドの下書きのプレビュー（`previewingDraft`）は「下書き保存した内容のプレビューを…」（`guideView.draftPreviewNotice`）。下書きが残っている非公開のガイドは両方に当たるが、「公開中の内容とは…」は当てはまらないので非公開の帯だけを出す
- **筆者の行**: 1行目は `MinecraftAvatar` 36px（`rounded-lg`・`alt=""`）＋筆者名（`/player/:slug` へのリンク）＋`@MCID`。1行目の右端（`ml-auto`。名前が折り返しても右端に残る）にいいねボタン（自分のガイドでは押せず件数のみ）とシェア（`ShareButton`。末尾と同じ。ドラフトのプレビュー中と非公開のときは出さない）を置く。非公開のときはいいねも出さない（読者が居ないので意味が無い。両方出ないときは右端の塊ごと出さない）。sm 未満はアイコン＋件数だけの高さ 44px のボタン（文字は `sr-only` で残し、読み上げ名は変えない。`LikeButton` の `compactLabel`、`ShareButton` の `compactOnMobile` ＋ `compactBelow="sm"`）、sm 以上は文字付き。2行目は「更新 {日付}」「閲覧 {件数}（ロケールの桁区切り）」だけ（閲覧数は文字のラベルで示す。アイコンだけにしない）。上下のいいねは同じ `LikesProvider` の状態を共有する
- **末尾のいいね・シェア**: 本文の直後、「この走者のほかのガイド」の前に、いいね（`LikeButton variant="detail"`）とシェア（`ShareButton`。テンプレート詳細と同じ部品。URL は `{appUrl}/guides/:authorSlug/:guideSlug`）を1行で置く（箱・欄にしない。高さはモバイル 44px）。ドラフトのプレビュー中は公開前で URL が 404 になるのでシェアだけ出さない（上の筆者行のシェアも同じ条件。いいねは出す）。非公開のガイドではシェアもいいねも出さず、行ごと出さない（`showShare` / `showLike`）。こちらは sm 未満でも文字付き
- **目次ドロワー（xl 未満）のフォーカス**: 開くと `onOpenAutoFocus` で Radix 既定（閉じるボタン）を止め、現在の項目（`aria-current="location"`）、無ければ最初の項目へフォーカスする（項目のリンクには `focus-visible` のリングがある）。閉じるボタンは `SheetContent` 既定の右上 X 1つだけで、読み上げ名は `closeLabel`（`guideToc.close`）で翻訳して渡す（`ui/sheet.tsx` の既定は "Close" のまま）。選んで閉じたあとに見出しへフォーカスを移す `onCloseAutoFocus` は従来どおり
- **タグ**は `/guides?tag=<タグ>`（一覧の絞り込みクエリ）へのリンク
- **末尾の「この走者のほかのガイド」**（`PageSection`・h2）: 筆者のアバター・名前・`@MCID`（プロフィールへのリンク）と、同じ筆者の**公開済み**のほかのガイドを更新日の新しい順に最大3件（このガイドは除く。下書き・非公開は含めない。ローダーの `otherGuides` は `slug` / `title` のみ）。見出し右に「すべてのガイド」（`/guides/:authorSlug`）。ほかのガイドが0件なら、リストと「すべてのガイド」は出さず筆者のリンクだけにし、見出しを「筆者」（`guideView.aboutAuthor`）に替える（欄・h2・`id` は保ち、筆者への導線を残す）
- **目次**（`app/components/guide-toc-nav.tsx`。xl（1280px）以上は本文左の sticky サイドバー、未満はバー＋ドロワー）: 箱を作らず、見出し「目次」（`text-sm font-semibold`）と左の細い縦線のリスト（アクティブ項目だけ線が `border-brand`）。サイドバーの置き場所は、2xl（1536px）以上は本文（`max-w-5xl` 中央寄せ）の左ガター（`w-56`）、xl〜2xl 未満はガターが狭いので本文を右へ寄せ（`xl:max-w-[74rem] xl:pl-60`、本文の幅は約 912px で 2xl の 960px と大差ない）、その左の余白（`w-52`）に置く（`guides/view.tsx`）。本文の行の長さは制限しない（全幅・左寄せ）。**折りたたみ**: 項目の最小 level の項目だけを常に出し、それより下の階層は節（最上位項目から次の最上位項目の手前まで）が開いているときだけ出す。既定では「いま読んでいる節」だけが開く（`visibleTocItems`、`app/lib/guide-toc.ts`）。ただし**最上位の項目が1つだけ**の目次（本文全体を1つの見出しの下にまとめた形。タイトルと同じ文の先頭の見出しは表示時に取り除く〔「公開表示の本文」〕ので、言い換えた見出しで始まる記事などが当たる）は、その節を既定で開く（畳むと目次が最初1行だけになるため）。この節にもシェブロンと「すべて開く／閉じる」は出し、利用者の開閉は既定より優先する。先頭の最上位より前の孤立した下位見出しの塊は従来どおり（読んでいるときだけ見える）。最上位が2つ以上の目次は変わらない。サイドバーとドロワーで同じ規則
  - **手動の開閉**: 最上位の各項目に、配下を開閉するシェブロンのボタン（`aria-expanded`・`aria-controls`・`aria-label` は `guideToc.sectionToggle`。配下が無い項目には出さない）。利用者が手で開閉した節はその操作を既定より優先する（`visibleTocItems` の `overrides`）。畳んでいる間も配下の `<ul>` は `hidden` で残す（`aria-controls` の参照先）。状態は保存せず、記事を移ると初期値に戻る（`GuideTocSidebar` / `GuideTocMobile` に `key={guide.id}`）。ボタンはサイドバー 28px、ドロワー 44px。開閉ボタンのシェブロンの回転は `motion-reduce:transition-none`、そのほかの開閉に動きは付けない
  - **現在地の判定**（`useActiveHeading`）: 見出しの上端が「貼り付く UI の下端（`:root` の `scroll-padding-top`。xl 未満は目次バーのぶん深い）＋8px」を最後に超えたものを現在地にする（以前は固定の 96px で、xl 未満では目次から移った見出しがしきい値より下に着地して現在地にならなかった）。末尾まで来たら最後の見出しを現在地にする: ページの最下部（スクロール位置は切り上げ）か、本文（`.guide-content`）の終わりが画面に入り最後の見出しも画面内にあるとき（記事の下に「他のガイド」やフッターが続くと、ページの最下部より先に本文を読み終えるため）。最初の見出しより上にいる間は現在地なし（`null`。SSR の初期値も `null`）で、モバイルのバーは「目次」だけを出し（名前も「目次」）、サイドバーはどの節も強調・自動展開しない。ページの先頭（`scrollY` が 0）では末尾の上書きもしない（1画面に収まる短い記事で、開いた直後から最後の見出しが現在地になるため）
  - **xl 未満の目次バー**: 面は不透明（`bg-background`）。モバイルはレイアウトの左右の余白まで覆う（`-mx-4`。ui.md 10 章）。バーの直前の 1px の番兵を IntersectionObserver で見て、ヘッダーの直下に貼り付いている間はバーに `data-toc-stuck="true"` を付け、`app/app.css` がその間サイトヘッダーを不透明にする（半透明のヘッダーの下に不透明なバーがあると食い違うため。走者画面の `data-stuck` とは属性を分ける。あちらは `--sticky-bar-inset` も変える）
  - **現在地の見せ方**: アクティブ見出しが畳まれた節の中にあるときは、その節の最上位項目を現在地として強調し（`aria-current="location"`、`tocDisplayedActiveId`）、目次の追従スクロールもその項目を見る
  - **すべて開く／すべて閉じる**: 配下を持つ節が1つでもあるときだけ出す。節ごとの開閉（overrides）を `tocAllSectionOverrides`（`guide-toc.ts`）でまとめて置き換える（「すべて閉じる」は読んでいる節も畳み、現在地は親の項目で示す）。サイドバーは見出し行のアイコンボタン（28px・Tooltip）、ドロワーは一覧の上の文字ボタン（高さ 44px）。overrides は `useTocOverrides` で `GuideTocSidebar` / `GuideTocMobile` が持ち、`TocList` と共有する
  - **ドロワーにも節ごとの開閉を入れた**: 30 項目の記事で、読んでいる節以外は畳まれて一覧が短くなり、別の節の下位見出しへ行きたいときも 44px のボタン1回で開けるため
  - ドロワーの項目は高さ 44px、閉じるボタン（右上の X）もモバイルは 44px、sm 以上は既定の 28px（`SheetContent` の `closeClassName`。既定の見た目は他画面と同じまま）。項目を選ぶとスクロールしたうえで、見出しへフォーカスも移す（実行時に `tabindex="-1"` を付けて `focus({ preventScroll: true })`。ドロワーは Radix のトリガーへのフォーカス復帰を `onCloseAutoFocus` で止める。リングは `.guide-content` の見出しで消す）。「動きを減らす」設定のときはスムーズスクロールにしない
- **ローダーは表示に使うフィールドだけを返す**（`guide`: id / slug / title / summary / coverImageUrl / tags / viewCount / updatedAt / sanitizedContent / likeCount、meta 用の原文 metaTitle / metaSummary、`author`: slug / mcid / uuid / displayName / customSkinUrl）。行をそのまま展開すると、著者の未公開ドラフト（`draftTitle` / `draftContent` 等）とサニタイズ前の生 `content` が全閲覧者のSSRペイロードに載るため。ドラフトプレビュー（`?draft=1`、本人のみ）では表示値にドラフトを採用するが、ドラフト列そのものは渡さない。回帰テスト: `app/routes/guides/__tests__/view.test.ts`

#### 自動翻訳の表示（`/guides/:authorSlug/:guideSlug`）

仕様の全体は [`docs/translation.md`](./translation.md)。ここでは画面側の挙動のみ。

- ローダーは公開版の原文を `getGuideTranslation()` に渡し、訳文（title / summary / 本文）が使えれば**既定で訳文を表示**する。使えない（機能無効・著者がオプトアウト・失効・未公開・原文と閲覧ロケールが同じ）ときは `null` で、従来どおり原文。**ドラフトプレビュー（`?draft=1`）では翻訳を引かない**
- 訳文の本文も原文と同じ経路（サニタイズ → 表の整形 → 目次 → 埋め込みの抽出・描画 → `guide-content`）で描画するため、キー配置・サーチクラフト・ガイドリンクの埋め込みは訳文でも同じに動く（埋め込み div は翻訳対象外で原文のまま）
- 記事上部（タグ行の下）に共通の `AutoTranslateNotice`（`app/components/auto-translate-notice.tsx`。プロフィールと共用）を出す。「自動翻訳 · 原文を表示」（文言キーは `playerProfile.autoTranslated` / `showOriginal` / `viewingOriginal` / `showTranslation`）。色は `border-info/40 bg-info/10`。誤訳が意味の反転になりうる技術記事のため、注記と原文への切替は必須要素
- **原文への切替は `?original=1`**（SSR で出し分け。共有・再読み込みでも状態が保てる）。原文表示中は「原文を表示中 · 翻訳を表示」に変わり、クエリから `original` を外すだけで訳文に戻る。他のクエリ（`draft` 等）は維持する
- 訳文があるとき（原文表示中も含む）だけローダーが `autoTranslation: { sourceLocale, showingOriginal }` を返す。無いときは `null`＝バナーを出さない
- **meta / OGP は常に原文**（クローラーには常に日本語。ローダーが `guide.metaTitle` / `guide.metaSummary` を別に返す）

#### 一覧での自動翻訳

`getGuideTranslations(db, ids, viewerLocale)` を 1 回呼び、`applyGuideTranslation()`（`app/lib/guide-translation-list.ts`）でタイトル・要約を訳文に差し替える（N+1 にならない）。差し替えた行は `autoTranslated: true` になり、`GuideCardGrid` / `GuideListView` が著者名の隣に `Languages` アイコン＋ツールチップ（`guides.autoTranslatedMark`）の小さなマーカーを出す。

- 対象: `/guides`（検索・タグ絞り込みは原文で行う）・`/guides/:authorSlug`・`/player/:slug` のガイドタブ
- ホーム（`/`）のガイドセクションも `GuideItem.autoTranslated` を受け取れる。ローダー側で同じ差し替えが必要（rankings-worker 担当）

### 404（ガイド記事・著者・テンプレート詳細）

`/guides/:authorSlug`・`/guides/:authorSlug/:guideSlug`・`/guides/templates/:templateId` は、自ルートに `ErrorBoundary`（`app/components/guide-route-not-found.tsx` の `GuideRouteNotFound`）を持つ。404 のときだけ「見つかりません＋一覧へ戻る」を出し（記事の 404 で著者が実在し本人以外にも見える場合は、loader が `data({ authorSlug, authorName }, { status: 404 })` で slug と表示名を載せ、「{名前}のガイド」〔`/guides/:authorSlug`〕のリンクも出す。著者が存在しない・非公開のときは載せず、代わりに「走者を探す」〔`/browse`。`showFindRunner`。著者ページの 404 も同じ〕を出す）。タイトルは h1（`EmptyState` の `titleAs="h1"`。既定は `p`）、操作ボタンはモバイル 44px（`min-h-11 sm:min-h-9`）、それ以外のエラーは root へ投げ直す。ルート自身が境界になることで、その route の `meta`（「見つかりません - Minefolio」系のタイトル）が使われる。サイト全体の 404（`app/root.tsx`）は別。

### /guides/templates/:templateId — テンプレート詳細のモバイル構成

本題のサーチクラフトの節を先に置き、リマップ（鍵盤）の節は後ろに置く。サーチクラフトの一覧は記事内の埋め込みと同じ開閉と枠（`framed={false}`・グループ見出しは h3・グループが 2 つ以上なら開閉・lg 以上は全部開いて、lg 未満は先頭のグループが 10 件以下ならそれだけ開いて始める・閉じた本体も `hidden="until-found"` で残す）。見出しの隣の「Loop n件」のピルは `HintTip` で何を数えているか（繋ぎ方の数。各タイミングのグループの中に出る）を説明する（名前は見えている文字から始まる説明文）。リマップの鍵盤は md 未満で既定「閉」の開閉（`aria-expanded`）で、md 以上は常に表示。ページ先頭に、フォーカス時だけ見えるスキップリンク「サーチクラフトへ移動」を置く。

アイテム名は既定でテンプレートのゲーム言語（未設定は日本語）のまま表示する。サーチクラフトの節の先頭（凡例の上）に、走者画面のサーチクラフトタブと同じ「アイテム名を{言語}で表示」のスイッチ（`playerProfile.searchCraftItemNamesIn`、モバイルは 44px）があり、オンにすると `SearchCraftGroupedList` の `gameLanguage` に `itemLangForLocale(locale)` を渡す。テンプレートの言語が閲覧者の言語と同じときはスイッチを出さない。状態は保存せず、別のテンプレートへ移るとオフに戻る。ガイド本文の埋め込み（`guide-embeds.tsx`）にはない。

### 著者slugの解決（`/guides/:authorSlug`・`/guides/:authorSlug/:guideSlug` 共通）

`users.slug` の照合は `/player/:slug` と同じ大文字小文字無視の完全一致で、一致しなければ404を
投げる直前に `resolvePlayerSlugFallback(db, authorSlug)`（slug_history → Mojang API の2段）を
試み、解決できれば現slugへ302リダイレクトする（記事slug・クエリ文字列は維持）。private な著者は
フォールバック対象外。詳細なポリシー・救済できる/できないケースは
[`docs/profiles.md`「スラッグ解決とフォールバックリダイレクト」](./profiles.md#スラッグ解決とフォールバックリダイレクト)を参照。
ガイド記事本体の `slug`（`guides.slug`）は保存時に小文字正規化された別スコープの値で、この
フォールバックの対象外（完全一致のまま）。

---

## 管理ページ（ルーティング）

`/me` 配下から切り離され、`/my-guides` 系として独立したルートになっている。ヘッダーのユーザードロップダウン（「設定」の直下）からアクセスできる。

### /my-guides — 自分のガイド一覧

- ログインユーザーが作成した全ガイド（公開・非公開含む）を表示
- 説明文の隣に、書き方の手引き（公式ガイド `/guides/bfmkn/guide-writing-guide`、`GUIDE_WRITING_GUIDE_PATH`）へのリンク。新しいタブで開き、外部リンクのアイコンと sr-only の「（新しいタブで開きます）」で伝える。ガイドが無い環境（ローカル DB）ではリンク先が 404 になるだけ
- 削除の確認ダイアログの実行ボタンは destructive（`buttonVariants({ variant: "destructive" })`）。削除ボタンのスピナーは、そのガイドの削除（`_action === "delete"`）を送っている間だけ回す（ピン留めも同じ fetcher・同じ `guideId` で送るため、`guideId` だけでは回ってしまっていた）
- 0 件のときは見出し横の「新規」ボタンを出さない（空状態の action に同じボタンがあるため。テンプレート管理も同じ）
- 各行の状態は ui.md 6 章の丸ピル（`StatusPill`。エディタの公開状態のピル `PublishStatusPill` と同じ見た目・同じ語）。公開中は「公開中」（Globe）、非公開は「非公開」（Lock、`meGuides.statusPrivate`。以前の「下書き」はエディタ・プレビューの帯の「非公開」と食い違っていたのでそろえた）。どちらも muted（brand は選択中・進行だけ。ui.md 1 章）
- 公開中のガイドに下書き保存した未公開の変更（`draftUpdatedAt` が null でない）があるときは、警告色の丸ピル「未公開の変更あり」（`meGuides.statusUnpublishedChanges`）を添える。非公開のガイドに残っている下書き（下書き保存が非公開のガイドにも出ていた頃のもの）では出さない（読者に見える公開版が無く「未公開」の区別に意味が無い。エディタの `draftBannerUnpublished`・プレビューの帯で非公開の帯だけを出すのと同じ扱い）

### /my-guides/new — 新規作成

- タイトルと **URL（スラッグ）** を入力して空のガイドを作り、`/my-guides/{slug}/edit` へ遷移する
- 本文は空の段落（`<p></p>`）で始める。タイトルはガイド設定と公開ページの h1 が持つ（以前は `<h1>タイトル</h1><p></p>` で始めていて、公開ページでタイトルが重なっていた。既存の記事は表示時に取り除く。上記「公開表示の本文」）。空の本文には、エディタの案内「本文を書く。/ でブロックや埋め込みを挿入」（`guideEditor.contentPlaceholder`）が出る
- 構成は他の管理ページ（`/my-guides/templates/new`）と同じ「戻るリンク（`/my-guides`）＋ h1 ＋ 説明 ＋ フォーム」。カードには入れない
- ページの `<title>` は「新しいガイドを作成 - Minefolio」
- **スラッグは必須入力**。タイトルからの自動生成は行わない（日本語のみのタイトルは `normalizeSlug()` で空になり、`guide-<ランダム6文字>` のような意味のないURLで公開されてしまうため）
  - 入力欄は `softNormalizeSlug()` でタイプ中に許可外文字を落とすため、日本語だけを打つと空のままになり、`required` でそのまま送信できない
  - サーバー側でも `normalizeSlug()` 後に空なら `errorSlugRequired`、同一著者内で重複していれば `errorSlugTaken` を返す（重複時に連番・乱数を自動付与しない）
  - `/guides/{authorSlug}/{slug}` のプレビューを入力欄の下に表示する（編集画面の設定モーダルと同じ体裁）

### /my-guides/:guideSlug/edit — 編集

- 既存ガイドの編集画面（`(authorId, slug)` で本人のガイドを特定）
- **独立レイアウト**: `me/_layout` のサイドバーに依存しないフルスクリーン編集画面
- タイトル/本文/サマリー/タグ inputs はブラウザ標準の綴りバリデーション（`spellcheck`）を無効化
- ツールバーの面は不透明（`bg-background`）。エディタではサイトヘッダーも不透明にする（`:root:has([data-editor-toolbar]) header.sticky`、`app/app.css`。ヘッダーだけ半透明だと、その下の不透明なツールバーと食い違うため）
- **URL（スラッグ）の編集**: 設定モーダルの「URL」欄で変更できる。下書き保存・保存いずれの保存でも即反映される（`slug` はライブ列）。
  - 保存時、`normalizeSlug()` で正規化した値が現在と異なれば、同一著者内での重複を確認する。重複時は `meGuides.errorSlugTaken` を返し、その保存自体を中止（トースト表示、他フィールドも保存されない）。正規化結果が空なら `meGuides.errorSlugRequired`。
  - スラッグ変更に成功すると、action は新しい `slug` を返し、クライアントは `/my-guides/{新slug}/edit` へ `navigate(replace)` する（同一ルートのためエディタは再マウントされず、編集中の本文・状態は保持される）。
  - 旧スラッグからのリダイレクトは行わない（旧URLは404になる）。
  - action の戻り値は素の object（`{ success, mode, slug }` / `{ error }`）。`hooks/use-guide-save.ts` が `fetcher.data` として受け取り、宿主（`index.tsx`）がトースト表示とURL差し替えを行う。

### 自動翻訳の許可と翻訳フック（編集 action）

- 設定モーダルの「自動翻訳を許可する」スイッチ（既定オン、`guides.allowAutoTranslation`）。説明文で、翻訳に外部サービス（Anthropic）を使うこと・オフにすると既存の翻訳も削除されることを伝える
- 自動翻訳の機能が無効（`ANTHROPIC_API_KEY` 未設定）のときはこのスイッチを表示しない。loader が `translationEnabled`（`isTranslationEnabled()` の真偽値）をエディタへ渡し、無効時は下書き保存・保存とも `allowAutoTranslation` を送らない（サーバーは保存済みの値のまま残す）
- フォームは `allowAutoTranslation`（`"true"` / `"false"`）を下書き保存・保存のどちらでも送る。サーバーは `"true"` / `"false"` 以外を拒否し（`errorInvalidAction`）、未送信なら列を上書きしない。ライブ列なので下書き保存でも反映する（スラッグと同じ）
- 保存成功後の分岐（有効値 = 送信値 ?? 現在値）:
  - **false** → `removeGuideTranslations()` を await（機能無効でも消す）。翻訳は依頼しない
  - **true** かつ（保存〔publish〕、またはオフ→オンに戻した保存）→ `scheduleGuideTranslation()`（`waitUntil`。レスポンス後に走り、失敗しても保存結果に影響しない）。公開版を書き換えない**下書き保存では、許可を戻したとき以外は翻訳しない**（ドラフトは翻訳対象外）
- `/my-guides/new` は非公開で作成するため翻訳しない。公開版の更新は `/my-guides/:guideSlug/edit` の publish のみ

### 公開ガイド表示時の編集導線

- `/guides/:authorSlug/:guideSlug` でログイン中ユーザーがそのガイドのオーナーの場合、ページ上部に編集ボタンが表示され `/my-guides/:guideSlug/edit` へ遷移できる

### APIエンドポイント

| エンドポイント | メソッド | 説明 |
|----------------|----------|------|
| /api/me/guides/upload-image | POST | 画像アップロード（Vercel Blob保存） |
| /api/guides/search | GET | ガイド検索 |
| /api/guides/templates-search | GET | サーチクラフトテンプレート検索（ガイドエディタの埋め込み用） |
| /api/guides/embed-resolve | GET | リマップ / サーチクラフト埋め込みの走者の解決（`?user=` slug か MCID。公開ページと同じ規則。`{ user: EmbedUserData \| null }`〔要約に使う項目だけ〕、`Cache-Control: private, no-store`） |

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
- `app/lib/official-guides.ts` — 公式ガイドへのパス（書き方の手引き `GUIDE_WRITING_GUIDE_PATH`。マイガイドとエディタのツールバーから使う）

### コンポーネント

- `app/components/guide-editor/index.tsx` — TipTapガイドエディタ
- `app/components/guide-list-views.tsx` — ガイド一覧のグリッド/リスト表示
- `app/components/status-pill.tsx` — 状態の丸ピル（`StatusPill`。ui.md 6 章「丸ピル」。`icon` で先頭アイコン、`tone="warning"` で未保存などの警告色。マイガイド・テンプレート管理・テンプレート詳細・エディタの公開状態で使う）
- `app/components/notice-banner.tsx` — 通知帯（`NoticeBanner`。`tone` = `warning` / `success` / `error` / `info`、`rounded-xl`・`text-sm`・意味色の面 /10 と枠。非公開プレビューの帯・エディタの下書きバナー・テンプレート反映後の成功帯・アップロード失敗で使う。ガイド固有ではなく他画面から使ってよい）
- `app/components/guide-list-views.tsx` の `GuideListSkeleton` — 一覧の読み込み中スケルトン（カード / リストの本物と同じ配置、`aria-hidden`）
- `app/components/guide-embeds.tsx` の `EmbedUnavailable` — 埋め込みを出せないときの箱（`variant="empty"` 実線＝まだ設定していない、`"missing"` 破線＝見つからない・表示できない）
- `app/components/guide-paged-list.tsx` — 24 件ずつ出す「もっと見る」付きの一覧（`GuidePagedList`）
- `app/components/auto-translate-notice.tsx` — 自動翻訳の注記と原文切替（ガイドは `to`＝`?original=1` のリンク、プロフィールは `onToggle`）
- `app/lib/guide-translation-list.ts` — 一覧行へ訳文を適用する純関数（`applyGuideTranslation`）

### API

- `app/routes/api/me/guides/upload-image.ts` — 画像アップロードAPI
- `app/routes/api/guides/search.ts` — ガイド検索API
- `app/routes/api/guides/templates-search.ts` — サーチクラフトテンプレート検索API（埋め込み用）
- `app/routes/api/guides/embed-resolve.ts` — リマップ / サーチクラフト埋め込みの走者の解決API（エディタ用）
- `app/lib/guide-embed-users.server.ts` — 埋め込みの走者の解決（公開ページと上の API で共用）
- `app/lib/guide-embed-data.ts` — 埋め込みが出すデータの選び方と、エディタ用の要約
