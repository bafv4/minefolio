# `/me` 共通（レイアウト・保存バー・はじめにガイド）

`/me/*` 全画面に共通する土台。担当ファイルは `app/routes/me/_layout.tsx`、`app/components/floating-save-bar.tsx`、
`app/components/me/`、`app/lib/me-guide.ts`・`me-tour.ts`・`me-checklist.server.ts`。

## レイアウト（`_layout.tsx`）

- 左にサイドバー、右に `<Outlet />`。`<main>` はサイト共通レイアウト（`routes/_layout.tsx`）の 1 つだけで、ここは `div`。
- サイドバーの項目名は各画面の h1（`meXxx.pageTitle`）と同じ文言にそろえる（短い方）。
- 項目は主の群（プロフィール編集 `/me/edit`・記録・プレイスタイル・キー配置・デバイス・アイテム配置・サーチクラフト）と、区切り線の下の補助の群（プリセット・インポート・公開とアカウント `/me/account`）。`/me/account` は公開範囲・既定タブ・表示設定・旧データ取り込み・アカウント削除のページ（担当は profiles-worker。[保存方式](./profiles.md#medit-の保存方式保存バーでの一括保存)）。
- 現在地は brand（`text-brand bg-brand/10`、ヘッダーの現在ページと同じ）。`NavLink` が `aria-current="page"` を付ける。
- md 未満はリンク・開閉ボタン・共有ボタンの高さを 44px（`min-h-11`）にする。

## 保存バーと未保存離脱の警告（`FloatingSaveBar`）

保存バーが出る画面は、バー自体が未保存のまま離れるのを止める（アプリ内遷移は確認ダイアログ、タブ閉じ/リロードは beforeunload）。
`dirty = hasChanges && !isSubmitting` なので、保存中は止めない。pathname が変わらない遷移も止めない（`useUnsavedWarning` と同じ）。

- 確認ダイアログ（`UnsavedChangesDialog`）は主ボタン「保存して移動」・「編集を続ける」・「保存せず離れる」（outline＋destructive 文字色。データを失う操作は主ボタンにしない）。
  「保存して移動」は `onSave` を呼び、送信（`isSubmitting`）の立ち上がりを待つ。送信が終わってから未保存が解消すれば `blocker.proceed()`
  （画面側は保存結果を受けた後の effect で下書きの基準を入れ替えるので、送信終了のレンダーではまだ未保存のことがある。最大 1 秒待つ＝`SAVE_SETTLE_TIMEOUT_MS`）、
  1 秒待っても未保存が残る（保存に失敗した）／1.5 秒経っても送信が始まらない（画面側の事前検証で止まった）ときは `blocker.reset()` で閉じて画面のエラーを見せる。
  保存中はボタンを無効にし「保存して移動中...」と表示、Esc でも閉じない。guide-editor は `onSave` を渡さず、従来の2択のまま。
- 保存バーの面は不透明の `bg-card`、枠は中立の `border-border/70`（「未保存」バッジの `text-warning` を全テーマで 4.5:1 以上に保つ。
  warning/10 を card に重ねて light 4.65・dark 5.58・ultra-dark 5.85）。
- バーが見えている間（`aria-hidden="false"`）は `app/app.css` が `--save-bar-inset`（モバイル 8.75rem・sm 以上 6.5rem）を `--bottom-fixed-inset` に足し、
  body の `padding-bottom` と `scroll-padding-bottom` に効かせる。Tab で移った欄がバーの裏に隠れない（WCAG 2.4.11）。
- 既定で有効。`useBlocker` は 1 ルーターに 1 つしか効かないため、自前で `useUnsavedWarning` + `UnsavedChangesDialog` を
  持つ画面は `<FloatingSaveBar unsavedGuard={false} />` を渡して二重にしない（現在は該当なし。`/me/*` の保存バーのある画面はすべて保存バー側に移した）。
- 自前の分を外して移行するには、その画面から `useUnsavedWarning` の呼び出しと `<UnsavedChangesDialog />` を消し、
  `unsavedGuard={false}` を削除する。

## はじめにガイド

オーナーの決定: 「ツアーとチェックリストの両方」「閉じた・見たことは DB に保存」。

| 何 | 保存先 | 記録する経路 |
|---|---|---|
| 初回ツアー | `users.me_tour_completed_at` | `POST /api/me/guide`（フォーム値 `kind=tour`） |
| チェックリストを閉じた | `users.me_checklist_dismissed_at` | 同（`kind=checklist`） |

`POST /api/me/guide` は認証必須（`requireApiUser`）。`kind` は `tour` / `checklist` のみ（それ以外は 400）、自分の行だけを現在時刻で更新する。

### ツアー（`components/me/me-tour.tsx`、手順は `lib/me-tour.ts`）

- `me_tour_completed_at` が null のとき、`/me` 配下のどの画面でも最初の 1 回だけ出す。終える・スキップ・Esc で記録し、二度と出ない。
  導入前から存在するユーザーにも 1 回だけ出る（バックフィルしない）。
- 吹き出しは Radix Popover の**非モーダル**（`modal={false}`）。背景のスクロール・操作は止めず、スクロールしても吹き出しは対象に追従する。
  フォーカスは見出しへ移る（背景へも移せる）。Esc で終える。外側クリックでは閉じない（誤タップで二度と出なくなるため）。
  `prefers-reduced-motion` ではアニメーションを切る。画面外には出ない（collisionPadding）。
- 手順の対象は `data-me-tour="<名前>"` 属性で指す。見えていない（`display:none` / サイズ 0 / `aria-hidden` 配下）・無い対象の手順は飛ばす。
  - `sidebar`（lg 以上のナビ一覧）／ `sidebar-toggle`（lg 未満の開閉ボタン）／ `identity`（サイドバー上部の名前と共有）／ `save-bar`（`FloatingSaveBar` が付ける）は共通部分が持つ
  - **`edit-form`** は `/me/edit` が付ける（プロフィール入力の先頭のカードなど、画面より小さめの要素に）。無い画面では飛ばす
  - 保存バーの手順は、`[data-me-tour="save-bar"]` が DOM にある画面（`FloatingSaveBar` を描く画面）だけで出す。
    変更が無いあいだ `aria-hidden` でも、存在すれば指す。その間は `[data-me-tour-active]` の CSS がバーを一時的に見える状態（不透明・位置は本来の位置）にして指す
    （透明のまま空所を指さない。操作は不可のまま。手順は飛ばさない）。保存バーの無い画面（/me/import・/me/presets など）では手順ごと飛ばす
    （画面下の中央を指す fallback は廃止）。文言は「変更は画面下の保存バーで確定」とだけ言い、反映のタイミングは約束しない

### 共通レイアウトの挙動（`routes/me/_layout.tsx`、`components/floating-save-bar.tsx`）

- lg 未満では、メニュー開閉ボタン（現在のページ名）と開いたメニューを1つの帯（`data-me-nav-bar`）にして、ヘッダー直下
  （`top-[64px]`、z-30、不透明背景）に貼り付ける。長いキー配置の途中からでも最上部へ戻らずに別の画面へ移れる。
  開いたメニューは帯の中で縦にスクロールする。lg 以上は従来のサイドバー（`top-24` で追従）。
  `app/app.css` で /me の lg 未満だけ `--sticky-bar-inset` を 8.5rem にしている（アンカー・フォーカス移動が帯に隠れない）。
- 保存バーの「取消」は `ghost` の副次操作。モバイルでは左端に小さく置き、広い「保存」から離す（押し間違いで破棄しにくくする。
  タップ領域は 44px のまま）。元に戻すトーストは各画面の状態に依存するため設けない。

### チェックリスト（`components/me/me-checklist.tsx`）

- `/me/edit` の h1 の下に `<MeChecklist />` を置く。データは `_layout` の loader が `checklist` として返す
  （閉じ済み・全手順完了なら `null`＝出さない）。判定は純粋関数 `computeMeChecklist`（`lib/me-guide.ts`）、集計は `me-checklist.server.ts`。
- 手順と済みの判定: MCID（Java/Bedrock いずれか）／キー配置（`keybindings` が 1 件以上）／デバイス（`player_configs` の
  キーボード・マウス・感度・コントローラー設定のいずれか）／記録（`category_records` が 1 件以上）／プレイスタイル（バージョン・カテゴリ・ホットバー切替のいずれか）。
- 記録の送信（ツアー完了・チェックリストを閉じる）は `recordMeGuide`（`lib/me-guide.ts`）の素の `fetch` POST。`useFetcher().submit` は
  表示中の子ルート（records・keybindings 等）の loader まで再検証させるため使わない。表示の消去はローカル状態で行う。
- ツアーの吹き出しは手順が変わるたびに見出しへフォーカスを移して読み上げさせる（`aria-live` は付けない）。
