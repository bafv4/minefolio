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
| `featuredVideoUrl` | text | 注目動画URL（レガシー。`profile_videos` が1件でもあればそちらを優先表示し、この値は無視される） |
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
| `asImage` | `boolean` | `false` | 静止画像として出力（`interactive` が `true` のときは強制無効） |
| `slim` | `boolean` | `false` | スリムスキンモデル |
| `interactive` | `boolean` | `false` | OrbitControls による回転・拡大縮小・移動を有効化 |
| `showInteractiveHint` | `boolean` | `false` | インタラクティブモード時に右上にヒント切替ボタン（？）を表示 |

ポーズ種別: `standing`, `walking`, `running`, `waving`, `sitting`, `custom`

#### 静止画像モード (`asImage: true`)

- レンダリング後に Canvas を PNG 化して `<img>` として出力
- 結果はメモリキャッシュ (`Map`) に保存し、同じパラメータの再レンダリングを回避
- Viewer は描画完了後に `dispose()` でリソース解放
- `interactive` が `true` の場合は強制的に無効化される

#### インタラクティブモード (`interactive: true`)

v1.4.0 で追加。skinview3d の OrbitControls を有効化し、ユーザーが視点を操作できる：

- 左ドラッグで回転、右ドラッグで平行移動、ホイール/ピンチで拡大縮小
- `enablePan` + `screenSpacePanning` を有効化
- ズーム範囲は `minDistance: 20` 〜 `maxDistance: 200` に制限
- 初期化直後に `controls.saveState()` を呼び、リセットボタンで `controls.reset()` できるようにする
- 右上に **リセットボタン**（`RotateCcw` アイコン）と、`showInteractiveHint=true` のとき **ヒント切替ボタン**（`HelpCircle`）を配置。ヒントボタンを押すと「ドラッグで回転 / 右ドラッグで移動 / ホイール・ピンチで拡縮」のテキストがビューポート下部に表示される

##### パフォーマンス最適化

- **画面外で描画停止**: `IntersectionObserver` で canvas の可視性を監視し、ビューポート外では `viewer.renderPaused = true` に切り替えてアニメーションループを停止
- **サイズ変更時の再初期化回避**: `width` / `height` を主 effect の依存に含めず、別 effect で `viewer.setSize(width, height)` を呼ぶことで、レスポンシブ切替時の `dispose()` + 再構築 + skin 再ロードを回避

#### i18n

`fullbodyViewer.*`（`avatarLabel` / `avatarLabelOf` / `showHint` / `hideHint` / `reset` / `hintText`）に集約。

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

## 動画欄（複数動画）

### `profile_videos` テーブル

| カラム | 型 | 説明 |
|---|---|---|
| `id` | text (PK) | CUID2 |
| `userId` | text (FK) | ユーザーID（cascade削除） |
| `url` | text | YouTube動画URL |
| `title` | text | 任意の表示タイトル |
| `isPinned` | boolean | ピン留め（デフォルト: false） |
| `displayOrder` | integer | 表示順（デフォルト: 0） |

### 表示（プロフィールタブの「動画」カード）

- 表示順: ピン留め → `displayOrder` 昇順（loaderの `orderBy`）
- **ピン留め動画は大きく単独表示**（`aspect-video max-w-2xl`）、その他は2カラムグリッドで小さく表示。動画が1件のみの場合は常に大きく表示
- **後方互換**: `profile_videos` が0件のユーザーは旧 `users.featuredVideoUrl` を1件の動画として表示する。1件でも登録するとレガシー値は無視される

### URL変換（`app/lib/youtube-url.ts`）

- `getYouTubeVideoId()` / `getYouTubeEmbedUrl()` / `getYouTubeThumbnailUrl()` を共通利用
- `watch?v=` / `youtu.be` / `live/` / `shorts/` / `embed/` 形式に対応
- **埋め込みURLへ変換できないURLは iframe に渡さず外部リンク表示にする**（YouTube視聴ページの `X-Frame-Options: SAMEORIGIN` によりブラウザが埋め込みをブロックするため。旧実装は変換不能時に生URLを埋め込みFirefoxで「このページを開けません」が出ていた）
- 登録時（`/me/edit` の `create_video` / `update_video`）も `getYouTubeVideoId()` で解決できないURLを拒否する

### 編集（`/me/edit` の「動画」カード）

- ソーシャルリンクと同じ「Dialog + `_action`」パターン: `create_video` / `update_video` / `delete_video` / `move_video`（上下入替、displayOrderをインデックスで振り直し）
- 最大10件。タイトルは100文字まで。ピン留めはダイアログ内のSwitch
- 動画0件かつレガシー `featuredVideoUrl` があるとき、追加ダイアログにそのURLをプリフィルして移行を促す

