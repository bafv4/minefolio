# 認証・認可 仕様書

## 概要

MinefolioはDiscord OAuthによるソーシャルログインを採用している。認証基盤には [better-auth](https://www.better-auth.com/) を使用し、セッション管理・OAuthフロー・Cookie処理を一括で扱う。

---

## Discord OAuthログインフロー

### 使用ライブラリ

- サーバー側: `better-auth` (`betterAuth()`)
- クライアント側: `better-auth/react` (`createAuthClient()`)

### フロー

1. ユーザーが `/login`（任意で `/login?returnTo=<戻り先パス>` )にアクセス
2. 既にセッションがある場合:
   - `users`テーブルにレコードがあれば `returnTo`（あれば）／なければ `/player/{slug}` へリダイレクト
   - レコードがなければ `/onboarding`（`returnTo` があれば `?returnTo=` を付けて引き継ぐ）へリダイレクト
3. 未認証の場合、ログイン画面を表示
4. 「Discordでログイン」ボタン押下で `authClient.signIn.social()` を呼び出し
   - `provider: "discord"`
   - `callbackURL: "/onboarding"`（`returnTo` があれば `/onboarding?returnTo=<encodeReturnToForCallback済みの値>`）
5. Discord OAuth認可後、better-authがコールバックを処理し、セッションを作成
6. `/onboarding` へリダイレクト（`returnTo` はクエリで引き継がれる）

### OAuthスコープ

```
identify, email
```

### APIルーティング

`/api/auth/*` (splat route) で better-auth の `auth.handler(request)` に委譲。loader/action両方で同じハンドラを使用する。

---

## ログイン後の遷移先（returnTo）

ログイン画面へ遷移する前にいたページへ、ログイン後に戻れるようにする仕組み。

### 仕組み

- `app/lib/return-to.ts` の `sanitizeReturnTo(value)` が単一の検証関数。`redirect()` / `<Link to>`
  に渡す前に必ずこれを通す（オープンリダイレクト対策）
  - 許可: 先頭が `/` の同一オリジン相対パス（`pathname + search + hash`）
  - 拒否: `//evil.com`・`/\evil.com`（プロトコル相対と解釈されうる）、`https://...` などの絶対URL、
    スキームのみの値（`javascript:` 等）、制御文字を含む値、空文字・非文字列
  - 拒否（ループ・無意味な遷移防止）: `/login`・`/dev/login`・`/onboarding`・`/api/*` 配下
  - 不正・欠落時は `null` を返し、呼び出し側は既存の既定遷移先へフォールバックする
- `encodeReturnToForCallback(returnTo)` は better-auth の `signIn.social({ callbackURL })` に
  埋め込む場合専用のエンコード。better-auth はソーシャルログインの `callbackURL`（相対パス）を
  `^/(?!/|\\|%2f|%5c)[\w\-.+/@]*(?:\?[\w\-.+/=&%@]*)?$` で検証するため（`trustedOrigins.ts`）、
  `encodeURIComponent` がエスケープしない `! ~ * ' ( )` を追加でパーセントエンコードする。
  それ以外（`redirect()` の Location ヘッダー、`<Link to>` のクエリ組み立て）は通常の
  `encodeURIComponent` でよい

### 発生源（returnTo を生成する箇所）

- ヘッダーのログインリンク（`app/components/layout/header.tsx`）: 現在の
  `location.pathname + location.search` を `sanitizeReturnTo` した値
- `getSession()`（`app/lib/session.ts`）が未認証時に `throw redirect("/login")` する際、
  `request.url` の pathname + search から導出（`getCurrentUser` / `getCurrentUserOrOnboarding` も
  内部で `getSession` を使うため同じ挙動になる）

### 消費先（returnTo を使って遷移する箇所）

- `/login` の loader: セッション済みなら `returnTo`（あれば）へ即リダイレクト。未セッションなら
  Discord ボタンの `callbackURL` と `/dev/login` リンクのクエリに引き継ぐ
- `/dev/login` の loader（セッション済み時の `/login` へのリダイレクト）・action（ログイン成功後の
  `/login` へのリダイレクト。フォームの hidden input 経由で受け渡す）
- `/onboarding` の loader（既に `users` 行があれば `returnTo` へ即リダイレクト）・action
  （`complete`/`skip` で新規ユーザー作成後、`returnTo` があればそこへ。フォームの hidden input
  経由で受け渡す。新規ユーザーであっても、元々アクセスしようとしていたページへ自然に戻せるため
  意図的に対応している）

### スコープ外

- 「ログインして反映」等の各所の CTA（`like-button.tsx`, `profile-reaction-bar.tsx`,
  `home.tsx` のヒーローCTA, `guides/templates/view.tsx` 等）は本仕組みの対象外
  （ヘッダーのログインリンクと `getSession()` 経由の保護ルートのみ対応）

## セッション管理

### 設定値

| 項目 | 値 |
|---|---|
| 有効期間 (`expiresIn`) | 7日間 (604,800秒) |
| 更新間隔 (`updateAge`) | 1日 (86,400秒) |
| Cookie prefix | `minefolio` |
| DBアダプタ | Drizzle (SQLite) |

### セッションスキーマ

better-authが管理する4テーブル:

- `authUsers` - better-auth内部ユーザー
- `authSessions` - セッション
- `authAccounts` - OAuthアカウント連携
- `authVerifications` - 検証トークン

これらはアプリケーション独自の `users` テーブルとは別で、`discordId` を介して紐付ける。

---

## セッション取得ヘルパー

`app/lib/session.ts` に定義された4つのヘルパー関数:

### `getSession(request, auth)`

