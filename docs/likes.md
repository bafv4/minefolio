# いいね機能 仕様書

## 概要

ガイドとサーチクラフトテンプレートに「いいね」（グッドボタン）を付けられる機能。v1.10.0 で追加。

- **ログイン必須**。未ログインは件数の閲覧のみ（詳細ページには「ログインしていいね」導線）
- **自分の投稿にはいいねできない**（件数は表示する。テンプレートの「適用回数」が自分の適用を除外するのと同じ方針）
- 1ユーザー1対象1件（ユニーク索引で保証）
- いいね数は一覧・詳細の両方に表示し、一覧には**人気順**の並び替えがある

---

## データモデル

対象ごとにテーブルを分ける（多態1テーブルにしない）。

### `guide_likes`

| カラム | 型 | 説明 |
|---|---|---|
| `id` | text (PK) | CUID2 |
| `guideId` | text (FK → `guides.id`, cascade) | 対象ガイド |
| `userId` | text (FK → `users.id`, cascade) | いいねしたユーザー |
| `createdAt` | timestamp | 作成日時 |

索引: `guide_likes_guide_user_uniq(guide_id, user_id)` (UNIQUE) / `guide_likes_user_idx(user_id, guide_id)`

### `search_craft_template_likes`

同形。`templateId` が `search_craft_templates.id` を参照する。

索引: `search_craft_template_likes_template_user_uniq(template_id, user_id)` (UNIQUE) / `search_craft_template_likes_user_idx(user_id, template_id)`

### 設計判断

**なぜ2テーブルか（多態1テーブルではなく）**
`favorites`（16節）の `favoriteSlug` は FK なしの弱参照で、対象削除時に孤児が残る問題を抱えている（スキーマにその旨のコメントがある）。多態テーブル `likes(target_type, target_id)` では `target_id` に FK を張れず、同じ問題を再発させる。libSQL は外部キーを既定で有効にする（`PRAGMA foreign_keys = 1`）ため、対象ごとにテーブルを分ければ **cascade が実際に効き**、ガイド・テンプレート・ユーザーいずれの削除でもいいねが自動的に消える。孤児GCも削除処理への追記も不要。

**なぜ非正規化カウンタを持たないか**
`guides.viewCount` / `searchCraftTemplates.applyCount` は非正規化カウンタだが、いいねは結合テーブルが実体なのでカウンタはキャッシュに過ぎず、ドリフトし得る。加えて `like_count integer default 0 not null` の追加は「falsyデフォルトのNOT NULL列」＝ `db:push` が TRUNCATE を提案する形（CLAUDE.md 参照）で、最も価値の高い2テーブルが対象になる。一覧は最大100行規模なので、**索引カバリングの相関サブクエリで都度算出**する方が安全で速度も十分。

**索引の列順**
`favorites` は `uniqueIndex(userId, ...)` だが、いいねは**対象列を先頭**にする。いいね数の相関サブクエリが索引だけで完結する（カバリング）ため。閲覧者の「いいね済み一覧」取得用には `(user_id, target_id)` の索引を別に張る。

---

## 可視性ルール

| 場面 | ルール |
|---|---|
| 一覧に出す（discovery） | `profileVisibility = "public"` のみ。ガイド一覧・テンプレート一覧とも |
| **いいねの可否** | `publiclyReferencableCondition`（public + unlisted）。かつ対象が公開済み |
| いいねの解除 | **無検査**（所有者・公開状態を見ない） |

**いいね可否に一覧と同じ「public のみ」を使ってはいけない**: 限定公開（unlisted）著者の投稿は URL 共有で正当に閲覧でき、ページにボタンも出るため、そこで 404 を返すと機能が壊れる。逆に無検査だと非公開著者の投稿が対象になる。

**解除を無検査にする理由**: 非公開化された後に自分のいいねを外せなくなるのを防ぐ。

**いいね数は liker の可視性で絞らない**: 第三者がプロフィールを非公開にしただけで他人の投稿の件数が減るのは説明できない挙動になるため。公開するのは集計値のみで、**いいねしたユーザーの一覧は一切公開しない**。

---

## API

### `POST /api/likes`

**リクエスト（JSON）:**
```json
{ "targetType": "guide" | "template", "targetId": "<cuid2>", "action": "like" | "unlike" }
```

**レスポンス:** `200 { "liked": boolean, "count": number }`（書き込み後の権威ある件数）

