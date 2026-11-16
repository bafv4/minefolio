# `/me` 共通（レイアウト・保存バー・はじめにガイド）

`/me/*` 全画面に共通する土台。担当ファイルは `app/routes/me/_layout.tsx`、`app/components/floating-save-bar.tsx`、
`app/components/me/`、`app/lib/me-guide.ts`・`me-tour.ts`・`me-checklist.server.ts`。

## レイアウト（`_layout.tsx`）

- 左にサイドバー、右に `<Outlet />`。`<main>` はサイト共通レイアウト（`routes/_layout.tsx`）の 1 つだけで、ここは `div`。
- サイドバーの項目名は各画面の h1（`meXxx.pageTitle`）と同じ文言にそろえる（短い方）。
- 現在地は brand（`text-brand bg-brand/10`、ヘッダーの現在ページと同じ）。`NavLink` が `aria-current="page"` を付ける。
- md 未満はリンク・開閉ボタン・共有ボタンの高さを 44px（`min-h-11`）にする。

## 保存バーと未保存離脱の警告（`FloatingSaveBar`）

保存バーが出る画面は、バー自体が未保存のまま離れるのを止める（アプリ内遷移は確認ダイアログ、タブ閉じ/リロードは beforeunload）。
`dirty = hasChanges && !isSubmitting` なので、保存中は止めない。pathname が変わらない遷移も止めない（`useUnsavedWarning` と同じ）。

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
- 吹き出しは Radix Popover（modal）。フォーカスは吹き出しへ移り、背景は読み上げから外れる。外側クリックでは閉じない。
  `prefers-reduced-motion` ではアニメーションを切る。画面外には出ない（collisionPadding）。
- 手順の対象は `data-me-tour="<名前>"` 属性で指す。見えていない（`display:none` / サイズ 0 / `aria-hidden` 配下）・無い対象の手順は飛ばす。
  - `sidebar`（lg 以上のナビ一覧）／ `sidebar-toggle`（lg 未満の開閉ボタン）／ `identity`（サイドバー上部の名前と共有）／ `save-bar`（`FloatingSaveBar` が付ける）は共通部分が持つ
  - **`edit-form`** は `/me/edit` が付ける（プロフィール入力の先頭のカードなど、画面より小さめの要素に）。無い画面では飛ばす
  - 保存バーの手順は、バーが出ていない間（通常）は画面下の中央を指す

### チェックリスト（`components/me/me-checklist.tsx`）

- `/me/edit` の h1 の下に `<MeChecklist />` を置く。データは `_layout` の loader が `checklist` として返す
  （閉じ済み・全手順完了なら `null`＝出さない）。判定は純粋関数 `computeMeChecklist`（`lib/me-guide.ts`）、集計は `me-checklist.server.ts`。
- 手順と済みの判定: MCID（Java/Bedrock いずれか）／キー配置（`keybindings` が 1 件以上）／デバイス（`player_configs` の
  キーボード・マウス・感度・コントローラー設定のいずれか）／記録（`category_records` が 1 件以上）／プレイスタイル（バージョン・カテゴリ・ホットバー切替のいずれか）。
- 記録の送信（ツアー完了・チェックリストを閉じる）は `recordMeGuide`（`lib/me-guide.ts`）の素の `fetch` POST。`useFetcher().submit` は
  表示中の子ルート（records・keybindings 等）の loader まで再検証させるため使わない。表示の消去はローカル状態で行う。
- ツアーの吹き出しは手順が変わるたびに見出しへフォーカスを移して読み上げさせる（`aria-live` は付けない）。
