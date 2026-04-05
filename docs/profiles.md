# プレイヤープロフィール 仕様書

## 概要

Minefolioの中核機能。各ユーザーはMinecraftスピードラン向けのプロフィールを持ち、キーバインド・アイテム配置・記録などを公開できる。

---

## ユーザーデータ構造

### `users` テーブル

| カラム | 型 | 説明 |
|---|---|---|
| `id` | text (PK) | CUID2で自動生成 |
| `discordId` | text (unique, NOT NULL) | Discord OAuth ID |
| `mcid` | text (unique, nullable) | Minecraft Java Edition ID |
| `uuid` | text (unique, nullable) | Minecraft UUID |
| `slug` | text (unique, NOT NULL) | URL用スラッグ |
| `displayName` | text | 表示名 |
| `discordAvatar` | text | Discordアバター (セッションから自動同期) |
| `bio` | text | プロフィール説明文 |
| `shortBio` | text | 短い説明文 (OGP等で使用) |
| `hasImported` | boolean | レガシーデータインポート済みフラグ |
| `profileVisibility` | enum | `public` / `unlisted` / `private` |
| `profilePose` | enum | `standing` / `walking` / `waving` |
| `slimSkin` | boolean | スリムスキン使用 |
| `location` | text | 所在地 |
| `pronouns` | text | 代名詞 |
| `defaultProfileTab` | enum | デフォルト表示タブ |
| `featuredVideoUrl` | text | 注目動画URL |
| `mainEdition` | enum | `java` / `bedrock` |
| `mainPlatform` | enum | `pc_windows` / `pc_mac` / `pc_linux` / `switch` / `mobile` / `other` |
| `role` | enum | `viewer` / `runner` |
| `inputMethod` | enum | `keyboard_mouse` / `controller` / `touch` |
| `inputMethodBadge` | enum | バッジ用入力方法 (inputMethodとは独立) |
| `speedruncomUsername` | text | Speedrun.comユーザー名 |
| `speedruncomId` | text | Speedrun.com ID |
| `profileViews` | integer | プロフィール閲覧数 |
| `customSkinUrl` | text | カスタムスキンURL (Vercel Blob) |
| `customSkinModel` | enum | `default` / `slim` |
| `customSkinUpdatedAt` | timestamp | カスタムスキン更新日時 |

### インデックス

- `idx_users_discord_id` (discordId)
- `idx_users_mcid` (mcid)
- `idx_users_uuid` (uuid)
- `idx_users_slug` (slug)
- `idx_users_speedruncom_id` (speedruncomId)

---

## プロフィール公開設定

| 値 | 挙動 |
|---|---|
| `public` | 誰でも閲覧可能、検索対象 |
| `unlisted` | URLを知っていれば閲覧可能、検索対象外 |
| `private` | 本人のみ閲覧可能 |

デフォルト値: `public`

---

## スラッグ (URL識別子)

`app/lib/slug.ts` で生成。

### 生成ルール

| 条件 | スラッグ | 例 |
|---|---|---|
| MCIDあり | MCID そのまま | `Dream` |
| MCIDなし | `@{discordId}` | `@123456789012345678` |

### ヘルパー関数

- `generateSlug(mcid, discordId)` - スラッグ生成
- `isGeneratedSlug(slug)` - 自動生成スラッグかどうか (`@` で始まるか)
- `getDisplayName(displayName, mcid, slug)` - 表示名取得 (優先順位: displayName > mcid > slug)
- `getMentionDisplay(mcid, slug)` - メンション用文字列

---

## プロフィール表示タブ

`defaultProfileTab` で設定可能なタブ:

| タブ | 説明 |
|---|---|
| `keybindings` | キーバインド設定 |
| `profile` | プロフィール詳細 |
| `stats` | スピードラン記録・統計 |
| `items` | アイテム配置 (ホットバー等) |
| `searchcraft` | サーチクラフト |
| `devices` | デバイス設定 |
| `settings` | ゲーム内設定 |

---

## カスタムスキン

### データモデル

- `customSkinUrl` - Vercel Blobに保存されたスキンテクスチャのURL
- `customSkinModel` - `"default"` または `"slim"` (腕幅の違い)

### API: `POST /api/me/skin`

カスタムスキンURLを保存する。

- 認証必須
- リクエストボディ: `{ url: string, model?: "default" | "slim" }`
- URLは `blob.vercel-storage.com` のものに限定
- 既存の古いBlobがあれば削除してから更新

### API: `DELETE /api/me/skin`

カスタムスキンを削除する。

- 認証必須
- Vercel BlobからファイルをDELETE
- DBの `customSkinUrl`, `customSkinModel`, `customSkinUpdatedAt` を `null` に

### API: `GET /api/skin`

スキンテクスチャ画像を返すプロキシAPI。

パラメータ:
- `uuid` - Minecraft UUID (直接指定)
- `userId` - Minefolioユーザー ID (カスタムスキン優先チェック)

### スキン取得優先順位

1. `customSkinUrl` (カスタムスキンがあればそれを返す)
2. Mojang Session Server API (UUIDからスキンテクスチャURLを取得)
3. Steve スキン (フォールバック)

レスポンスヘッダ: `Cache-Control: public, max-age=3600` (1時間)

---

## スキン表示コンポーネント

### `MinecraftAvatar`

顔アイコン (2Dレンダリング)。Canvas APIでスキンテクスチャからヘッド部分を切り出し。

