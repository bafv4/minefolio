# お気に入り機能 仕様書

## 概要

走者プロフィールをお気に入り登録する機能。v1.4.0 で大規模刷新し、ログインユーザーは DB を正本として複数デバイス間で同期し、未ログインユーザーは引き続きクライアント側ローカル保存（旧 Cookie ベースから localStorage 方式に移行）で利用できる。

旧 Cookie `minefolio_favorites` および旧 `favorites.favoriteMcid` カラムは廃止。詳細は履歴節を参照。

---

## データモデル

### `favorites` テーブル

```typescript
{
  id: string;            // CUID2
  userId: string;        // FK -> users.id (cascade delete)
  favoriteSlug: string;  // 対象ユーザーの slug
  createdAt: Date;
}
```

### インデックス

- `idx_favorites_user_slug (userId, favoriteSlug)` — UNIQUE
- `idx_favorites_user_id (userId)`

---

## 保存先と参照先

| ユーザー種別 | 正本 | クライアント側キャッシュ |
|---|---|---|
| ログイン中 | DB `favorites` | sessionStorage `minefolio_favorites_cache` |
| 未ログイン（Cookie 同意済み） | localStorage `minefolio_favorites` | （正本=ローカル） |
| 未ログイン（Cookie 同意なし） | 利用不可 | — |

最大件数は 50。

---

## API エンドポイント

### `GET /api/favorites`

- 認証任意
- ログイン中: DB から slug 配列を返す
- 未ログイン: 空配列を返す
- 旧 Cookie `minefolio_favorites` が残っていれば `Set-Cookie: ...; Max-Age=0` で自動削除

レスポンス例:

```json
{ "favorites": ["slug1", "slug2"] }
```

### `POST /api/favorites`

- 認証必須
- リクエスト: `{ slug: string, action: "add" | "remove" }`
- 更新後の最新リストを返す

### `PUT /api/favorites`

- 認証必須
- リクエスト: `{ slugs: string[] }`
- localStorage→DB の一括同期用。重複は無視

### `POST /api/users/by-slugs`

- 認証不要
- リクエスト: `{ slugs: string[] }`（最大 100 件）
- レスポンス: 入力順を維持した `{ users: [...] }`
- 未ログインの `/favorites` ページで、ローカル保存の slug 一覧から走者カードを描画するために利用

---

## クライアント側ライブラリ

### `app/lib/favorites-client.ts`

- `getLocalFavorites()` / `setLocalFavorites(slugs)` / `addLocalFavorite(slug)` / `removeLocalFavorite(slug)` / `clearLocalFavorites()`
- `getSessionFavorites()` / `setSessionFavorites(slugs)`
- SSR セーフ（`typeof window === "undefined"` ガード、`try/catch` で QuotaExceeded 等を吸収）

### `app/lib/favorites.ts`

サーバー側 DB CRUD ヘルパー：

- `getFavoritesFromDb(db, userId): Promise<string[]>`
- `addFavoriteToDb(db, userId, slug)`
- `removeFavoriteFromDb(db, userId, slug)`
- `syncLocalFavoritesToDb(db, userId, slugs)` — 一括同期、重複は無視
- `buildLegacyFavoritesCookieDeletion()` — 旧 Cookie 削除用 `Set-Cookie` ヘッダー値
- `LEGACY_FAVORITES_COOKIE_NAME` 定数
- `isFavorite(list, slug)` — クライアント・サーバー両用の純関数
- `retargetFavoritesOnSlugChange(tx, { oldSlug, newSlug })` — slug 変更時の追従更新（下記「slug 変更時の追従更新」参照）

---

## slug 変更時の追従更新

