# プレイヤー一覧・比較・お気に入り 仕様書

## プレイヤー一覧 (/browse)

### 概要

公開プロフィールを持つプレイヤーの一覧表示・検索画面。

### フィルタ条件

- **公開プロフィールのみ**: `profileVisibility = "public"` のユーザーのみ表示
- 非公開・限定公開プロフィールは一覧に表示されない
- **視聴者ロールはデフォルトで非表示**：ロールフィルタで `viewer` を明示的に選択した場合のみ表示される。実装は `app/lib/users-filter.ts` の `excludeViewersCondition` を `where` に組み込む方式

### 検索

- クエリパラメータ `q` でテキスト検索
- 検索対象: `mcid`, `displayName`（LIKE検索）
- `slug` は検索対象に含めない。MCID 未登録ユーザーの slug は `@{discordId}`（Discord の数値ID）であり、検索に含めると数字パターン等で Discord ID にヒットしてしまうため（登録済みユーザーは `slug == mcid` なので mcid 検索でカバーされる）
- URLパラメータ: `?q=検索ワード`
- 適用タイミング: ページ上の操作（検索語・並び順）は即時反映、フィルタはダイアログで確定して反映
  - 検索語は入力から 400ms の debounce で `q` に反映する（`replace: true` で履歴を積まない。IME 変換中は反映せず確定後に debounce。空にすると `q` を外す）。Enter／検索ボタンは待たずに即時反映
  - 読み込み中は表示中の一覧を残して薄く（`opacity-60`・`aria-busy`）表示し、一覧が無いときだけスケルトンを出す（入力のたびにスケルトンへ切り替わってちらつかないように）

### ソート

クエリパラメータ `sort` で指定:

| 値 | 説明 |
|----|------|
| `updatedAt` | 更新日時順（デフォルト） |
| `popular` | 人気順（直近7日のページビュー降順 → `updatedAt` 降順） |
| `mcid` | MCID昇順 |
| `displayName` | 表示名昇順 |

**未設定（NULL）は必ず末尾**。SQLite は昇順で NULL を先頭に置くため、`nullsLast()`
（`app/lib/sort-order.ts`）を ORDER BY の先頭キーに差し込んで打ち消している。
MCID 未登録・表示名未設定の走者が並び替えのたびに 1 ページ目を占有するのを防ぐ。
お気に入り優先はこれより強く、お気に入りなら未設定でも先頭に来る。