| ステータス | 条件 |
|---|---|
| 400 | JSON不正 / `targetType`・`targetId`・`action` が不正、`targetId` が64文字超 |
| 401 | 未ログイン、またはセッションはあるが `users` 行が無い（未オンボーディング） |
| 403 | 自分の投稿 |
| 404 | 不存在・未公開・著者が非公開（**すべて同一の応答**。存在の列挙オラクルにしない） |
| 405 | POST 以外 |

- `Cache-Control: private, no-store`
- **`getOptionalSession` を使い 401 を返す**。`getSession` は `throw redirect("/login")` するため、`fetch` が302を追って「200 + ログインHTML」を受け取り `res.json()` が壊れる
- `action: "like" | "unlike"` の絶対指定（トグルではない）。冪等なので再送・二重送信でも状態がずれない
- レート制限は設けない。ユニーク索引により1ユーザー1対象1件が上限で、濫用の天井はアカウント数（favorites と同じ）

---

## サーバー層（`app/lib/likes.server.ts`）

`db` を第一引数に取り、`Request`・セッションを扱わない（`favorites.ts` と同じ方針でテストしやすくする）。

| 関数 | 用途 |
|---|---|
| `guideLikeCountSql()` / `templateLikeCountSql()` | 一覧ローダー用のいいね数サブクエリ断片（`.select()` と RQB の `extras` の両方で使える） |
| `getViewerLikedIds(db, userId \| null)` | 閲覧者のいいね済み id（`_layout` で一括取得。上限 `VIEWER_LIKED_IDS_LIMIT = 2000`） |
| `getGuideLikeCount` / `getTemplateLikeCount` | 詳細ページ用の単体件数 |
| `getGuideLikeCounts` / `getTemplateLikeCounts` | id群→件数のマップ（0件の id は含まれない） |
| `likeGuide` / `unlikeGuide` / `likeTemplate` / `unlikeTemplate` | 本体。冪等 |
| `setLike(db, userId, targetType, targetId, liked)` | API ルート用ディスパッチャ |

- 重複は `onConflictDoNothing({ target: [...] })` で1文に吸収する（SELECT→INSERT だと連打でTOCTOUが残る）
- **自分の投稿の拒否はここで行う**（UIだけに任せない）。ガイドは `authorId`、テンプレートは `userId` と所有者列の名前が違う
- 戻り値は `{ ok: true, liked, count } | { ok: false, reason: "not_found" | "self" }`

---

## クライアント

### `LikesProvider`（`app/hooks/use-likes.tsx`）

`FavoritesProvider` と同じく `_layout.tsx` にマウントする。

- **いいね済みか**: `_layout` のローダーが `getViewerLikedIds` の結果を返し、それをシードにする（SSR時点で正しい状態が出る。クライアント取得だと未いいね状態が一瞬見える）
- **いいね数**: 基準値は各ページのローダー由来の props。Provider は自分が押した分の差分だけをオーバーライドとして保持し、**新しいローダー値が届いたら破棄**する（再検証後に古い件数が残らない）
- 連打対策に対象ごとの直列化、失敗時は楽観的更新の直前の値へロールバック（エラー表示はしない。件数が戻るのが合図）
- `useFetcher` は使わない（送信のたびに全ローダーが再検証され、ホームでは外部API取得が走る）

### `LikeButton`（`app/components/like-button.tsx`）

| variant | 用途 | 未ログイン / 自分の投稿 |
|---|---|---|
| `compact` | 一覧カードのメタ行。素の `<button>`（shadcn `Button` は `h-8` でメタ行が崩れ、`[&_svg:not([class*='size-'])]:size-4` が `h-3 w-3` に勝つ） | 静的な `<span>`（件数のみ） |
| `detail` | 詳細ページのアクション行。shadcn `Button` | 未ログインは `<Link to="/login">`、自分の投稿は `disabled` ＋ `disabled:opacity-100`（件数を読めるように） |

- 色は**テーマトークン `--brand`**。`favorite-button.tsx` の `text-red-500` は固定色で3テーマに対応せず、お気に入りと同色にもなるため流用しない
- 件数は `tabular-nums`（9→10 で行が揺れない）、いいね済みは `fill-current`
- クリックは `e.preventDefault(); e.stopPropagation()`

### 一覧カードの構造（重要）

