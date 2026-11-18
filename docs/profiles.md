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
| `bedrockMcid` | text (nullable) | Bedrock Edition の MCID（Xbox ゲーマータグ）。自己申告の表示用テキストで **Mojang 検証なし・UNIQUE なし**。`slug` / `uuid` / スキン / PaceMan などには一切関与しない |
| `uuid` | text (unique, nullable) | Minecraft UUID |
| `slug` | text (unique, NOT NULL) | URL用スラッグ |
| `displayName` | text | 表示名 |
| `displayNameAlphabet` | text | 表示名のアルファベット表記（任意）。英語ロケールでは表示名の代わりに使う |
| `discordAvatar` | text | Discordアバター (セッションから自動同期) |
| `bio` | text | プロフィール説明文 |
| `shortBio` | text | 短い説明文 (OGP等で使用) |
| `allowAutoTranslation` | boolean (既定 true) | 自己紹介（`bio` / `shortBio`）の自動翻訳を許可するか。`/me/edit` のスイッチで切り替える（[`docs/translation.md`](./translation.md)） |
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
| `customCapeUrl` | text (nullable) | カスタムマントURL (Vercel Blob、`capes/<userId>/`) |
| `customCapeUpdatedAt` | timestamp (nullable) | カスタムマント更新日時 |
| `capeDisplay` | enum (NOT NULL, 既定 `cape`) | `cape` / `elytra` / `hidden`。マントの出所（カスタム/Mojang）に関係なく適用される背中の表示 |
| `onboardingCompleted` | boolean (NOT NULL, 既定 true) | 初期設定ウィザード（`/onboarding`）を完了したか。既存ユーザーは既定値で完了済み、ウィザード開始時に `false` で作成され最終ステップ（公開設定）の保存で `true` になる。未完了のユーザーは `profileVisibility: "private"` のまま（詳細は [`docs/auth.md`](./auth.md#オンボーディングフロー)） |

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

変更は `/me/account`「公開とアカウント」の保存バーで確定する（[/me/edit の保存方式](#medit-の保存方式保存バーでの一括保存)）。

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

### スラッグ解決とフォールバックリダイレクト

`/player/:slug`・`/player/:slug/stats` は `users.slug` の大文字小文字無視の完全一致で検索し、
一致しなければ404を返す。slug は MCID 変更（`/me/edit` の MCID設定/削除）のたびに上書きされるが、
変更のたびに **`slug_history` テーブル**（`app/lib/slug-history.server.ts`）へ旧slugを記録して
いるため、404直前にこの履歴・Mojang API の順で解決を試みる2段フォールバックを挟む
（`app/lib/player-slug-fallback.server.ts` の `resolvePlayerSlugFallback(db, requestedSlug)`）。

同じポリシーは `/guides/:authorSlug`・`/guides/:authorSlug/:guideSlug`（著者slugの解決）にも
適用されている（`app/routes/guides/user.tsx` / `app/routes/guides/view.tsx`）。著者が見つからない
場合、解決できた現slugへ記事slug・クエリ文字列を維持したままリダイレクトする
（`/guides/:authorSlug/:guideSlug` は `/guides/<現slug>/<guideSlug>?...`）。「著者が private で
本人以外」の404分岐ではこのフォールバックを呼ばない点も `/player/:slug` と同様。

**解決手順**:

1. `users.slug` の完全一致検索（既存の主経路）
2. 一致しなければ `slug_history` から `requestedSlug`（小文字化）を検索する
   （`resolveSlugFromHistory`）。ヒットし、参照先ユーザーが `public` / `unlisted`
   （`publiclyReferencableCondition`）なら、そのユーザーの現在の `slug` へ **302** リダイレクトする。
   `@discordId` 形式の旧slug（MCID削除時に発生）も対象で、MCID形状ガードは適用しない
3. 履歴でもヒットしなければ、`requestedSlug` が MCID として解釈可能な形状
   （`/^[A-Za-z0-9_]{3,16}$/`）かを確認する。`@discordId` 形式の自動生成 slug やランダムパスへの
   無差別アクセスはここで弾かれ、Mojang API は呼ばれない
4. Mojang API（`fetchUuidFromMcid`、フォールバック用に3秒タイムアウト）で `requestedSlug` を
   MCID とみなして現在の UUID を取得する
5. その UUID を持つユーザーが `public` / `unlisted`ならその現在の `slug` へ **302** リダイレクトする。
   `private` は一致しても存在を漏らさないため404のまま

**302を使う理由**: どちらの段も「現在の所有者」を指し示すものであり、slug の再利用によって
将来別ユーザーに移りうる（恒久的な対応関係ではない）ため、恒久リダイレクト（301）は使わない。

**slug_history の記録・整理**（詳細は `app/lib/slug-history.server.ts` と `docs/database.md` の
`slug_history` 節）:
- 一括保存（`save_all`、`saveProfileBatch`）の MCID 設定・変更・削除は、`users` 更新と `recordSlugChange()` を
  同一トランザクションでまとめて実行する（Mojang検証はトランザクションの外）
- `recordSlugChange` は旧slugを小文字化して upsert（1つの旧slugは常に最新の元所有者1人だけを
  指す）し、新slugが過去に別ユーザーの旧slugとして記録されていればその履歴行を削除する
  （クレームによるクリーンアップ）
- オンボーディングでの初回 slug 取得時は `claimSlug()` で同様のクリーンアップを行う
- ユーザー退会（`users` 行削除）時は FK cascade で該当ユーザーの履歴も自動的に消える
  （退会者の旧slugへのリダイレクトは自然消滅する）

**救済できるケース**:
- 改名・MCID削除によって Minefolio 側の slug が変わったプロフィールへの旧slugアクセス
  （`slug_history` 導入後に発生した変更はすべて対象）
- Mojang側で改名済み・Minefolio側の slug が未更新のプロフィールに、新しい MCID
  （＝現在のMojang名）でアクセスされた場合（Mojangフォールバック）

**救済できないケース（仕様）**:
- `slug_history` 導入前に発生した slug 変更（履歴が存在しない）
- `private` プロフィールへの旧slugアクセス（存在を漏らさないため404のまま）
- 旧slugが別ユーザーの現役slugとして再利用されている場合（`slug_history` は新slug確定時に
  該当履歴を削除するため、この場合はそもそも履歴に残らず主経路の完全一致検索で現所有者の
  プロフィールが表示される＝正しい挙動）

**キャッシュ**（Mojangフォールバック段のみ。`slug_history` 検索はDB直接参照でキャッシュしない）:
- 正引き（MCID→UUID）は `fetchUuidFromMcid` 自体が1日（`CacheTTL.LONG`）キャッシュする
- Mojang側に存在しない MCID（`MojangError` の `MCID_NOT_FOUND`）は15分（`CacheTTL.MEDIUM`）の
  ネガティブキャッシュを積み、無差別アクセスによる繰り返しの API 呼び出しを抑える
- タイムアウトや Mojang 側の一時障害（`API_ERROR`）はキャッシュしない（次回のアクセスで再試行できるようにする）

このフォールバックは例外を投げない。失敗時（履歴なし・形状不一致・Mojang未登録・一時障害・
該当ユーザーなし）は常に `null` を返し、呼び出し側は従来どおり404にフォールバックする。

「本人以外に404を返すプライベートプロフィール」判定の分岐ではこのフォールバックを呼ばない
（同一ユーザーの slug/UUID に解決されるだけで、履歴検索・Mojang API 呼び出しが無駄になるため）。

---

## プロフィール表示タブ

### 身元帯（全タブ共通）

`/player/:slug` は全タブの上に共通の身元帯を置く（`app/routes/player/profile.tsx`）。`rounded-2xl border border-border/70 bg-card/70` の大型パネル（ui.md「大型パネル」参照）で、中身は次のとおり。

- アバター（md 未満 40px / 以上 64px を CSS で出し分け、ハイドレーション後に大きさが変わらないようにする）・表示名（**このページの `h1` はここだけ**。他タブ用の視覚非表示の h1 は無い）・アルファベット表記・`@MCID`・メインカテゴリ（押すとプレイスタイルタブへ）
- 操作ボタン（編集〔本人のみ〕・お気に入り・シェア）。**md 未満はアイコンのみ**（ラベルは sr-only で残し、タップ目標は 44px 以上）で名前の右に置き、幅が足りないときだけ次の行へ折り返す。md 以上はラベル付き。**比較ボタンは置かない**（比較の導線は各タブ末尾の「ほかの走者と比べる」欄に集約）。モバイルでも第一画面に収まる
- ハイライト（`ProfileHighlights`、`app/components/profile-highlights.tsx`）。**md 以上は静止グリッド**（1 行 4 列。自動スクロール・複製描画は無い）、**md 未満は 1 行の横スクロール**（`HorizontalScrollArea`、タイルは縮めず横に並べる。縦に積むと本文が押し下げられるため）で、データがある項目だけを次の順に並べる。タイルは見えているラベルと値がそのままアクセシブルネームになる（`aria-label` で値を上書きしない）。高さは固定（`TILE_HEIGHT_CLASS`）で、スケルトンとの切替でホットバーが跳ねない
  - **PB**（代表 PB）: 次の優先順で 1 件を選ぶ（非表示にした speedrun.com 記録は全段階で除外）。1) 活動・記録タブでピン留めした speedrun.com の記録（`pinnedSpeedrunRecords`、speedrun.com カードの並びの先頭）→ 2) メインカテゴリの記録〔speedrun.com: rsg=`Any%` + Random Seed、ssg=`Any%` + Set Seed、aa=All Advancements の最速。メインカテゴリが ranked なら MCSR Ranked の自己ベスト（`seasonData.bestTimeAllTime`、無ければ `bestTime`。`showRankedStats` が有効で登録済みのときのみ）。ce/other は対応付けない〕→ 3) speedrun.com の**公式カテゴリ**の記録のうち順位最上位 → 4) 手入力のカスタム記録（メインカテゴリ一致の最速、無ければ先頭の PB 付き記録。ラベルは記録名）。公式カテゴリの判定（`isOfficialSpeedrunComPb`）: game の `abbreviation` が `mc` / `mcbe`（Java / Bedrock 本体）で、category が `miscellaneous`（Co-op 等）でなく、IL でないこと。Category Extensions（`mcce` 等）・Unofficial（`mc_juice` 等）・Datapack & Modded は対象外。公式カテゴリが無く手入力も無ければ PB タイルは出さない。speedrun.com（メインカテゴリが ranked のときは Ranked も）が手入力より優先されるため、取得が終わるまで（`speedruncomUsername` があれば常に）スケルトンを出す。取得は `fetchSpeedrunComStatsCached`〔60 秒共有・失敗は非キャッシュ〕。選択ロジックは `app/lib/profile-highlights.ts` の `pickRepresentativePb`（記録タブの「ハイライトの PB を必ず表示」〔`highlightSrcRunId`。代表が speedrun.com の記録のときだけ指定、Ranked・カスタムなら null〕もこの選択を共有する）
  - **ゲーム内感度**: 計算可能なら cm/180° を併記（「1.5 cm/180°」。数値と単位の間は空白。デバイスタブの振り向きも同じ表記）
  - **サーチクラフト**: タブが表示される〔`searchCraft !== does_not`〕うえ、サーチクラフトの**登録が 1 件以上**あるときだけ（「53件・Yorùbá」の形。値はゲーム言語名、未設定なら回答ラベル）。以前のように回答だけでは出さない。押すと `searchcraft` タブへ
  - **MCSR Ranked Elo**: クライアント取得。取得中はスケルトン、未登録・`showRankedStats === false` なら項目ごと非表示（失敗は値の位置で示す）。**常に最後に置く**（取得中の枠が「未登録」と分かって消えても、ほかのタイルが横にずれないようにするため）
  - 全部無ければ行ごと非表示。メインカテゴリ・ガイドのタイルは、身元帯とホットバーに役目が移ったため無い。各タイルは `stats` / `devices` / `searchcraft` 等のタブへ切り替えるボタン

### ホットバー型タブ

左サイドバーとモバイルのタブ選択ドロワー（旧「モバイルタブ選択ドロワー」）は撤去済み。タブは `ProfileHotbarTabs`（`app/components/profile-hotbar-tabs.tsx`）の**横一列のスロット型タブ**（Minecraft のホットバーの見立て）。

- **並びと 2 群**（群の境目に `aria-hidden` の区切り線。tablist の子は tab だけにするため `role="group"` は使わない）:

| 群 | タブ（順） |
|---|---|
| 人物系 | 概要（`profile`）・記録（`stats`）・ガイド（`guides`） |
| セットアップ系 | スタイル（`playstyle`）・キー（`keybindings`）・デバイス（`devices`）・アイテム（`items`）・サーチ（`searchcraft`。**登録があるとき＝`searchCraft !== does_not` のときだけ**） |

- **配置**: md 以上は身元帯の直下に置き、スクロールすると**サイトヘッダーの直下に追従（`sticky`、`top-[64px]`＝ヘッダー〈65px〉の下に 1px もぐらせる、z はヘッダーより下）**する。止まる前は 72px 角のスロット（アイコン＋短いラベル）、**貼り付いたらコンパクト表示**（横長の低いスロット〈高さ 40px〉でアイコンと短いラベルを横並び、不透明な `bg-background`＋下罫線）。貼り付き判定はバー直前の番兵（1px の要素）を `IntersectionObserver`（`rootMargin` でヘッダー高さぶん上を削る）で見て `data-stuck` を切り替える（scroll イベントで state を更新しない）。コンパクト時はバーが縮むぶんの `margin-bottom` でフロー上の高さ（72px）を保ち、切替の瞬間に下の内容が跳ねないようにする。アニメーションは色の transition のみ（高さ・位置は動かさない）。選択中・空スロット・数字キー・ツールチップ・アクセシブルネームの規則はコンパクト時も同じ。追従バーに着地点が隠れないよう、`:root` の `scroll-padding-top`（`app/app.css` の `--sticky-bar-inset`。md 以上は 8.5rem＝ヘッダー 65px＋コンパクトバー 57px＋余白）で避ける（スキップリンクのフォーカス移動・`?srcPending=1` の `scrollIntoView` 等。`Tabs` 配下の `[id]` は `scroll-mt-0`）。**貼り付き中に別のタブへ切り替えたとき**は、タブ切替が `preventScrollReset`（スクロール位置を保つ）のため、新しいタブの先頭がコンパクトバーの直下に見える位置までスクロールを戻す（`activeValue` の変化で一本化。クリック・数字キー・戻る/進むで共通。貼り付いていないときは何もしない）。**md 未満で切り替えたとき**は、新しいタブのタイトル（h2 `profile-tab-title-<value>`）が画面の上（サイトヘッダーの裏を含む）に外れているときだけ、`:root` の `scroll-padding-top`（`--sticky-bar-inset`）の位置までスクロールを戻す（瞬時。身元帯が見える浅い位置などタイトルが見えているときは動かさない）。md 未満は**画面下端に固定**（`data-bottom-dock`、アイコンのみ＋上に選択中のタブ名）。固定 UI の避け方は `.claude/rules/ui.md`「下端の固定 UI」
- **キーボード操作**: Radix Tabs を `activationMode="manual"`（矢印キーはフォーカス移動だけ、Enter / Space で切替）。**数字キー 1〜9 は、ホットバー（tablist）にフォーカスがあるときだけ**対応するタブへ切り替える（ページ全体のキー監視はしない＝WCAG 2.1.4。Ctrl / Alt / Meta / Shift 併用は無視）。対応は純粋関数 `hotbarTabForKey`（`app/lib/profile-hotbar.ts`）で、数字は上の並び順（サーチが無ければ詰まる）。**キーボードでホットバーにフォーカスが当たっている間だけ（`group-has-[:focus-visible]/list`）、md 以上で各スロットの左上に番号（`text-[10px]`、`aria-hidden`、150ms のフェード）を出して数字キーの存在を知らせる**（空スロットにも出す。マウス操作では出さない。貼り付き中のコンパクトスロットは左端のアイコンと重なるため出さない）
- **空スロット**: 中身が無いタブは破線枠（`border-border`。中身のあるスロットの枠より目立たせず、判別は破線の形とアクセシブルネームの「、未登録」に任せる）と薄いアイコン（文字は 4.5:1 を保つため薄めない）で描くが押せる状態のまま（選択中の見た目が優先）。各スロットに `aria-keyshortcuts`（1〜9）を付け、ツールチップに数字を添える（`playerProfile.hotbarTooltipWithKey`）。アクセシブルネームに「、未登録」を付ける（`playerProfile.hotbarEmptySuffix`）。「中身あり」は各タブで 1 か所の変数が決め、パネルの `EmptyState` の条件と同じものを使う。記録タブは外部統計をクライアントで取得するので取得前は空と断定せず、MCID・speedrun.com ユーザー名・手入力記録・審査中記録のいずれも無いときだけ空とする
- **ツールチップとアクセシブルネーム**: 短いラベル（スロット表示）と長いラベルが異なるときだけ長いラベルをツールチップに出す（モバイルでは出さない）。名前は見えている短いラベルを含める（label in name、WCAG 2.5.3）。長いラベルが短いラベルを含まなければ短いラベルを使う
- **履歴**: タブ切替（`handleTabChange`）だけ履歴に push（ブラウザの「戻る」で前のタブへ戻れる）。プリセット切替と審査中記録のトグル（`srcPending`）は `replace`
- **フォーカスの輪**: 不透明の `--ring` の 2px を**内側**に描く（`ring-2 ring-inset ring-ring`。ui.md 9章「フォーカスリング」。矢印キーで動かしている間はフォーカス位置と選択中が違い、輪だけが手がかりになるため。隣のスロットとの間隔〔モバイル 2px〕に重ならないよう内側）
- 選択枠の移動アニメーションは無い（SSR 直後から選択状態が正しく見える）。選択状態の判定が `aria-selected` である理由は ui.md「タブ」参照

### タブ構成

`/player/:slug` のタブ構成（ホットバーの並び順）:

| タブ | 説明 |
|---|---|
| `profile` | 概要（リンク・自己紹介・動画ほか。先頭。ホットバー・ツールチップ・ドック・パネル名・読み上げのすべてで「概要」／Overview に統一） |
| `stats` | スピードラン記録・統計 |
| `guides` | 投稿したガイド一覧 |
| `playstyle` | プレイスタイル（下記「プレイスタイル」参照） |
| `keybindings` | キーバインド設定 |
| `devices` | デバイス設定 |
| `items` | アイテム配置 (ホットバー等) |
| `searchcraft` | サーチクラフト。**`playstyle.searchCraft === "does_not"` のとき非表示**（`hideSearchCraftTab`。未回答 `null` は表示する） |

- `defaultProfileTab`（`users` テーブル）は初期表示タブを決める。値は上記の他に `settings` を enum として持つが、**UI 上に対応するタブは存在しない**（過去に存在したゲーム内設定タブの残置 enum 値）
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
| カテゴリ | チェックボックスのタイル複数選択（バージョンと同じ形） | 常時 |
| メインバージョン / メインカテゴリ | 選択済みから各1つ | 常時（メインバージョンのエディション → プロフィールの Java/Bedrock バッジを決定） |
| 入力方法 | 3値 Select（`users.inputMethod`。`/me/edit` から移管しバッジと一本化。**編集の場所は playstyle に一本化**し、`/me/devices` からは外す方針。説明文から `/me/keybindings` / `/me/devices` の編集モードへリンクする） | 常時 |
| ホットバー切替方法 | 4値: ホットキー/ホットキー(時々ホイール)/マウスホイール(時々ホットキー)/マウスホイール | 常時 |
| サーチクラフト | 3値: する/少しだけする/しない | 常時（「しない」でプロフィールのSCタブを非表示） |
| ゲーム言語（読み取り表示） | `player_configs.gameLanguage`（`/me/devices` への誘導リンクのみ、この画面では編集不可） | サーチクラフト ≠ 「しない」 |
| 半シフト | 頻度5段階: 積極的にする/する/たまにする/めったにしない/しない（半シフト＝スニークを一定間隔で解除しながら置いて、橋架けの移動時間を縮める技。頻度は橋を架けるたびに使うかどうか） | 常時 |
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
- action は**1つのトランザクション**で2箇所を更新する（片方だけ書かれた状態を残さない。失敗は `{ error: mePlaystyle.saveFailed }` で返し、throw しない＝ErrorBoundary に落ちて下書きが消えるのを避ける）:
  1. `playstyles` を `onConflictDoUpdate({ target: playstyles.userId })` で upsert
  2. `users` を1回の `update` で `inputMethod` を保存し、**`mainVersion` が指定されていれば** `mainEdition = editionOfVersion(mainVersion)` も同時に更新する。`mainVersion` が未設定（空文字）の場合は `mainEdition` に触れない（クリア手段は現状なし。仕様どおりのトレードオフ）
- 下書きは `useLoaderSyncedDraft`（`app/hooks/use-loader-synced-draft.ts`）で loader の値と同期する。保存が失敗して再検証が走っても、編集済みの下書きは消さない（成功した保存の結果を `syncToken` に渡し、その次の loader 更新でだけサーバーの保存値に揃える）
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
- **所有判定**（`isOwnTextureBlobUrl` / env を読む `isOwnTextureBlob`＝`app/lib/blob-ownership.server.ts`）: ホスト確認に加え、URL のパスが `skins/<自分の userId>/` で始まり（その下に名前があり、`..` セグメントを含まない）、`BLOB_READ_WRITE_TOKEN` があるときはホストが自ストア（`<storeId>.public|private.blob.vercel-storage.com`、storeId はトークン `vercel_blob_rw_<storeId>_…` の4つ目、@vercel/blob と同じ導出）であること。通らなければ 400 `Invalid blob URL`。トークンが無い環境（ローカル）ではパスだけを確認する。プレフィックスはアップロードのトークン発行（`TEXTURE_BLOB_PREFIX`）と共有。他人の Blob を保存すると、解除・差し替え時の `del()` で消せてしまうため
- 既存の古いBlobがあれば削除してから更新。ただし古い URL が所有判定に通らない（過去に保存された他人のパス・他ストア）ときは `del()` せず、列の更新だけ行う

### API: `DELETE /api/me/skin`

カスタムスキンを削除する。

- 認証必須
- Vercel BlobからファイルをDELETE（所有判定に通らない既存 URL は `del()` せず列のクリアのみ。アカウント削除の `cleanupUserBlobs` の保険 `del()` も同じ）
- DBの `customSkinUrl`, `customSkinModel`, `customSkinUpdatedAt` を `null` に

### API: `GET /api/skin`

スキンテクスチャ画像を返すプロキシAPI。

パラメータ:
- `uuid` - Minecraft UUID (直接指定)
- `userId` - Minefolioユーザー ID (カスタムスキン優先チェック)

保存済み `customSkinUrl` をサーバー side で fetch する前に、保存時と同じ許可リスト検証（`parseVercelBlobUrl`）を再適用する。信頼された Vercel Blob ホスト以外・IP リテラル・非 https は fetch せずスキップし、SSRF を防ぐ。応答の `Content-Length` がスキンのアップロード上限（1MB）を超えるときは本文を読まず Mojang 経路へフォールバックする（読み取り側には所有判定を入れない）。

### スキン取得優先順位

1. `customSkinUrl` (カスタムスキンがあればそれを返す)
2. Mojang Session Server API (UUIDからスキンテクスチャURLを取得)
3. Steve スキン (フォールバック)

レスポンスヘッダ: `Cache-Control: public, max-age=3600` (1時間)

**MCID未登録ユーザーの扱いは表示側で分岐する。** `/api/skin` は `uuid` も `customSkinUrl` も無いユーザーに対しても
Steve を返す（この API の挙動は変えていない）。「MCID未登録（`uuid` も `customSkinUrl` も無い）」の判定と
プレースホルダー表示は、この API を呼ぶ前に表示側（`MinecraftAvatar` / `MinecraftFullBody` / OGP生成）で行う。

### MCID未登録ユーザーのプレースホルダー

`uuid` も `customSkinUrl` も無いユーザーは Steve ではなく専用のプレースホルダーを表示する
（カスタムスキンは MCID 無しでもアップロードできるため、`customSkinUrl` があればそちらを従来どおり表示する）。

| 用途 | アセット | 内容 |
|---|---|---|
| 顔（`MinecraftAvatar`・OGPのアバター） | `public/skins/no-mcid-face.svg` | 16x16。ラッキーブロック風の「?」ブロックのドット絵（色は `--brand` 基調の緑）。1px ごとの `<rect>` を手描きした SVG |
| 全身（`/player/:slug` プロフィールタブ） | `public/skins/no-mcid.png` | 64x64。default モデルのベースレイヤーだけを `#1a1a1a` で塗り、オーバーレイ層は透明 |

