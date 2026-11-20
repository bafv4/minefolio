# `/me` 共通（レイアウト・保存バー・はじめにガイド）

`/me/*` 全画面に共通する土台。担当ファイルは `app/routes/me/_layout.tsx`、`app/components/floating-save-bar.tsx`、
`app/components/me/`、`app/lib/me-guide.ts`・`me-tour.ts`・`me-checklist.server.ts`。

## レイアウト（`_layout.tsx`）

- `middleware` が配下の loader と action の前に登録完了を確認する（未登録は `/onboarding`。仕組みは [auth.md](./auth.md#me-の保護ルートのミドルウェア)）。`/api/me/*` は対象外。

- 左にサイドバー、右に `<Outlet />`。`<main>` はサイト共通レイアウト（`routes/_layout.tsx`）の 1 つだけで、ここは `div`。
- サイドバーの項目名は各画面の h1（`meXxx.pageTitle`）と同じ文言にそろえる（短い方）。
- 項目は見出し付きの3群（`role="group"`＋`aria-labelledby`）: 「プロフィール」（`meLayout.groupProfile`。プロフィール編集 `/me/edit`・記録・プレイスタイル＝プリセットに属さない画面）、「プリセットごとの設定」（`meLayout.groupPreset`。キー配置・デバイス・アイテム配置・サーチクラフト＝編集中のプリセットに保存され、`PresetSelector` がある画面）、「管理」（`meLayout.groupManage`。プリセット・インポート・公開とアカウント `/me/account`）。並び順は従来のまま、群の境目だけを「プリセットに保存されるか」で引く（以前の区切り線はプロフィールのホットバーと同じ「人物系 | セットアップ系」で、プレイスタイルの前にあった）。`/me/account` は公開範囲・既定タブ・表示設定・旧データ取り込み・アカウント削除のページ（担当は profiles-worker。[保存方式](./profiles.md#medit-の保存方式保存バーでの一括保存)）。
- 現在地は brand（`text-brand bg-brand/10`、ヘッダーの現在ページと同じ）。`NavLink` が `aria-current="page"` を付ける。
- md 未満はリンク・開閉ボタン・共有ボタンの高さを 44px（`min-h-11`）にする。
- lg 未満はサイドバー上部の身元（名前・@MCID・共有）を1行に詰める（共有ボタンは押せる高さ 44px を負のマージンで保ったまま行の高さを取らない）。開閉バーの上でページの h1 を押し下げないため。

## 保存バーと未保存離脱の警告（`FloatingSaveBar`）

保存バーが出る画面は、バー自体が未保存のまま離れるのを止める（アプリ内遷移は確認ダイアログ、タブ閉じ/リロードは beforeunload）。
`dirty = hasChanges && !isSubmitting` なので、保存中は止めない。pathname が変わらない遷移も止めない（`useUnsavedWarning` と同じ）。

- 確認ダイアログ（`UnsavedChangesDialog`）は主ボタン「保存して移動」・「編集を続ける」・「保存せず離れる」（outline＋destructive 文字色。データを失う操作は主ボタンにしない）。
  「保存して移動」は押した時点の `saveResult` の参照を覚えて `onSave` を呼び、送信（`isSubmitting`）の立ち上がりを待つ。
  各画面は保存に使う fetcher の `data` を `saveResult`、その成否を `saveSucceeded` として `FloatingSaveBar` に渡す（保存の送信が完了するたびに新しい参照になること）。
  送信が終わったとき `saveResult` が押した時点と別の参照なら、その保存の結果が届いたとみなし、`saveSucceeded` が true なら `blocker.proceed()`、false なら `blocker.reset()`。
  **未保存（`hasChanges`）は見ない**: 保存が失敗しても再検証で loader が変わり下書きが捨てられる（別タブでプリセットが切り替わっていた等）と未保存が消えるため、
  それを成功と取り違えて移動してしまう。送信が終わっても `saveResult` が同じ参照のままなら最大 1 秒待ち（`SAVE_SETTLE_TIMEOUT_MS`）、届かなければ `reset`。
  1.5 秒経っても送信が始まらない（画面側の事前検証で止まった）ときも `reset` で閉じて画面のエラーを見せる。
  `FloatingSaveBar` ではこの2つは必須（`/me` の8画面すべてが渡す）。`UnsavedChangesDialog` を直接使い、どちらも渡さない呼び出し側だけが、送信後に未保存が解消したかで成功を推定する。
  保存中はボタンを無効にし「保存して移動中...」と表示、Esc でも閉じない。guide-editor は `onSave` を渡さず、従来の2択のまま（2択でも「保存せず離れる」は outline＋destructive 文字色。主ボタンにしない）。
- 保存バーの面は不透明の `bg-card`、枠は中立の `border-border/70`（「未保存」バッジの `text-warning` を全テーマで 4.5:1 以上に保つ。
  warning/10 を card に重ねて light 4.65・dark 5.58・ultra-dark 5.85）。
- バーが見えている間（`aria-hidden="false"`）は `app/app.css` が `--save-bar-inset`（モバイル 8.75rem・sm 以上 6.5rem）を `--bottom-fixed-inset` に足し、
  body の `padding-bottom` と `scroll-padding-bottom` に効かせる。Tab で移った欄がバーの裏に隠れない（WCAG 2.4.11）。
- lg 以上の `/me` は本文の列がサイドバー（16rem＋gap 2rem）の分だけ右にあるので、バーは `translate-x-[var(--save-bar-shift,0px)]` で半分（9rem）右へずらして
  本文の列の中央に揃える。`--save-bar-shift` は `app.css` が lg 以上かつ `[data-me-tour="sidebar"]` がある画面だけで解決する（サイドバー幅・gap を変えたら合わせる）。
- 「トップへ戻る」は `bottom-[calc(1.5rem+var(--bottom-fixed-inset,0px))]`。保存バーが見えている間はその上に出て、保存ボタンの右端と重ならない。
- 「取消」（`onReset`）は誤タップで全損しうるので、画面は元に戻せる形で渡せる。`onReset` の型は `() => void | (() => boolean)`。
  下書きを破棄する前にその内容を取っておき、**それを戻す関数（戻せたら `true`）を返す**と、トーストに「元に戻す」（`common.undo`、8 秒）が付く。
  押すと返した関数が呼ばれ、`true` のときだけ `common.changesRestored` のトーストを出して保存ボタンへフォーカスを移す（戻した後は `hasChanges` が真に戻り、バーが再び出る）。
  `false`（戻せない）のときは部品が `common.undoUnavailable` を出す（画面側で toast.error を出さない）。
  部品は次の場合に戻す関数を呼ばず `common.undoUnavailable` を出す: 取り消した後に別の編集をした（`hasChanges` が真）／FloatingSaveBar がアンマウント済み。
  また、アンマウント時に「元に戻す」のトーストを閉じる（ページをまたいで残らない）。
  何も返さない画面は従来どおり（action なし）。部品は復元方法を知らない。
  ```tsx
  onReset={() => {
    const prev = draft;          // 破棄の前の下書きを取っておく
    setDraft(initial);           // 破棄
    return () => {               // 戻す関数: 戻せたら true
      if (!canRestore(prev)) return false;
      setDraft(prev);
      return true;
    };
  }}
  ```
- 離脱確認ダイアログのボタンはモバイルで高さ 44px（`max-sm:min-h-11`、消費側で指定）。
- 既定で有効。`useBlocker` は 1 ルーターに 1 つしか効かないため、自前で `useUnsavedWarning` + `UnsavedChangesDialog` を
  持つ画面は `<FloatingSaveBar unsavedGuard={false} />` を渡して二重にしない（現在は該当なし。`/me/*` の保存バーのある画面はすべて保存バー側に移した）。
- 自前の分を外して移行するには、その画面から `useUnsavedWarning` の呼び出しと `<UnsavedChangesDialog />` を消し、
  `unsavedGuard={false}` を削除する。

## 再検証と下書きの同期（`useLoaderSyncedDraft`）

`/me/keybindings` `/me/devices` `/me/items` `/me/search-craft` は、loader の値から画面ローカルの下書きを作る。
`PresetSelector` は未変更の間、タブ復帰（focus / visibilitychange）で loader を再検証する（別タブでのプリセット切替の検知）。
「戻る → 応答が返る前に編集」の順でも編集が消えないよう、下書きの同期は次の規則に従う
（`app/hooks/use-loader-synced-draft.ts`、判定は純粋関数 `resolveSyncedDraft`〔`app/lib/loader-synced-draft.ts`〕）。

- loader の値（source）が変わったとき、**下書きが前回の基準値と同じ（＝未変更）のときだけ新しい値で置き換える**。編集済みなら下書きを残し、基準値（base）だけを新しい値へ進める。比較は既定で JSON 文字列の一致
- 置き換えは**レンダー中**に行う（effect にしない）。置き換え前の値が 1 フレーム描かれない
- フックの `syncToken` に「**最後に成功した保存の結果**の参照」（`successfulSaveToken(fetcher.data)`。失敗の結果・未保存は null）を渡す。未消費のトークンがある状態で source が変わったレンダーでは**編集済みでも**置き換え（サーバーで正規化された値・新規行に採番された id に揃える）、同じレンダーで「消費済み」を state に記録する。保存結果と loader の再取得結果が同じコミットで届いても別々に届いても、強制はちょうど 1 回だけ効く（effect のタイミングに依存しない）。失敗した保存の後の再検証・タブ復帰の再検証（トークンが同じ／null）では効かず、編集済みの下書きは残る。`/me/keybindings` は `syncToken` を使わず、保存成功時に再検証後の値へ直接そろえる
- **プリセットが変わったら、編集済みでも必ず置き換える**。各画面は `useLoaderSyncedDraft(source, { resetKey: activePreset?.id ?? null })` を呼び、`resetKey` が変わったとき新しい値で置き換えて基準値も進める（`resolveSyncedDraft` の `prevKey` / `nextKey`）。別タブで編集先を切り替えたあとに、旧プリセットの内容が新しいプリセットへ保存される事故（保存時の `presetId` は loader の最新のアクティブIDなので、`staleSession` では防げない）を避けるため。不変条件: 「プリセット A で読み込んだ下書きは、`presetId=B` では保存できない」（`use-loader-synced-draft.test.tsx`）
- 未変更の間にプリセットが切り替わる通常の場合も、同じ規則で置き換わる。source は参照が安定していること（`useMemo`）
- `/search-craft` は crafts と loops の 2 つの hook を同じ `resetKey` で揃える（Loop が旧 craftId を指したまま残らない）
- `/me/keybindings` は hook 以外の下書きもプリセットが変わった時点で捨てる: 操作割り当ての差分（`keybindingChanges`）、キーのダイアログの下書き（`modalDraft*`）。開いているダイアログは閉じる
- 同じプリセットの中での `keybindingChanges` は、loader が変わったときに**保存値と同じになった項目だけ**外す（未保存の項目は残す）。保存成功時は従来どおり全クリア

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
  - **`preset`**（「編集中のプリセット」）は `[data-me-tour="preset-selector"]`（`PresetSelector` のルートが付ける）が見えている画面
    （キー配置・デバイス・アイテム・サーチクラフト）だけで出す。保存バーの手順の前。無い画面では飛ばす
  - 保存バーの手順は、`[data-me-tour="save-bar"]` が DOM にある画面（`FloatingSaveBar` を描く画面）だけで出す。
    変更が無いあいだ `aria-hidden` でも、存在すれば指す。その間は `[data-me-tour-active]` の CSS がバーを一時的に見える状態（不透明・位置は本来の位置）にして指す
    （透明のまま空所を指さない。操作は不可のまま。手順は飛ばさない）。保存バーの無い画面（/me/import・/me/presets など）では手順ごと飛ばす
    （画面下の中央を指す fallback は廃止）。文言は「変更は画面下の保存バーで確定」とだけ言い、反映のタイミングは約束しない

### 共通レイアウトの挙動（`routes/me/_layout.tsx`、`components/floating-save-bar.tsx`）

- lg 未満では、メニュー開閉ボタン（現在のページ名）と開いたメニューを1つの帯（`data-me-nav-bar`）にして、ヘッダー直下
  （`top-[64px]`、z-30、不透明背景）に貼り付ける。長いキー配置の途中からでも最上部へ戻らずに別の画面へ移れる。
  開いたメニューは帯の中で縦にスクロールする。開いたメニューは Esc で閉じ、フォーカスを開閉ボタンへ戻す。lg 以上は従来のサイドバー（`top-24` で追従）。
  `app/app.css` で /me の lg 未満だけ `--sticky-bar-inset` を 8.5rem にしている（アンカー・フォーカス移動が帯に隠れない）。
- 保存バーの「取消」は `ghost` の副次操作。モバイルでは左端に小さく置き、広い「保存」から離す（押し間違いで破棄しにくくする。
  タップ領域は 44px のまま）。取消の後は、フォーカスをページの h1 へ移し（`tabindex` が無ければ `-1` を付ける）、「変更を取り消しました」（`common.changesDiscarded`）のトーストを出す。
  「元に戻す」（取り消した下書きの復元）は設けない（下書きの持ち方が画面ごとに違い、取消の前の状態を共通の部品から復元できないため）。

### チェックリスト（`components/me/me-checklist.tsx`）

- `/me/edit` の h1 の下に `<MeChecklist />` を置く。データは `_layout` の loader が `checklist` として返す
  （閉じ済みなら `null`＝出さない。全手順が済んでいても閉じるまでは返す。完了は `doneCount >= total` で導き、新しい状態は持たない）。判定は純粋関数 `computeMeChecklist`（`lib/me-guide.ts`）、集計は `me-checklist.server.ts`。
- 手順と済みの判定（6手順。各手順の下に達成条件を muted の1行で表示する。文言は `meLayout.checklist.criteria`）:
  MCID（Java 版 `mcid` か Bedrock 版 `bedrock_mcid` のどちらか）／自己紹介（`users.bio`。空白のみは未入力。リンクは `/me/edit#bio`）／
  キー配置（`keybindings` が 1 件以上）／デバイス（`player_configs` のキーボード・マウス・感度・コントローラー設定のいずれか）／
  記録（`category_records` が 1 件以上、または Speedrun.com のユーザー名・ID が登録済み）／プレイスタイル（バージョン・カテゴリ・ホットバー切替のいずれか）。
- 全手順が済んでいる間は達成表示になる（事実に基づく1回きりの確認。飾り・紙吹雪・新しい面は無し）。バッジは `{done} / {total} 完了` のまま、
  進捗バーは brand で満タン、手順の一覧の代わりに brand の Check ＋「進捗を達成しました: …」（`text-base font-semibold`、h3 にしない）と説明文、
  自分の走者画面 `/player/:slug`（`/me` レイアウトの `user.slug`）へのリンクボタンを出す。出現は `animate-in fade-in duration-300` のみで `role="status"` は付けない。
  「閉じる」と走者画面リンクの押下はどちらも `recordMeGuide("checklist")` で記録し、以後は出ない。
- 記録の送信（ツアー完了・チェックリストを閉じる）は `recordMeGuide`（`lib/me-guide.ts`）の素の `fetch` POST。`useFetcher().submit` は
  表示中の子ルート（records・keybindings 等）の loader まで再検証させるため使わない。表示の消去はローカル状態で行う。
- ツアーの吹き出しは手順が変わるたびに見出しへフォーカスを移して読み上げさせる（`aria-live` は付けない）。