ガイドカード・ガイドリスト・テンプレート行は、いずれも**カード全体を覆うリンクのオーバーレイ**方式にしている（`pace-feed-card.tsx` と同じ）:

```tsx
<div className="group relative ...">
  <Link to={...} className="absolute inset-0 z-0" aria-label={title} />
  ...
  <LikeButton variant="compact" ... />  {/* relative z-10 を内部で持つ */}
</div>
```

**`<a>` の子孫にインタラクティブ要素（`<button>` / `tabindex` 付き要素）を置くのは不正なHTML**のため、カード全体を `<Link>` で包む従来の構造は使えない。

---

## 並び替え

型と選択肢とパースは `app/lib/content-sort.ts`（React 非依存。ローダー側の `guideListOrderBy` と定義を共有するため）、UI は `ContentSortSelect`（`app/components/content-sort-select.tsx`）。`?sort=` で指定し、既定（`new`）ではパラメータを削除してURLを綺麗に保つ。

**選択肢は一覧ごとに異なる**ので `parseContentSort(value, allowed)` の `allowed` は必須にしている。省略可にすると、テンプレート一覧が `?sort=views` を受理して「UI は新着順なのに実際の順序が違う」状態になる。許可されていない値（廃止済みの旧 `?sort=recommended` を含む）は既定の `new` へ丸められるため、旧URLをブックマークしていてもエラーにはならず新着順で表示される。

| 一覧 | 選択肢（表示順） | 定数 |
|---|---|---|
| ガイド | 更新順 / いいね数順 / 閲覧数順 / 人気順 | `GUIDE_SORTS` |
| テンプレート | 新着順 / 人気順 | `TEMPLATE_SORTS` |

- ラベルはリストで異なる: ガイドは `updatedAt` 基準で**更新順**、テンプレートは `createdAt` 基準で**新着順**
- **並び替えは必ず SQL の `ORDER BY` で行う**。テンプレート一覧は `.limit(100)` が先に効くため、メモリ上で並べ替えると「新しい100件を人気順に並べた」結果になり、古くて人気のテンプレートが永久に出てこない
- タイブレークを必ず入れる（初日は全件0いいね・0PVで、無いと順序が不定になりページングも壊れる）
- **GETフォームには `sort` の hidden input が必要**（GETフォームはクエリを総入れ替えするため、無いと検索のたびにソートが解除される。`tag` / `lang` と同じ対処）

### ガイド一覧の並び順（`guideListOrderBy()`）

`guideListOrderBy()`（`likes.server.ts`）が単一情報源。`sort` の値ごとに以下を返す（すべて末尾に `id ASC` を持ちタイブレークを完結させる）:

| `sort` | 意味 | 並び順（タイブレーク込み） |
|---|---|---|
| `new`（既定） | 更新順 | `updatedAt DESC, id ASC` |
| `likes` | いいね数順（総いいね数） | `likeCount DESC, updatedAt DESC, id ASC` |
| `views` | 閲覧数順（`guides.viewCount` の累計） | `viewCount DESC, likeCount DESC, updatedAt DESC, id ASC` |
| `popular` | 人気順（直近7日のページビュー） | `pageviews DESC, likeCount DESC, updatedAt DESC, id ASC` |