`popular` のページビューは `profilePageViewsSql()`（`app/lib/page-view-stats.server.ts`）が返す `page_view_stats` の相関サブクエリ（Vercel Web Analytics を cron で集計）。未集計・0件のプロフィールは `updatedAt` 降順へ自然に落ちる。集計の仕組みは [`docs/infrastructure.md`](./infrastructure.md#ページビュー集計vercel-web-analytics) を参照。

`?sort=` は許可リスト（`BROWSE_SORTS` = 上記4値、`app/lib/browse-query.server.ts`）で検証し、未知の値は既定の `updatedAt` へ丸める（`parseBrowseSort()`）。ガイド・テンプレート一覧の `parseContentSort()` と同じ「不正な `sort` はエラーにせず既定へフォールバックする」方針を踏襲している。

`popular` 選択時は、並び替えの下に基準「直近7日でよく見られた順」（`contentSort.popularDesc`、日数は `PAGE_VIEW_WINDOW_DAYS`）を補足テキストで表示する。閲覧数の数値そのものはカード等に出さない。

### ランダムな走者

見出しの右に副次の操作（outline のボタン）として「ランダムな走者」（`browse.randomRunner`）を置く。`/random-player`（`/browse` と同じ母集団＝公開プロフィールで視聴者ロール以外〔ロール未設定は走者扱い〕。ログイン中は本人を除く。そこから1人選んでプロフィールへリダイレクトするリソースルート）へのリンクで、`reloadDocument` で開く。

### 表示形式（カード / リスト）

クエリパラメータ `view` に保持する。`?view=list` のときリスト、それ以外（既定のカード）はパラメータを付けない。切替は `replace`（履歴を積まない）で、フィルタ・並び順・ページ等の他のクエリは保持する。`view` だけが変わるナビゲーションでは loader を再実行しない（`shouldRevalidate`）。localStorage は使わない。

### フィルタ（複数選択対応）

| パラメータ | 型 | 選択肢 |
|-----------|-----|--------|
| `role` | FilterRole | `runner` / `viewer`（`users.role` は NULL 許容で NULL＝未設定。**未設定は走者として扱う**: `runner` 絞り込みは NULL を含み、`role` 指定なしの既定一覧（視聴者除外）と件数が一致する） |
| `edition` | FilterEdition | `java` / `bedrock` |
| `input` | FilterInputMethod | `keyboard_mouse` / `controller` / `touch` |
| `platform` | FilterPlatform | `pc_windows` / `pc_mac` / `pc_linux` / `switch` / `mobile` / `other` |

`input` フィルタの参照先は `users.inputMethod`（旧 `inputMethodBadge` は @deprecated・未使用。プロフィールのバッジ表示と同じ列に一本化されている。詳細は [`docs/profiles.md`](./profiles.md#プレイスタイル) の「プレイスタイル」参照）。URLパラメータ名・値は変更前と同じで既存URLと互換。

ロールフィルタで何も選択していない時のみ視聴者ロールが除外される（前述）。「視聴者」を選択した場合はそのまま表示される。

#### フィルタダイアログの動作

- フィルタダイアログ内のチェックボックスはローカル `draftFilters` のみを更新
- 「完了」ボタンで URL 検索パラメータに反映 → `loader` が再実行される
- ダイアログ外のフィルタチップ（×ボタン）は即時反映
- 完了ボタンは「{n}件を表示」になる（`browse.showCount`）。下書き条件を 300ms debounce で `GET /api/browse?count=1` へ問い合わせ、前のリクエストは中断する。0件は「該当なし（0件）」、取得失敗時は従来の「完了」に戻る。検索語は URL に適用済みのもの（`q`）だけを渡す
- ロール未選択時は、視聴者を除外している旨の補足文をダイアログに表示する（`browse.roleDefaultNote`）
- チェックボックスの各行は `label` で包み、行全体を押せる（モバイルは高さ 44px＝`min-h-11`、`sm` 以上は 36px）。検索欄・検索ボタン・フィルタ・並び替えもモバイルは 44px。適用中チップの × は、見た目を変えずに押せる範囲を広げている
- プラットフォーム `mobile` の表記は `/me/edit` の選択肢と同じ `meEdit.mobile`（ja「スマホ」・en「Mobile」。`platformLabel()` も同じ）
- エディション・入力方式の表記は、ダイアログのチェックボックスと適用中チップで同じ翻訳ラベルを使う

#### 件数専用モード (`GET /api/browse?count=1`)

同じ絞り込みパラメータ（`q` / `role` / `edition` / `input` / `platform`）を受け取り `{ total }` だけを返す。一覧と同じ `buildWhere` を通す `countBrowse()`（`app/lib/browse-query.server.ts`）で `count(*)` のみ実行し、一覧 loader の総件数もこの関数を共有する。お気に入り順に依存しないためセッションは見ず、`Cache-Control: public, s-maxage=30, stale-while-revalidate=300`。

### ページネーション

- 1ページあたり12件（`ITEMS_PER_PAGE = 12`）
- クエリパラメータ `page` でページ番号指定
- 前へ/次へボタンで遷移

### お気に入り並べ替え

- ログイン中ユーザーのお気に入りを `loader` で DB から取得し、リストの先頭に並び替える
- 先頭に来たお気に入りには、カード・リスト行の右側（カードは名前行の右端、リスト行はタグ・時刻の手前）に「お気に入り」の小さなピル（塗りハート＋文言、地は `bg-favorite/10`、文字は前景色。表示専用の `FavoriteMark`）を表示する。ログイン中でお気に入りが1人以上いるときは、ページ上部（件数の下）に「ハートが付き先頭に表示される」旨の補足行（`browse.favoritesFirstNote`）を出す（`ProfileFeedCard` / `ProfileFeedListItem` の `isFavorite` prop。`browse.tsx` が `useFavorites().isFavorite(slug)` を渡す。他画面は渡さない。`ProfileFeedCard` は任意の `showFavoriteButton` でヘッダー右端に `FavoriteButton` を出せるが、これはホームの推薦用で /browse は使わない）
- 未ログイン時は SSR 時点でのお気に入り情報がないため、初期表示は通常順序のまま（クライアント側 hydrate 後に `useFavorites` フックの状態を参照）

### 表示コンポーネント

- `ProfileFeedCard` - カード表示モード
- `ProfileFeedListItem` - リスト表示モード
- `PlayerViewToggle` - 表示切替

リスト表示のタグはカード表示と同じ規則（`FeedCardTags`）。既定値（Java / Windows / KBM / 走者）は出さず、識別に効くタグを最大3個表示する。

---

## プレイヤー比較 (/compare)

### 概要

2人のプレイヤーのキー配置・デバイス設定を並べて比較する画面。

> v1.4.0 でヘッダー・モバイルナビからリンクを削除しました。直接URLでアクセスすれば引き続き利用可能です。

### 比較対象の指定

- URLパラメータ `p1`, `p2` で比較対象の slug を指定
- 例: `/compare?p1=player_a&p2=player_b`
- 画面上の選択欄から走者を選べる。選択欄は「走者 1」「走者 2」の見出し（`aria-labelledby` で結ぶ）＋検索付きのコンボボックス（`RunnerPicker`、`compare.tsx`。`Popover`＋`Command` で組み、見た目は `ui/combobox` と同じ）1つ。検索は表示名・アルファベット表記・MCID・slug に当たり（cmdk の `keywords`）、一致0件は「一致する走者が見つかりません」（`compare.noRunnerMatch`）。もう片方で選ばれている走者は候補から外す。選択中の名前とアバターは loader の一覧から引くので SSR の時点で出る。2つの選択欄の間に、走者 1 と 2 を入れ替えるボタン（`compare.swapRunners`。URL の `p1` / `p2` を入れ替える）を置く。選択欄は箱にしない
- 指定した走者を表示できないとき（存在しない、または公開されていない。両者は区別しない）は、その走者の選択欄の下に警告の案内を出し、選択欄は未選択の表示にする。HTTP ステータスは 200 のままで、loader が `notFoundSlugs` を返す
- URL で指定されて表示が許された走者が選択用の一覧（公開のみ・最大100人）に無いときは、その走者だけを選択肢に足す
- 各プレイヤーのヘッダー（表示名・MCID の下）に RTA歴を1行で表示する（`rtaStartedYearMonth` を設定している走者のみ、未設定なら何も出さない）。文言・計算はプロフィールページと同じ `rtaCareerView()` / `rtaCareerLabel()`（`app/lib/rta-career.ts`）を共有し、経過期間の基準時刻は loader が返す `now` で SSR とハイドレーションを揃える（`RtaCareerLine`）

### 比較項目

#### キーバインド比較

以下のアクションを一覧表示し、差異をハイライト:

| カテゴリ | アクション |
|---------|-----------|
| 移動 (movement) | forward, back, left, right, jump, sneak, sprint |
| 戦闘 (combat) | attack, use, pickBlock, drop |
| インベントリ (inventory) | inventory, hotbar1〜9, swapOffhand |
| UI | chat, command, playerList, screenshot, fullscreen, togglePerspective |

#### デバイス設定比較

- キーボードレイアウト、キーボードモデル
- マウスDPI、ゲーム感度、cm/360
- マウスモデル、マウス加速、raw input
- FOV、GUIスケール
- ゲーム言語、トグルスプリント

#### リマップ比較

- キーリマップ設定の差分表示

### 類似プレイヤー提案

- 比較画面下部に、選択されたプレイヤーと設定が近い他のプレイヤーを提案

### 表示

- `getActionLabel(action)` でアクション名のローカライズ表示
- `getKeyLabel(keyCode)` でキーコードの表示名変換
- 差の示し方は中立にする（一致・相違に良し悪しの色や ✓・× を付けない）。「違う」の基準は1つ（`compareValues`、`compare.tsx`）で、**両方に値があって異なる行と、片方だけ値がある行**（「-」と「US」など）を「違う」とする。**既定は違う行だけを表示する**（下記）。全行表示のときだけ、違う行は面を `bg-secondary/50` にし、行頭の項目名の横に前景色の点＋「異なる」（`compare.different`）の文字を出し、値のチップ（`KeyChip` / `ValueText`）に `border-primary` の枠を付ける（面の濃淡以外の手がかり。赤・緑や優劣の装飾は使わない）。一致の行・両方未設定の行は装飾なし。値が無いセルは「-」ではなくチップ無しの muted の「未設定」（`compare.notSet`）。要約の件数（一致・異なる）と一致率は**両方に設定がある操作だけ**を分母にし、片方だけ設定の操作は数えない（要約に「片方が未設定のN件は数えません」〔`compare.unsetNotCounted`〕を添える。表の行としては「違う」に出る）。**類似走者の一致率・「N/M 一致」も同じ数え方**（`compareKeyMaps` を要約と `rankSimilarPlayers` が共有）。並び順は、比べられた操作の数が最低の分母（`MIN_COMPARABLE_ACTIONS`＝比較対象の操作数の半数以上、現在 13）に達した人を先に、足りない人を後ろへ回し（除外はしない）、それぞれの中を 一致率 → 分母の大きい順 → slug 順（`sortSimilarPlayers`）。表示は「一致数/分母 一致」を主、% を従にし、分母が足りない人には muted で「比べられる設定が少ない」（`compare.fewComparable`）を添える（優劣の色は付けない）。両方に設定のある操作が1つも無い走者は候補から除く。走者を1人も選んでいないときは使い方の `EmptyState`（compact）を出す。数字は前景色
- キー配置（カテゴリごと）とデバイス・設定の表は同じ形（`CompareTable`）: `role="table"`（行 `row`・項目名 `rowheader`・値 `cell`）、先頭行に列見出し（操作／項目・走者1・走者2。走者の列見出しはアバター 20px〔`alt=""`〕＋名前〔`truncate`〕）、全行表示のとき違う行は行全体の面。ページ全体を `mx-auto max-w-3xl` に絞り、選択欄・要約・表の幅をそろえる。カテゴリ名は h2「キー配置の比較」の下の h3
- **既定は「違いだけ」**。要約の中（集計の下）に「同じ行も表示」（`compare.showSame`）のスイッチを置き、オンで同じ行も並べる。状態は URL の `?all=1`（既定はオフ＝違いだけ、切替は `replace`。旧 `?diff=1` は無視され、開くと違いだけになる）。`all` だけが変わるナビゲーションでは loader を再実行しない（`shouldRevalidate`）。キー配置で違いの無いカテゴリはカードを出さず、末尾の1文「ほかのカテゴリに違いはありません」（`compare.otherCategoriesNoDifferences`。全カテゴリに違いが無ければ「違いはありません」〔`compare.noDifferences`〕）にまとめる。キー配置・デバイス設定とも違いが0件のときは、表の代わりに `EmptyState`（compact）「違いはありません」＋「同じ行も表示」ボタンを出す。一部の欄だけ違いが無いとき（キー配置は0件でデバイス設定に違いがある、など）は、その欄の「違いはありません」の隣にも同じ「同じ行も表示」ボタンを出す（切替の手がかりが無い状態を作らない）
- 要約は「A vs B」の左右対称（左に走者1、右に走者2〔鏡写し〕、中央に「N 一致 / M 異なる」・一致率・スイッチ）。モバイルは走者2人を1行、集計をその下に置く。走者の帯は、その走者のプロフィールへのリンク（タップ領域 44px）。結果が出ているとき、md 未満の選択欄は「選択部品・入れ替え・選択部品」の1行に詰め（見出しは `sr-only`、「プロフィールを見る」リンクは非表示）、最初の1画面に違いの行が入るようにする`role="group"` に `aria-label`（`compare.titleWithPlayers`）を付け、類似走者の「比較」で結果が出たらフォーカスをここへ移す
- 2人が選ばれていて、**2人とも公開の走者**のとき、`meta` の title / og:title は「A と B のキー配置比較」（`compare.titleWithPlayers`）。限定公開（URL 指定でだけ見られる）の走者が含まれるときは、リンクを貼った先のプレビューに名前が出ないよう、一般のタイトル（`compare.title`）にする。非公開の走者は loader が返さない
- 2人目の slug が存在しない（または非公開）で1人目が表示できるときは、p1 のみ指定と同じ類似走者を返す
- 比較には保存済みのキー割り当て（実際に押すキー）だけを使う。`keyRemaps` は読み込まない
- 類似走者の一致率（%）は前景色（良し悪しの色を付けない）

---

## お気に入り (/favorites)

### 概要

お気に入りに登録したプレイヤーの一覧画面。v1.4.0 以降、ログインユーザーは DB がマスター、未ログインユーザーは `localStorage` ベースで管理する。詳細は [`docs/favorites.md`](favorites.md) を参照。

### loader 処理

- **ログイン中**: `getFavoritesFromDb(db, userId)` で slug 一覧を取得 → `users` テーブルから JOIN で詳細取得 → 入力順でソートして返却
- **未ログイン**: SSR 時点では空のプレースホルダーを返し、クライアント側で `localStorage` から slug 一覧を取得 → `POST /api/users/by-slugs` で詳細取得

### Cookie 同意未承諾の場合

未ログインで Cookie 同意がない場合は localStorage を参照せず、案内バナーを表示する。

### 関連 API

- `GET /api/favorites` — お気に入り一覧（slug 配列、未認証は空配列）
- `POST /api/favorites` — お気に入り追加・削除（認証必須）
- `PUT /api/favorites` — localStorage→DB の一括同期（認証必須、ログイン時に自動実行）
- `POST /api/users/by-slugs` — slug 配列からユーザー詳細を取得（最大100件）

旧 Cookie `minefolio_favorites` は `/api/favorites` の応答で `Set-Cookie: ... Max-Age=0` により自動削除される。

### 表示

- `ProfileFeedCard`（`/browse` と共通）でプレイヤーカード表示。タグは最大3個で、既定値（走者・Java・Windows・KBM）は全員同じで識別情報にならないため出さない。メインカテゴリ（`playstyles.mainCategory`）のバッジを先頭に出し（PB のタイムは、何のタイムか一覧では分からないため出さない。PB は注目の走者とプロフィールのハイライトでラベル付きで見せる）、残り枠に viewer / Bedrock / Windows 以外のプラットフォーム / KBM 以外の入力方式を出す。これらの表示用フィールド（`inputMethod` / `mainCategory`）は任意で、渡さない一覧（ホーム）は従来どおり描画される。`loadBrowsePage` が `with`（playstyle）で一括取得する（N+1 なし）
- `/browse` の見出し（件数行）は選択中の role フィルタに追従する（走者／視聴者／すべて）。件数の単位は「人」（en は people）に統一。検索語（`q`）かロール以外のフィルタ（エディション・入力方法・プラットフォーム）が有効なときは「登録されている〜」ではなく「該当する〜（{count}人）」（`browse.matchedCount{Runner,Viewer,All}`）にする
- お気に入りが空の場合、`EmptyState` で案内メッセージ + `/browse` への導線を表示
- `FavoriteButton` コンポーネントで各プレイヤーカードにお気に入りトグルボタンを表示（v1.4.0 から `slug` プロップを受け取る）

---

## メタタグ

全画面共通で以下を設定:

| プロパティ | 値 |
|-----------|-----|
| `og:type` | `website` |
| `og:title` | 各画面のタイトル（`t()` で国際化） |
| `og:description` | 各画面の説明 |
| `og:image` | `/og-image`（動的OGP画像） |
| `twitter:card` | `summary` |

---

## 関連ファイル

### ルート
- `app/routes/browse.tsx` - プレイヤー一覧画面
- `app/routes/compare.tsx` - プレイヤー比較画面
- `app/routes/favorites.tsx` - お気に入り画面
- `app/routes/api/favorites.ts` - お気に入りAPI（GET / POST / PUT）
- `app/routes/api/users/by-slugs.ts` - スラッグ配列からユーザー詳細を取得

### ライブラリ
- `app/lib/users-filter.ts` - 視聴者ロール除外条件 `excludeViewersCondition`
- `app/lib/page-view-stats.server.ts` - `popular` ソートで使うページビュー相関サブクエリ（`profilePageViewsSql`）
- `app/lib/favorites.ts` - サーバー側 DB CRUD（`getFavoritesFromDb` / `addFavoriteToDb` / `removeFavoriteFromDb` / `syncLocalFavoritesToDb`）+ 旧 Cookie 削除ヘッダー生成
- `app/lib/favorites-client.ts` - クライアント側 localStorage 操作
- `app/hooks/use-favorites.tsx` - `FavoritesProvider` + `useFavorites` フック
- `app/lib/keybindings.ts` - キーバインドのラベル変換（`getActionLabel`, `getKeyLabel`, `normalizeKeyCode`）

### コンポーネント
- `app/components/profile-feed-card.tsx` - プロフィールフィードカード（`/browse` `/favorites` 共通。カード/リスト表示切替対応）
- `app/components/favorite-button.tsx` - お気に入りボタン（slug ベース）
- `app/components/minecraft-avatar.tsx` - Minecraftアバター表示
