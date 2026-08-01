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
| `displayNameAlphabet` | text | 表示名のアルファベット表記（任意）。英語ロケールでは表示名の代わりに使う |
| `discordAvatar` | text | Discordアバター (セッションから自動同期) |
| `bio` | text | プロフィール説明文 |
| `shortBio` | text | 短い説明文 (OGP等で使用) |
| `hasImported` | boolean | レガシーデータインポート済みフラグ |
| `profileVisibility` | enum | `public` / `unlisted` / `private` |
| `profilePose` | enum | `standing` / `walking` / `waving` |
| `slimSkin` | boolean | スリムスキン使用 |
| `location` | text | 所在地 |
| `pronouns` | text | 代名詞 |
| `rtaStartedYearMonth` | text | RTAを始めた年月（`"YYYY-MM"` 形式、未回答は `null`）。別プロジェクトmcsr-buttonの `started_year_month` と同形式で、経過年数は表示時に算出する（下記「RTA歴」参照） |
| `defaultProfileTab` | enum | デフォルト表示タブ（`profile` / `stats` / `keybindings` / `items` / `searchcraft` / `devices` / `settings` / `playstyle`。詳細は下記「プロフィール表示タブ」） |
| `featuredVideoUrl` | text | 注目動画URL（レガシー。`profile_videos` が1件でもあればそちらを優先表示し、この値は無視される） |
| `mainEdition` | enum | `java` / `bedrock`。**`/me/playstyle` でメインバージョンを選ぶと自動決定される**（`/me/edit` の入力項目からは削除済み。詳細は下記「プレイスタイル」） |
| `mainPlatform` | enum | `pc_windows` / `pc_mac` / `pc_linux` / `switch` / `mobile` / `other` |
| `role` | enum | `viewer` / `runner` |
| `inputMethod` | enum | `keyboard_mouse` / `controller` / `touch`。入力方法バッジ・`/browse` の `?input=` フィルタが参照する唯一のソース（`/me/playstyle` で編集） |
| `inputMethodBadge` | enum | @deprecated **未使用**。`inputMethod` に一本化済み（バッジ表示・フィルタとも `inputMethod` を参照）。本番DDLと `schema.ts` の乖離を避けるため列は残置し、DBからはドロップしていない |
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
- `pickDisplayName(user, locale)` - ロケール別の表示名を選ぶ (`ja` 以外は `displayNameAlphabet` を優先し、未入力なら `displayName`)
- `getLocalizedDisplayName(user, locale)` - 上記 2 つの組み合わせ (アルファベット表記 > displayName > mcid > slug)
- `getMentionDisplay(mcid, slug)` - メンション用文字列

### 表示名のアルファベット表記

`/me/edit` の「表示名（アルファベット表記）」で登録する任意項目。

- **保存時の検証**: 50文字以内、かつ印字可能な ASCII（` `〜`~`）のみ
- **英語ロケール**: 一覧・プロフィール・ヘッダー・ランキング・ガイド著者名など、表示名を出す箇所で
  `displayName` の代わりに使う（未入力なら従来どおり `displayName`）
- **プロフィールページ**: ロケールを問わず見出しの下に併記する（見出しと同じ文字列になる場合は省略）
- **解決のタイミング**: リクエスト間で共有されるキャッシュ（`home-user-data.server.ts` /
  `paces-feed.server.ts` / `youtube-cache.ts`）には**ロケール解決後の値を入れない**。
  これらは `displayName` と `displayNameAlphabet` の両方を持ち回り、描画直前に `useLocale()` で解決する
- **OGP画像（`/og-image`）は対象外**: クローラーはロケール Cookie を送らないため、常に `displayName` を使う

---

## プロフィール表示タブ

`/player/:slug` のタブ構成（サイドバー/モバイルドロワーの並び順）:

| タブ | 説明 |
|---|---|
| `profile` | プロフィール詳細（スキン・基本情報。先頭に固定、アバター付きの専用トリガーで `tabItems` 配列には含まれない） |
| `stats` | スピードラン記録・統計 |
| `playstyle` | プレイスタイル（下記「プレイスタイル」参照） |
| `keybindings` | キーバインド設定 |
| `devices` | デバイス設定 |
| `items` | アイテム配置 (ホットバー等) |
| `searchcraft` | サーチクラフト。**`playstyle.searchCraft === "does_not"` のとき非表示**（`hideSearchCraftTab`。未回答 `null` は表示する） |
| `guides` | 投稿したガイド一覧 |

