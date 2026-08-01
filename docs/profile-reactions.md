# プロフィール絵文字リアクション 仕様書

## 概要

プロフィールに Discord 風の絵文字リアクションを付けられる機能。表示位置はプロフィールカード内・アクションボタン行（編集/お気に入り/シェア/比較）の**直下**。

- **固定8種**の Unicode 絵文字のみ（Discordの定番）: 👍 ❤️ 😂 😮 😢 🎉 🔥 💯
- **自分のプロフィールにも押せる**（[`docs/likes.md`](./likes.md) と異なり self 拒否なし）
- **カウントのみ公開**。押した人の一覧は一切非公開で、自分の押下のみハイライトする
- 1ユーザー・1プロフィール・1絵文字につき1件（3列ユニーク索引で保証）

設計はいいね機構（[`docs/likes.md`](./likes.md)）の相似形。差分は (a) self許可 (b) ユニークキーが3列、の2点。

---

## 標準機能（フィーチャーフラグは撤去済み）

v1.14系までは `FEATURE_PROFILE_REACTIONS` 環境変数でガードされたフィーチャーフラグ機能だったが、
Dev環境・本番の両方で先行有効化・展開が完了したため、フラグ判定（`isProfileReactionsEnabled()`
= `app/lib/env.server.ts`、`/player/:slug` loader のガード、`POST /api/profile-reactions` の
404ゲート）は撤去し、**常時有効の標準機能**にしている。

- `/player/:slug` の loader は常に `getProfileReactionCounts` / `getViewerProfileReactions` を呼び、
  `profileReactions: { counts, viewerReactions, viewerHasAccount }`（非null）を返す
- `POST /api/profile-reactions` にフラグゲートはなく、405/401/400/404 の判定のみで応答する
- `app/lib/profile-reactions.server.ts` は元々フラグを見ない設計（`db` を第一引数に取る既存方針＝
  Request文脈を持たない関数にフラグ分岐を混ぜない）だったため、この撤去による変更はない

> **デプロイ前の必須手順**: `profile_reactions` テーブルが存在しない環境（未適用のリモートDB等）
> にこの機能をデプロイすると、profile loader が例外で落ちる（フラグによる回避が無いため）。
> デプロイ前に必ず「DB反映」節の `scripts/add-profile-reactions-table.ts --remote --apply` を
> 適用済みであることを確認する。

---

## データモデル

### `profile_reactions`

| カラム | 型 | 説明 |
|---|---|---|
| `id` | text (PK) | CUID2 |
| `profileUserId` | text (FK → `users.id`, cascade) | リアクション対象のプロフィール |
| `reactorUserId` | text (FK → `users.id`, cascade) | リアクションしたユーザー |
| `emoji` | text | 固定8種のいずれか（`PROFILE_REACTION_EMOJIS`） |
| `createdAt` | timestamp | 作成日時 |

索引: `profile_reactions_profile_emoji_reactor_uniq(profile_user_id, emoji, reactor_user_id)`（UNIQUE） / `profile_reactions_reactor_idx(reactor_user_id, profile_user_id, emoji)`

`profileUserId` と `reactorUserId` が両方 `users.id` を参照するため、`relations()` は `relationName` で「プロフィール側（`profileReactionsReceived`）」と「押した側（`profileReactionsGiven`）」の2方向を区別する。

### 索引の列順（重要・変更しない）

- **ユニーク索引は `profileUserId` を先頭にする**: プロフィール1件のカウント集計（`where profile_user_id = ? group by emoji`）がこの索引だけで完結する（カバリング索引）。3列一致の一意性制約（1人1対象1絵文字1件）もこの索引が兼ねる
- **`reactorUserId` 索引は `reactorUserId` を先頭にする**: 「自分（reactor）がどのプロフィールにどの絵文字を押したか」を reactor 起点で引く経路（閲覧者の押下取得・解除の delete）専用のため

いいね（`docs/likes.md` の「索引の列順」）と同じ考え方だが、対象列だけでなく **`emoji` も含めた3列**が対象キーになる点が違う（1人が同じ対象に同じ絵文字を複数回押すのを防ぐ必要があるため）。

### なぜ非正規化カウンタを持たないか