- 認証必須
- セッションがなければ `/login` へリダイレクト (`throw redirect`)
- 戻り値: `session` オブジェクト

### `getOptionalSession(request, auth)`

- 認証任意
- セッションがなければ `null` を返す
- レイアウトやログインページなど、認証状態に応じてUIを変えるケースで使用

### `getCurrentUser(request, auth, db)`

- 認証必須 + オンボーディング必須
- セッション取得後、`users` テーブルから `discordId` で検索
- ユーザーレコードがなければ `/onboarding` へリダイレクト
- 戻り値: `{ session, user }`

### `getCurrentUserOrOnboarding(request, auth, db)`

- 認証必須、オンボーディング任意
- ユーザーレコードがなくてもリダイレクトしない
- 戻り値: `{ session, user }` (userは `undefined` の可能性あり)

### `isAuthenticated(request, auth)`

- セッションの有無を `boolean` で返す

---

## オンボーディングフロー

### パス: `/onboarding`

### 前提条件

- ログイン済み (`getSession` で検証)
- `users` テーブルにレコードが存在しないこと (存在すれば `/player/{slug}` へリダイレクト)

### ステップ1: MCID入力

1. ユーザーがMinecraft Java EditionのMCIDを入力
2. バリデーション:
   - 必須 (スキップ可能 -- 後述)
   - 3~16文字
   - 他ユーザーと重複不可
3. Mojang APIでUUIDを取得 (`fetchUuidFromMcid`)

### ステップ2: 確認・登録

1. MCIDとMinecraftアバターを表示して確認
2. 登録処理:
   - `createId()` でユーザーID生成 (CUID2)
   - `generateSlug(mcid, discordId)` でスラッグ生成
   - `users` テーブルにINSERT
   - デフォルト値作成 (`createDefaultsForNewUser`)
3. `/player/{slug}` へリダイレクト

> 旧サイト (mchotkeys) からのデータ引き継ぎボタンは登録フローから削除済み。

### MCIDスキップ

- MCIDなしでも登録可能 (`_action: "skip"`)
- スラッグは `@{discordId}` 形式になる
- `mcid`, `uuid` は `null`
- デフォルト値のみ作成

---

## Discordアバター同期

### 仕組み

`_layout.tsx` の loader で毎回チェック:

```
session.user.image !== user.discordAvatar
```

差異がある場合、DBの `discordAvatar` カラムを更新する。

### タイミング

- 全てのページロード時 (`_layout` はルートレイアウト)
- `getOptionalSession` でセッション取得後に実行
- セッションがない場合やユーザーレコードがない場合はスキップ

### 保存先

`users.discordAvatar` カラム (テキスト)

---

## 保護ルートの仕組み

### パターン1: 認証必須ページ

```typescript
// loader内
const session = await getSession(request, auth);
// セッションがなければ自動で /login?returnTo=<元のURL> へリダイレクト
// （returnTo の検証は sanitizeReturnTo に集約。詳細は「ログイン後の遷移先（returnTo）」）
```

使用箇所: `/onboarding`, `/me/edit`, その他認証必須ページ

### パターン2: 認証任意ページ

```typescript
// loader内
const session = await getOptionalSession(request, auth);
// session は null の可能性あり
```

使用箇所: `_layout.tsx` (ヘッダーのログイン状態表示), `/login` (既にログイン済みならリダイレクト)

### パターン3: 認証 + ユーザー登録必須

```typescript
// loader内
const { session, user } = await getCurrentUser(request, auth, db);
// 未認証なら /login、未登録なら /onboarding へリダイレクト
```

使用箇所: プロフィール編集など、完全なユーザー情報が必要なページ

---

## ローカル開発の簡易ログイン（/dev/login）

ローカル開発では Discord OAuth を用意しなくても、簡易ログインで認証済みセッションを作れる
（詳細な手順は `docs/local-development.md`）。

- **有効化条件（二重ゲート）**: `DEV_AUTH=1` かつ `NODE_ENV !== "production"`
  （`isDevAuthEnabled()` in `app/lib/env.server.ts`）。満たさない場合 `/dev/login` は404、
  better-auth の `emailAndPassword` も無効のまま
- 仕組み: ローカル限定で better-auth の email/password 認証を有効化し、ユーザー名から
  `{username}@dev.local` + 固定パスワードでサインアップ/サインインする。以降のフロー
  （セッション・`/onboarding` での `users` 行作成）は Discord ログインと完全に共通
- Discord OAuth 未設定（`DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` なし）でも起動できるよう、
  `createAuth()` は未設定時に Discord プロバイダを登録しない

---

## 関連ファイル

| ファイル | 役割 |
|---|---|
| `app/lib/auth.ts` | better-auth設定、`createAuth()` ファクトリ |
| `app/lib/auth-client.ts` | クライアント側authインスタンス (`createAuthClient`) |
| `app/lib/session.ts` | セッション取得ヘルパー群 |
| `app/lib/return-to.ts` | ログイン後の遷移先（returnTo）の検証・エンコード（`sanitizeReturnTo` / `encodeReturnToForCallback`） |
| `app/routes/login.tsx` | ログインページ (Discord OAuthトリガー) |
| `app/routes/onboarding.tsx` | オンボーディング (MCID登録、ユーザー作成) |
| `app/routes/dev-login.tsx` | ローカル開発専用の簡易ログイン（`DEV_AUTH=1` 時のみ） |
| `app/routes/_layout.tsx` | ルートレイアウト (Discordアバター同期) |
| `app/routes/api/auth/splat.tsx` | better-auth APIハンドラ (`/api/auth/*`) |