- `defaultProfileTab`（`users` テーブル）はこの並びの初期表示タブを決める。値は上記の他に `settings` を enum として持つが、**UI 上に対応するタブは存在しない**（過去に存在したゲーム内設定タブの残置 enum 値）
- 既定値は `profile`（新規ユーザーは insert 時に `$defaultFn(() => "profile")` で設定される）。未設定行（`null`）はアプリ側でも `profile` にフォールバックする
- **サニタイズ**: `defaultProfileTab` が現在の有効タブ集合（上記 + `profile`）に含まれない場合（廃止された `settings` や、SC非表示中に保存されていた `searchcraft` など）は `profile` へフォールバックする。DB の `defaultProfileTab` 自体は書き換えない（サーチクラフトが再度「する」に変われば自然に復活する）
- URL クエリ `?tab=` が唯一の直接指定手段。未指定・不正値のときに `defaultProfileTab`（サニタイズ後）へフォールバックする
- 既存ユーザーの初期表示タブを `keybindings` から `profile` へ変更した際は、`scripts/set-default-profile-tab-profile.ts --apply` で DB 上の既存行（`defaultProfileTab = "keybindings"` のもの）を `profile` に更新した。リモート Turso への適用は別途 `--remote --apply` で実行する必要がある

---

## プレイスタイル

プレイするバージョン・カテゴリ、操作方法、高CPSクリックやZero Cycleなどのテクニック系設定を自己申告で登録し、プロフィールの `playstyle` タブに表示する機能。編集は `/me/playstyle`。

### `playstyles` テーブル

`users` と 1:1（`userId` に `unique()` + FK cascade）。**全項目 nullable**（未回答を許容する）。項目追加は `pnpm db:push` を使わず、`scripts/` の dry-run既定 + `--apply` の一回限りスクリプト（前例: `scripts/add-playstyles-table.ts`）で手動DDLを適用する運用（詳細は `CLAUDE.md`「接続先の分離運用」）。

| カラム | 型 | 説明 |
|---|---|---|
| `id` | text (PK) | CUID2 |
| `userId` | text (FK, unique) | `users.id`（cascade削除） |
| `versions` | text | JSON配列（`VersionKey[]`）。`"java:1_16_1_19"` のような `エディション:バージョン` 連結キー |
| `categories` | text | JSON配列（`CategoryKey[]`） |
| `mainVersion` | text | 選択済み `versions` から1つ |
| `mainCategory` | text | 選択済み `categories` から1つ |
| `hotbarSwitching` | enum | ホットバー切替方法（4値） |
| `searchCraft` | enum | サーチクラフト度（3値） |
| `halfShift` | enum | 半シフトの頻度（5段階） |
| `itemLayoutPolicy` | enum | アイテム配置を決めているか（3値） |
| `clickMethods` | text | JSON配列（`ClickMethod[]`）。高CPSクリック方法の複数選択 |
| `dragTapeType` | text | 自由入力（テープの種類） |
| `usesMousepad` | enum | マウスパッド使用有無（2値） |
| `mousepadType` | text | 自由入力（マウスパッドの種類） |
| `zeroCycle` | enum | Zero Cycle の頻度（`halfShift` と同スケール5段階） |
| `groundZero` | enum | できる/できない（2値） |
| `oneshot` | enum | できる/できない（2値） |
| `favoriteBastion` | enum | 好きな廃要塞の種類（4値） |
| `createdAt` / `updatedAt` | timestamp（秒） | |

### 項目一覧（表示条件）

条件付き項目（KBM限定・Java RSG/Ranked限定・1.16+限定）は、**条件を満たさなくなっても保存値をクリアしない**（データ保持方針）。編集フォーム（`/me/playstyle`）・プロフィール表示（`playstyle` タブ）の両方で、条件を満たすときだけその項目を出す。表示条件の判定ロジックは両者で共有（下記「選択肢定義」参照）。