| Prop | 型 | デフォルト | 説明 |
|---|---|---|---|
| `uuid` | `string \| null` | - | Minecraft UUID |
| `skinUrl` | `string \| null` | - | カスタムスキンURL (指定時はuuidより優先) |
| `mcid` | `string \| null` | - | alt属性用 |
| `size` | `number` | `64` | ピクセルサイズ |
| `overlay` | `boolean` | `true` | 帽子レイヤーを重ねるか |

描画ロジック:
1. `skinUrl` が指定されていればそれを使用
2. なければ `/api/skin?uuid={uuid}` を使用
3. 読み込み失敗時は `/api/skin?uuid={STEVE_UUID}` にフォールバック
4. ベースレイヤー (8x8, 座標 8,8) + オーバーレイレイヤー (8x8, 座標 40,8) を合成
5. ドロップシャドウ付きで描画

### `MinecraftFullBody`

3D全身レンダリング。[skinview3d](https://github.com/nicholasly/skinview3d) を使用。

| Prop | 型 | デフォルト | 説明 |
|---|---|---|---|
| `uuid` | `string` | - | Minecraft UUID |
| `skinUrl` | `string` | - | カスタムスキンURL (指定時はuuidより優先) |
| `width` | `number` | `300` | 幅 |
| `height` | `number` | `400` | 高さ |
| `pose` | PoseName | `"standing"` | ポーズ |
| `angle` | `number` | `25` | カメラ角度 |
| `elevation` | `number` | `10` | カメラ仰角 |
| `zoom` | `number` | `0.9` | ズーム |
| `walk` | `boolean` | `false` | 歩行アニメーション |
| `run` | `boolean` | `false` | 走行アニメーション |
| `rotate` | `boolean` | `false` | 自動回転 |
| `asImage` | `boolean` | `false` | 静止画像として出力 |
| `slim` | `boolean` | `false` | スリムスキンモデル |

ポーズ種別: `standing`, `walking`, `running`, `waving`, `sitting`, `custom`

静止画像モード (`asImage: true`):
- レンダリング後にCanvasをPNG化し `<img>` として出力
- 結果はメモリキャッシュ (`Map`) に保存し、同じパラメータの再レンダリングを回避
- Viewer は描画完了後に `dispose()` でリソース解放

---

## ソーシャルリンク

### `social_links` テーブル

| カラム | 型 | 説明 |
|---|---|---|
| `id` | text (PK) | CUID2 |
| `userId` | text (FK) | ユーザーID |
| `platform` | enum | `speedruncom` / `youtube` / `twitch` / `twitter` / `custom` |
| `identifier` | text | ユーザー名やチャンネルID |
| `customLabel` | text | `custom` プラットフォーム時の表示名 |
| `customUrl` | text | `custom` プラットフォーム時のURL |
| `displayOrder` | integer | 表示順 (デフォルト: 0) |

### プラットフォーム別

| Platform | identifier の意味 | URL生成 |
|---|---|---|
| `speedruncom` | ユーザー名 | `https://www.speedrun.com/users/{identifier}` |
| `youtube` | チャンネルID/ハンドル | `https://www.youtube.com/{identifier}` |
| `twitch` | ユーザー名 | `https://www.twitch.tv/{identifier}` |
| `twitter` | ユーザー名 | `https://x.com/{identifier}` |
| `custom` | 任意 | `customUrl` を直接使用、`customLabel` が必要 |

---

## プロフィール閲覧数

`users.profileViews` (integer, デフォルト 0)。

プロフィールページが閲覧されるたびにインクリメントされる。

---

## プロフィール編集

### パス: `/me/edit`

認証必須 (`getCurrentUser` を使用)。ユーザーの各フィールドを編集できるフォーム。

---

## OGP画像生成

### パス: `/og-image`

`@vercel/og` の `ImageResponse` を使用してPNG画像を動的生成する。サイズは 1200x630px (Twitter/OGP標準)。

### クエリパラメータ

| パラメータ | 説明 |
|---|---|
| `mcid` | MCIDでユーザーを検索 |
| `slug` | スラッグでユーザーを検索 |
| `title` | デフォルトOGP用タイトル |
| `description` | デフォルトOGP用説明文 |

### 生成パターン

**デフォルトOGP** (`mcid`/`slug` なし):
- アプリアイコン + タイトル + 説明文

**プレイヤーOGP** (`mcid` または `slug` あり):
- アバター画像 + 表示名 + MCID + ロールバッジ + エディションバッジ + bio

### アバター画像取得の優先順位

1. Discordアバター (`cdn.discordapp.com/avatars/{discordId}/{hash}.png`)
2. Crafatar (`crafatar.com/avatars/{uuid}`)
3. mc-heads.net (`mc-heads.net/avatar/{uuid}`)
4. minotar.net (`minotar.net/avatar/{uuid}`)

全てBase64データURLに変換して `ImageResponse` に埋め込む。

### キャッシュ

```
Cache-Control: public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800
```

---

## 関連ファイル

| ファイル | 役割 |
|---|---|
| `app/lib/schema.ts` | DBスキーマ定義 (`users`, `social_links` 等) |
| `app/lib/slug.ts` | スラッグ生成ユーティリティ |
| `app/routes/player/profile.tsx` | プロフィール表示ページ |
| `app/routes/me/edit.tsx` | プロフィール編集ページ |
| `app/routes/og-image.tsx` | OGP画像生成API |
| `app/components/minecraft-avatar.tsx` | 顔アイコンコンポーネント (2D) |
| `app/components/minecraft-fullbody.tsx` | 全身コンポーネント (3D, skinview3d) |
| `app/routes/api/skin.ts` | スキンテクスチャプロキシAPI |
| `app/routes/api/me/skin.ts` | カスタムスキン管理API (POST/DELETE) |