- どちらもオリジナルのピクセルアート（第三者 Mod のテクスチャは使わない）
- **顔（SVG）は手描きなので直接編集する**。`shape-rendering="crispEdges"` と `width`/`height` 属性（intrinsic size 16x16）は
  拡大表示・OGP 合成の前提なので外さないこと
- **黒スキン（PNG）は `scripts/generate-placeholder-skins.ts` が生成する**（`pnpm exec tsx scripts/generate-placeholder-skins.ts`。出力は決定的）。
  skinview3d のテクスチャはラスタでないと扱えないため PNG のまま。生成物もリポジトリに含める
- 配信は `public/` の静的配信に任せる（専用のキャッシュヘッダ設定は持たない）
- **`uuid` か `customSkinUrl` のどちらかがあるユーザーの挙動は従来どおり**。読み込み失敗時の Steve フォールバックも維持する
  （ただしプレースホルダー自体の読み込みに失敗した場合は、顔の切り出し方が異なるため Steve へは落とさない）

---

## マント（cape）

スキン3D表示（`MinecraftFullBody`）に背中のマント／エリトラを載せる。

### 表示の優先順位

**カスタムマント（`customCapeUrl`） → Mojang のマント（`uuid` がある場合） → なし**。
カスタムスキンを設定していても `uuid` があれば Mojang のマントを出す（スキンとマントは独立に解決する）。

`POST` / `DELETE /api/me/cape` はスキンと同じ所有判定（`capes/<userId>/`）を通す。判定に通らない既存 URL は `del()` しない。
この解決は `app/lib/cape.ts` の `resolveCapeProps({ uuid, customCapeUrl, capeDisplay })`（`.server` ではない共有ヘルパー）に集約しており、
返り値 `{ capeUrl?, backEquipment? }` をそのまま `MinecraftFullBody` に spread する。`hidden` や出所が無い場合は `{}`。

### `capeDisplay`

| 値 | 表示 |
|---|---|
| `cape` | マント（既定） |
| `elytra` | そのマントのテクスチャでエリトラ |
| `hidden` | 非表示 |

出所（カスタム/Mojang）に関係なく適用する。マントが無いユーザーが `elytra` を選んでも何も出ない。
`/me/edit` の「マントの表示」3択トグル（「スキンモデル」トグルと同じ見た目）で選び、基本のプロフィール保存フォーム
（`formValues` / 変更検知 / リセット）に乗る。サーバー側は `users.capeDisplay.enumValues` から導出した許可リストで検証し、
値が未送信のときは列を更新対象から外す（`null` や既定値で上書きしない）。不正値はエラー。
`/me/edit` のポーズプレビューには、保存前のフォーム値の `capeDisplay` を使って即時反映する。

### API: `GET /api/cape?uuid=`

Mojang のマント画像を返す中継API（`app/routes/api/cape.ts`）。プライバシーポリシーの
「閲覧者の端末から Mojang へ直接通信しない」に合わせ、サーバーが sessionserver からプロフィールを取得して textures の
`CAPE.url` を取り出し、PNG を取得して配信する（ブラウザに `textures.minecraft.net` を直接読ませない）。

- `uuid`: ハイフン有無の32桁hex。形式不正は `400`
- SSRF 対策: `CAPE.url` はパースしてホストが `textures.minecraft.net` であることを確認する（`toSafeMojangTextureUrl`、`app/lib/mojang.ts`）。
  sessionserver は `http://` を返すため http/https のどちらも受け付け、取得時は常に `https` へ正規化する。ポート指定・認証情報つき・
  別ホストは取得しない。リダイレクトは辿らない（`redirect: "error"`）
- マントが無い（プロフィール 204/404・textures 無し・CAPE 無し）: `404` + 長期公開キャッシュ（`/api/skin` の `SKIN_CACHE_CONTROL` 相当）
- Mojang 側の失敗（非 ok / 例外 / 不正なレスポンス / 想定外ホスト / 1MB 超）: `502` + 短TTL（`max-age=300, s-maxage=300`）
- `MinecraftFullBody` は `loadCape` の失敗（404 等）を握りつぶしてマント無しで続行する

### カスタムマントのアップロード

- Blob パス: `capes/<userId>/cape.png`（`addRandomSuffix: true` のため実体は一意パス）。png のみ・1MB まで
- 受け付ける画像サイズ: 64×32 / 22×17（旧形式）/ 128×64 / 256×128 / 512×256（HD）
- `POST /api/me/cape/upload-token`: Client Upload 用トークン発行。認証必須、`capes/<userId>/` 以外・`..` を含むパスは拒否
- `POST /api/me/cape`: `{ url }` を保存（認証必須。URLは `isVercelBlobUrl` でホスト検証。旧Blobは差し替え時に削除）。`customCapeUrl` / `customCapeUpdatedAt` を更新
- `DELETE /api/me/cape`: Blob を削除し、`customCapeUrl` / `customCapeUpdatedAt` を `null` に（`capeDisplay` は触らない）
- UI は `app/components/cape-uploader.tsx`（`skin-uploader.tsx` と同形。現在のマントは `pixelated` でプレビュー）。`/me/edit` の「カスタムスキン」の次にセクションを置く

### 静止画キャッシュ

`MinecraftFullBody` の静止画キャッシュキー・リクエストキー・主 effect の依存に `capeUrl` と `backEquipment` を含める
（マントだけ変わったときのキャッシュ衝突と、古い静止画の残留を防ぐ）。静止画の角度は変えず、マントも同じ角度で載せる。

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

**MCID未登録（`uuid` も `skinUrl` も無い）の場合は上記の canvas 経路を通らない。**
`MinecraftAvatar` が `/skins/no-mcid-face.svg` を `<img>` で直接描画する（`imageRendering: pixelated`・
同じドロップシャドウ・`composite()` と同じ5%の内側余白で、他のアバターと見かけの大きさを揃える）。
切り出す頭部が無い上、ベクタなので任意サイズでそのまま綺麗に出せる（canvas に通すと SVG のラスタライズ挙動が
ブラウザ依存になる）ため。判定と URL は `app/lib/avatar-cache.ts` の `isMissingSkinSource()` / `NO_MCID_FACE_URL`。
`warmAvatars()` は未登録ユーザーをスキップする。

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
| `capeUrl` | `string` | - | マント画像URL。省略時はマント無し。読み込み失敗（404等）もマント無しで続行 |
| `backEquipment` | `"cape" \| "elytra"` | `"cape"` | 背中の装備。`elytra` は同じマントテクスチャでエリトラ表示（`capeUrl` がある場合のみ有効） |
| `interactive` | `boolean` | `false` | OrbitControls による回転・拡大縮小・移動を有効化 |
| `showInteractiveHint` | `boolean` | `false` | インタラクティブモード時に右上にヒント切替ボタン（？）を表示 |

ポーズ種別: `standing`, `walking`, `running`, `waving`, `sitting`, `custom`

スキンURLの決定: `skinUrl` > `/api/skin?uuid={uuid}` > `/skins/no-mcid.png`（`uuid` も `skinUrl` も無い場合）。
プレースホルダー時は `slim` を無視して default モデルで読み込む。静止画キャッシュキーに使う識別子も
`/skins/no-mcid.png` になるため、Steve の静止画とは衝突しない。読み込み自体に失敗した場合のみ Steve に落とす。

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

`fullbodyViewer.*`（`avatarLabel` / `avatarLabelOf` / `noMcidAvatarLabel` / `showHint` / `hideHint` / `reset` / `hintText`）に集約。

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

### `speedruncom` リンクと `users.speedruncomUsername` の双方向同期

`/me/edit` の一括保存（`save_all`、`app/lib/profile-edit.server.ts` の `saveProfileBatch`）で双方向に同期する（リンクが `speedruncom` に触れるかの判定は `app/lib/profile-edit-validation.ts` の `linksTouchSpeedrun`）。

- **ソーシャルリンク欄からの操作** → `speedruncomUsername` に反映: リンクの作成・更新で
  platform が `speedruncom` なら identifier を `speedruncomUsername` にセット、別プラットフォームへ
  変更した場合はクリア、`speedruncom` リンクを削除した場合もクリア
- **`speedruncomUsername` を直接送る経路** → `speedruncom` ソーシャルリンクに反映: 値を
  設定/変更すると `social_links` に `speedruncom` 行を作成・更新（identifier が同じ場合は書き込みしない）、
  空にすると該当行を削除する。**`/me/edit` の UI の入口はソーシャルリンクだけ**で、「Speedrun.com 連携」欄は
  「ソーシャルリンクの Speedrun.com から読み取り中: xxx」の表示のみ（未設定ならソーシャルリンクへの案内）。
  この経路は、リンク行が無く列だけが入っている既存データや、直接送られた値の同期のために残している。
  フォームに `speedruncomUsername` が**無い**保存（`/me/account` など）では、列・リンク行・ランキング再取得のどれにも触れない

どちらの経路で設定しても、ソーシャルリンク一覧・公開プロフィールの `SocialLinksCard` の両方に反映される。

**一括保存（`save_all`）での優先規則**: 同じ保存に speedrun.com に関わるリンクの変更（作成 / 更新 / 削除。更新は旧・新どちらかが `speedruncom` の場合）が含まれる場合は**リンクの変更を優先**し、`speedruncomUsername` は最終状態の speedrun.com リンクの identifier から決める（無ければ `null`。`social_links` への逆方向同期は行わない）。speedrun.com に関わるリンク変更が無いときだけフォームの値を使い、従来どおり `social_links` へ逆方向同期する。クライアントも、リンクの下書きで speedrun.com リンクが増減・変更したらフォームの `speedruncomUsername` を同じ値に更新する（画面とサーバーの結果を揃える）。実装は `app/lib/profile-edit.server.ts`、テストは `app/routes/me/__tests__/edit-batch-save.test.ts`。

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
  ネガティブキャッシュ）・Twitch 5分（配信中フラグの鮮度優先。失敗も5分）。失敗は番兵値で保存する。CDNは `s-maxage=300, stale-while-revalidate=3600`
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
- 登録時（`/me/edit` の一括保存 `changes.videos` の `create` / `update`）も `getYouTubeVideoId()` で解決できないURLを拒否する

### 編集（`/me/edit` の「動画」カード）