| 項目 | 形式 | 表示条件 |
|---|---|---|
| プレイするバージョン | エディション別チェックボックス複数選択 | 常時 |
| カテゴリ | チップ複数選択 | 常時 |
| メインバージョン / メインカテゴリ | 選択済みから各1つ | 常時（メインバージョンのエディション → プロフィールの Java/Bedrock バッジを決定） |
| 入力方法 | 3値 Select（`users.inputMethod`。`/me/edit` から移管しバッジと一本化） | 常時 |
| ホットバー切替方法 | 4値: ホットキー/ホットキー(時々ホイール)/マウスホイール(時々ホットキー)/マウスホイール | 常時 |
| サーチクラフト | 3値: する/少しだけする/しない | 常時（「しない」でプロフィールのSCタブを非表示） |
| ゲーム言語（読み取り表示） | `player_configs.gameLanguage`（`/me/devices` への誘導リンクのみ、この画面では編集不可） | サーチクラフト ≠ 「しない」 |
| 半シフト | 頻度5段階: 積極的にする/する/たまにする/めったにしない/しない | 常時 |
| アイテム配置は決めてる？ | 3値: 厳密に決めている/ざっくり決めている/気分 | 常時 |
| 高CPSクリック方法 | 複数選択: ノーマル/ジッター/バタフライ/ドラッグ | **KBM限定**（`inputMethod === "keyboard_mouse"`） |
| └ テープの種類 | 自由入力（100文字まで） | クリック方法に「ドラッグ」を含む場合 |
| マウスパッドは使う？ | 2値: 使う/使わない | **KBM限定** |
| └ 種類 | 自由入力（100文字まで） | 「使う」の場合 |
| Zero Cycle | 頻度5段階（半シフトと同スケール） | **Java の RSG/Ranked をプレイする場合**（`versions` に `java:*` を含み、かつ `categories` に `rsg` か `ranked` を含む） |
| Ground Zero | 2値: できる/できない | 同上 |
| Oneshot | 2値: できる/できない | 同上 |
| 好きな廃要塞の種類 | 4値: ハウジング/ステーブル/ブリッジ/トレジャー | **1.16+ のバージョンを1つ以上選択時**（`java:1_16_1_19` / `java:1_20_plus` / `bedrock:1_16` / `bedrock:1_16_100_1_17` / `bedrock:1_18`） |

### 選択肢定義・共有ロジック（`app/lib/playstyle.ts`）

`.server` ではない非サーバーモジュール。編集フォームとプロフィール表示の両方から import される、選択肢・型・ロジックの**単一情報源**:

- 定数: `JAVA_VERSIONS` / `BEDROCK_VERSIONS`（speedrun.com 準拠のバージョン区分、ロケール非依存の直書きラベル）、`CATEGORIES`（RSG/SSG/AA/CE/MCSR Ranked/その他）、`HOTBAR_SWITCHING_OPTIONS` / `SEARCH_CRAFT_OPTIONS` / `FREQUENCY_OPTIONS`（半シフト・Zero Cycle 共用）/ `ITEM_LAYOUT_POLICY_OPTIONS` / `CLICK_METHOD_OPTIONS` / `CAN_CANNOT_OPTIONS` / `USES_MOUSEPAD_OPTIONS` / `BASTION_OPTIONS`
- ヘルパー: `editionOfVersion` / `versionLabel` / `groupVersionsByEdition`
- 破損JSON耐性パーサ: `parsePlaystyleVersions` / `parsePlaystyleCategories` / `parsePlaystyleClickMethods`（`app/lib/preset-read.ts` の `safeParseArray` と同方針。壊れたJSON・非配列・未知キーは例外を投げず黙って捨てる）
- 表示条件ヘルパー: `isKbmPlaystyle(inputMethod)` / `playsJavaRsgOrRanked(versions, categories)` / `hasBastionVersions(versions)` / `hidesSearchCraft(searchCraft)`（`searchCraft === "does_not"`。SCタブ非表示・ゲーム言語行の表示条件で共用）
- ラベル解決: `categoryLabel(t, value)` / `playstyleOptionLabel(t, options, value)`（編集フォーム・プロフィール表示の両方で共用）
- バリデーション: `validatePlaystyle(input)`（既知キーのみ・重複除去・定義順正規化・`mainVersion`/`mainCategory` が選択済み集合に含まれるか検証・enum検証・自由入力2欄はtrim+最大100文字+空文字→null。条件外項目の値も受理する＝データ保持方針。違反時は `errorKey` を返す）

### 編集ページ: `/me/playstyle`

