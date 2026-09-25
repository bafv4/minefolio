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
   - 登録済み（`users` 行があり `onboardingCompleted === true`）なら `returnTo`（あれば）／なければ `/player/{slug}` へリダイレクト
   - レコードが無い、またはウィザード未完了（`onboardingCompleted === false`）なら `/onboarding`（`returnTo` があれば `?returnTo=` を付けて引き継ぐ）へリダイレクト
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
- `/onboarding` の loader（登録済み＝`onboardingCompleted === true` なら `returnTo` へ即リダイレクト）・
  action（最終ステップ `save_visibility` が完了画面の「プロフィールを見る」の遷移先として
  `returnTo`（無ければ `/player/{slug}`）を返す。フォームの hidden input 経由で受け渡す。
  新規ユーザーであっても、元々アクセスしようとしていたページへ自然に戻せるため意図的に対応している）

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

### 期限切れ行のクリーンアップ

better-auth は `expiresAt` を過ぎた `authSessions` / `authVerifications` を無効扱いにするだけで DB から削除しない。IPアドレス・User-Agent を含む `authSessions` が残り続けないよう、cron `/api/cron/cleanup-auth` が日次で期限切れ行を物理削除する（猶予なし即時削除。詳細は [`docs/api.md`](./api.md#get-apicroncleanup-auth) 参照）。

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
- `onboardingCompleted`（ウィザード完了フラグ）は見ない。ウィザード途中で離脱したユーザーも行があれば通す（「オンボーディングフロー」参照）
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

SNS（X / Instagram 風）のウィザード式初期設定。公開レイアウト内の中央寄せ 1 枚カードで、
ようこそ画面 → ステップ1〜5 → 完了画面の順に進む。実装は `app/routes/onboarding.tsx`
（ステップ枠の共通部品は `app/components/onboarding/onboarding-step.tsx`）。

### 「登録済み」の判定

- **登録済み** = `users` 行があり、かつ `users.onboardingCompleted === true`
- `onboardingCompleted` は DB 既定値が `true`（列追加前から存在する全ユーザーは完了済み扱い。バックフィル不要）。
  ウィザード開始時（`_action=start`）の insert だけが明示的に `false` を入れ、最終ステップの保存で `true` になる
- `/login` の loader: セッション済みで `!user || !user.onboardingCompleted` なら `/onboarding` へ（returnTo 引き継ぎ）
- `/onboarding` の loader: 登録済みなら `returnTo || /player/{slug}` へリダイレクト。
  行が無ければようこそ画面から、行があり未完了ならステップ1から再開する（保存済みの値を各入力の初期値に使う）
- `getCurrentUser` などセッションヘルパーは `onboardingCompleted` を見ない（行の有無だけで判定する）。
  ウィザードを途中で離脱してもアプリ全体はロックせず、未設定の項目は後から `/me/edit` で設定できる

### 前提条件

- ログイン済み (`getSession` で検証)

### ステップ構成

各ステップは「タイトル＋説明」→ フォーム → フッター（左「戻る」、右「スキップ」「次へ」）。
ステップ遷移はクライアント側の state、保存は各ステップの `useFetcher` POST（`_action` で分岐）。
保存に成功（＋ loader の再検証完了）したら次のステップへ進み、失敗ならフォーム内にエラーを表示する。
**「スキップ」は保存せずに次へ進むだけ**（サーバー呼び出しなし）。

| ステップ | `_action` | 内容 |
|---|---|---|
| 0 ようこそ | `start` | Discord アバター＋「ようこそ、{Discord表示名}さん」。「はじめる」で `users` 行を作成（下記） |
| 1 プロフィール | `save_profile` | 表示名・アルファベット表記・ひとこと・自己紹介・所在地・代名詞。検証は `/me/edit` の基本情報フォームと同じ |
| 2 Minecraft | `save_minecraft` | Java版 MCID（任意）・Bedrock版 MCID（任意） |
| 3 スキン | （なし） | 現在のスキンのプレビューと `SkinUploader` によるカスタムスキンのアップロード／削除（既存 API `/api/me/skin`）。完了後は loader を再検証してプレビューを更新 |
| 4 連携 | `save_links` | YouTube / Twitch / X / Speedrun.com の ID |
| 5 公開設定 | `save_visibility` | **スキップ不可**。公開範囲（public / unlisted / private、既定選択なし・必須）とその他の表示設定トグル |

#### ステップ0: `start`（`users` 行の作成）

- `displayName` = Discord 表示名、`displayNameAlphabet` = Discord 表示名が印字可能 ASCII（`/^[ -~]+$/`）かつ 50 文字以内ならそれ、そうでなければ `null`
- `slug = generateSlug(null, discordId)`（`@{discordId}` 形式）、`mcid` / `uuid` は `null`
- **`profileVisibility: "private"`**（ウィザード完了までは検索・一覧に出さない。公開範囲は最終ステップで必ず本人が選ぶ）
- **`onboardingCompleted: false`**
- 挿入成功後に `claimSlug()` と `createDefaultsForNewUser()`。UNIQUE 違反は `errorAlreadyRegistered`
- 既に行がある（未完了からの再開）なら何もせず成功を返す

#### ステップ1: 表示名の Discord フォールバック

- 表示名が未入力なら Discord 表示名を保存する
- アルファベット表記が未入力なら、Discord 表示名が印字可能 ASCII かつ 50 文字以内のときだけそれを保存し、そうでなければ `null`（start と同じ規則）

#### ステップ2: MCID

- Java版 MCID: 入力があり現在値と異なれば `/me/edit` の `set_mcid` と同じ処理（3〜16 文字・他ユーザー重複チェック・
  Mojang API で UUID 取得・`generateSlug(mcid, discordId)`・トランザクション内で `recordSlugChange` と
  `retargetFavoritesOnSlugChange`）。空欄で現在 MCID があれば `remove_mcid` 相当で解除（slug は `@{discordId}` に戻る）
- Bedrock版 MCID: `set_bedrock_mcid` と同じ検証（3〜24 文字・制御文字禁止）。空欄なら `null`
- ウィザード中は常に非公開のため、`set_mcid` が行う YouTube 動画キャッシュの追従は行わない（公開への切替時に追いつかせる）

#### ステップ4: 連携

- 各 ID は `/me/edit` の `create_link` と同じ形式検証（100 文字以内、YouTube は禁止文字方式、それ以外は `/^[\w\-]+$/`）
- `social_links` へプラットフォーム単位で upsert（あれば identifier 更新、無ければ作成、空欄なら該当プラットフォームの行を削除）。カスタムリンクは扱わない
- Speedrun.com は `users.speedruncomUsername` にも同期し、値が変わったら `speedruncomId` を `null` にリセットして SRC ランキングを即時更新
- Twitch VOD / YouTube 動画キャッシュの取得はここでは行わない（非公開中は cron 対象外）

#### ステップ5: 公開設定（完了）

- 公開範囲を enum 検証し、表示設定トグルと合わせて更新。同じ update で **`onboardingCompleted: true`** にする
- 非公開→公開に切り替わる場合は `/me/edit` と同じく Twitch / YouTube / SRC のキャッシュを `runAfterResponse` で追いつかせる
- リダイレクトせず `{ success: true, action: "complete", slug, redirectTo, ... }` を返し、クライアントが完了画面を表示する
  （この action の後だけ loader の再検証を抑止する。再検証すると「登録済み → リダイレクト」で完了画面が飛ぶため）

### 完了画面

- 「設定が完了しました」＋「ようこそ、{保存済みの表示名}さん！」（英語ロケールでは `displayNameAlphabet ?? displayName`）
- CTA:「プロフィールを見る」（`returnTo` があればそこ、無ければ `/player/{slug}`）・「さらに詳しく設定する」（`/me/edit`）

> 旧サイト (mchotkeys) からのデータ引き継ぎボタンは登録フローから削除済み。

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
| `app/routes/onboarding.tsx` | オンボーディング（ウィザード式初期設定。ユーザー作成・プロフィール/MCID/連携/公開設定の保存） |
| `app/components/onboarding/onboarding-step.tsx` | ウィザードのステップ枠（ステップ表示＋Progress・エラー・フッター） |
| `app/routes/dev-login.tsx` | ローカル開発専用の簡易ログイン（`DEV_AUTH=1` 時のみ） |
| `app/routes/_layout.tsx` | ルートレイアウト (Discordアバター同期) |
| `app/routes/api/auth/splat.tsx` | better-auth APIハンドラ (`/api/auth/*`) |