いいねと同じ理由（[`docs/likes.md`](./likes.md#設計判断)）で、`profile_reactions` テーブルの `COUNT(*)` を都度算出する。非正規化カウンタ列を足すと「falsyデフォルトのNOT NULL列」＝ `db:push` が TRUNCATE を提案する形になる。

---

## 可視性ルール

| 場面 | ルール |
|---|---|
| 追加（react） | 対象プロフィールが存在し、かつ **`private` の場合は reactor が本人であること**を検査する。private かつ本人以外は `not_found`（不存在と区別しない） |
| 追加・self | **本人は自分のプロフィールが `private` でも押せる**（self 拒否なし。いいねの「自分の投稿は拒否」とは逆の方針） |
| 解除（unreact） | **無検査**（所有者・公開状態を見ない delete）。非公開化された後でも自分の分は外せる |
| カウントの公開範囲 | **押した人（reactor）の一覧は一切公開しない**。API・loader とも reactor 情報を返さない。公開するのは絵文字ごとの集計値のみ |

可視性チェックは**追加時のみ**行う。これはいいね（[`docs/likes.md`](./likes.md#可視性ルール)）の「いいねの解除は無検査」と同じ思想で、非公開化後に自分のリアクションを外せなくなるのを防ぐ。

---

## API

### `POST /api/profile-reactions`

**リクエスト（JSON）:**
```json
{ "profileUserId": "<内部ユーザーID>", "emoji": "👍", "action": "react" | "unreact" }
```

**レスポンス:** `200 { "reacted": boolean, "count": number }`（書き込み後にテーブルを数え直した権威値）

判定は上から順に評価し、該当した時点で応答する:

| 順 | 条件 | ステータス |
|---|---|---|
| ① | POST以外 | 405 |
| ② | 未ログイン、またはセッションはあるが `users` 行が無い（未オンボーディング） | 401 |
| ③ | JSON不正 / `profileUserId` が空・64文字超 / `emoji` が allowlist（固定8種）外 / `action` が `react`/`unreact` 以外 | 400 |
| ④ | 対象プロフィール不存在、または `private` かつ reactor が本人以外 | 404（②と同じ形の応答で存在の列挙オラクルにしない） |

- `Cache-Control: private, no-store`
- **`getOptionalSession` を使い 401 を返す**（`getSession` は `throw redirect("/login")` するため、`fetch` が302を追って「200 + ログインHTML」を受け取り `res.json()` が壊れる。`api/likes.ts` と同じ理由）
- `action: "react" | "unreact"` の絶対指定（トグルではない）。冪等なので再送・連打でも状態がずれない
- レート制限は設けない。ユニーク索引により1ユーザー1対象1絵文字1件が上限で、濫用の天井は「アカウント数 × 8絵文字」

### 入力が内部 `userId` である理由

`targetId`（＝ `profileUserId`）は Discord ID やスラッグではなく `users.id`（内部 CUID2）で渡す。理由は `api/likes.ts` の `targetId` と同じ前例に倣ったもので:

- プロフィールページの loader は表示対象の `player.id` を既に手元に持っており、リクエスト側で追加クエリが要らない
- CUID2 はランダムなため、この値だけを渡っても他人のプロフィールを列挙できない

---

## サーバー層（`app/lib/profile-reactions.server.ts`）

`likes.server.ts` と同じ作法で、`db` を第一引数に取り `Request` / セッションを扱わない（テストしやすくするため）。

| 関数 | 用途 |
|---|---|
| `getProfileReactionCounts(db, profileUserId)` | 絵文字別カウント。`group by emoji` で集計し、0件の絵文字は含めず、**`PROFILE_REACTION_EMOJIS` の並び順に整列**して返す（表示順の安定化。将来絵文字セットを変更した場合の allowlist 外の遺物行も走査対象外になり自然に除外される） |
| `getViewerProfileReactions(db, profileUserId, viewerUserId \| null)` | 閲覧者がこのプロフィールに押している絵文字一覧（ピルのハイライト判定用）。`viewerUserId` が `null`（未ログイン）なら SQL を発行せず `[]` を返す（`getViewerLikedIds` と同方針） |
| `setProfileReaction(db, reactorUserId, profileUserId, emoji, reacted)` | 追加・解除の本体（冪等・APIルート用ディスパッチャ）。追加時のみ可視性チェック（「可視性ルール」節）を行い、`onConflictDoNothing({ target: 3列 })` で連打の重複挿入を1文で吸収する。解除は無検査 delete。戻り値は `{ ok: true, reacted, count }`（成功）または `{ ok: false, reason: "not_found" }`（不存在・private本人以外、区別せず） |

`app/lib/profile-reactions.ts`（非 `.server`）には、クライアント（パレット描画・aria ラベル生成）とサーバー（許可リスト検証）の両方から import する定数・型を置く:

- `PROFILE_REACTION_EMOJIS`（固定8種、`as const`）。❤️ は **VS16（U+FE0F）付き**で定数化しており、VS16 なしの `"❤"`（U+2764 単体）は別バイト列として扱い allowlist 外＝400 になる
- `PROFILE_REACTION_EMOJI_KEYS`（aria用 i18n キー接尾辞: `thumbsUp` / `heart` / `joy` / `wow` / `cry` / `tada` / `fire` / `hundred`。`PROFILE_REACTION_EMOJIS` と同じ並び順で対応）
- `isProfileReactionEmoji(value)`（Set による**完全一致**判定。NFC正規化などは行わない — DBに入ってよいのはこの8種の正確なバイト列のみ、という方針で絵文字の正規化揺れを構造的に排除する）

---

## クライアント

プロフィールページ（`/player/:slug`）1画面でのみ使う機能のため、いいね（`LikesProvider` によるグローバル状態）とは異なり **単一ページ用のローカルフックに簡略化**している。一覧・カードなど複数箇所に同じ状態を配る必要がなく、`_layout.tsx` にマウントするグローバル Provider を追加するコストに見合わないための判断。

**フックの呼び出し位置は `ProfileReactionBar` 自身ではなく `PlayerProfilePage`（`app/routes/player/profile.tsx`、Tabs を描画する親コンポーネント）**にする。Radix `TabsContent` は非アクティブになると外枠の `role="tabpanel"` ノードは維持したまま中の子要素を unmount する。`ProfileReactionBar` は `<TabsContent value="profile">` の中にあるため、もしバー自身の中で `useProfileReactions()` を呼ぶと、別タブへ切替 → 「プロフィール」タブに戻る、のたびに state（`overrides`）が失われる。タブ切替では `?tab=` の更新のみで loader は再実行されない（`shouldRevalidate` による最適化）ため、remount 後は loader 初回読み込み時点の古い `initialCounts`/`initialViewerReactions` から再スタートしてしまい、直前に押したリアクションが外れて見える（DB自体は正しく、ハードリロードすれば直る）。`PlayerProfilePage` はタブ切替で re-render はされるが unmount はされないため、ここで state を保持すれば解決する。

### `useProfileReactions`（`app/hooks/use-profile-reactions.ts`）

`use-likes.tsx` の戦訓を単一対象用に簡略化して継承している:

- **グローバル Provider にしない**（対象は常に1プロフィールのみで、ページコンポーネント内で閉じるため Context を挟む理由がない）
- **素の `fetch`**（`useFetcher` は使わない）。profile loader は PaceMan 等の外部APIを叩く重い loader のため、送信のたびに全体を再検証させたくない
- **絵文字ごとに直列化**（`chainsRef` で対象絵文字ごとに直前の Promise を待ってから次を実行し、連打時の TOCTOU を避ける）
- **楽観的更新 + 失敗時ロールバック**（`reacted` を反転・`count` を ±1、下限0でクランプ。成功時は応答の権威 `count` で確定し、失敗時は直前値に戻す。エラー表示はしない＝件数が戻るのが合図）
- **`overridesRef`**（stale closure 対策の鏡。`use-likes.tsx` / `use-favorites.tsx` と同じ理由）
- props（`initialCounts` / `initialViewerReactions`）が更新されたら、通信中でない絵文字については override を破棄して新しい値へ reconcile する（再検証後に古い件数が残らない）
- 戻り値: `pills`（`PROFILE_REACTION_EMOJIS` の並び順に固定した8件。表示側で `count > 0` に絞り込む）/ `toggle(emoji)`

### `ProfileReactionBar`（`app/components/profile-reaction-bar.tsx`）

**表示専用コンポーネント**で、内部で `useProfileReactions()` は呼ばない。Props: `pills`（`useProfileReactions()` の戻り値をそのまま渡す） / `toggle`（同） / `isLoggedIn` / `className?`

- ピル: `count > 0` の絵文字のみ表示。**表示順は `PROFILE_REACTION_EMOJIS` 固定**（カウント順にすると押すたびに並びが入れ替わって視認性が悪い）。自分が押している絵文字はブランドトークン（`border-brand/40 bg-brand/10 text-brand`、`like-button` と同トークン）でハイライトする。`aria-pressed` / `aria-busy` / `aria-label`（`profileReactions.reactAria` / `unreactAria`）を付与
- 追加ボタン: lucide `SmilePlus` + shadcn `Popover` 内に `grid grid-cols-4` の固定8絵文字パレット（8件全て表示、押下済みは `bg-brand/10`）。選択でトグルしてパレットを閉じる
- 未ログイン: ピルは静的な `<span>`（カウントは公開情報のため見える）。`aria-label` は `profileReactions.pillAria`。追加ボタンは `/login` への `Link`（`profileReactions.loginToReact`）
- **カウント0件かつ未ログインの場合はバー自体を非表示**にする（ログイン済みなら0件でも追加ボタンを出す必要があるため表示する）

### 組み込み（`app/routes/player/profile.tsx`）

- loader は常に `getProfileReactionCounts` / `getViewerProfileReactions` を呼び、`profileReactions: { counts, viewerReactions, viewerHasAccount }`（非null）を返す。閲覧者が本人ならプロフィール対象の `player.id` をそのまま使い（追加クエリなし）、他人ログイン中は discordId → id を1回引く（未ログインは `null`）
- **`useProfileReactions()` は `PlayerProfilePage`（Tabs を描画する親コンポーネント）のトップレベルで呼ぶ**（他の hooks と同じ並び、条件分岐の外）。戻り値の `pills`/`toggle` を `<ProfileReactionBar>` に props として渡す（理由は上の「`useProfileReactions`」節の呼び出し位置の説明を参照）
- 表示はアクションボタン行（編集/お気に入り/シェア/比較）の**閉じタグ直後**。`isLoggedIn` プロップには `viewerHasAccount`（セッションはあるが `users` 行が無い＝未オンボーディングは false 扱い）を渡す
- i18n: `pages-ja.ts` の `likes` 節近くに `profileReactions` 節（`addLabel` / `loginToReact` / `reactAria` / `unreactAria` / `pillAria`（未ログイン時の静的ピルの aria-label） + `emoji.thumbsUp`〜`emoji.hundred` の8種名）を持つ。`pages-en.ts` にも対訳あり

---

## キャッシュ規律

| データ | 性質 | 置いてよい場所 |
|---|---|---|
| 絵文字別カウント | 共有（誰から見ても同じ値） | どこでも |
| 閲覧者の押下状態（`viewerReactions`） | 閲覧者依存 | **`public` キャッシュ・`getCached()` の値には絶対に入れない**。`/api/profile-reactions` の応答は常に `private, no-store` |

`docs/likes.md`「キャッシュとの関係」と同じ規律。閲覧者依存のデータを CDN 配信・共有キャッシュに混ぜると、あるユーザーの押下状態が他の全員に配信されてしまう。

`/player/:slug` ページ自体も `headers()` export で `Cache-Control: private, no-store` を返す（`docs/profiles.md`「キャッシュ方針」参照）。これが無いと `prefetch="intent"` のホバー先読みがブラウザにキャッシュされ、リアクション後に別ページ経由で再訪した際に古い状態が表示される不具合になる。

---

## DB 反映

`pnpm db:generate` / `db:migrate` / `db:push` は使わない（`docs/likes.md`「DB反映」と同じ理由: journal が現行スキーマから乖離しており、`db:push` は索引名ドリフトで失敗する）。

```bash
pnpm gen:test-schema                                              # test-schema.sql 再生成（テストに必須）
pnpm exec tsx scripts/add-profile-reactions-table.ts              # ローカル dry-run
pnpm exec tsx scripts/add-profile-reactions-table.ts --apply      # ローカル適用
pnpm exec tsx scripts/add-profile-reactions-table.ts --remote          # リモート dry-run
pnpm exec tsx scripts/add-profile-reactions-table.ts --remote --apply  # リモート適用（要承認）
```

DDL は `pnpm gen:test-schema`（drizzle-kit export）の出力と同一に、再実行に備えて `IF NOT EXISTS` のみ付け足したもの。新規テーブルの追加のみで既存データは変更しない。

> **デプロイ前に必須**: 本機能は常時有効（フィーチャーフラグ無し）のため、`profile_reactions`
> テーブルが無い環境に対して profile loader は無条件でこのテーブルへクエリを発行する。
> リモート（devブランチ・本番共有のTurso）へのデプロイ前に、上記の
> `scripts/add-profile-reactions-table.ts --remote --apply` の適用が完了していることを必ず確認する
> （未適用のままデプロイすると `/player/:slug` が例外で落ちる）。

---

## 関連ファイル

| ファイル | 役割 |
|---|---|
| `app/lib/schema.ts`（26節） | `profileReactions` テーブル定義・relations・型 |
| `app/lib/profile-reactions.ts` | 固定8絵文字・型・allowlist判定（非 `.server`、クライアント/サーバー共用） |
| `app/lib/profile-reactions.server.ts` | サーバー層（カウント取得・閲覧者の押下取得・追加解除ディスパッチャ） |
| `app/routes/api/profile-reactions.ts` | 追加・解除API |
| `app/routes/player/profile.tsx` | プロフィール表示ページ（loaderでの取得・バー組み込み） |
| `app/hooks/use-profile-reactions.ts` | 単一ページ用ローカルフック |
| `app/components/profile-reaction-bar.tsx` | ピル表示 + 追加ボタン（Popover パレット） |
| `app/lib/messages/pages-ja.ts` / `pages-en.ts` | `profileReactions` 節（ボタン文言・aria・絵文字名） |
| `scripts/add-profile-reactions-table.ts` | DB反映スクリプト（デプロイ前に `--remote --apply` の適用が必須） |
| `app/lib/__tests__/profile-reactions.server.test.ts` | サーバー層テスト |
| `app/routes/api/__tests__/profile-reactions.test.ts` | APIルートテスト |
| `docs/likes.md` | 相似形の元になったいいね機構の仕様書 |
