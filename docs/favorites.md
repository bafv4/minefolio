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
| ログイン中 | DB `favorites` | なし（SSR の `initialFavorites` を正とする） |
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
`app/lib/mcid-change.server.ts` の `applyMcidSlugChange`（`/me/edit` の `save_all` と onboarding が共用）は `users` 更新と同じトランザクション内で
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

1. localStorage に未同期エントリが**無い**場合: SSR の `initialFavorites`（`_layout` ローダーが同一リクエストで DB から取得。失敗時はページ全体が落ちるため「0件」と区別できる）を正とし、何もしない（`useState` の初期値のまま）。`GET /api/favorites` は出さない
2. 未同期エントリが**ある**場合は `PUT /api/favorites` で一括同期 → 完了後 `clearLocalFavorites()`、応答で state を更新。PUT が失敗したときだけ `GET /api/favorites` にフォールバック

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
- バナー（`CookieConsentBanner`）の文言は実際の保存先に合わせ、プライバシーポリシー「3. Cookie 等について」の書き方で「お気に入りにした走者の一覧をブラウザ内（ローカルストレージ）に保存」と書く。`role="region"`＋名前付き。「同意する」「拒否する」は同じ重さ（どちらも outline）
- 初回の自動表示は `/login`・`/onboarding`・`/dev/login` では見合わせる（中央のカードの主ボタンに重なるため）。ほかのページへ移ると、未回答なら表示する。`FavoriteButton` からの表示（`show` 指定）は対象外

---

## 関連ページ

| ページ | お気に入りの利用 |
|---|---|
| `/favorites` | お気に入り一覧。ログイン時は loader が DB から取得 → users JOIN で詳細返却。未ログイン時はクライアント側で localStorage → `POST /api/users/by-slugs` で詳細取得 |
| `/favorites/activity` | お気に入り走者の動き一覧（下記）。ホームの「お気に入り走者の動き」の「すべて見る」の遷移先 |
| `/browse` | ログイン時のみ、お気に入りを上位に並べ替え（loader で DB から取得） |
| `/player/:slug` | `<FavoriteButton slug={player.slug} />` でトグル |
| ホーム（`/`） | ライブ・ペース・動画でお気に入りを先頭に並べ替え。クライアント側の `useFavorites()` で適用し、ゲスト（Cookie 同意済み）も対象。`/api/home-feed` 自体はユーザー非依存（お気に入り・セッションを参照せず、CDN キャッシュ） |

---

## お気に入り走者の動き一覧 (/favorites/activity)

お気に入りにした走者の最近の動き（PaceMan のペース・YouTube/Twitch の動画・プロフィール更新・ガイドの公開/更新）を新しい順に並べるページ。ホームの「お気に入り走者の動き」欄（直近7日・10件）の全件版。