---

## ピン留め（Folio強調表示）

プロフィール上で「これを見てほしい」コンテンツを強調する仕組み。対象は **ガイド**（`guides.isPinned`）・**カスタム記録**（`category_records.isPinned`）・**動画**（`profile_videos.isPinned`）・**Speedrun.com記録**（`users.pinnedSpeedrunRecords`）。

- 表示: ピン留め項目は各リストの**先頭**に並び、カード表示では**拡大表示**される
  - ガイド: グリッド2列分（`sm:col-span-2`）+ カバー画像拡大 + ピンアイコン（`GuideCardGrid` / `GuideListView`、プロフィールのガイドタブのみ。グローバル `/guides` には影響しない）
  - 記録: グリッド2列分（`md:col-span-2`）+ タイム拡大 + 枠線強調（`RecordCard`）
  - 動画: 上記「動画欄」参照
  - Speedrun.com記録: 下記「Speedrun.com記録のピン留め」参照
- 切替UI: ガイド=`/my-guides` 一覧のピンボタン（`_action: "togglePin"`）、記録=`/me/records` の編集ダイアログのSwitch、動画=`/me/edit` の動画ダイアログのSwitch、Speedrun.com記録=`/me/records` のピンアイコンボタン

### Speedrun.com記録のピン留め（軽量実装）

Speedrun.comのPBはDBにキャッシュされず、プロフィール表示のたびにSpeedrun.com APIから直接取得される（`category_records` に行を持たない）ため、他のピン留めと違い `category_records.isPinned` を使えない。代わりに `users.pinnedSpeedrunRecords`（JSON配列、ピン留めするrun IDの一覧。`hiddenSpeedrunRecords` と同じ形式）で管理する。

- 管理: `/me/records` の「Speedrun.com 記録」セクションで、各カードの右上にピン留め（`Pin`アイコン）と表示/非表示（`Eye`/`EyeOff`アイコン）の2つのトグルボタンが並ぶ。`_action: "toggleSpeedrunRecordPin"` でトグル
- 表示: プロフィールの活動・記録タブで、非表示記録を除外した後、ピン留めを先頭に安定ソートしてから最大6件表示（`StatsContent` 内）。ピン留めカードは `md:col-span-2` + 枠線強調 + タイム拡大（`text-3xl`）+ ピンアイコン
- 非表示（`hiddenSpeedrunRecords`）と独立して管理されるため、非表示にした記録をピン留めすることも技術的には可能だが、非表示である以上プロフィールには表示されない

---

## プロフィール表示ページのレイアウト

### スキン表示

`/player/:slug` ではスキン全身表示を **インタラクティブモード**（`interactive` + `showInteractiveHint`）で描画する。サイズはレスポンシブ：

| 画面幅 | サイズ |
|---|---|
| `(max-width: 640px)`（モバイル） | 320 × 380 |
| それ以外（デスクトップ） | 240 × 280 |

判定には `app/hooks/use-media-query.ts` の `useMediaQuery(query, ssrDefault)` フックを使用。SSR セーフ。

スキンと右側の基本情報は `flex-col sm:flex-row sm:items-center` で、デスクトップ時は上下中央揃え。

### モバイルタブ選択ドロワー

モバイル表示時の上部スティッキーボタンには `ChevronsDown` アイコンを使用（v1.4.0 でハンバーガー `Menu` から変更）。展開中は `X` アイコンに切り替わる。

### プリセット切替

`presets.length > 0` で対象タブ（`keybindings` / `devices` / `items` / `searchcraft`）を表示中のときは、プリセット切替ドロップダウンを描画する：

- デスクトップではサイドバーに表示
- モバイルではメインコンテンツ上部に表示
- 選択肢に切替時は URL クエリ `?preset=...` を `setSearchParams` で更新し、`useRevalidator().revalidate()` も併せて呼ぶ
- 切替中（`navigation.state === "loading"` または `revalidator.state === "loading"`）はメインコンテンツ右カラムにローディングオーバーレイを表示。サイドバー（プリセット選択 UI を含む）は表示維持

### 視聴者ロールの扱い

- 個別プロフィールページ自体は `role = "viewer"` のユーザーでも表示する（直接 URL アクセスは可能）
- 各種一覧（`/browse` / `/keybindings` / ホーム画面など）からはデフォルトで除外される — 詳細は各画面の仕様書参照

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
| `app/hooks/use-media-query.ts` | レスポンシブサイズ判定用フック |
| `app/routes/api/skin.ts` | スキンテクスチャプロキシAPI |
| `app/routes/api/me/skin.ts` | カスタムスキン管理API (POST/DELETE) |