- ソーシャルリンクと同じ「Dialog で下書きを編集 → 保存バーで一括保存」パターン（[/me/edit の保存方式](#medit-の保存方式保存バーでの一括保存)）。追加・編集・削除・上下入替はいずれも下書きだけを変え、保存時に `changes.videos`（`create` / `update` / `delete` / `order`）として送る。`order` の並び順でサーバーが `displayOrder` をインデックスで振り直す（旧 `create_video` 等の個別 `_action` は削除済み）
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
- 切替UI: ガイド=`/my-guides` 一覧のピンボタン（`_action: "togglePin"`）、記録=`/me/records` の編集ダイアログのSwitch（下書きに積み、保存で確定）、動画=`/me/edit` の動画ダイアログのSwitch、Speedrun.com記録=`/me/records` のピンアイコンボタン

### /me/records（記録の管理）

欄区切り（`PageSection`）。「Speedrun.com 記録」欄（ユーザー名設定時のみ）と「カスタム記録」欄の2つ。

- **保存の仕方（全部を下書きにそろえる）**: Speedrun.com 記録の非表示・ピン留めと、カスタム記録の追加・編集・削除は、すべて画面上の下書きで持ち、`FloatingSaveBar`（離脱の警告つき）でまとめて保存する（`hasChanges` は旗の下書き＋記録の下書き。保存中は編集・追加・トグルを無効にする）。ダイアログの確定ボタンは「この画面に反映」（DB には書かず下書きに積むだけ。注記「ページ下の保存で確定します」付き）で、必須・長さ・時間形式・動画URL・同一カテゴリの重複・50件上限はダイアログ内で先に検査して表示する。**削除は即時の確認ダイアログではなく、下書き上で「削除予定」にする**（行は半透明・取り消し線・「削除予定」バッジで、その行の「元に戻す」で復帰。追加したばかりの記録は一覧から外すだけ）。保存の action は `_action: "saveRecords"`（`hidden` / `pinned` ＋ `records`＝変わった記録だけの JSON 配列。`id` が null なら新規、`delete: true` なら削除）で、書き込み前に形・値・所有者（他人の id が混ざっていたら `invalidAction` で何も書かない）・保存後のカテゴリ重複（`categoryDuplicate`）・件数上限（`errorLimitReached`）をすべて検証し、1つのトランザクションで 削除 → 更新 → 追加 → 旗の更新 の順に書く（途中で失敗しても何も残らない。エラーは下書きを残したまま表示）。説明文（h1 の下）に「ここでの変更は下書きで、ページ下の保存で確定します」と書く。
- **カテゴリ（`category_records.category`）**: プロフィールのハイライトが、プレイスタイルのメインカテゴリ（rsg / ssg / aa / ce / ranked）の記録を前方一致（`recordMatchesMainCategory`、`profile-highlights.ts`）で選ぶために使われるので、入力欄は残している。画面では**カテゴリ（選択式。`CATEGORY_KEYS`）＋サブカテゴリ（任意の自由入力）**に分けて入力し、`app/lib/record-category.ts` の `buildRecordCategory` が `rsg_any` の形に組み立てて `category` として送る（既存の記録の編集では、開いた時点のキー・サブカテゴリから変更が無ければ `resolveRecordCategory` が元の値をそのまま送る。`RSG-any` 等が表示名だけの変更で `rsg_any` に正規化され、`rsg-any` と `rsg_any` を両方持つ走者で重複エラーになるのを防ぐ）（action は従来どおり `category` 1本を受ける）。既存の自由入力は `splitRecordCategory` が前方一致で分け、どのキーにも属さない値は「その他」＋全体として保つ（組み立て直しても同じ値）。`(userId, category, recordType)` は一意なので、同じカテゴリ・サブカテゴリで2件目を作ると `meRecords.categoryDuplicate` を返す（500 にしない）。列はそのまま（`categoryRefId` は手入力の記録では未使用）
- 操作ボタンはすべて名前つき（記録名入りの `aria-label`）で、md 未満は 44px

### Speedrun.com記録のピン留め（軽量実装）

Speedrun.comのPBはDBにキャッシュされず、プロフィール表示のたびにSpeedrun.com APIから直接取得される（`category_records` に行を持たない）ため、他のピン留めと違い `category_records.isPinned` を使えない。代わりに `users.pinnedSpeedrunRecords`（JSON配列、ピン留めするrun IDの一覧。`hiddenSpeedrunRecords` と同じ形式）で管理する。

- 管理: `/me/records` の「Speedrun.com 記録」欄で、各タイルの右上にピン留め（`Pin`）と表示/非表示（`Eye`/`EyeOff`）の2つのトグルボタンが並ぶ（`aria-pressed` ＋記録名入りの `aria-label`、md 未満は 44px）。押しても**即保存はせず下書きに積み**、`FloatingSaveBar`（離脱の警告つき）の保存で、カスタム記録の変更と一緒に `_action: "saveRecords"`（`hidden` / `pinned` に run ID の JSON 配列。サーバーが重複・空文字を除いて上限 500 件で検証し、2列を同じトランザクションで置き換える）が呼ばれる。`updatedAt` はピン留めの集合が変わったときだけ進める。下書きは保存済みの内容（集合）が変わったときだけ取り直す（再検証で参照だけが変わっても未保存の下書きを消さないよう、参照ではなく内容で比べる（記録の下書きも同じキーで取り直す））。純粋関数は `app/lib/run-id-list.ts`（`sameRunIdSet` / `parseRunIdListInput`）。保存中（`isSavingFlags`）は2つのトグルを `disabled` にする（保存後の再取得で下書きが保存済みの値に取り直されるため、保存中に押した操作が消えるのを防ぐ）。保存は「リスト全体で上書き」なので、別タブの古い画面から保存すると後勝ちで他方の変更が消える
- 表示: プロフィールの活動・記録タブで、非表示記録を除外した後、ピン留めを先頭に安定ソートしてから最大6件表示（`StatsContent` 内）。ピン留めカードは `md:col-span-2` + 枠線強調 + タイム拡大（`text-3xl`）+ ピンアイコン
- 非表示（`hiddenSpeedrunRecords`）と独立して管理されるため、非表示にした記録をピン留めすることも技術的には可能だが、非表示である以上プロフィールには表示されない

---

## プロフィール表示ページのレイアウト

### キャッシュ方針

`app/routes/player/profile.tsx` は `headers()` export で `Cache-Control: private, no-store` を返す。isOwner・プリセット選択・絵文字リアクションなど閲覧者依存のデータを含むため、ブラウザ/CDN にキャッシュさせない。React Router のシングルフェッチはこの `headers()` を `.data` サブリクエスト（クライアント遷移時の JSON 取得）にも適用する。

これが無いと、`ProfileFeedCard` 等の `prefetch="intent"` Link がホバー時に `/player/:slug.data` を `<link rel="prefetch">` で先読みし、その応答がブラウザの HTTP キャッシュに乗ってしまう。結果として「リアクション後に別ページへ移動し、ホームのカード等からプレフェッチ経由で再訪すると、反応前の古い状態が一瞬〜継続的に表示される」不具合になる（ハードリロードはブラウザキャッシュを無視するため直る＝原因の特定に使えた症状）。

### アイテム配置タブ・概要タブの動画

アイテム配置タブは xl（1280px）以上で区間（`ItemLayoutRow`）を2列の格子に並べる（DOM 順＝左→右・上→下。メモは各ホットバーの下。罫線は先頭と最上段の右の欄だけ外す）。xl 未満は1列のまま（lg では列幅約457px に9スロットのホットバー約535px が収まらず、列ごとの横スクロールとページのはみ出しが出るため）。概要タブの動画（`VideoEmbed`）は YouTube を `YouTubeClickEmbed`（押してから iframe を読み込む。名前・title は動画のタイトル、無ければ URL）で出す。YouTube に変換できない URL は従来どおり外部リンクで、Twitch 等の iframe 埋め込みは元からない。

### 貼り付いたホットバー（md 以上）

貼り付き中のバーは不透明な `bg-background`（blur なし）・スロット `h-10`・`py-2`・下罫線 1px で高さ 57px。貼り付く前のフロー上の高さ 72px を保つため `mb-[15px]`（72 − 57）。貼り付き中はサイトヘッダーを不透明にする（`app.css` の `:root:has([data-stuck="true"]) header.sticky`）。ヘッダーの下罫線は残す。連動する値: `SCROLL_RESTORE_SENTINEL_TOP_PX`（42）、サーチクラフトの追従見出し `top`（120px。バーの下端 121px = 64 + 57 より 1px 上にもぐらせる）。バーと追従見出しを 1px ずつ重ねるのは、ちょうど接すると表示倍率 125%・150% 等で境目が小数の画素位置（81.25 等）になり、両者が半端に塗る1行から下のコンテンツが透けてちらつくため、`app.css` の `scroll-padding-top`（md 以上 8.5rem、追従見出しがあるとき 11.75rem）。

貼り付き中だけ、バーの左（tablist の外）に走者のアバター（28px）と名前を表示する（`ProfileHotbarTabs` の `leading`。`aria-hidden`・クリック不可。名前は xl 以上だけで `max-w-40 truncate`、1024px 前後は8スロット＋プリセットでバー幅が埋まるためアバターだけ）。貼り付く前・md 未満の下端ドックには出さない。

### スキン表示

`/player/:slug` のプロフィールタブでは、ページ上は**静止画**（`asImage`）で描画し、クリックでダイアログを開いたときだけ
**インタラクティブモード**（`interactive` + `showInteractiveHint`）をマウントする（WebGL を常駐させないため）。サイズはレスポンシブ：

| 画面幅 | 表示サイズ |
|---|---|
| sm 未満（モバイル） | 206 × 240（縦を使いすぎないため。縦横比 0.857 を維持） |
| sm 以上（デスクトップ） | 240 × 280 |

出し分けは CSS（`h-[380px] w-[320px] sm:h-[280px] sm:w-[240px]` の箱）で行う。`useMediaQuery` で寸法を決めると SSR はデスクトップ寸法で描かれ、モバイルでハイドレーション後に大きくなって跳ねる（CLS）ため。描画解像度は 320 × 380 に固定し（どちらも縮小表示）、`MinecraftFullBody` の `fluid`（静止画のみ。表示は親の箱に `object-contain` で収める）で縮小表示する。

スキンと右側の基本情報は `flex-col sm:flex-row sm:items-center` で、デスクトップ時は上下中央揃え。

**MCID未登録（`uuid` も `customSkinUrl` も無い）の場合**は、スキン領域を消さずに黒スキンのプレースホルダー
（`/skins/no-mcid.png`）を静止画で表示し、その直下に注釈「このユーザーはMCIDを登録していません」
（`playerProfile.noMcidNote`）を中央寄せ・`text-xs text-muted-foreground` で添える。3D 表示のダイアログは開けない
（見るべきスキンが無いため、トリガーごと出さない）。`uuid` か `customSkinUrl` のどちらかがある場合は従来どおり。

### Bedrock版 MCID の表示

`bedrockMcid` が登録されている場合、`/player/:slug` の概要タブ先頭（スキン横の基本情報）で、Java版 MCID の `@{mcid}` 行と同じ `text-muted-foreground` の
スタイルで `playerProfile.bedrockMcidLine`（ja: `Bedrock版: {id}` / en: `Bedrock: {id}`）を追加表示する。
Java版 MCID が未登録で Bedrock版だけがある場合も、その行だけを表示する。
OGP画像・`/compare`・`/browse` のカードは対象外。

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

編集（本人のみ）/お気に入り/シェアのアクションボタン行は身元帯にある（md 未満はアイコンのみ）。プロフィール絵文字リアクションバー（常時表示、標準機能）は概要タブの基本情報（短い自己紹介の下）に置く。未ログインでリアクションが 0 件のときもバーを消さず、短い案内文（`profileReactions.loginPrompt`）と既存の「ログインしてリアクション」ボタン（`/login`）を出す。詳細は [`docs/profile-reactions.md`](./profile-reactions.md) を参照。

### 自己紹介（bio / shortBio）の自動翻訳表示

閲覧ロケールと原文のロケールが異なり、有効な訳文があるときだけ、`bio`（Bio 欄）と `shortBio`（概要タブの基本情報）を**訳文を既定で**表示する。仕様の全体は [`docs/translation.md`](./translation.md)。

- loader が `getUserBioTranslation(db, player, resolveLocale(request))`（`app/lib/content-translation.server.ts`）を呼び、`bioTranslation`（`{ bio, shortBio, sourceLocale }` | `null`）を返す。`player` の原文も従来どおり返すため、訳文と原文の両方がクライアントに渡る（500字以内で負担は小さい）。`null` は機能無効・オプトアウト・失効・原文と閲覧ロケールが同じ、のいずれかで、その場合は原文のみ
- SSR 時点で訳文が出る（切替前に原文が一瞬見えることはない）。切替はクライアント状態（`showBioOriginal`）のみで、`bio` と `shortBio` が同時に切り替わる
- 訳文が存在する欄の近くに `AutoTranslateNotice`（`app/components/auto-translate-notice.tsx`。ガイド記事ページと共通で、切替は `onToggle`〈ボタン〉または `to`〈URL リンク〉）を出す: 概要タブの基本情報の `shortBio` の下と Bio 欄の見出し直下。「自動翻訳 · 原文を表示」→ 原文表示中は「原文を表示中 · 翻訳を表示」（`playerProfile.autoTranslated` / `showOriginal` / `viewingOriginal` / `showTranslation`）。自動翻訳を著者の言葉として黙って出さないための必須要素
- 訳文の `bio` も原文と同じ `BioMarkdown`（`react-markdown` + `rehype-sanitize`）で描画する
- `<meta>` の description / OGP・シェアの文面は原文（`shortBio`）のまま。一覧カード（`/browse`・ホーム・`/compare` 等）の `shortBio` は**未対応**（原文表示）

### 値なし表記・空タブの扱い（`/player/:slug`）

- 値が無い項目の表記は「-」に統一し、共有コンポーネント `EmptyValue`（`app/components/player-profile-bits.tsx`）で描画する（スクリーンリーダー向けに sr-only「値なし」を併記）。キー配置の空チップも同様
- デバイスタブは中身のあるカードだけ表示する（キーボード＝モデル/配列、マウス＝モデル/DPI/ゲーム内感度/Windows 速度のいずれか、ゲーム内設定）。全部空なら空状態。初期値のままの Raw Input/加速だけでは「データあり」とみなさない。旧「キーボード/マウス情報なし」の文言カードは廃止
- 本人（`isOwner`）が見たときだけ、空タブの空状態とカード見出しに編集ページへの導線（`OwnerEditAction`）を出す。遷移先は `/me/keybindings`・`/me/items`・`/me/search-craft`・`/me/devices`・`/me/records`・`/my-guides`

### デバイスタブのマウス設定表示

`devices` タブのマウス設定は、値が出せない/不正なケースでも行を消さず「-」+ 理由（または警告）を表示する。計算ロジック・警告UIは `/keybindings` 一覧と共有しており、詳細は [`docs/keybindings.md`](./keybindings.md#マウス設定)（振り向き・カーソル速度・バリデーション節）を参照:

- **ゲーム内感度が有効範囲外**: 値はそのまま出しつつ警告アイコン + ヒント（共有コンポーネント `SensitivityWarning`、`app/components/sensitivity-warning.tsx`）を表示する
- **Win Sens が係数テーブル（1〜20）外**: `x1.000` と断定せず警告アイコン + ヒント（`WinSensValue`）を表示する
- **振り向き（cm/360）・カーソル速度が計算できない**: 行自体は残し、「-」+ 理由（DPI未設定・感度未設定・感度範囲外・Windows乗数未設定/不明など、`TurnDistanceValue` / `CursorSpeedValue`）を `HintTip` で表示する（以前は該当行そのものを非表示にしていた）

### 活動・記録タブの外部統計カード

`stats` タブの MCSR Ranked カード（レート帯チップ・Win Rate/FF Rate・国内順位・Minefolio内順位・最近のマッチ）は `/player/:slug/stats` と共通の表示コンポーネントで、算出ロジックの詳細は [`docs/rankings-stats.md`](./rankings-stats.md#mcsr-ranked連携)「MCSR Ranked連携」を参照。

#### 審査中の speedrun.com 記録

承認済み記録のみを返す personal-bests API では出ない「審査中」（`player_rankings.verificationStatus = "new"`、`rankingType = "speedruncom"`）の記録を、`stats` タブの Speedrun.com カードの下の専用カード（`PendingSpeedrunRecordsCard`）に出す。

- 取得は loader で `loadPendingSpeedrunRecords`（`app/lib/speedruncom-pending.server.ts`）。cron が保存済みの行を読むだけで speedrun.com API は叩かない。承認済み・却下・他ユーザーの行は含めず、オーナーが非表示にした run ID は除外、タイムの速い順。非公開プロフィールは loader 冒頭のゲートで本人以外に 404 のため漏れない
- 0 件の人にはカードごと出さない。カード右上の「審査中の記録も表示」トグルをオンにすると、カテゴリ名・タイム・「審査中」バッジ（`warning` トークン）・speedrun.com のランページへの外部リンク（新しいタブ）を並べる
- トグル状態は URL の `srcPending=1` が指定元（切替は `replace` で履歴を汚さない）。スイッチはタブと同じくローカル状態で即時に切り替え、URL の変化（リンク等）に追従させる（URL だけを読むと root / _layout の loader が返るまで切り替わって見えない）。`srcPending` は loader が読まないので、`shouldRevalidate` で `tab` と同じく profile の loader を再実行しない（`PROFILE_VIEW_ONLY_PARAMS`）。`?tab=stats&srcPending=1` で開くと最初からオンで、カードの位置までスクロールする（ホームの注目の走者カードからの導線。形式は変更しない）
- テスト: `app/lib/__tests__/speedruncom-pending.server.test.ts`

### 各タブの欄構成

走者画面は**欄を箱にせず、上罫線で区切る**（共通部品 `PageSection`、`app/components/page-section.tsx`。ホームと共有。規約は ui.md「欄枠」「見出しの段」）。**見出しの階層は 走者名 `h1`（身元帯）＞ タブタイトル `h2` ＞ 欄 `h3` ＞ 欄の中の小見出し `h4`**。**サイズは段差をつける**: 走者名 `h1` は `text-2xl md:text-3xl`（24/30px）、タブタイトル `h2` は `text-xl md:text-2xl`（20/24px）、欄 `h3` は `text-lg`（18px）、小見出し `h4` は `text-base`（`PageSection` は `headingLevel=="h3"` のときだけ `text-lg`、既定の `h2`＝ホームは `text-xl` のまま）。`PageSection` の `headingLevel` prop（既定 `h2`＝ホーム。走者画面だけ `"h3"`）で切り替え、共有部品の箱なし表示（`framed={false}`）は欄を `h3`・小見出しを `h4` で描く。

**`/player/:slug/stats`** は記録タブと同じ骨格にそろえている: 走者名 `h1`（`getLocalizedDisplayName`。`<title>` も同じ名前）＞「活動・記録」`h2` ＞ 欄 `h3`（統計カードは `framed={false}`）。手入力のカスタム記録（`categoryRecords`、`isVisible` のみ・ピン留め先頭）も「データあり」に数えて欄（`RecordCard`、`app/components/record-card.tsx`。記録タブと共有）で描く。何も無いときの空状態は記録タブと同じ文言（`playerProfile.noStatsTitle` / `noStatsDescription`、本人は `noStatsDescriptionOwner`）。戻るリンクは `/player/:slug?tab=stats`（記録タブ）。

**空状態の文言（本人）**: 各タブの空状態は、本人が見ているときは三人称（「この走者はまだ…」）ではなく本人向けの文（`playerProfile.*Owner`）にする。

**プリセットの選択**: メインのプリセットには「 (メイン)」（`playerProfile.presetMainSuffix`）を添えるが、名前がメインの表示そのもの（`playerProfile.presetMainLabel`）なら重ねない。

**指色の凡例**: キー配置タブの指色の凡例（`FingerLegend`）は、指の割り当てが1つ以上あるときだけ出す。

**タブタイトル**: 各タブパネルの先頭に、そのタブの名称（ホットバーのツールチップと同じ `tabItems` の `label`）を `h2`（`text-xl md:text-2xl font-bold`、`ProfileTabTitle`。`badge` でタイトル直後に HintTip、`trailing` で右端に操作）で出す。**欄が1つだけのタブ（ガイド・サーチクラフト）は、見える欄見出しを出さず、`sr-only` の `h3`（「ガイド一覧」「サーチクラフト一覧」、`playerProfile.guidesListHeading` / `searchCraftListHeading`）を1つ置く**（タブタイトルと同文言で二重になるため見せない。見出しの並びを h2 → h3 → h4 にそろえ、その下のカード名・サーチクラフトのグループ名を `h4` にする。見た目は変えない。ガイドカードは `GuideCardGrid` / `GuideListView` の `titleLevel="h4"`、サーチクラフトは `groupHeadingLevel="h4"`）。欄は `section` ではなく `role="group"` の div（`aria-labelledby` でこの `h3` を参照）にし、欄見出しの右にあった操作はタイトル行へ移す。空状態のタブも同じで、タイトルの下に `EmptyState`。パネルの名前（`aria-labelledby`）はこの `h2` を参照する。タイトルと最初の内容の間隔は欄どうしより詰める（`mb-3 sm:mb-4`）。md 未満のプリセット選択はタイトルと同じ行の右端（狭いと折り返す）。

**先頭の罫線**: タイトル直下の最初の欄は上罫線・上余白なし、2つ目以降は罫線あり（`PANEL_CLASS` がパネル直下の最初の `section` に効く。`PageSection` の `first` / `className` でも指定できる）。2列グリッド（プレイスタイル lg・デバイスのキーボード/マウス md）は1行目に横並びになる欄がどれも罫線なし（1列に落ちる幅では最初の欄だけ）。概要の先頭（スキン等）と空状態の箱はそのままタイトル直下に来る。各タブ末尾の「ほかの走者と比べる」欄はパネルの外なので罫線あり・`h2`。欄どうしの間隔は `space-y-7 sm:space-y-8`。箱として残すのは1件ずつの物（記録のカテゴリ別カード・動画の埋め込み・リッチリンク・ガイドカード）だけ。他画面と共用する部品（`player-stats-cards.tsx`・`ItemHotbar`・`SearchCraftGroupedList`・`VirtualKeyboard` 等）は props で箱なし表示に切り替え、既定は従来のまま（`/me/items` 等は不変。`/player/:slug/stats` は上記のとおり箱なしへ移した）。

- **概要**（`profile`）: スキン＋基本情報（Bedrock MCID・短い自己紹介・バッジ・メタ情報・リアクション）、リンク、自己紹介、動画の各欄（アイコンなし）
- **記録**（`stats`）: 本人のメインカテゴリに合う欄を先頭に置く（`orderStatsSections`、`app/lib/profile-stats-order.ts`。ranked → MCSR Ranked、rsg / ssg / aa / ce → Speedrun.com＋審査中、他は既定の順）。各カード（MCSR Ranked / PaceMan / Speedrun.com / 審査中 / 取得中）は `framed={false}` で欄になる。
  - Speedrun.com は、身元帯と同じ規則で選んだハイライトの PB を `highlightRunId` で渡し、表示上限の外でも必ず表示する（先頭 5 件＋その PB）。7 件以上なら「すべて表示（N件）」／「表示を減らす」で切り替える
  - PaceMan はリンクと過去 1 週間の統計を **1 欄**にまとめ、リンクを見出し右に置く。週間統計があるときは登録判定（クライアント取得）の状態も見出し右で扱う（読み込み中＝小さなスピナー、失敗＝「再試行」ボタン、成功＝リンク）。単独の取得中・失敗カードは週間統計が無いときだけ出す。取得中・失敗も確定後と同じ見出しの欄にして、完了で見出しが跳ねないようにする
  - **代表 PB（Speedrun.com 欄）**: 身元帯の代表 PB（`pickRepresentativePb`）はカードを「ピン留めの次」（無ければ先頭）に置き、「代表記録」の Badge（secondary）と `border-primary/40` を付ける。カードは `id="stats-src-<runId>"`（`tabIndex=-1`）。同名カテゴリがほかにあるときだけ、カード見出しと身元帯タイルのラベルに版を添える（`speedrunComPbDisplayName`、例「Java · Any% Glitchless」）。身元帯の PB タイルを押すと記録タブへ切り替え、そのカードへスクロール（`:root` の scroll-padding でホットバーを避ける）してフォーカスを移す（`profile-highlights.tsx` の `goToStatsCard`。カードが現れるまで最大5秒待つ）
  - **SRC の動画埋め込み**: 押してから読み込む（`youtube-click-embed.tsx`。サムネイル `i.ytimg.com`〔`getYouTubeThumbnailUrl`、feed-video-card と同じ送信先〕＋再生ボタン → 押すと `youtube-nocookie.com` の iframe〔autoplay=1〕）。ボタンの名前・iframe の title は「<版・カテゴリ> <記録時間>」
  - **身元帯タイルの取得失敗**: Ranked / SRC の結果に `error` があるとき、Elo・PB タイルを消さず値の位置に「取得できませんでした」（`text-muted-foreground`）を出す（押すと記録タブの再試行カードへ）。`error` なしの未登録・データなしは従来どおりタイルを出さない
  - **取得失敗の再試行**: MCSR Ranked / PaceMan / Speedrun.com の取得に失敗（関数が throw、または Ranked・SRC の結果に `error` あり。`error` なしの `isRegistered: false` や PB 0 件は「未登録・データなし」で欄ごと出さない）したら、失敗カード（`StatsServiceLoadingCard`）に「再試行」ボタン（`common.retry`、`RotateCw`、md 未満は高さ 44px 以上）を出す。押すとそのサービスだけ `loading` に戻して取り直す（`profile.tsx` の `StatsTabContent` がサービスごとの取得関数 `loadRanked` / `loadPaceman` / `loadSpeedruncom` を持つ。走者切替・アンマウントでは取得セッションを破棄し、古い結果は反映しない）。`onRetry` を渡さない利用箇所（`/player/:slug/stats` 等）は従来どおりボタン無し
  - 箱なしのとき MCSR Ranked の統計タイルは 3+3（狭い幅は 2 列）、Elo グラフの見出しは `h4`（差分に「この間の増減」ラベル）
  - カスタム記録も欄に入れ、`RecordCard` は 1 件ずつの箱のまま
- **ガイド**（`guides`）: 欄見出しなし。タイトル行の右に表示切替（`ViewToggle`）→ プリセット（md 未満）、下にガイドカード（箱のまま。カードの見出しは `h3`）
- **プレイスタイル**（`playstyle`）: プレイ内容・操作・テクニックの欄。lg 以上でカードを 2 列にする
- **キー配置**（`keybindings`）: 2 欄。
  - 「キーボード表示」: 上の 1 行に指の凡例・略号（OH / HB）の `HintTip`・Trigger/Chat 切替・「キーを押すと割り当ての詳細が出ます」・画像保存。キーボードは箱に入れず欄に直接置く。**キーボードのナビクラスタの位置は、本文幅 1120px（70rem）を境に切り替える**（container query。以上はナビをメイン部の右、未満は下の段に「ナビ → テンキー → マウス」）。両方を描いて `display:none` で片方だけ出す（SSR でちらつかず、隠れた側のキーに Tab が止まらない）。`VirtualKeyboard` の `section`（`"all" | "main" | "nav"`、既定 `"all"`）で分割して描く。**モバイルは** `KeyboardScaledPreview`（`app/components/keyboard-scaled-preview.tsx`）で実寸を縮小表示し、タップで全画面ダイアログ（実寸・ピンチ／スクロール）。縮小レイヤーは `inert`
  - キーボードの直前に**スキップリンク**「キーボードを飛ばして割り当て一覧へ」（素の `href="#…"` は履歴を増やすので、ボタンで一覧の見出しへ focus する）
  - 「割り当て一覧」: 各グループとカスタムアクションを `h3` グループ＋`divide-y` のリスト（2 列は維持）にする。**リマップは件数付きの折りたたみ（`details`）で既定は閉じる**
- **デバイス**（`devices`）: キーボード・マウス・ゲーム内設定の欄。振り向きは**小数 1 桁＋「cm/180°」**表記（ホームの注目の走者と同じ）。キーボードレイアウトの生の値は「JIS TKL」のように表示し（`/me/devices` の選択肢と同表記）、ゲーム言語名・機種名・レイアウト名は等幅フォントにしない
- **アイテム配置**（`items`）: レイアウト（セグメント）ごとに 1 欄（`h2`＝セグメント名、色ドットを見出しの左）。ホットバーは箱に入れず欄に直接置く。`ItemHotbar` の props: `slotKeyLabels`（各スロットに本人の `hotbar1`〜`9` の割り当てキーを出す。番号は sr-only に残し、未割り当ては「-」。キー配置タブと同じ `player.keybindings` から解決するのでプリセット表示中はプリセットのキー）／`fitMobile`（md 未満でスロットを最大 32px〈アイコン 24px〉に縮め、オフハンド＋9 スロットを横スクロールなしで収める）／`itemNameTips`（アイテム名を `HintTip` 方式で、ホバー・フォーカス・タップのどれでも出す）。アイテムアイコンの `alt` は翻訳済みのアイテム名（`ItemIcon` の `alt`。既定は従来の itemId）
- **サーチクラフト**（`searchcraft`）: **1 欄**（欄見出しなし。タブタイトルの直後に説明の `HintTip`）。サマリーは箱にせず欄の先頭の行。タイトル行の右（プリセット選択の左）に、**閲覧者の言語でアイテム名を表示するトグル**（shadcn の `Switch`＋`<label>`「アイテム名を{表示言語名}で表示」。`playerProfile.searchCraftItemNamesIn` / `searchCraftViewerLangName`）を置く。既定は走者のゲーム言語のまま、押すとアイテム名だけを閲覧者のロケール（ja→日本語、en→英語）にし、もう一度押すと戻る。サーチ文字列・キー列は変えない。状態はコンポーネントの state のみで保存しない（localStorage・Cookie・URL に載せない）。走者のゲーム言語（未設定は日本語）が閲覧者の言語と同じときはトグルを出さない。走者のゲーム言語にアイテム名の辞書（`public/mcitems/1.16/lang/<code>.json`）が無い場合（`hasItemNameDictionary`＝`app/lib/game-languages.ts`。該当は `lo_la` / `nah` / `nb_no` / `ry_ua` / `sr_cs` / `zlm_arab`）、アイテム名は英語にフォールバックする。トグルが OFF（走者の言語で表示中）のときだけ、サマリー行の下に控えめな注記1行（`searchCraftNoItemDictionary`、Info アイコン＋`text-xs text-muted-foreground`、折り返し可）で理由を示す。閲覧者の言語へは自動で切り替えない。辞書の有無と集合の一致は `game-languages-label.test.ts` が検証する。`SearchCraftGroupedList` の `framed={false}`（タイトル直下の sr-only の h3「サーチクラフト一覧」の下なので `groupHeadingLevel="h4"`）＋`collapsible`（グループごとの開閉・件数・最初のグループだけ開く・「すべて開く／すべて閉じる」）。`stickyHeaders` ＋ `stickyTopClassName`（`top-[64px] md:top-[112px]`＝サイトヘッダー直下、md 以上は貼り付いたコンパクトなホットバーの直下。いずれも 1px 重ねる）で、**開いているグループの見出し行（名前・件数・開閉ボタン・列見出し）を `sticky`（`z-30`・`bg-background/95` ＋ `backdrop-blur`）で追従**させる（閉じたグループは追従しない。既定 off で他画面は不変）。中身（crafts も Loop も）が無いグループは出さない

### 空状態・末尾の導線

- **空状態**: 中身の無いタブは `EmptyState`。**訪問者**には、その走者で中身のあるタブを**最大 3 つ**（ホットバーの並び順、概要は最後）ボタンで案内し、押すとそのタブへ切り替える（`playerProfile.emptySuggestTabs`）。**本人**（`isOwner`）には従来どおり編集ページへの導線。見出しは「〇〇はまだありません」／"No X yet" にそろえる。人を指す語は「走者」（en: runner）
- **末尾の導線**: 全タブの末尾に「ほかの走者と比べる」の欄（`playerProfile.exploreTitle`）を置く。「比較・似た走者を探す」（`/compare?p1=<slug>`。比較ページへ）、ログイン中に他人のページを見ているときだけ「自分と比較する」（`p2=<自分の slug>`）、「ほかの走者を見る」（`/browse`）。比較の導線はここに集約（身元帯には置かない）。モバイルでも下端のホットバーに隠れない（本文末尾にホットバーの高さぶんの余白が入る）

### 登録者・フォロワーの 0 表記、スキン静止画の失敗

- リンクのリッチカードで、YouTube の登録者数・Twitch のフォロワー数が **0 のときはその数を出さない**（新規チャンネル等で「登録者 0人」と見せない。リンクと配信の情報は残す）。取得失敗は従来から非表示。`/api/social-stats` は取得失敗を番兵値（`{ failed: true }`）で短 TTL ネガティブキャッシュする（`getDbCached` は「行なし／期限切れ」も保存済み null も null で返し区別できないため。YouTube 15 分・Twitch 5 分）
- 3D スキンの静止画（`MinecraftFullBody` の `asImage`）が描画失敗で**全面透明**になったときは、2D アバター（`MinecraftAvatar`）を元の枠の中央に出す（canvas を 16x16 に縮小して alpha を検査）。透明と判定した結果はキャッシュしない（次の mount で再描画を試みる）。`/onboarding` にも効く

### プリセット切替

`presets.length > 0` で対象タブ（`keybindings` / `devices` / `items` / `searchcraft`）を表示中のときは、**lg 以上ではホットバーと同じ行の右端（`ProfileHotbarTabs` の `trailing` slot。tablist の外に置き、貼り付いてコンパクト表示になってもバーの中に残る。バーは折り返さない）、lg 未満（〜1023px）ではタブタイトル（`h2`）と同じ行の右端（狭いと折り返す）に、小さなセレクト**（768〜1023px でバーに入れると貼り付き前に2行〈112px〉、貼り付くと1行になって高さが変わり、貼り付き判定が点滅するため。スロットの左右余白は lg 未満で詰める）（`SelectTrigger size="sm"`・幅は内容に合わせる。アクセシブルネームは `playerProfile.preset`、見える「プリセット:」ラベルは無い）を置く。箱・全幅の帯にはしない。特定の欄の見出しには付けない（2 列のデバイスタブで左の欄専用に見えるため）。4 タブとも同じ位置で、`EmptyState` だけのタブでも同じ（`presetSelectorNode`。lg 未満用は各タブの `ProfileTabTitle` の `trailing` に渡す `presetSelector`〔`lg:hidden`〕で、同じ部品を2か所に描き CSS で切り替える）。サーチクラフトタブのタイトル行は「HintTip … 言語トグル → プリセット」の並び（狭い幅は折り返す）。「プリセット表示中」バッジは md 以上のみ：

- **アイテム配置・サーチクラフトは、表示中のデータもどのプリセットも空のときは出さない**（別のプリセットに中身があれば切替先として残す。プリセット一覧が種別ごとの有無フラグ `hasItemLayouts` / `hasSearchCrafts` を持つ）。キー配置・デバイスは有無の情報が無いので対象外
- 選択肢に切替時は URL クエリ `?preset=...` を `setSearchParams` で更新し（`replace`）、`useRevalidator().revalidate()` も併せて呼ぶ
- 切替中（`navigation.state === "loading"` または `revalidator.state === "loading"`）はメインコンテンツにローディングオーバーレイを表示。プリセット選択 UI は表示維持

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

画面は欄区切り（`PageSection`、ui.md 4章）。h1 ＞ 欄 h2 ＞ 欄の中の小見出し h3 の段。欄は「MCID・スキン」「基本情報」「Speedrun.com 連携」「ソーシャルリンク」「動画」「プロフィール設定」「危険な操作」。危険な操作は欄区切りの中に `NoticeBanner tone="error"` で削除の行を置く（箱の入れ子はしない）。最初の欄を包む要素に `data-me-tour="edit-form"`（ツアーの対象、[me-common.md](./me-common.md)）。

「基本情報」に残るのは `mainPlatform` / `role` の2フィールドのみ。**`mainEdition` / `inputMethod` / `inputMethodBadge` はこの画面からは削除済み**で、`/me/playstyle` に移管されている（`mainEdition` は `/me/playstyle` でメインバージョンを選ぶと自動決定され、単体でのクリア手段は無い）。移行期の誘導リンクは廃止した。詳細は上記「プレイスタイル」を参照

「表示設定」の `showPacemanOnHome` / `showTwitchOnHome` / `showYoutubeOnHome` は**自分の分を全員のホームに出すかの公開範囲**（サーバーが全員のホームから除外する）で、文言も「（全員に表示）」と明示する。`showRankedStats` / `showPacemanStats` は自分のプロフィールの活動・記録タブ（閲覧者に表示）

### /me/edit の保存方式（保存バーでの一括保存）

プロフィールの編集は **2 ページに分かれ**、それぞれ**下部の保存バー（`FloatingSaveBar`）で自分の項目だけを一括保存**する。

| ページ | 内容 | 送る項目（`app/lib/profile-edit-scope.ts`） |
|---|---|---|
| `/me/edit`「プロフィール」（訪問者が走者画面で見る中身） | MCID（Java / Bedrock）・スキン・マント・ポーズ・基本情報・Speedrun.com 連携（表示のみ）・ソーシャルリンク・動画 | `displayName` `displayNameAlphabet` `bio` `shortBio` `location` `pronouns` `allowAutoTranslation` `rtaStartedYearMonth` `mainPlatform` `role` `profilePose` `slimSkin` `capeDisplay` `speedruncomUsername`（リンクから決まる値）＋ `changes`（MCID・Bedrock・リンク・動画の差分） |
| `/me/account`「公開とアカウント」 | プロフィール設定（公開範囲・既定タブ・表示設定）・旧データ取り込み（`import_legacy`）・危険な操作（アカウント削除 `delete_account`） | `profileVisibility` `defaultProfileTab` `showPacemanOnHome` `showTwitchOnHome` `showYoutubeOnHome` `showRankedStats` `showPacemanStats` |

- **送られた項目だけを更新する**: 保存本体（`saveProfileBatch`）は、フォームに**無い**項目を触らない（`undefined` = 未送信。空欄は空文字で送られ、`null` として保存される）。`/me/account` の保存が `/me/edit` の項目（基本情報・MCID・リンク・動画・Speedrun.com 連携）を空にしたり、`updatedAt` を進めたり、外部キャッシュのキックを走らせたりしない（逆も同じ）。commit 後の副作用（非公開なら訳文行を消す・公開への切替で外部キャッシュを追いつかせる）は、送られた公開範囲、無ければ保存済みの値で判定する。テストは `app/routes/me/__tests__/account.test.ts`
- **`/me/edit` の即時保存**: アカウント削除・レガシーインポートは編集ではないので `/me/account` で即時実行する。スキン/マントのアップロード・削除も保存バーとは別に即時保存される（別 API）。アップロード欄に「アップロードと削除は、すぐに公開へ反映されます（ページ下の保存とは別です）」の 1 文を出す。完了時はページを再読込せず、返ってきた新しい URL だけをローカル state（`customSkinUrl` / `customCapeUrl`）へ反映して画面（アバター・プレビュー）を更新する（再読込・loader 再検証をすると未保存の下書きが消えるため。下書きは保たれる）。完了時はページを再読込せず、返ってきた新しい URL だけをローカル state（`customSkinUrl` / `customCapeUrl`）へ反映して画面（アバター・プレビュー）を更新する（再読込・loader 再検証をすると未保存の下書きが消えるため。下書きは保たれる）。

- **下書き（draft）**: MCID・リンク・動画はクライアントの下書き状態にだけ持つ（`app/lib/profile-edit-draft.ts` の `ProfileDraft`。純関数でテスト済み）。ダイアログの確定は下書きの更新だけで、サーバーへは送らない。各ダイアログに「保存バーで保存するまで反映されません」の案内を出し、未保存の行には「未保存」バッジ、削除予定の行は取り消し線＋「取り消す」を出す。項目単位の取り消しと、保存バーの「変更を破棄」（フォーム値＋下書き全体を保存済みへ戻す）がある
- **一時ID**: 新規のリンク・動画はクライアント生成の一時キー（`new-<uuid>`）を持つ。サーバーの ID としては使わず、サーバーが `createId()` で採番する。一時キーは `order`（動画は `new:<key>`）とエラー位置（`fieldErrors`）の参照にだけ使う。保存成功後は loader の再取得結果で下書き・保存済み両方を作り直す（実 ID に置き換わる）
- **送信**: 保存バーの保存で `_action=save_all` ＋ プロフィール列 ＋ `changes`（JSON。`ProfileChanges`。差分が無ければ省略）を **1リクエスト**で送る。`_action` 未指定（従来の保存）も同じ経路で、`changes` が無いときはプロフィール列だけを保存する。`changes` は zod で検証し、不正なら何も保存しない
- **未知の `_action` は拒否**: `_action` が送られていて `save_all` 以外（古いタブが送る `import_legacy` / `delete_account` など。これらは `/me/account` の action）なら、保存せず `meEdit.invalidOption` のエラーを返す（`/me/edit` が黙って「保存した」と返さない）。`_action` が無いときだけ従来の保存として扱う
- **リンクのプラットフォーム重複は書き込みトランザクションの中でも再検査する**: `social_links` に `(userId, platform)` の一意制約が無いため、①の事前確認だけでは並行リクエストで重複しうる。`db.transaction()` は libsql の既定（`BEGIN IMMEDIATE`）で書き込みロックを開始時に取り並行する保存を直列化するので、トランザクション内でリンクを読み直して最終状態を再検査し、重複なら何も書かず `platformLinkExists` を返す（Speedrun.com 列からのリンク逆同期もこの読み直した行を使う）。一意制約そのものは未追加（リモート DDL と承認が要る）
- **保存エラーのログ**: 保存の catch は `errorSummary(e)`（`app/lib/error-summary.ts`。SQL 文と原因だけでパラメータを出さない）で出し、入力値（表示名・自己紹介・所在地など）をログに残さない
- **サーバー処理**（`app/lib/profile-edit.server.ts` の `saveProfileBatch`）: ① 検証（形式 → 既存データを読んだ「最終状態」の検証〈所有確認・同一プラットフォーム重複・動画10件上限〉→ MCID 重複と Mojang 照合）→ ② DB 書き込みを**単一トランザクション**（MCID/slug 更新・slug 履歴・お気に入り追従・リンク〈削除→更新→作成〉・動画〈削除→更新→作成→並び〉・プロフィール列）→ ③ commit 後に外部キャッシュのキック（`scheduleSocialLinkKicks` 等。保存が失敗したら一切走らない）。①で失敗したら DB は1行も変わらない。他ユーザーの ID の更新はエラー、削除は無視する（IDOR 防止）
- **不正値の扱い**: enum 系（`profileVisibility` / `profilePose` / `capeDisplay` / `defaultProfileTab` / `mainPlatform` / `role`）と真偽の欄（`slimSkin` / `show*` / `allowAutoTranslation`）は、許可リスト（enum は `schema.ts` の `enumValues`、既定タブは `PROFILE_TAB_VALUES`）にない値をエラー（`meEdit.invalidOption`）にして何も書かない。真偽は `"true"` / `"false"` のみ（`"on"` や空文字を false 扱いにしない）。`defaultProfileTab` は保存済みの値をそのまま送り返すため、選択肢（`SELECTABLE_PROFILE_TABS`）ではなく enum 全体（廃止値 `settings` を含む）で検証する
- **件数・長さの上限**（悪用防止の水準。現実的な最大の約10倍。定数は `profile-edit-validation.ts`）: カスタムリンクの `customLabel` 100 文字・`customUrl` 2000 文字（`PROFILE_FIELD_LIMITS`。入力欄の `maxLength` も同じ）、リンク総数 `MAX_SOCIAL_LINKS`（50 件。動画上限と同じく**件数が増える保存だけ**検査し、過去データが超過していても他の保存は妨げない）。記録の `pbVideoUrl` は 2000 文字（`PROFILE_FIELD_LIMITS.recordVideoUrl`。`/me/records` の保存で検査）。超過は `meEdit.customLabelMax` / `customUrlMax` / `linkMaxCount` / `meRecords.videoUrlTooLong` を返し、何も書かない
- **リンク解除時の共有キャッシュ**: Twitch VOD / YouTube 動画のキャッシュはチャンネル単位の共有で、リンクは自己申告のため、解除・変更のたびに無条件で消すと他の走者の行まで消せる。このため `deleteTwitchVodsForLogin(login, owner)` は自分以外の走者が同じ login（大文字小文字無視）の twitch リンクを持っていれば消さず、`deleteYoutubeVideosForChannelIdentifier(identifier, owner)` は `youtube_video_cache.minefolio_mcid` が本人の MCID（MCID を変える保存では旧・新）に帰属した行だけを消す（本人の MCID が無ければ消さない）。詳細は `docs/home-live.md`
- **MCID の Mojang 照合は二段構え**: ダイアログ確定時に `GET /api/me/mcid-check?mcid=`（認証必須・DB 非変更。形式 → 重複 → Mojang の順。`fetchUuidFromMcid` のキャッシュはインスタンス内メモリのため、Vercel では確認時と保存時で別インスタンスになり、Mojang を2回照合することがある。大文字小文字違いの MCID は `uuid` が同じになるため、`users.uuid` の他ユーザー使用も `taken` として弾く）で確認し、**確認できたものだけ**下書きに載せる（UUID・アバターのプレビュー可）。保存時にもサーバーが必ず再照合する（クライアントの結果は信用しない）。保存時に失敗したら `fieldErrors.mcid`（`mcidNotFound` / `mcidTaken` / `mcidVerifyFailed`）を返し、**他の変更も含め何も保存せず**、下書きはそのまま残る（MCID カード内に赤い Alert を出して再入力・再試行できる）。Bedrock 版は自己申告で Mojang 照合なし（形式検証のみ）
- **検証エラーの表示**: `{ error, fieldErrors: { mcid?, bedrockMcid?, links?: {key: msg}, videos?: {key: msg} } }`。`error` はトースト、`fieldErrors` は該当項目の下に表示する。保存時のエラー（クライアントの事前検証〈RTA歴の片方だけ選択〉とサーバーが返した `fieldErrors` の両方）は、ページ順で最初のエラー欄（`edit-error-*` の id、RTA歴は Select）へスクロールしてフォーカスする（`prefers-reduced-motion` ではなめらかにしない。保存バーの裏は `scroll-padding` が避ける）。Select（`/me/edit` の RTA歴の年月・主なプラットフォーム・役割、`/me/account` の公開範囲・既定タブ）の `SelectValue` には今の値の表示文字を子として渡す（Radix は SSR で選択中の文字を描けず、サーバー HTML が空になるため）。表示設定のスイッチ行は `max-w-2xl` で幅を詰める
- **未保存検知・離脱ガード**: `FloatingSaveBar` が内蔵する離脱ガード（`unsavedGuard` 既定 true。内部で `useUnsavedWarning` ＋ `UnsavedChangesDialog`。この画面は自前では持たない）が `hasChanges`（保存中は止めない）を見る。`hasChanges` を「フォーム値の変更 ＋ `hasProfileChanges(savedDraft, draft)`」にした（下書きの `buildProfileChanges` が空でないかで判定。前後の空白だけの差・追加してすぐ削除した項目は変更とみなさない）。保存中〜保存後の再取得が終わるまで（`fetcher.state !== "idle"`）は保存ボタンを無効にして二重送信（新規行の重複）を防ぐ
- **アカウント削除**（`/me/account`）: 未保存の変更があるとき、確認ダイアログに「未保存の変更は破棄されます」を表示。実行ボタンのクリックで下書き・フォーム値を破棄してから送信し、削除後のリダイレクトを離脱ガードが止めないようにする
- **`/me/account` の `_action`**: `save_all` / `import_legacy` / `delete_account` のみ。送られているが未知の値は `meEdit.unknownAccountAction` のエラーを返し、保存として扱わない（`_action` が送られていない場合は従来どおり保存として扱う）
- **レガシーインポート**（`/me/account`。キー配置等が無い走者にだけ案内）: 未保存の変更がある間はボタンを無効化し「先に保存または取り消してください」を表示する（インポートはキー配置等を別テーブルへ書くだけでプロフィール列は触らないが、画面の下書きとの食い違いを避けるため）
- **個別 `_action` は削除済み**: 旧 `set_mcid` / `remove_mcid` / `set_bedrock_mcid` / `remove_bedrock_mcid` / `create_link` / `update_link` / `delete_link` / 動画系の個別 action は無く、`/me/edit` の action は `save_all`（`saveProfileBatch`）のみ、`/me/account` の action は `save_all`（同じ `saveProfileBatch`）・`import_legacy`・`delete_account` のみ
- **モバイル表示と追加ダイアログ**: MCID 行はモバイルでボタンが下に縦積みになり（`sm` 以上は横並び）、MCID は長くても折り返して全体を表示する。ソーシャルリンク追加・動画追加ダイアログにはキャンセルボタン（`DialogClose`）を置く
- **共有モジュール**: MCID 検証と slug 変更は `app/lib/mcid-change.server.ts`（`verifyMcidForUser` / `applyMcidSlugChange`。onboarding も同じものを使い、uuid の重複チェックを含む）、入力上限と検証は `app/lib/profile-edit-validation.ts`（`PROFILE_FIELD_LIMITS` / `validateProfileTextFields` / `validateLinkInput` / `linksTouchSpeedrun`）

### `users.updatedAt`（ホームの「最近の更新」の基準）

`users.updatedAt` はホームの「最近の更新」と、お気に入り走者の動きの「プロフィールを更新」の元になる。**プロフィールの内容が変わったときだけ**進め、露出を減らす操作・表示設定の変更では進めない（非公開化や非表示にした操作が、かえって「更新」として目立たないようにするため）。

- 進める: `/me/edit`（と既定タブは `/me/account`）の保存で、MCID・Bedrock MCID・表示名・表示名のアルファベット表記・自己紹介（`bio` / `shortBio`）・場所・代名詞・ポーズ・スリム・マント・既定タブ・メインプラットフォーム・ロール・RTA 歴・speedrun.com ユーザー名、ソーシャルリンク、動画（追加・削除・内容変更・並び替え）のいずれかが**既存値と違う**とき。記録（`category_records`）の追加・編集、speedrun.com 記録のピン留め切替
- 進めない: `/me/edit` / `/me/account` の保存で変化した列が `profileVisibility` / `showPacemanOnHome` / `showTwitchOnHome` / `showYoutubeOnHome` / `showRankedStats` / `showPacemanStats` / `allowAutoTranslation` だけのとき（何も変わらない保存も同様）、`/me/records` の speedrun.com 記録の非表示切替、ホームの並び順保存
- 判定は送信値ではなく既存値との差分で行う（`saveProfileBatch` の `contentChanged`）。

### 自己紹介の自動翻訳の許可

`bio` / `shortBio` の入力欄の直下に「自己紹介の自動翻訳を許可する」`Switch`（`users.allowAutoTranslation`、既定オン）と説明（外部サービス Anthropic に送る旨を含む）を置く。保存フォーム（`FloatingSaveBar` の一括保存）に `allowAutoTranslation`（`"true"` / `"false"`）を載せる。

- 機能無効時（`isTranslationEnabled()` が偽＝`ANTHROPIC_API_KEY` 未設定）はスイッチと説明を**表示しない**。loader が真偽値 `translationEnabled` だけをクライアントへ渡し、無効時はフォームに `allowAutoTranslation` を載せない（未送信なので保存済みの値が残り、キー設定後にそのまま使われる）
- 検証: `"true"` / `"false"` 以外の値は `meEdit.invalidOption` で拒否。**未送信（null）の場合は列を更新対象から外し**、既定値で上書きしない
- 保存成功後の分岐: 有効な許可状態（送信値、未送信なら既存値）が **オフ** なら `removeUserBioTranslations()` を await（機能無効でも確実に訳文行を消す）。**オン**なら毎回 `scheduleUserBioTranslation()`（`waitUntil` でレスポンス後に翻訳。基盤が原文ハッシュで `upToDate` を判定するので、bio / shortBio が変わっていない保存では API を呼ばない）

### Bedrock版 MCID（Xbox ゲーマータグ）

「MCID・スキン」カードの Java版 MCID ブロックの下で登録・変更・削除する。

- 保存: 一括保存（`save_all`）のフォーム値 `bedrockMcid`（空欄で削除）。`users.bedrockMcid` を更新するだけで、
  `recordSlugChange` などの slug 関連処理・Mojang 検証・YouTubeキャッシュ追従は**一切呼ばない**
- **Mojang 検証はしない**（Xbox ゲーマータグの所有確認 API が存在しないため）。あくまで自己申告の表示用テキスト
- **重複チェックもしない**（未検証値のため UNIQUE 制約も張っていない）
- 検証: `trim` 後 3〜24文字（ゲーマータグ最大12文字＋新形式の `#1234` サフィックスを見込んだ上限）。
  制御文字（`U+0000`〜`U+001F` / `U+007F`）を含む場合のみ拒否し、それ以外の文字種は制限しない
- **`slug`・`uuid`・スキン表示には影響しない**（プロフィールURLは変わらない）。そのため Java版 MCID 変更時のような
  URL変更警告・ページリロードは行わず、トーストのみで完結する
- 削除は `AlertDialog` の確認を挟む

### 代名詞（pronouns）の入力

基本情報カードの「代名詞」は `Combobox`（`app/components/ui/combobox.tsx`、`allowCustomValue`）で、`he/him` / `she/her` / `they/them` / `he/they` / `she/they` / `any/all` のプリセットから選ぶか、任意の文字列を自由入力できる（ロケール非依存の英語表記のため値と表示ラベルは同一・翻訳キー無し）。空欄に戻すことも可能。保存経路（`users.pronouns`、自由文字列）は変更していない。

### RTA歴（開始年月）の入力

基本情報カードで、年（2009〜現在年、降順）・月の2連 Select として入力する（各先頭に「未設定」項目）。年・月は両方選択するか両方未選択のみ有効で、片方だけ選ぶと Select 直下にインラインエラー（`meEdit.rtaStartedBothOrNone`、`aria-invalid` 付き）を出す。サーバー側の action でも `isValidRtaStartedYearMonth`（`app/lib/rta-career.ts`）で `2009-01`〜現在年月の範囲を検証し、範囲外なら保存を拒否する。

- **未来月を選択肢から除外**: 現在年を選んでいる間は、月の選択肢を現在月までに絞る（`rtaStartedMonthOptions`）。現在年に変更した結果、選択済みの月が未来になる場合はその月選択をクリアする
- **連動クリア**: 年・月どちらかで「未設定」を選ぶと、もう片方も同時にクリアする（`clearRtaStarted()`）。入力欄の右には両方をまとめてクリアする X ボタンを表示する（どちらか一方でも値があれば表示）
- **ライブプレビュー**: 年・月が両方揃うと、その場でプロフィールに表示される文言をそのままプレビューする（`rtaCareerExactLabel()` を使い端数月まで表示、例: 「RTA歴 6年2か月（2020/6〜）」）。未入力時のヒントテキスト（`meEdit.rtaStartedHint`）も「設定するとプロフィールに『RTA歴 6年（2020/6〜）』のように公開表示されます」と、保存後の見え方が事前に伝わる文言にしている
- 各 Select には個別の `aria-label`（`meEdit.rtaStartedYearAria` / `rtaStartedMonthAria`）を持たせ、スクリーンリーダーで年・月を区別できるようにしている

### アカウント削除

`/me/account` の `_action="delete_account"`（confirmText に MCID または slug の入力一致を要求）で実行する。処理本体は `app/lib/content-cleanup.server.ts` の合成ドメイン操作 `deleteUserAccount()` に集約されている:

1. **派生データの削除 + 本体の削除を単一の `db.transaction()` で原子化**（`users` 行の削除前に派生データを削除する順序はトランザクション内の手順として維持。削除後は cascade で `guides` が消え、著者のガイド一覧を後から引けなくなるため）
   - `content_translations` の翻訳キャッシュ行（`userBio` 分 + 著者だった全ガイドの `guide` 分）を `deleteTranslationsForUser()` で削除
   - 他ユーザーが自分を favorite していた孤児行を `favoriteSlug`（削除対象ユーザーの `slug` と完全一致・大文字小文字を区別）で削除（自分が押した側の `favorites` 行は `userId` の FK cascade で別途消える）。詳細は [database.md](./database.md#弱参照fk-を張らない参照)
   - `users` 行の削除（cascade で大半の関連テーブルが消える）→ better-auth の `authSessions` / `authAccounts` / `authUsers` を削除
   - トランザクション化により、途中で失敗した場合は全体がロールバックされる（「他ユーザーが押した favorites 行だけ消えた」のような復元不能な部分状態を防ぐ）
2. action 側はこの呼び出しの後に `/` へリダイレクトするだけ

Vercel Blob 実体（`guides/<userId>/` と `skins/<userId>/` と `capes/<userId>/` の3 prefix 配下 = 著者の全ガイドの本文画像・カバー・ドラフト分とカスタムスキン・カスタムマント。`customSkinUrl` / `customCapeUrl` は規約前パスの保険として個別にも `del()` する）は、トランザクション成功後に `deleteUserAccount()` が内部で `runAfterResponse()` 経由で best-effort 削除をスケジュールする（`cleanupUserBlobs()`）。失敗してもアカウント削除自体は完了しており、消し残しは `scripts/audit-orphan-blobs.ts` / `delete-orphan-blobs.ts` が後から拾える（[guides.md](./guides.md#参照されなくなった-blob-の回収)参照）。ローカル開発など `BLOB_READ_WRITE_TOKEN` 未設定時は no-op。

**残るもの**: `paceman_paces` の当該ユーザー分は `user_id` が `set null` になるだけで行自体は残る（MCID 起点の設計。同じ MCID で再登録されれば再リンクされる。[database.md](./database.md#ondelete-の使い分け)参照）。他ユーザーのガイドへコピーされた画像参照は、コピー元の Blob が削除されるため壊れる（cross-user 参照は保護対象外。ガイド個別削除時のカバー画像即時削除と同じ意味論として許容）。

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

### アバター画像の生成

顔は `app/lib/skin-face.server.ts` が純JS（`pngjs`）で合成する。WebGL / Canvas の無い OGP 生成環境（satori）でも
アプリ一覧（`MinecraftAvatar`）と同じ見た目になるようにするため。

頭部・帽子の切り出し領域は 64 基準の座標を `width / 64` 倍して求めるため、128x128 の HD スキンでも正しい位置を使う。
旧形式（64x32）スキンは Minecraft 本体の透明化処理に合わせ、右半分に alpha < 128 の画素が1つも無いときは帽子を描かない
（帽子領域が不透明な黒で塗られたスキンで顔が真っ黒になるのを防ぐ）。この判定は `app/lib/skin-texture.ts` に集約し、
クライアントの `avatar-cache.ts` の `composite()` と共有する。

1. `uuid` か `customSkinUrl` があるユーザー … `fetchSkinFaceDataUrl()` が `/api/skin?userId=` を取得し、
   頭の正面 (8,8) + 帽子レイヤー (40,8) をアルファ合成して 180x180 に拡大（失敗時は Steve にフォールバック）
2. どちらも無い（MCID未登録）ユーザー … `fetchNoMcidFaceDataUrl()` が `/skins/no-mcid-face.svg` を取得し、
   `data:image/svg+xml;base64,...` の data URL にしてそのまま返す（satori は `<img src>` の SVG data URL を
   描画でき、表示サイズは `<img width={180} height={180}>` に従うのでサーバー側でのラスタ化は不要）。
   **`/api/skin?userId=` は未登録ユーザーにも Steve を返すため、この分岐は `og-image.tsx` 側で
   `user.uuid` / `user.customSkinUrl` を見て決める**

いずれもBase64データURLに変換して `ImageResponse` に埋め込む。両方失敗した場合は `null`（アバターなしで描画）。

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
| `app/lib/player-slug-fallback.server.ts` | 404時のフォールバックリダイレクト解決（`resolvePlayerSlugFallback`。slug_history → Mojangの2段） |
| `app/lib/slug-history.server.ts` | 旧slug→現ユーザーの履歴管理（`recordSlugChange` / `claimSlug` / `resolveSlugFromHistory`） |
| `app/routes/player/profile.tsx` | プロフィール表示ページ |
| `app/routes/me/edit.tsx` | プロフィール編集ページ |
| `app/lib/profile-edit.server.ts` | `/me/edit` の一括保存本体（`saveProfileBatch`。検証・単一トランザクション・外部キャッシュのキック） |
| `app/lib/profile-edit-validation.ts` | リンク・動画・MCID の入力検証と `ProfileChanges` 型（クライアントとサーバーで共用） |
| `app/lib/profile-edit-draft.ts` | 下書き（MCID・リンク・動画）の dirty 判定・差分生成・並び替え（純関数） |
| `app/routes/api/me/mcid-check.ts` | MCID 変更ダイアログ用の事前照合 API（認証必須・DB 非変更） |
| `app/routes/me/playstyle.tsx` | プレイスタイル編集ページ (`/me/playstyle`) |
| `app/lib/playstyle.ts` | プレイスタイルの選択肢定義・型・表示条件ヘルパー・バリデーション（非 `.server`、編集/表示で共用） |
| `scripts/add-playstyles-table.ts` | `playstyles` テーブルのDB反映スクリプト（`inputMethod` バックフィル同梱） |
| `app/routes/og-image.tsx` | OGP画像生成API |
| `app/components/minecraft-avatar.tsx` | 顔アイコンコンポーネント (2D) |
| `app/components/minecraft-fullbody.tsx` | 全身コンポーネント (3D, skinview3d) |
| `app/lib/avatar-cache.ts` | 顔アバターのスキン画像・描画結果キャッシュ、URL解決（MCID未登録判定を含む） |
| `app/lib/skin-face.server.ts` | OGP向けの顔合成（純JS・`pngjs`）とプレースホルダー顔の拡大 |
| `public/skins/no-mcid-face.svg` | MCID未登録の顔プレースホルダー（手描き。生成スクリプトの対象外） |
| `scripts/generate-placeholder-skins.ts` | MCID未登録の全身プレースホルダー（`public/skins/no-mcid.png`）の生成 |
| `app/hooks/use-media-query.ts` | レスポンシブサイズ判定用フック |
| `app/routes/api/skin.ts` | スキンテクスチャプロキシAPI |
| `app/routes/api/me/skin.ts` | カスタムスキン管理API (POST/DELETE) |
| `app/routes/api/cape.ts` | Mojang マント画像の中継API (`GET /api/cape?uuid=`) |
| `app/routes/api/me/cape.ts` | カスタムマント管理API (POST/DELETE) |
| `app/routes/api/me/cape/upload-token.ts` | カスタムマントのアップロードトークン発行 |
| `app/lib/cape.ts` | マント表示の解決ヘルパー（`resolveCapeProps`・`capeDisplay` の型） |
| `app/components/cape-uploader.tsx` | カスタムマントのアップロードUI |
| `app/lib/rta-career.ts` | RTA歴（開始年月）のパース・検証・経過期間算出・表示文言の組み立て（ロケール対応） |
| `scripts/add-rta-started-column.ts` | `rta_started_year_month` 列のDB反映スクリプト |
| `scripts/add-onboarding-completed-column.ts` | `onboarding_completed` 列のDB反映スクリプト |
| `app/components/hint-tip.tsx` | 端数月の補足など、短い説明を出す共有トリガー（[`docs/keybindings.md`](./keybindings.md#関連ファイル)にも記載） |
| `app/components/sensitivity-warning.tsx` | デバイスタブの感度警告表示（[`docs/keybindings.md`](./keybindings.md#関連ファイル)にも記載） |