`favorites.favoriteSlug` は `users.slug` への弱参照（FK 制約なし。整合性ポリシーは `app/lib/schema.ts` の
favorites コメントおよび [database.md](./database.md#弱参照fk-を張らない参照) 参照）。MCID の設定・変更・削除で
`users.slug` が再生成されると、他ユーザーが持つ `favorites` 行が古い slug を指したまま孤児化し、
`/favorites`（`inArray(users.slug, slugs)` の完全一致で解決）から黙って消える。これを防ぐため、
`app/routes/me/edit.tsx` の `set_mcid` / `remove_mcid` アクションは `users` 更新と同じトランザクション内で
`retargetFavoritesOnSlugChange(tx, { oldSlug, newSlug })` を呼ぶ。

処理順（`app/lib/favorites.ts`）:

1. `oldSlug === newSlug`（完全一致）なら何もしない
2. `newSlug` を `favoriteSlug` に持つ既存行を削除する — 以前その slug を持っていた別ユーザーへの
   孤児参照であり、そのまま残すと次の UPDATE が `(userId, favoriteSlug)` の UNIQUE 制約
   （`idx_favorites_user_slug`）に衝突しうるため（`slug-history.server.ts` の `claimSlug` と同じ意味論）
3. `oldSlug` を `favoriteSlug` に持つ行を `newSlug` へ更新する（追従更新本体）

比較は **完全一致**（大文字小文字を区別）。`favoriteSlug` は登録時点の `users.slug` の正確な値を保存しており、
`/favorites` 側の解決も完全一致のため、大文字小文字だけの slug 変更（例: `"alice"` → `"Alice"`）でも追従が必要
になる。これは `slug_history`（小文字化して比較し、大文字小文字だけの変更は no-op とする）とは判定基準が
異なる点に注意。

---

## `FavoritesProvider` / `useFavorites` フック

`app/hooks/use-favorites.tsx` で提供。`app/routes/_layout.tsx` で `<FavoritesProvider isLoggedIn={...} initialFavorites={...}>` として配置されている。

### 初期化フロー（マウント時）

**ログイン中:**

1. sessionStorage から即時表示（`initialFavorites` が空のときのフォールバック）
2. localStorage に未同期エントリがあれば `PUT /api/favorites` で一括同期 → 完了後 `clearLocalFavorites()`
3. `GET /api/favorites` で最新を取得し state と sessionStorage を更新

**未ログイン:**

- Cookie 同意済み → localStorage を読む
- 同意なし → 空配列で固定

### `toggleFavorite(slug)`

- 楽観的更新（即座に UI 反映）
- ログイン中: `POST /api/favorites` を呼び、レスポンスで上書き。エラー時はロールバック
- 未ログイン: `addLocalFavorite` / `removeLocalFavorite` を直接呼ぶ
- `needsCookieConsent` が真（未ログイン + Cookie 同意なし）の場合は no-op

### Cookie 同意との連携

- 未ログイン状態で `useCookieConsent().hasConsent` が `true` でない場合は localStorage を参照しない
- `FavoriteButton` クリック時に同意なしならコンセントバナーを表示

---

## 関連ページ

| ページ | お気に入りの利用 |
|---|---|
| `/favorites` | お気に入り一覧。ログイン時は loader が DB から取得 → users JOIN で詳細返却。未ログイン時はクライアント側で localStorage → `POST /api/users/by-slugs` で詳細取得 |
| `/browse` | ログイン時のみ、お気に入りを上位に並べ替え（loader で DB から取得） |
| `/player/:slug` | `<FavoriteButton slug={player.slug} />` でトグル |
| `/api/home-feed` | ライブ・ペース・動画でお気に入りを上位にソート（ログイン時のみ） |

---

## SSR の扱い

- ログイン中のローダー（`/favorites` / `/browse` / `/api/home-feed`）は DB から取得して SSR に反映
- 未ログインは SSR では何もしない（クライアントの `FavoritesProvider` がマウント後に処理）
- `/_layout` ローダーで `initialFavorites` を取得し、`FavoritesProvider` に渡すことで初回描画のチラつきを軽減

---

## 関連ファイル

| ファイル | 役割 |
|---|---|
| `app/lib/schema.ts` | `favorites` テーブル定義 |
| `app/lib/favorites.ts` | サーバー側 DB CRUD + 旧 Cookie 削除ヘッダー + slug 変更時の追従更新（`retargetFavoritesOnSlugChange`） |
| `app/routes/me/edit.tsx` | `set_mcid` / `remove_mcid` アクションから `retargetFavoritesOnSlugChange` を呼び出し |
| `app/lib/favorites-client.ts` | クライアント側 localStorage / sessionStorage 操作 |
| `app/hooks/use-favorites.tsx` | `FavoritesProvider` + `useFavorites` |
| `app/routes/api/favorites.ts` | GET / POST / PUT のお気に入り API |
| `app/routes/api/users/by-slugs.ts` | スラッグ配列→ユーザー詳細 API |
| `app/routes/favorites.tsx` | `/favorites` ページ |
| `app/routes/_layout.tsx` | `FavoritesProvider` のマウント |
| `app/components/favorite-button.tsx` | お気に入りトグルボタン（slug ベース） |
| `app/components/cookie-consent.tsx` | Cookie 同意フック |

---

## 履歴

### v1.3.x まで

- 保存先は Cookie `minefolio_favorites`（slug 文字列の配列を URLEncode + JSON 化）
- DB の `favorites.favoriteMcid` カラムは存在したものの、書き込みコードからは未参照（実装上は Cookie のみ）

### v1.4.0

- `favoriteMcid` を `favoriteSlug` にリネーム（インデックスも `idx_favorites_user_slug` に）
- ログインユーザーの正本を DB に移行、デバイス間共有を実現
- 未ログインユーザー向けに localStorage ベースへ切替
- `GET /api/favorites` のレスポンスで旧 Cookie を `Max-Age=0` で自動削除
- `POST /api/users/by-slugs` を新設し、未ログインの一覧表示でも detail 取得を可能に
