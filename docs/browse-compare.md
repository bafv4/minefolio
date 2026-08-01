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

### フィルタ（複数選択対応）

| パラメータ | 型 | 選択肢 |
|-----------|-----|--------|
| `role` | FilterRole | `runner` / `viewer` |
| `edition` | FilterEdition | `java` / `bedrock` |
| `input` | FilterInputMethod | `keyboard_mouse` / `controller` / `touch` |
| `platform` | FilterPlatform | `pc_windows` / `pc_mac` / `pc_linux` / `switch` / `mobile` / `other` |

ロールフィルタで何も選択していない時のみ視聴者ロールが除外される（前述）。「視聴者」を選択した場合はそのまま表示される。

#### フィルタダイアログの動作

- フィルタダイアログ内のチェックボックスはローカル `draftFilters` のみを更新
- 「完了」ボタンで URL 検索パラメータに反映 → `loader` が再実行される
- ダイアログ外のフィルタチップ（×ボタン）は即時反映

### ページネーション

- 1ページあたり12件（`ITEMS_PER_PAGE = 12`）
- クエリパラメータ `page` でページ番号指定
- 前へ/次へボタンで遷移

### お気に入り並べ替え

- ログイン中ユーザーのお気に入りを `loader` で DB から取得し、リストの先頭に並び替える
- 未ログイン時は SSR 時点でのお気に入り情報がないため、初期表示は通常順序のまま（クライアント側 hydrate 後に `useFavorites` フックの状態を参照）

### 表示コンポーネント

- `ProfileFeedCard` - カード表示モード
- `ProfileFeedListItem` - リスト表示モード
- `PlayerViewToggle` - 表示切替

---

## プレイヤー比較 (/compare)

### 概要

2人のプレイヤーのキー配置・デバイス設定を並べて比較する画面。

> v1.4.0 でヘッダー・モバイルナビからリンクを削除しました。直接URLでアクセスすれば引き続き利用可能です。

### 比較対象の指定

- URLパラメータ `player1`, `player2` で比較対象のMCIDまたはslugを指定
- 例: `/compare?player1=player_a&player2=player_b`
- 画面上の検索フォームからプレイヤーを選択可能
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
- 差異がある項目を視覚的にハイライト

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

- `PlayerCard` コンポーネントでプレイヤーカード表示
- お気に入りが空の場合、案内メッセージ表示
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
- `app/lib/favorites-client.ts` - クライアント側 localStorage / sessionStorage 操作
- `app/hooks/use-favorites.tsx` - `FavoritesProvider` + `useFavorites` フック
- `app/lib/keybindings.ts` - キーバインドのラベル変換（`getActionLabel`, `getKeyLabel`, `normalizeKeyCode`）

### コンポーネント
- `app/components/player-card.tsx` - プレイヤーカード
- `app/components/profile-feed-card.tsx` - プロフィールフィードカード（カード/リスト表示切替対応）
- `app/components/favorite-button.tsx` - お気に入りボタン（slug ベース）
- `app/components/minecraft-avatar.tsx` - Minecraftアバター表示