- `popular` の `pageviews` は `guidePageViewsSql()`（`app/lib/page-view-stats.server.ts`）が返す `page_view_stats` の相関サブクエリ（likes と同じ「内側から `id` を消す」書き方を踏襲）。ページビュー集計がまだ無い・失敗している間は該当ガイドが全件0扱いになり、その場合は `likeCount → updatedAt` へ素直に落ちるので並びが破綻しない。集計の仕組み（Vercel Web Analytics・cron・テーブル定義）は [`docs/infrastructure.md`](./infrastructure.md#ページビュー集計vercel-web-analytics) を参照
- テンプレート一覧のタイブレークは従来どおり `likeCount DESC, createdAt DESC, id ASC`

### `popular` の意味はガイドとテンプレートで異なる（重要）

ガイドの `popular` は**直近7日のページビュー**基準、テンプレートの `popular` は**総いいね数**基準（従来の人気順のまま）。テンプレートには個別ページのページビューが無い（`/guides/templates/:id` は `page-view-paths.ts` の解釈対象外）ため、この差が生じる。ラベル（`contentSort.popular`）はどちらも「人気順」を共用する — 利用者から見て「よく見られている／支持されている」という意味は共通のため、あえてキーを分けていない。

### 廃止: おすすめ順（v1.11.0）

v1.10.0 で追加した「おすすめ順」（`recommended`。直近30日のいいね数 → 総いいね数 → 更新日時 → id）は v1.11.0 で廃止した。`guideListOrderBy()` の `recommended` 分岐、`RECENT_LIKE_WINDOW_DAYS`（30日）、`recentGuideLikeCountSql`、`recentLikeCutoff` は削除済み。廃止後に届く `?sort=recommended` は前述のとおり `new`（更新順）へフォールバックする。

---

## 相関サブクエリの書き方（`guideLikeCountSql` など）

いいね数は外側の1行ごとに数える相関サブクエリで求める。ここには**クエリの形によって黙って壊れる罠**が2つあるため、内側テーブルを `(select 必要な列だけ from ...)` で包む形に統一している。

1. drizzle は `${table.column}` を、**FROM が1テーブルだけのクエリ**（RQB の `findMany`、join なしの `select`）では**修飾なし**で描画する。素直に書くと `... from guide_likes where "guide_id" = "id"` となり、内側の `guide_likes` にも `id` があるためそちらへ解決され**常に0件**になる。SQLエラーにならないので「いいね0」と表示されるだけで気づけない
2. かといってテーブル名で明示的に修飾すると、今度は RQB が根テーブルを**スキーマのキー名**で別名にするため壊れる（`from "search_craft_templates" "searchCraftTemplates"` → `no such column`）

内側から `id` を消せば、外側の参照が修飾済み・未修飾のどちらで描画されても正しく外側の行に解決される。SQLite は単純な FROM 副問合せを平坦化するので索引の利用にも影響しない。

> この罠は実際に踏んでいる。v1.10.0 の初版では `/guides/:authorSlug`（著者別一覧）とプロフィールのガイドタブが RQB の `extras` 経路だったため、**いいね数が常に0と表示されていた**。`app/lib/__tests__/likes-sort.test.ts` が両方のクエリ形で実値を検証して再発を防いでいる。

---

## キャッシュとの関係

| データ | 性質 | 置いてよい場所 |
|---|---|---|
| いいね数 | 共有 | どこでも（CDNキャッシュされる応答を含む） |
| いいね済みか | 閲覧者依存 | **`public, s-maxage` の応答と `getCached()` の値には絶対に入れない** |

`/api/home-feed`・`/api/paces`・`/api/videos` はユーザー非依存を前提に CDN 配信している（`stale-while-revalidate` は最大1日）。閲覧者依存のデータを混ぜると、あるユーザーのいいね状態が他の全員に配信される。

---

## DB 反映

`pnpm db:generate` / `db:migrate` / `db:push` は使わない（journal が現行スキーマから乖離し、`db:push` は索引名ドリフトで失敗する）。

```bash
pnpm gen:test-schema                                    # test-schema.sql 再生成（テストに必須）
pnpm exec tsx scripts/add-like-tables.ts                # ローカル dry-run
pnpm exec tsx scripts/add-like-tables.ts --apply        # ローカル適用
pnpm exec tsx scripts/add-like-tables.ts --remote --apply  # リモート適用（要承認）
```

---

## 関連ファイル

| ファイル | 役割 |
|---|---|
| `app/lib/schema.ts`（25節） | `guideLikes` / `searchCraftTemplateLikes` |
| `app/lib/likes.server.ts` | サーバー層 |
| `app/routes/api/likes.ts` | API ルート |
| `app/hooks/use-likes.tsx` | `LikesProvider` / `useLike` |
| `app/components/like-button.tsx` | ボタン |
| `app/components/content-sort-select.tsx` | 並び替えUI |
| `app/lib/page-view-stats.server.ts` | `popular` で使うページビュー相関サブクエリ（詳細は [`docs/infrastructure.md`](./infrastructure.md#ページビュー集計vercel-web-analytics)） |
| `scripts/add-like-tables.ts` | DB反映スクリプト |
| `app/lib/__tests__/likes.server.test.ts` | サーバー層テスト |
| `app/routes/api/__tests__/likes.test.ts` | APIルートテスト |
| `app/routes/guides/templates/__tests__/index.test.ts` | 一覧の可視性・並び替えテスト |
