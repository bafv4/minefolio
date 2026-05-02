# プレイヤー一覧・比較・お気に入り 仕様書

## プレイヤー一覧 (/browse)

### 概要

公開プロフィールを持つプレイヤーの一覧表示・検索画面。

### フィルタ条件

- **公開プロフィールのみ**: `profileVisibility = "public"` のユーザーのみ表示
- 非公開・限定公開プロフィールは一覧に表示されない
- **視聴者ロールはデフォルトで非表示**：ロールフィルタで `viewer` を明示的に選択した場合のみ表示される

### 検索

- クエリパラメータ `q` でテキスト検索
- 検索対象: `mcid`, `displayName`, `slug`（LIKE検索）
- URLパラメータ: `?q=検索ワード`

### ソート

クエリパラメータ `sort` で指定:

| 値 | 説明 |
|----|------|
| `updatedAt` | 更新日時順（デフォルト） |
| `mcid` | MCID昇順 |
| `displayName` | 表示名昇順 |

### フィルタ（複数選択対応）

| パラメータ | 型 | 選択肢 |
|-----------|-----|--------|
| `role` | FilterRole | `runner` / `viewer` |
| `edition` | FilterEdition | `java` / `bedrock` |
| `input` | FilterInputMethod | `keyboard_mouse` / `controller` / `touch` |
| `platform` | FilterPlatform | `pc_windows` / `pc_mac` / `pc_linux` / `switch` / `mobile` / `other` |

### ページネーション

- 1ページあたり12件（`ITEMS_PER_PAGE = 12`）
- クエリパラメータ `page` でページ番号指定
- 前へ/次へボタンで遷移

### 表示コンポーネント

- `ProfileFeedCard` - カード表示モード
- `ProfileFeedListItem` - リスト表示モード
- `PlayerViewToggle` - 表示切替

### カスタムスキン対応

- Cookieからお気に入り一覧を取得（`getFavoritesFromCookie`）し、お気に入りマーク表示に使用

---

## プレイヤー比較 (/compare)

### 概要

2人のプレイヤーのキー配置・デバイス設定を並べて比較する画面。

### 比較対象の指定

- URLパラメータ `player1`, `player2` で比較対象のMCIDまたはslugを指定
- 例: `/compare?player1=player_a&player2=player_b`
- 画面上の検索フォームからプレイヤーを選択可能

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

お気に入りに登録したプレイヤーの一覧画面。Cookieベース（非ログイン対応）およびDBベースの管理をサポート。

### Cookieベースのお気に入り

- `getFavoritesFromCookie(cookieHeader)` でCookieからお気に入りMCID一覧を取得
- ログインしていなくてもお気に入りが利用可能
- Cookie同意（`useCookieConsent`）が必要

### DBベースのお気に入り

#### favorites テーブル

| カラム | 型 | 説明 |
|--------|-----|------|
| `id` | text (PK) | CUID2 |
| `userId` | text (FK → users) | ユーザーID |
| `favoriteMcid` | text | お気に入りプレイヤーのMCID |
| `createdAt` | timestamp | 作成日時 |

#### インデックス

- `idx_favorites_user_mcid` (UNIQUE) - ユーザー + MCIDの組み合わせで一意
- `idx_favorites_user_id` - ユーザーIDで検索

### /api/favorites

お気に入りの追加・削除を行うAPIエンドポイント。

| メソッド | 操作 |
|---------|------|
| POST | お気に入り追加 |
| DELETE | お気に入り削除 |

### 表示

- `PlayerCard` コンポーネントでプレイヤーカード表示
- お気に入りが空の場合、案内メッセージ表示
- `FavoriteButton` コンポーネントで各プレイヤーカードにお気に入りトグルボタンを表示

### loader処理

1. Cookieからお気に入りMCID一覧を取得
2. 空の場合は早期リターン
3. `users` テーブルから該当MCIDのプレイヤー情報を `inArray` で一括取得

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
- `app/routes/api/favorites.ts` - お気に入りAPI

### ライブラリ
- `app/lib/favorites.ts` - お気に入りCookie管理（`getFavoritesFromCookie`）
- `app/lib/keybindings.ts` - キーバインドのラベル変換（`getActionLabel`, `getKeyLabel`, `normalizeKeyCode`）

### コンポーネント
- `app/components/player-card.tsx` - プレイヤーカード
- `app/components/profile-feed-card.tsx` - プロフィールフィードカード（カード/リスト表示切替対応）
- `app/components/favorite-button.tsx` - お気に入りボタン
- `app/components/minecraft-avatar.tsx` - Minecraftアバター表示