- **期間・件数**: 直近30日・最大100件（ホームは7日・10件）。サーバー側で `clampFavoriteActivityOptions`（`app/lib/home-favorite-activity-shared.ts`）が日数を最大30・件数を最大100に丸め、不正値は既定に戻す。同じ走者のペースはホームでは1人2件、このページでは1人5件まで。
- **お気に入りの解決**: ログイン済みはサーバーのお気に入り、未ログインはブラウザのお気に入り（ホームと同じ）。取得は `POST /api/home-favorite-activity`（本文に `windowDays` / `limit`）をクライアントから呼ぶ（`useFavoriteActivity`、`app/hooks/use-favorite-activity.ts`）。
- **除外**: 非公開・限定公開プロフィールは含めない。ホーム表示設定（`showPacemanOnHome` / `showYoutubeOnHome` / `showTwitchOnHome`）がオフの人の該当コンテンツも除外する（ホームと同じ `getFavoriteActivity`）。
- **表示**: 日付見出し（今日・昨日・それ以前は日付）で区切り、各行に時刻（HH:mm、端末のタイムゾーン）。行の文言と行コンポーネントはホームと共用（`app/components/favorite-activity-row.tsx`）。お気に入り0件・動き0件は `EmptyState`。
- **イベント種別**: ペース・動画・プロフィール更新・ガイドに加え、Ranked のレート帯 UP（`rankTierUp`）・Ranked PB 更新（`rankedPb`）・speedrun.com への申請（`srcSubmit`、審査中）・操作設定の変更（`settings`。メインプリセットへの切替〈プリセットを変更〉とメイン＝編集中プリセットの公開設定の保存のみ。`config_history` を `publicConfigChangeCondition()` で絞り、`change_type` は種別ラベルに使う。1人1日 changeType ごと1件）がある。データ元・精度・除外条件・文面は [home-live.md](./home-live.md#お気に入りの動き縦タイムライン) の「種類（追加分）」を参照。日付精度の種別（`rankTierUp` / `rankedPb`）はこのページの時刻列を空欄にする。Ranked 系は `showRankedStats === false` の人を除外する。一覧では rankTierUp・srcSubmit・settings は1人3件まで。
- **ペース行の挙動**: PaceMan のペース行（`kind: "pace"`。応答に `runId` を含む）は、行全体がタイムラインモーダル（`PaceTimelineModal`、`app/components/pace-timeline-modal.tsx`。`/paces` のペースカードと共用）を開くボタン（`aria-haspopup="dialog"`）になる。走者プロフィールへはアバターが別リンク（z-10）として残る。動画・ガイド・プロフィール更新の行は従来どおり該当ページへのリンク。
- **相互ナビ**: `/favorites` と `/favorites/activity` の両方のヘッダ直下に共通の切り替え `FavoritesNav`（「お気に入り走者」｜「動き」、現在ページに `aria-current="page"`）。見た目はページ間のタブ `ContentTabs`（`app/components/content-tabs.tsx`。ui.md 11章「ほかのタブ形」）。両ページの見出しは同じ形（素のアイコン＋h1。丸背景のアイコンチップは付けない）。

## SSR の扱い

- ログイン中のローダー（`/favorites` / `/browse`）は DB から取得して SSR に反映
- 未ログインは SSR では何もしない（クライアントの `FavoritesProvider` がマウント後に処理）
- `/_layout` ローダーで `initialFavorites` を取得し、`FavoritesProvider` に渡すことで初回描画のチラつきを軽減

---

## 関連ファイル

| ファイル | 役割 |
|---|---|
| `app/lib/schema.ts` | `favorites` テーブル定義 |
| `app/lib/favorites.ts` | サーバー側 DB CRUD + 旧 Cookie 削除ヘッダー + slug 変更時の追従更新（`retargetFavoritesOnSlugChange`） |
| `app/lib/mcid-change.server.ts` | `applyMcidSlugChange` から `retargetFavoritesOnSlugChange` を呼び出し（`/me/edit` の `save_all`・onboarding 共用） |
| `app/lib/favorites-client.ts` | クライアント側 localStorage 操作 |
| `app/hooks/use-favorites.tsx` | `FavoritesProvider` + `useFavorites` |
| `app/routes/api/favorites.ts` | GET / POST / PUT のお気に入り API |
| `app/routes/api/users/by-slugs.ts` | スラッグ配列→ユーザー詳細 API |
| `app/routes/favorites.tsx` | `/favorites` ページ |
| `app/routes/favorites-activity.tsx` | `/favorites/activity` ページ |
| `app/components/favorites-nav.tsx` | 上記2ページを行き来するルート間ナビ（`aria-current="page"`） |
| `app/components/favorite-activity-row.tsx` / `app/hooks/use-favorite-activity.ts` | 動きの行・文言 / 取得フック（ホーム欄と共用） |
| `app/lib/home-favorite-activity-shared.ts` | 期間・件数の定数（クライアントからも参照） |
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
- `/api/favorites` の応答（GET / POST / PUT）で旧 Cookie を `Max-Age=0` で自動削除（ログイン時の初期化では GET を出さなくなったため、お気に入りの追加・削除・同期のときに消える）
- `POST /api/users/by-slugs` を新設し、未ログインの一覧表示でも detail 取得を可能に
- ログイン中の sessionStorage キャッシュ（`minefolio_favorites_cache`）を廃止（SSR の `initialFavorites` を正とし、GET も出さないため不要になった）