- 認証必須。プリセット非依存（`devices` タブの `saveInputMethod` と同様、`users` テーブルへの直接更新方式）
- `me/_layout.tsx` のサイドバーに `Gamepad2` アイコンで登録（`/me/edit` の直後）
- action は1回のトランザクション相当で2箇所を更新する:
  1. `playstyles` を `onConflictDoUpdate({ target: playstyles.userId })` で upsert
  2. `users` を1回の `update` で `inputMethod` を保存し、**`mainVersion` が指定されていれば** `mainEdition = editionOfVersion(mainVersion)` も同時に更新する。`mainVersion` が未設定（空文字）の場合は `mainEdition` に触れない（クリア手段は現状なし。仕様どおりのトレードオフ）
- バージョン/カテゴリのチェックを外してメイン選択が対象から外れた場合、メイン選択は自動的にリセットされる
- 条件付き項目（KBM限定群・Java RSG/Ranked群・廃要塞）はフォーム内の選択に動的に追従して表示/非表示が切り替わる。条件から外れても入力値はフォーム上もクリアされない

### プロフィール表示（`playstyle` タブ）

`app/routes/player/profile.tsx` の loader が `with: { playstyle: true }` で読み込む。表示は `/me/playstyle` 編集フォームと同じ3カードにグルーピング:

- **プレイ内容**: バージョン（エディション別グループ表示 + メインは強調バッジ）/ カテゴリ（チップ + メイン強調）
- **操作**: 入力方法 / ホットバー切替 / 半シフト / 高CPSクリック方法+テープの種類（KBM時のみ）/ マウスパッド+種類（KBM時のみ）
- **テクニック**: アイテム配置 / サーチクラフト度 / ゲーム言語（条件を満たす場合のみ）/ Zero Cycle・Ground Zero・Oneshot（Java RSG/Ranked時のみ）/ 好きな廃要塞（1.16+選択時のみ）

各項目は値が `null`（未回答）または表示条件を満たさない場合は行ごと非表示になる。全項目が未回答（`hasPlaystyleData` が false）の場合は EmptyState を表示し、本人閲覧時は `/me/playstyle` への誘導リンクを出す。

---

## カスタムスキン

### データモデル

- `customSkinUrl` - Vercel Blobに保存されたスキンテクスチャのURL
- `customSkinModel` - `"default"` または `"slim"` (腕幅の違い)

### API: `POST /api/me/skin`

カスタムスキンURLを保存する。

- 認証必須
- リクエストボディ: `{ url: string, model?: "default" | "slim" }`
- URLは `blob.vercel-storage.com`（完全一致 or サブドメイン）のホストに限定。`new URL()` でパースしてホスト名で許可リスト判定する（部分文字列一致は `#fragment` 等ですり抜けられ SSRF になるため使わない）。検証ロジックは `app/lib/blob-url.ts`（`isVercelBlobUrl` / `parseVercelBlobUrl`）に集約
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

保存済み `customSkinUrl` をサーバー side で fetch する前に、保存時と同じ許可リスト検証（`parseVercelBlobUrl`）を再適用する。信頼された Vercel Blob ホスト以外・IP リテラル・非 https は fetch せずスキップし、SSRF を防ぐ。

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

### YouTube / Twitch の統計表示（プロフィールタブ）

プロフィールタブの「リンク」カードでは、YouTube / Twitch のリンクは統計付きのリッチカードで表示する
（その他のプラットフォームは従来のボタン表示）。

- **YouTube**: 登録者数 + 最新動画（配信アーカイブ含む）の投稿日時。「配信中/配信予定」の検出は
  Search API のクォータコスト（100 units/call）が高いため行わない
- **Twitch**: フォロワー数 + 前回配信日時（最新アーカイブの `created_at`）+ 配信中バッジ
- 取得は `GET /api/social-stats?slug={slug}`（`app/routes/api/social-stats.ts`）からのクライアント
  遅延フェッチ。APIキー（`YOUTUBE_API_KEY` / `TWITCH_CLIENT_ID/SECRET`）はサーバー専用のため、
  クライアントから任意 identifier を受けるオープンプロキシにはせず、slug 経由でDB保存済みの
  リンクに対してのみ統計を返す
- **可視性ゲート**: `private` プロフィールは本人（セッション一致）のみ取得可（`Cache-Control: private, no-store`）、
  他人には 404。`public` / `unlisted` は取得可
- **キャッシュ**: `api_cache`（`cacheType: "social_stats"`）に YouTube 6時間（取得失敗時は15分の
  ネガティブキャッシュ）・Twitch 5分（配信中フラグの鮮度優先）。CDNは `s-maxage=300, stale-while-revalidate=3600`
