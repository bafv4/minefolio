# 認証・認可 仕様書

## 概要

MinefolioはDiscord OAuthによるソーシャルログインを採用している。認証基盤には [better-auth](https://www.better-auth.com/) を使用し、セッション管理・OAuthフロー・Cookie処理を一括で扱う。

---

## Discord OAuthログインフロー

### 使用ライブラリ

- サーバー側: `better-auth` (`betterAuth()`)
- クライアント側: `better-auth/react` (`createAuthClient()`)

### フロー

1. ユーザーが `/login` にアクセス
2. 既にセッションがある場合:
   - `users`テーブルにレコードがあれば `/player/{slug}` へリダイレクト
   - レコードがなければ `/onboarding` へリダイレクト
3. 未認証の場合、ログイン画面を表示
4. 「Discordでログイン」ボタン押下で `authClient.signIn.social()` を呼び出し
   - `provider: "discord"`
   - `callbackURL: "/onboarding"`
5. Discord OAuth認可後、better-authがコールバックを処理し、セッションを作成
6. `/onboarding` へリダイレクト

### OAuthスコープ

```
identify, email
```

### APIルーティング

`/api/auth/*` (splat route) で better-auth の `auth.handler(request)` に委譲。loader/action両方で同じハンドラを使用する。

---

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
4. 旧サイト (mchotkeys) のデータ存在チェック

### ステップ2: 確認・登録

1. MCIDとMinecraftアバターを表示して確認
2. レガシーデータがある場合、インポートの選択肢を表示
3. 登録処理:
   - `createId()` でユーザーID生成 (CUID2)
   - `generateSlug(mcid, discordId)` でスラッグ生成
   - `users` テーブルにINSERT
   - インポートまたはデフォルト値作成
4. `/player/{slug}` へリダイレクト

### MCIDスキップ

- MCIDなしでも登録可能 (`_action: "skip"`)
- スラッグは `@{discordId}` 形式になる
- `mcid`, `uuid` は `null`
- デフォルト値のみ作成 (レガシーインポート不可)

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
// セッションがなければ自動で /login へリダイレクト
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

## 関連ファイル

| ファイル | 役割 |
|---|---|
| `app/lib/auth.ts` | better-auth設定、`createAuth()` ファクトリ |
| `app/lib/auth-client.ts` | クライアント側authインスタンス (`createAuthClient`) |
| `app/lib/session.ts` | セッション取得ヘルパー群 |
| `app/routes/login.tsx` | ログインページ (Discord OAuthトリガー) |
| `app/routes/onboarding.tsx` | オンボーディング (MCID登録、ユーザー作成) |
| `app/routes/_layout.tsx` | ルートレイアウト (Discordアバター同期) |
| `app/routes/api/auth/splat.tsx` | better-auth APIハンドラ (`/api/auth/*`) |