- 統計未取得の間（ロード中・取得失敗・APIキー未設定）はリンク行のみ表示にフォールバックする
- 実装: `app/lib/youtube.ts` の `getChannelStats()`（channels + playlistItems、計2 units）、
  `app/lib/twitch.ts` の `getChannelStats()`（users / channels/followers / streams / videos）

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

### RTA歴

`rtaStartedYearMonth` を登録している場合のみ、基本情報のメタ情報行（居住地・代名詞と同じ並び）に History アイコン付きで表示する。文言の組み立ては `app/lib/rta-career.ts`（`rtaCareerView()` / `rtaCareerLabel()` / `rtaCareerExactLabel()`）に集約されており、プロフィール・比較ページ（[`docs/browse-compare.md`](./browse-compare.md#プレイヤー比較-compare)）の双方から共有する。

- 開始年月の表示（`start`）はロケール依存: ja は `"2020/6"`、en は `"Jun 2020"`（`Intl.DateTimeFormat`、月だけタイムゾーンの影響を避けるため UTC 基準で整形）
- 1年以上: `RTA歴 {years}年（{start}〜）`（`playerProfile.rtaCareerYears`、端数月は切り捨てて表示）。英語は単複で文言を分ける（`rtaCareerYears` / `rtaCareerYearsOne`）: `"Speedrunning for 6 years (since Jun 2020)"` / 1年なら `"Speedrunning for 1 year (since ...)"`
  - **端数月がある場合**（`hasRtaCareerRemainder()`）は表示に下線を付け、`HintTip`（ホバー/フォーカス/タップ）で端数まで含めた正確な経過（`playerProfile.rtaCareerExact`、例: `"RTA歴 6年2か月（2020/6〜）"`）を補足する
- 1年未満: `RTA歴 {months}か月（{start}〜）`（`playerProfile.rtaCareerMonths` / 単数は `rtaCareerMonthsOne`）
- 開始月と同じ月（経過0か月）は「1か月未満」（`playerProfile.rtaCareerJustStarted`）と表示する。以前は「1か月」に切り上げていたが、実際の経過とずれるため文言を分けた
- 経過期間は DB には保存せず、表示のたびに `app/lib/rta-career.ts` の `rtaCareerElapsed()` で開始年月と基準時刻から算出する（月単位、日は考慮しない）。基準時刻は loader が返す `now` を使い、SSR とハイドレーションで計算結果を一致させる
- 更新日（`Calendar` アイコン）にも「最終更新」ラベルを付け（`playerProfile.lastUpdated`）、ロケールに応じた日付書式（`date-fns` の `format()` + `dateFormatPattern(locale)` / `dateFnsLocale(locale)`）で表示する（従来は `toLocaleDateString("ja-JP", ...)` 固定でロケールに関わらず日本語表記だった）

### アクションボタン行・絵文字リアクション

ヘッダーカードの基本情報カラム下部に、編集（本人のみ）/お気に入り/シェア/比較のアクションボタン行がある。**その直下**にプロフィール絵文字リアクションバー（常時表示、標準機能）を配置する。詳細は [`docs/profile-reactions.md`](./profile-reactions.md) を参照。

### デバイスタブのマウス設定表示

`devices` タブのマウス設定は、値が出せない/不正なケースでも行を消さず「-」+ 理由（または警告）を表示する。計算ロジック・警告UIは `/keybindings` 一覧と共有しており、詳細は [`docs/keybindings.md`](./keybindings.md#マウス設定)（振り向き・カーソル速度・バリデーション節）を参照:

- **ゲーム内感度が有効範囲外**: 値はそのまま出しつつ警告アイコン + ヒント（共有コンポーネント `SensitivityWarning`、`app/components/sensitivity-warning.tsx`）を表示する
- **Win Sens が係数テーブル（1〜20）外**: `x1.000` と断定せず警告アイコン + ヒント（`WinSensValue`）を表示する
- **振り向き（cm/360）・カーソル速度が計算できない**: 行自体は残し、「-」+ 理由（DPI未設定・感度未設定・感度範囲外・Windows乗数未設定/不明など、`TurnDistanceValue` / `CursorSpeedValue`）を `HintTip` で表示する（以前は該当行そのものを非表示にしていた）

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

「プレイヤー情報」カードに残るのは `mainPlatform` / `role` の2フィールドのみ（2カラムグリッド）。**`mainEdition` / `inputMethod` / `inputMethodBadge` はこの画面からは削除済み**で、`/me/playstyle` に移管されている（`mainEdition` は `/me/playstyle` でメインバージョンを選ぶと自動決定され、単体でのクリア手段は無い）。カード下部に「/me/playstyle に移動しました」の誘導リンク（`meEdit.movedToPlaystyle`）を表示する。詳細は上記「プレイスタイル」を参照

### 代名詞（pronouns）の入力

基本情報カードの「代名詞」は `Combobox`（`app/components/ui/combobox.tsx`、`allowCustomValue`）で、`he/him` / `she/her` / `they/them` / `he/they` / `she/they` / `any/all` のプリセットから選ぶか、任意の文字列を自由入力できる（ロケール非依存の英語表記のため値と表示ラベルは同一・翻訳キー無し）。空欄に戻すことも可能。保存経路（`users.pronouns`、自由文字列）は変更していない。

### RTA歴（開始年月）の入力

基本情報カードで、年（2009〜現在年、降順）・月の2連 Select として入力する（各先頭に「未設定」項目）。年・月は両方選択するか両方未選択のみ有効で、片方だけ選ぶと Select 直下にインラインエラー（`meEdit.rtaStartedBothOrNone`、`aria-invalid` 付き）を出す。サーバー側の action でも `isValidRtaStartedYearMonth`（`app/lib/rta-career.ts`）で `2009-01`〜現在年月の範囲を検証し、範囲外なら保存を拒否する。

- **未来月を選択肢から除外**: 現在年を選んでいる間は、月の選択肢を現在月までに絞る（`rtaStartedMonthOptions`）。現在年に変更した結果、選択済みの月が未来になる場合はその月選択をクリアする
- **連動クリア**: 年・月どちらかで「未設定」を選ぶと、もう片方も同時にクリアする（`clearRtaStarted()`）。入力欄の右には両方をまとめてクリアする X ボタンを表示する（どちらか一方でも値があれば表示）
- **ライブプレビュー**: 年・月が両方揃うと、その場でプロフィールに表示される文言をそのままプレビューする（`rtaCareerExactLabel()` を使い端数月まで表示、例: 「RTA歴 6年2か月（2020/6〜）」）。未入力時のヒントテキスト（`meEdit.rtaStartedHint`）も「設定するとプロフィールに『RTA歴 6年（2020/6〜）』のように公開表示されます」と、保存後の見え方が事前に伝わる文言にしている
- 各 Select には個別の `aria-label`（`meEdit.rtaStartedYearAria` / `rtaStartedMonthAria`）を持たせ、スクリーンリーダーで年・月を区別できるようにしている

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
| `app/routes/me/playstyle.tsx` | プレイスタイル編集ページ (`/me/playstyle`) |
| `app/lib/playstyle.ts` | プレイスタイルの選択肢定義・型・表示条件ヘルパー・バリデーション（非 `.server`、編集/表示で共用） |
| `scripts/add-playstyles-table.ts` | `playstyles` テーブルのDB反映スクリプト（`inputMethod` バックフィル同梱） |
| `app/routes/og-image.tsx` | OGP画像生成API |
| `app/components/minecraft-avatar.tsx` | 顔アイコンコンポーネント (2D) |
| `app/components/minecraft-fullbody.tsx` | 全身コンポーネント (3D, skinview3d) |
| `app/hooks/use-media-query.ts` | レスポンシブサイズ判定用フック |
| `app/routes/api/skin.ts` | スキンテクスチャプロキシAPI |
| `app/routes/api/me/skin.ts` | カスタムスキン管理API (POST/DELETE) |
| `app/lib/rta-career.ts` | RTA歴（開始年月）のパース・検証・経過期間算出・表示文言の組み立て（ロケール対応） |
| `scripts/add-rta-started-column.ts` | `rta_started_year_month` 列のDB反映スクリプト |
| `app/components/hint-tip.tsx` | 端数月の補足など、短い説明を出す共有トリガー（[`docs/keybindings.md`](./keybindings.md#関連ファイル)にも記載） |
| `app/components/sensitivity-warning.tsx` | デバイスタブの感度警告表示（[`docs/keybindings.md`](./keybindings.md#関連ファイル)にも記載） |
