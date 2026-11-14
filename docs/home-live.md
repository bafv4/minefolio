# ホーム画面・ライブ機能 仕様書

## ホーム画面 (/)

### 概要

Minefolioのトップページ。登録ユーザーのアクティビティ、ガイド、動画フィード（YouTube動画 + Twitch VOD）、PaceManペース、ライブランをまとめて表示するフィードを提供する。

### 認証・登録チェック

- `getOptionalSession()` でセッションを取得（未ログインでもアクセス可能）
- セッションがある場合、`users` テーブルから `discordId` で登録済みユーザーを検索
- ホームの SSR / `.data` 応答は閲覧者依存（ログイン状態・表示設定・並び順）なので `headers()` で `Cache-Control: private, no-store` を返す（ブラウザ・CDN の共有キャッシュに載せない）
- 登録済みの場合 `isRegistered = true` を返し、ユーザーの表示設定（`showPacemanOnHome`, `showYoutubeOnHome`, `showTwitchOnHome`）を取得

### ホームの構成（2026-11 全面改修）

**ログイン状態で先頭（ヒーロー / おかえりバー）を分け、以降は共通**。各欄は `section` + `aria-labelledby`（h2）。欄の見出しは「アイコンチップ + h2 + 件数 + すべて見る」のみで、英大文字の eyebrow・格子背景・ヒーローの統計タイルは無い（公開プロフィール数は「プロフィール」欄の見出し、ライブ人数は「ライブ」欄の見出しに移した。「記録ペース」の件数と `countHomeRecordedPaces` は廃止）。共通の欄枠は `app/components/home/home-section.tsx`。

| 順 | ゲスト | ログイン済み（登録済み） |
|---|---|---|
| 1 | ヒーロー（左: h1・説明・「プロフィールを作る」「走者を探す」、右: 「注目の走者」カード） | おかえりバー（アバター・「おかえりなさい、{name}さん」〈アカウント作成から24時間以内は「ようこそ、{name}さん」〉・「プロフィールを編集」「マイプロフィール」「お気に入り」）。h1 は `sr-only` |
| 2 | お気に入り走者の動き（ブラウザにお気に入りがある場合のみ） | お気に入り走者の動き（常に出す） |
| 3 | ライブ / ペース（横レール） | ライブ / ペース（お気に入りを先頭・ハート印） |
| 4 | 最新動画（YouTube カード3本 + Twitch「Twitchライブ」6行） | 同左 |
| 5 | 新着ガイド（4件、著者1人1件） | 同左 |
| 6 | （ヒーロー右に出すので無し） | 注目の走者（横長版） |
| 7 | プロフィール（最近の更新 / よく見られている の2列コンパクト行、各4件） | 同左 |

#### 欄の並び順の設定（ログイン済みのみ）

上表の2〜7行目（ゲストでは「注目の走者」はヒーロー内）のうち、ログイン済みの6欄（お気に入り走者の動き `favoriteActivity` / ライブ `live` / 最新動画 `videos` / 新着ガイド `guides` / 注目の走者 `featured` / プロフィール `profiles`）の並びは、おかえりバー右端の「ホーム設定」ボタン（`Settings2` アイコン・Tooltip）のモーダル（`app/components/home/home-settings-dialog.tsx`）で変更できる。おかえりバーは先頭固定で対象外。おかえりバーのレイアウト: モバイルは1段目＝アバター・挨拶・設定ボタン（右端）、2段目＝「プロフィールを編集」（ラベルあり）＋「マイプロフィール」「お気に入り」（アイコンのみ・ラベルは sr-only。いずれも44px）、sm 以上は1行（設定ボタンは右端）。ログイン時の「注目の走者」（`wide`）の見出しは他の欄と同じアイコンチップ＋h2 `text-xl font-bold`（「別の走者」は見出し行の右）、ゲストのヒーロー内は小見出し。お気に入りの動きの文はモバイルで2行まで折り返し（sm 以上は1行 truncate）。ゲストは常に既定順。

- **ID・正規化**: `app/lib/home-sections.ts`（非 `.server`）。既定順は上記の並び。`normalizeHomeSectionOrder` は JSON 文字列 / 配列を受け、解釈不能なら既定順、未知 ID と重複を除き、欠けた ID は既定順で末尾に補う（欄を増やしても既存の保存値が壊れない）。
- **保存先**: `users.home_section_order`（nullable、JSON 配列文字列）。既定順と同じ並びを保存するときは `null` にして既定へ戻す。**`users.updatedAt` は更新しない**（お気に入り走者の動きに「プロフィールを更新」と誤って出るため）。
- **loader / action**: loader が正規化済みの `sectionOrder` を返し、SSR の段階からその順で描画する（読み込み後の入れ替えなし）。保存は home ルートの action（`_action=saveHomeSectionOrder`、`order` = JSON 配列。未ログインは 401）。保存後は home の loader が再検証される（`_layout` には `shouldRevalidate` を付けない）。
- **モーダル**: 各行は上へ／下へのアイコンボタン（端は disabled、移動後もフォーカスが追従）と「初期の並びに戻す」。編集中はモーダル内の state のみ（キャンセルで破棄）。保存は共有キーの `useFetcher` で送信し、保存中は `fetcher.formData` から楽観的にホームへ反映、成功でトースト＋閉じる、失敗でエラートースト。
- 欄の表示条件（ガイド0件なら出さない等）は並び順に依らず従来どおり。

レイアウトの型は欄ごとに変える（ヒーロー＝左右分割 / ライブ＝モバイル横レール・md 以上グリッド / お気に入りの動き＝縦タイムライン / ガイド＝カバー付きグリッド / プロフィール＝コンパクト行 / 動画＝メディアグリッド + リスト行）。時刻は `m:ss`（1時間以上は `h:mm:ss`。`app/lib/home-format.ts` の `formatClock`）で、ミリ秒はペースカードのタイムラインモーダル内だけ。タップ領域はモバイルで 44px 以上。モーションはライブ進行バーの遷移（200ms）とホバーだけで、`motion-reduce` では止める。

#### サーバーサイドで取得（loader）

| データ | ソース | 条件 |
|--------|--------|------|
| 最近更新されたプロフィール | `users` テーブル | `profileVisibility = "public"`、視聴者除外、`updatedAt` 降順、最大4件 |
| よく見られているプロフィール | `page_view_stats` + `users` JOIN | `targetType = "profile"`、公開、`pageviews` 降順。「最近の更新」に出た人は除き、最大4件。右端は `home.views7d`（7日で n 閲覧） |
| 新着ガイド | `guides` + `users` JOIN | 公開済み・著者が公開プロフィール、`updatedAt` 降順。**同じ著者は1件まで**、最大4件。注目順の段は廃止（並べ替えは `/guides` 側） |
| 公開プロフィール数 | `users` COUNT | 「プロフィール」欄の見出しに表示 |
| 注目の走者（ゲストのみ） | `getHomeSpotlight`（`app/lib/home-featured.server.ts`） | 下記。10分キャッシュ（ロケール非依存） |

ガイドには自動翻訳（[`docs/translation.md`](./translation.md)）を反映する（表示する4件の id を `getGuideTranslations` に1回で渡す）。

##### 注目の走者（ヒーロー右）
- **表示設定**: video 理由はその動画のプラットフォームの設定（`forHome` で除外）、`rankedPb` / `eloGain` は `showRankedStats`。speedrun.com 理由に表示設定は無いが、**オーナーが非表示にした記録は出さない**（`users.hiddenSpeedrunRecords` の run ID、および `category_records.isVisible = false` のカテゴリの記録。`/rankings` と同じ条件）。

- **候補**: 直近7日の出来事から1人1件（最も点数の高いもの）を採用し、点数順（同点は新しい順）に最大5人。点数は `app/lib/home-featured.ts` の `scoreFeaturedReason`: speedrun.com の新規申請 90 > Ranked の PB 更新 80 > 新しい動画 60。Ranked のレート上昇は 40 + 上昇幅/5（上昇幅300で頭打ち＝最大100）。
  - speedrun.com / Ranked PB: `player_rankings` の `recordDate`（`YYYY-MM-DD`）が期間内。`verificationStatus` が `new` でも対象（`rejected` は除く）。**ranked_pb 行は現状 `recordDate` が保存されないため、この出来事は日付が入るまで発火しない**
  - speedrun.com の理由は `{ type, timeMs, categoryName, status }`。`categoryName` は `player_rankings.category_id` → `speedrun_categories.name`（未設定は null）、`status` は `verificationStatus`（`new`＝審査中 / `verified`＝承認済み。null は verified 扱い）。文言は「speedrun.com に {category} {time} を申請（審査中）」/「speedrun.com で {category} {time} が承認」（カテゴリ無しは category を省く）。**審査中のときだけ**理由行の右端に「審査中の記録を見る」リンク（`relative z-10`、縦余白でタップ約44px、理由文は truncate・リンクは shrink-0）を出し、`/player/<slug>?tab=stats&srcPending=1`（プロフィール側で審査中の記録を表示）へ飛ばす。承認済みは記録タブに既に出るためリンク無し
  - Ranked レート上昇: `ranked_elo_snapshots`（cron `update-rankings` が日次で記録）の期間内最古と最新の差が20以上。最古のスナップショットが6日以上前でない間（導入後7日分たまるまで）は対象外
  - 新しい動画: `getPublicVideoFeed`（YouTube / Twitch のキャッシュ）の公開日時が期間内
  - Ranked 系（PB・レート上昇）は `users.show_ranked_stats = false` の人を除く。いずれも公開プロフィール・視聴者除外
- **カードの内容**: 理由の1行（`home.featuredReason*`）→ スキン（`MinecraftAvatar` の2D）・名前・メインカテゴリ・PB（`m:ss`）・感度（`n% · x.x cm/180°`）→ 主要9操作（前進・後退・左・右〈WASD〉・ジャンプ・スニーク・ダッシュ・インベントリ・オフハンド）のキーチップ。キー配置が無い人はキーチップ行ごと出さない。その下に**ホットバー1〜9**（`hotbar1`〜`hotbar9`、`FeaturedRunner.hotbar`）を、番号ラベル無しの9列等幅グリッド（見出し「ホットバー（1〜9）」）（`HotbarRow`）で1行に出す。狭幅（モバイル・ゲストヒーロー右側）でも折り返さないよう、チップは `min-w-0` で `truncate`（全文は `title`）、未割り当てのスロットは薄い「-」。ホットバーの割り当てが1つも無い人は行ごと出さない。`wide` 版（ログイン時）は右列（`lg:w-[38rem]`）に主要9操作とホットバーを2段で縦に並べ、両段とも9列グリッドで列を揃える（主要操作の列数はビューポートではなくキー領域（`@container`）の幅で決める: 約35rem 以上で9列、26rem 以上で5列、未満は3列。チップは `max-w-full` + `truncate`（全文は `title`）、9列時は `text-xs`。アバターは64px。「プロフィールを見る」行は無く、名前リンクのオーバーレイでカード全体が遷移する。ラベルは通常の操作名のまま、truncate せず収まらなければ折り返す）。注目の走者の10分キャッシュキーは `home:spotlight:v6`（v6 は設定の取得元を公開用のメインプリセットへ変えたため〈次項〉、v5 は `FeaturedKey` から `isRemapped` / `gameKeyCode` を外したため、v4 は注目の走者の動画理由からホーム表示をオフにした人を除外するため。それ以前は `hotbar`・speedrun.com 理由のカテゴリ名/審査状態の追加で形状が変わったため版を上げた）。**キー・感度・リマップの取得元は、プロフィール・操作設定一覧と同じ規則**（`docs/presets.md`）: メインプリセット（`isMain`）が非アクティブ（`isActive = false`）ならそのスナップショット（`decodePresetConfig`。`null` の種別は空として扱いライブへフォールバックしない）、メインが無い／編集中ならライブテーブル（`shouldUsePresetSnapshot` が単一の決定点）。編集中のプリセットの内容を公開面に出さないため。日替わり・ランダムの母集団（キー4つ以上・感度あり・メインカテゴリあり。キャッシュキー `home:featured-pool:v2`）も同じ取得元で判定する。チップはゲーム内キーを出すために実際に押す物理キー（trigger 文脈の単一キーリマップの source）を出し。リマップの有無による強調（リング・枠色・ツールチップ）は出さず、全チップ同じ見た目（物理キーの位置のみ）。見た目は KeyBadge 系と同じクラスだが、`KeyBadge` の import が `item-icon`・`virtual-keyboard` をホームの初期表示へ引き込むため、指割り当て色・ツールチップを省いたホーム専用実装（`featured-runner-card.tsx` の `KeyChip`）。カード全体が走者プロフィールへのリンク。
- **SSR の初期表示**: 候補の1位。候補が0人なら日替わり（キー配置〈主要9操作のうち4つ以上〉・感度・メインカテゴリが揃った公開プロフィールから、UTC 日付をシードに1人。理由の行は出さない）。それも0人なら「プロフィールで見られるもの」の静的説明。
- **「別の走者」ボタン**（常に出す。`min-h-11`）: 押すと、まず SSR で渡した候補を点数順に順番に表示し、出し切った後・候補が無い日は `GET /api/home-featured?exclude=<表示中>,<直前>` で、揃った公開プロフィールからランダムに1人取得する（理由なし。母集団が尽きたら表示を据え置く。`Cache-Control: no-store`）。取得中は中身を薄くして `aria-busy`（高さは変えない）。切り替え後は `aria-live="polite"` で新しい走者の名前を読み上げる。

##### 「お気に入りの動き」（縦タイムライン）
- **表示設定**: ペースは `showPacemanOnHome`、動画はプラットフォーム別の設定で、オフにした人の分を除く。

- `POST /api/home-favorite-activity`（`app/routes/api/home-favorite-activity.ts` → `getFavoriteActivity`）。応答は `private, no-store`。ログイン済みは**サーバーのお気に入り**（`getFavoritesFromDb`、本文は無視）、未ログインは**ブラウザのお気に入りを本文 `{ slugs }` で受ける**（URL に載せない。上限100件・公開プロフィールのみ解決）。
- 種類: ペース（直近7日・保持期間内。同じランは最深区間、1人2件まで）・動画（YouTube/Twitch キャッシュ）・プロフィール更新（`users.updatedAt`）・ガイド（公開済みの `updatedAt`。公開日時の列が無いため「公開・更新」の文言）。新しい順に10件。各1クエリ（お気に入りの userId 群に対して）。
- 種類（追加分）: **rankTierUp**（Ranked のレート帯 UP。`ranked_elo_snapshots` を `getRankTier`〈division 含む。Gold III→Emerald I、Emerald I→II も対象〉で段階化し、期間前の最新スナップショット〈無ければ期間内の最初〉を基準に「それまでの最高段階を更新した日」だけを出す。境目の行き来では増やさず、複数段階上がった日は到達段階1件。文面「{name} が {tier} に昇格」）・**rankedPb**（`player_rankings` の `ranked_pb` で `recordDate` が期間内。「{name} が Ranked PB を更新：{time}」）・**srcSubmit**（speedrun.com への新規申請。`verificationStatus = "new"` で行の `createdAt`〈cron が初めて検知した時刻〉と `recordDate`〈ランの日付〉がともに期間内。連携直後に古い審査中記録が「今提出した」ように見えるのを防ぐ。rejected は出さず、オーナーが非表示にした run〈`hiddenSpeedrunRecords`〉も除く。時刻は `createdAt`）・**settings**（操作設定の変更。**メインプリセットに関わる変更のみ**: メインプリセットへの切替〈初回のメイン作成を含む。文面「プリセットを変更」〉と、メイン＝編集中プリセットの公開設定の保存だけ。`config_history` を `publicConfigChangeCondition()`〈`app/lib/config-history.ts`。`presetId IS NOT NULL` かつ `createdAt >= PUBLIC_CONFIG_HISTORY_SINCE`〉で絞り、`change_type` は種別ラベル（文面・アイコン）に使う。メインでない編集・編集対象の切替は出さない。そのうえで1人・1日〈UTC〉・`changeType` ごとに最新1件へ集約し、文面・アイコンは changeType で分ける: keybinding=キー配置 / device=デバイス設定 / game_setting=ゲーム設定〈アイテム配置・サーチクラフト・プリセットへの保存・テンプレート適用が混在〉 / remap=リマップ〈現状この種別を書く箇所は無い〉 / preset_switch=プリセット。`changeDescription` は書き込み時のロケールの文字列なので表示に使わない）。
- 精度: rankTierUp〈`snapshotDate`〉・rankedPb〈`recordDate`〉は日付までしか分からないため `FavoriteActivityItem.dateOnly = true`、`at` はその UTC 日の正午（now を超えない）。ホームの相対表示は「今日／昨日／N日前」（UTC 日単位）、一覧ページの時刻列は空欄。srcSubmit・settings は時刻つき。
- 1人あたりの上限: ホームは rankTierUp・srcSubmit・settings とも1件（一覧は3件、rankedPb は常に1件）。
- 除外: Ranked 系（rankTierUp・rankedPb）は `users.showRankedStats === false` の人を除く（プロフィールの Ranked 表示と同じ条件。MCSR Ranked 側の非公開を示すデータはアプリ内に無い）。いずれも公開プロフィールのみ・視聴者除外。各取得は独立に失敗させる（`.catch(() => [])`）。
- 遷移先: rankTierUp・rankedPb→`/player/{slug}?tab=stats`、srcSubmit→`/player/{slug}?tab=stats&srcPending=1`、settings→`?tab=keybindings`（keybinding・remap・preset_switch・game_setting〈混在する種別のため汎用の文面にし、遷移先もキー配置タブにする〉）/`devices`（device）。
- お気に入り0人（解決できる公開プロフィールが0人）: 「走者をお気に入りに追加すると、ここに動きが並びます」＋よく見られている走者3人（`ProfileFeedCard`＝お気に入りボタン付き）。動きが0件: 「直近7日の動きはありません」。
- 未ログインでお気に入りが無い（Cookie 未同意を含む）ときは欄ごと出さない。お気に入りの一覧は画面表示後にブラウザから取得するため、欄は5行のスケルトンで高さを確保してから埋める。
- **「すべて見る」の遷移先は `/favorites/activity`**（動きの一覧ページ。仕様は [favorites.md](./favorites.md#お気に入り走者の動き一覧-favoritesactivity)）。
- **ペース行の挙動**: PaceMan のペース行（`kind: "pace"`。応答に `runId` を含む）は、行全体がタイムラインモーダル（`PaceTimelineModal`、`app/components/pace-timeline-modal.tsx`。`/paces` のペースカードと共用）を開くボタン（`aria-haspopup="dialog"`）になる。走者プロフィールへはアバターが別リンク（z-10）として残る。動画・ガイド・プロフィール更新の行は従来どおり該当ページへのリンク。
- API は本文の `windowDays`（既定7・最大30）・`limit`（既定10・最大100）で期間・件数を指定でき、サーバー側（`clampFavoriteActivityOptions`）で検証・クランプする（不正値は既定）。ホーム欄は指定しない（7日・10件）。取得ロジックはフック `useFavoriteActivity`（`app/hooks/use-favorite-activity.ts`）、行の描画・文言は `FavoriteActivityRow`（`app/components/favorite-activity-row.tsx`）をホーム欄と一覧ページで共用する。

「よく見られている」は `page_view_stats` のスナップショット行を起点に `innerJoin` する（PV スナップショットが無い環境では自然に0件。UI は件数だけで列を出すか判定）。

#### クライアントサイドで遅延取得（/api/home-feed）

| データ | キャッシュキー | CDNキャッシュ (s-maxage) | stale-while-revalidate |
|--------|---------------|--------------|------|
| YouTube動画（`type=youtube-videos`） | `youtube_videos` | 30分 | 1日 |
| Twitch VOD（`type=twitch-vods`） | `twitch_vods`（`twitch_vod_cache` テーブル読み） | 15分（空は60秒） | 1日 |
| YouTubeライブ配信 | `youtube_live` | 1分 | 2分 |
| PaceManペース（`type=recent-paces`） | `recent_paces` | 5分 | 1日 |
| Twitchストリーム（`type=twitch-streams`） | `twitch_streams` | 30秒 | 60秒 |
| ライブラン（`type=live-runs`、v2 キャッシュ） | `live_runs` | 30秒 | 60秒 |
| Ranked 対戦中（`type=ranked-live`） | `home-feed:ranked-live:v2`（30秒） | 30秒 | 60秒 |

DBキャッシュ系（PaceManペース / YouTube動画）はデータ鮮度がcron更新間隔（30分 / 2時間）で決まるため、s-maxage を長めに取り、TTL切れ後も stale-while-revalidate（1日）でエッジから即時配信しつつバックグラウンド再検証する。

`youtube-videos` / `twitch-vods` は `perRunner=1`（ホームが付ける）で**同じ走者（slug）の動画・VODを新しい順の先頭1件に絞って**から10件に切る（`/videos` 等の既存の呼び出しは従来どおり）。

##### ライブ欄（横レール `app/components/home/live-rail.tsx`）
- **表示設定**: PaceMan ライブラン・最近のペースは `showPacemanOnHome`、Twitch 配信中は `showTwitchOnHome` で除外（Ranked 対戦中は `showRankedStats` のみ）。

- 見出し「ライブ」＋件数（赤い点1つ。`aria-live="polite"` の件数テキストは人数が変わったときだけ文字列が変わる）。`/api/home-feed?type=live-runs`・`ranked-live`・`twitch-streams` を初回取得＋**15秒間隔で自動更新**（タブ非表示中は停止、復帰時に即更新。ranked-live / twitch-streams の失敗は直前の値を保ち、欄全体のエラーにはしない）。更新ボタンは廃止。
- md 未満（モバイル・小型タブレット）は横レール（scroll-snap。モバイル約1.2枚・sm 約2.5枚見え）、**md 以上は折り返すグリッド**（md=2 / lg=3 / xl=4 列。カードは行内で同じ高さ）。md 以上は最初の2行分（md=4 / lg=6 / xl=8 件）だけ出し、超える分があれば「さらに表示（残り N 人）」で全件展開・「折りたたむ」で戻す（`aria-expanded`）。件数の切り替えは CSS（超過項目に `md:hidden` / `md:max-xl:hidden` / `md:max-lg:hidden`）で行い JS の画面幅判定は使わない（SSR とずれない）。モバイルはレールで全件見られるためボタンを出さない。お気に入りの走者は先頭＋ハート印（各グループ内の並びは PaceMan → Ranked → Twitch）。カードは3種類:
  - **PaceMan のライブラン**（ネザー入り以降のみ。PaceMan liveruns の範囲）: アバター・名前（その下は `@mcid`）、データ元の1行（`PaceManSourceLine`。「PaceMan」＋カテゴリ「RSG Any%」〈PaceMan が追跡するのは RSG Any% のみ。英語固有名のため翻訳しない〉＋バージョン。Ranked カードの「Ranked 対戦中」ラベルと同じ段）、7点の区間進行バー（Nether → Bastion → Fortress → Blind → Stronghold → End → Finish。到達済みは塗り・現在区間を強調。`app/lib/home-live.ts` の `splitStage`）、最新区間の IGT（大きめ等幅・`aria-label` は「m分s秒」）、**ベスト比**。PaceMan に区間別 PB が無いため、ベスト比は「蓄積ペース（`paceman_paces`、直近2か月）内の同じ区間の最小 IGT との差」（進行中のランを比較対象にしないよう直近3時間の行は除外。`live-runs` 応答の `splitBests`）。ベストが無い走者は出さない。**ネザー入り（Enter Nether）・バスティオン入場（Bastion）の段階ではベスト比を出さない**（この段階の差はシードの運に大きく左右され、比較の意味が薄いため。`splitStage` が 3 以上のときだけ表示）。`splitStage` の対応表は PaceMan の正準タイムライン名（`pacemanPaces.timeline`）→ 段階のみ持ち、スプリットID（`rsg.*`）は `getSplitTimeline` で変換して引く。`Obtain Blaze Rods`（Fortress 内の区間）は Fortress と同じ段階（3）。
  - **Ranked 対戦中**: MCSR Ranked の `GET https://mcsrranked.com/api/live`（`app/lib/ranked-live.server.ts`。応答は `data.liveMatches[].{currentTime(ms), players[], data[uuid].{liveUrl, timeline:{time(ms), type}|null}}`）のうち、Minefolio 登録者（`users.uuid` をハイフン無し・小文字に正規化して照合。公開プロフィール・視聴者除外・`show_ranked_stats` が false でない）が出ている試合を1試合1カードに。相手・両者のレート・経過時間を出す。サーバー側 30秒キャッシュ（レート制限 500回/10分に十分収まる）。
    - **試合の進捗**: 両選手の `timeline`（最新1イベントのみ。途中経過・過去の区間の到達時刻は API に無い）を `RankedLiveMatch.progress`（登録走者）/ `opponent.progress`（相手）に載せる（`{stage, split, timeMs}`。timeline 無し・未知の type は null）。対応は `app/lib/home-live.ts` の `rankedStage` / `rankedSplitName`: `story.enter_the_nether`→1 Enter Nether / `nether.find_bastion`→2 Bastion / `nether.find_fortress`→3 Fortress / `projectelo.timeline.blind_travel`→4 First Portal（Blind） / `story.follow_ender_eye`→5 Enter Stronghold / `story.enter_the_end`→6 Enter End（Finish=7 は Ranked の timeline に無く、バーは End までで止まる）。
    - **表示**: 状態帯は上に小さな「Ranked 対戦中」ラベル（Swords＋`text-[11px]`）、下に登録走者の `StageBar`。時間ブロックのラベルは progress があれば区間マーク＋到達時刻（例: Fortress 5:12）、無ければ「経過時間」。大きな数字は常に試合の経過時間。右側は2行（右寄せ・下揃え）: 1行目「レート vs 相手 (レート)」（truncate）、2行目「相手: 区間マーク＋区間名」（相手が timeline 無しなら2行目なし）。時間ブロックは左（ラベル＋数字）が `shrink-0`・ラベル `whitespace-nowrap`、右が `min-w-0` で、全カード種別で左右が重ならない。
  - **Twitch 配信中**（`TwitchLiveCard`）: `twitch-streams` で配信中と確認できた Minefolio 登録者。アバター・名前、配信タイトル（2行 clamp）、配信時間（`started_at` から）、視聴者数、「Twitch で見る」。**優先順位は PaceMan > Ranked > Twitch**: PaceMan のライブラン・Ranked 対戦中として既に出ている人は Twitch カードを出さない（slug、および PaceMan の `liveAccount`・Ranked の `liveUrl` の Twitch ログイン名〔小文字〕で照合。`pickTwitchOnlyStreams` / `twitchLoginFromUrl`、`app/lib/home-live.ts`）。**対象は Minecraft カテゴリ（`game_id === "27471"` または `game_name === "Minecraft"`）のみ**: スピードランのサイトのライブ欄に他ゲームの配信が並ぶのを避けるため（登録者が雑談・他ゲームで配信中でも出さない。「Twitchライブ」欄の `TwitchRecentList` はカテゴリで絞らない）。サムネイルは使わない（カード寸法を他2種に揃え、プライバシーポリシーに記載のない Twitch CDN 画像のブラウザ直接取得を増やさないため）。自分の `showTwitchOnHome = false` は自分の Twitch カードを隠す。
  - 件数（見出し・`aria-live`）は3種類の合計。3種類がすべて0件のときだけ下記「0件のとき」に切り替わる。
  - 自分の `showPacemanOnHome = false` はライブ（PaceMan）・最近のペースで自分を隠す（Ranked 対戦中は PaceMan 設定の対象外。`getHiddenPaceMcid` / `filterOwnPaces`、`app/lib/pace-visibility.ts`）。
- **配信リンク**: PaceMan の `user.liveAccount` と Ranked の `liveUrl`（`sanitizeTwitchUrl` で Twitch のみ通す）があれば「Twitch で見る」。赤い「配信中」の印（`StreamingBadge`）は、Minefolio に Twitch を登録していて `twitch-streams`（Helix の Get Streams）で配信中と確認できた人だけ（slug で照合）。**「ホーム画面にTwitch配信を表示」（`showTwitchOnHome = false`）の人は、サーバー側で PaceMan の `liveAccount`（`live-runs`、キャッシュキー v3）と Ranked の `liveUrl`（`ranked-live`、v2）を null にする**ため、「Twitch で見る」リンクが出ず、Twitch カード・`twitch-streams` にも出ない（優先順位の重複除外 `pickTwitchOnlyStreams` は、その人の Twitch カードが元から無いので影響しない）。**YouTube の配信中表示は無い**（`youtube_live_cache` はレート制限のため不使用）。
  - **カードの段構成（全種別共通）**: ヘッダー（`CardHead`）→ 状態帯（`StateBand`、`h-10` 固定。PaceMan/最近のペース＝「PaceMan RSG Any%」の1行＋進行バー、Ranked＝小さな「対戦中」ラベル＋登録走者の進行バー、Twitch＝タイトル2行 clamp）→ 時間ブロック（`TimeBlock`、ラベル行 `h-5`〈`text-xs`、区間マークのアイコン 16px〉＋隙間 `gap-1`＋時刻 `leading-8`。右側の補足〈ベスト比・レート・視聴者数・相対時刻〉は下端揃え）→ リンク行（`LinkRow`、`mt-auto`＋`min-h-11 sm:min-h-8`。ライブ欄の3種別はリンクが無いカードも同じ高さの空行を確保。0件時の「最近のペース」カードはライブカードと同じグリッドに並ばず、リンクも無いので置かない）。種別・状態によらず経過時間とリンクの縦位置が一致する。
- **0件のとき**: 「いまライブ中の走者はいません」1行＋「最近のペース」3件（同じ走者は2件まで・同じカードの静止版、すべて見るは `/paces`）に差し替える。独立した「過去のペース」欄・`LivePaceList` は廃止。ライブ・最近のペースの各エラーは欄内に1行の再試行を出す。
- **区間進行バー**（`StageBar`、`app/components/pace-stage-bar.tsx`）: ライブ欄カード・最近のペースカード・`/paces` の `PaceFeedCard`（ヘッダー直下、IGT・区間バッジの上）で共有。`PaceFeedCard` は過去のペースなので、そのランの最深区間（`splitStage(run.timeline)`）を現在区間として強調する。バーは `aria-hidden`（区間名はバッジのテキストで出る）。
- **過去のペースカードのタイムラインモーダル**: `PaceFeedCard`（`app/components/pace-feed-card.tsx`、`/paces` 一覧で使用）のカードをクリックすると、そのランの全スプリット（Enter Netherを含む進行順）を表示するモーダルが開く。データは `/api/home-feed?type=pace-timeline&mcid=...&runId=...`（`getRunTimeline()`）で、モーダルを開くたびに遅延取得する。時刻は `formatClock`（`app/lib/home-format.ts`。1時間以上は h:mm:ss）で他の欄と揃える。HTTP エラー（`!res.ok`）は「区間データがありません」ではなくエラー表示にする。**応答は公開プロフィール（視聴者除外）として登録されている mcid（`getUserData().registeredMcids`、小文字比較）に限る**。非公開・視聴者・未登録の mcid は、存在しない場合と同じ `{ timeline: [] }` を返し、登録の有無を応答から判別できないようにする。PaceMan.gg への外部リンクはモーダル下部。

### /api/home-feed

遅延読み込み対応のAPIエンドポイント。クエリパラメータ `type` で取得するデータ種別を指定する。

- **レスポンスはユーザー非依存**: セッション・お気に入りを一切参照しない（お気に入りを先頭に出す並べ替えはクライアント側 `useFavorites()` で適用）。これによりレスポンスがユーザー間で完全に共有可能になり、CDNキャッシュが正しく機能する
- **UserDataCache**: 登録ユーザーのMCID・UUID・表示名・カスタムスキンURLをインメモリキャッシュ（TTL: 1分）。`app/lib/home-user-data.server.ts` の `getUserData()` に共通化されており、`/api/home-feed` と `app/lib/paces-feed.server.ts`（`/paces`・`/api/paces`）が同一キャッシュを参照する（毎リクエストの全ユーザースキャンを回避）。ホームの SSR loader（`home.tsx`）はこのマップを返さない
- **応答に載せるマップは表示アイテム分のみ**: キャッシュは全公開ユーザー分だが、`/api/home-feed` の応答（ライブラン・ペース）には `pickUserDataForMcids` で表示アイテムの mcid 分だけに絞ったマップ（`mcidToUuid` / `mcidToSlug` / `mcidToDisplayName` / `mcidToDisplayNameAlphabet` / `mcidToSkinUrl`）を載せる
- **TwitchLinkCache**: Twitchソーシャルリンク一覧をキャッシュ（TTL: 5分。キー `home-feed:twitch-links:v2`）。配信中応答（`home-feed:twitch:all:v2`）の各要素（`HomeTwitchStream`、`app/lib/home-live.ts`）は `displayNameAlphabet` を含み、表示側が `pickDisplayName` でロケールに応じた名前に解決する（他の欄と揃える）
- **HomeHiddenUsers**: ホームの表示設定をオフにした人の一覧（`getHomeHiddenUsers`）を60秒キャッシュ（キー `home:hidden-users:v1`。純関数 `isHiddenOnHome(user, kind)` が「`false` のときだけ隠す」判定の単一定義）
- **Ranked ライブの登録者一覧**: `getRegisteredByUuid`（公開・視聴者除外・Ranked 統計を表示する人）を60秒キャッシュ（キー `home:ranked-registered:v1`）
- **CDNキャッシュヘッダー**: `Cache-Control: public, s-maxage=N, stale-while-revalidate=M` を設定（上記の表を参照）

### 動画フィード（YouTube + Twitch VOD）
- **表示設定**: ホームの呼び出し（`perRunner=1`）は `showYoutubeOnHome` / `showTwitchOnHome` をオフにした人の動画を除く。`/videos` は対象外。

- YouTube動画（`type=youtube-videos`、`youtube_video_cache`）と Twitch 配信アーカイブ
  （`type=twitch-vods`、`twitch_vod_cache`）を並列取得し、クライアント側で
  統一形式 `FeedVideo`（`app/components/feed-video-card.tsx`）にマージして新しい順に表示する
- **どちらも cron 蓄積の専用テーブル読み**（YouTube: `youtube-update` 2時間毎 / Twitch: `twitch-update` 30分毎）。
  保持期間は**90日**（`app/lib/feed-video.ts` の `VIDEO_FEED_RETENTION_DAYS`。cron がそれ以前の行を削除）
  - **Twitch VOD取得**（`getRecentVods()`、`app/lib/twitch.ts`）: 連携済み全チャンネルが対象（旧: 先頭10件のみ）。
    チャンネルごとに `/videos?type=archive` を保持期間（90日）に達するまでページング取得する
    （1ページ100件、安全上限500件/チャンネル＝最大5ページ。同時5チャンネルまで並列。Helixレート制限
    800pt/分への配慮）。`viewable === "private"` のVODを除外してキャッシュする（フィールド欠落は
    public 扱い＝欠落時に差分削除で全消ししないための安全側）。API呼び出しに成功し全件取得しきれた
    チャンネル（0件応答も含む）は取得結果との差分でキャッシュ行を削除し、VOD削除・非公開化・
    チャンネル全体の非公開化を反映する。login解決不可・API呼び出し失敗など判定不能なチャンネルと、
    安全上限（500件）で打ち切られ未取得分が残りうるチャンネル（`incompleteLogins`）は削除しない
    （フェイルオープン）。`verify` cron（8時間毎、VOD IDの存在確認）はこの差分削除の取りこぼしに対する
    安全網として引き続き稼働する
  - **YouTube動画取得**（`resolveUploadsPlaylists()` + `fetchUploadsPlaylistItems()`、`app/lib/youtube.ts`）:
    Search API（1回100ユニット）ではなく、アップロード再生リスト方式（`channels.list` でチャンネルの
    uploadsプレイリストIDを解決 + `playlistItems.list` で最新10件取得。いずれも1ユニット/リクエスト）で
    クォータを節約する。連携済み全チャンネルを毎回処理し、`privacyStatus === "public"` の動画のみ
    キャッシュする。非公開化・削除の検知は従来どおり `verify` cron（12時間毎、動画IDの存在確認）が担う
- **ホームの動画欄は YouTube と Twitch を分ける**（個人設定 `showYoutubeOnHome` / `showTwitchOnHome` は従来どおりクライアント側で効く）。「すべて見る」は `/videos`（`/videos` は従来どおり `FeedVideoCard` の混在一覧）
  - **YouTube**（`app/components/home/home-video-card.tsx`）: 3本・同じ走者は1本まで。デスクトップ3列、モバイルは横レール。カード全体がその場で再生（`youtube-nocookie.com` の埋め込み）、外部リンクは右上の 44px アイコンボタン（Tab 停止点は再生・外部リンク・走者リンク）
  - **Twitch「Twitchライブ」**（`app/components/home/twitch-recent-list.tsx`）: 1人1行（その人の最新アーカイブ）で6行、サムネイル・埋め込みは使わない。配信中の人（`twitch-streams`）を先頭に「配信中」の印付きで出し、その人の VOD 行は重複させない。行は左にアバターと名前、その右にタイトル → ゲーム名（`twitch_vod_cache.game_name`。null なら省く。配信中は Helix の `game_name`）→ 時間（相対時刻＋アーカイブの長さ `h:mm:ss`。配信中は経過時間）。行全体が Twitch への外部リンク（新しいタブ・アイコン付き・高さ 44px 以上）。`game_name` は cron が取り込み時点のチャンネルのカテゴリを保存する（取り込みが配信終了から遅れると次の配信のカテゴリになることがある）
- 各取得は独立にスケルトン→失敗時は1行の再試行（YouTube・Twitch の片方だけ失敗なら失敗した側だけ再取得）。マージ後0件なら空状態
- 旧 `FeedVideoCard` は `/videos` が引き続き使う（埋め込みURL生成 `getEmbedUrl` / `getFeedVideoUrl` はホームのカードも共用）。カード内の旧「サムネイルクリックで再生」「タイトルから視聴ページ」の挙動は `/videos` のまま

### 設定変更時の自動リフレッシュ（cronを待たない反映）

プロフィール編集の保存時、cronの次回実行（YouTube最大2時間・Twitch最大30分）を待たずに**対象ユーザー分だけ**
即時反映するトリガーが `app/lib/targeted-refresh.server.ts` に集約されている。action がレスポンスを返した
「後」に `runAfterResponse()`（内部は `@vercel/functions` の `waitUntil()`）でバックグラウンド実行するため、
保存の応答速度には影響しない。各関数は内部でエラーを握り、失敗しても action を失敗・ブロックさせない
（fire-and-forget）。呼び出し元は `app/routes/me/edit.tsx`。

| トリガー | 実行内容 |
|---|---|
| Twitch/YouTubeリンクの追加・変更 | 新チャンネルのVOD/動画を即時取得（`refreshTwitchVodsForLogin` / `refreshYoutubeForChannel`） |
| Twitch/YouTubeリンクの変更・削除 | 旧チャンネルのキャッシュ行を削除（`deleteTwitchVodsForLogin` / `deleteYoutubeVideosForChannelIdentifier`） |
| Speedrun.comユーザー名の変更（ソーシャルリンク欄・基本情報フォームのどちらの経路でも） | Speedrun.com/MCSR Rankedランキングを即時更新（`refreshSrcRankingsForUser`） |
| MCID変更 | `youtube_video_cache.minefolio_mcid` の紐付けを新MCIDへ更新（`updateYoutubeCacheMcid`。旧MCIDのまま残ると一覧から消えるため）＋YouTube連携があれば新MCIDで即時再取得 |
| プロフィールを非公開→公開へ再公開 | 非公開中は cron の走査対象外（`getPublicTwitchLinks` / `getRegisteredYouTubeChannels` は公開プロフィールのみを走査）だったため取りこぼしていたTwitch/YouTubeキャッシュを追いつかせる |

cron（YouTube 2時間毎・Twitch 30分毎）は全体の定期同期として引き続き稼働し、この即時リフレッシュを
置き換えるものではない（未ログイン操作や外部サービス側での削除・非公開化は cron 側の `verify` が拾う）。

### 表示制御フラグ

ユーザーごとに以下のフラグで表示/非表示を制御する（`users` テーブル）。**オフにした人の該当コンテンツは、誰のホームにも出さない**（本人の画面だけでなく全員のホームから除外）。

| フラグ | デフォルト | 除外されるもの（ホームのみ） |
|--------|-----------|------|
| `showPacemanOnHome` | `true` | ライブ欄の PaceMan ライブラン（`type=live-runs`）・最近のペース（`type=recent-paces`）・お気に入りの動きのペース。ライブカードの「同区間ベスト」はライブランから派生するので同時に消える |
| `showTwitchOnHome` | `true` | ライブ欄の Twitch 配信中カードと「Twitchライブ」の配信中行（`type=twitch-streams`）、最新動画の Twitch「Twitchライブ」（`type=twitch-vods&perRunner=1`）、注目の走者・お気に入りの動きの Twitch 動画 |
| `showYoutubeOnHome` | `true` | 最新動画の YouTube カード（`type=youtube-videos&perRunner=1`）、注目の走者・お気に入りの動きの YouTube 動画 |

- **適用範囲はホームのみ**。`/videos`・`/paces`・プロフィール等では従来どおり表示する（設定文言が「ホーム画面に」であるため）。`getPublicVideoFeed(db, filters, { forHome: true })` のオプションでホーム用の呼び出しだけが除外を行い、`/videos` と共用のフィード本体（`videos:feed:all`）は変えない。`type=youtube-videos` / `twitch-vods` は `perRunner=1`（ホームが付ける）のときだけ除外する
- 除外は**サーバー側**（`app/lib/home-visibility.server.ts` の `getHomeHiddenUsers`＝フラグが明示的に `false` の人の mcid / slug 一覧）で行う。PaceMan のライブランは mcid（大文字小文字無視）で照合する。応答は閲覧者非依存のままなので CDN 共有キャッシュと矛盾しない。**設定を変えてから他人の画面に反映されるまでの最悪値**は、CDN の `s-maxage` ＋ `stale-while-revalidate` と、サーバー側キャッシュの合算（古い応答がエッジに残る間は、サーバー側を更新しても反映されない）:

  | 対象 | CDN（s-maxage + SWR） | サーバーキャッシュ |
  |---|---|---|
  | YouTube 動画（`youtube-videos`） | 30分 + 1日 | 動画フィード 60秒、非表示一覧 60秒 |
  | Twitch VOD（`twitch-vods`） | 15分 + 1日 | 同上 |
  | ペース（`recent-paces`） | 5分 + 1日 | ユーザーデータ 60秒、非表示一覧 60秒 |
  | ライブラン・配信中 | 30秒 + 60秒（既定は s-maxage の2倍） | ライブラン 30秒、配信中 1分、Twitch リンク 5分、ユーザーデータ 60秒、非表示一覧 60秒 |
  | 注目の走者 | なし（SSR は `private, no-store`） | 10分（母集団 10分） |
  | Ranked 対戦中 | 30秒 + 60秒 | 登録者一覧 60秒 |

  つまりペース・動画は最悪で「s-maxage ＋ 1日」ほど古い応答が残りうる（SWR 中は古い応答を返しつつ再検証するため、低トラフィック時ほど長く残る）。即時性が要る自分の画面だけは下記のクライアント側除外で補う
- **Ranked 対戦中**（`type=ranked-live`）は PaceMan 設定の対象外。`showRankedStats=false` の人だけを除外する（既存）。注目の走者の `rankedPb` / `eloGain` 理由も `showRankedStats`。speedrun.com 理由に表示設定は無い（非表示にした記録は除く）
- 本人の画面だけは、設定変更の直後にキャッシュ TTL を待たず消えるよう、`home.tsx` で自分の分を従来どおりクライアント側でも除外する（冗長だが即時反映のため残している）

### カスタムスキン対応

- `mcidToSkinUrl` マップ: MCIDからカスタムスキンURLへのマッピング（`/api/home-feed` の応答に表示アイテム分のみ含まれる）
- カスタムスキンが設定されているユーザーは、Mojang APIの代わりにカスタムスキンURLを使用
- `customSkinUrl` は Vercel Blob に保存

### フィード状態管理

クライアントサイドでは `useReducer` によるFeed状態管理を行う:

```
interface FeedState {
  recentVideos: FeedVideo[];
  twitchVods: FeedVideo[];
  twitchStreams: HomeTwitchStream[];
  recentPaces: CachedPace[];
  liveRuns: PaceManLiveRun[];
  rankedMatches: RankedLiveMatch[];
  splitBests: Record<string, Record<string, number>>;
  mcidToUuid: Record<string, string>;
  mcidToSlug: Record<string, string>;
  mcidToDisplayName: Record<string, string>;
  mcidToDisplayNameAlphabet: Record<string, string>;
  mcidToSkinUrl: Record<string, string>;
  loading: { videos; twitchVods; paces; liveRuns: boolean };
  errors: { videos; twitchVods; paces; liveRuns: boolean };
  liveRunsCheckedAt: number | null;
}
```

mcid マップは SSR では持たず、`SET_PACES` / `SET_LIVE_RUNS` で受けた `/api/home-feed` 応答のマップを `mergeMcidMaps` で既存 state に**蓄積マージ**する（ライブとペースで別々の mcid が返るため、後勝ち置換ではなく和集合にする。応答にキーが無い場合はそのまま保持）。

### メタタグ

- `og:type`: `website`
- `og:title`: `t("home.title")`
- `og:image`: `/icon.png`
- `twitter:card`: `summary`

---

## ペース一覧画面 (/paces)

### 概要

ホームの「最近のペース」フィードの全件表示版。DBキャッシュ（`pacemanPaces` テーブル、**過去2か月分**を保持）にあるペースを検索・無限スクロールで閲覧できる。

### データ取得

共通ロジックは `app/lib/paces-feed.server.ts` に集約（loaderと `/api/paces` で共用）。レスポンスをCDNキャッシュ可能にするため、セッション非依存の一覧取得と、ログインユーザー固有の表示設定取得を2関数に分離している:

- **`getPublicPaceFeed(filters)`**（セッション非依存。戻り値は `{ items, userData }`）
  - 登録ユーザー（MCID・UUIDあり、視聴者ロール除外）の情報は `getUserData()` の共通キャッシュから取得。SSR 1ページ目・`/api/paces` はいずれも `withPaceProfiles` で応答ページ分の `items[].profile`（`uuid` / `displayName` / `displayNameAlphabet` / `skinUrl`）を付与し、全ユーザー分のマップは応答に載せない
  - `getPaceFeedEntries(registeredMcids, query)`（`app/lib/paceman-cache.ts`）で取得
    - Enter Nether を除外、保持期間（2か月）外をガード
    - 同一 `pacemanRunId` は最も進んだ Split（rta最大）のみ採用（区間指定時はその区間の行）
    - 日時降順ソート（同秒タイは `pacemanRunId` 降順でタイブレーク — offsetページングの安定性のため）。ホームフィードはこの共通関数に `{ limit: 12 }` を渡して利用する
  - フィード全体は区間キー毎にインメモリキャッシュ（キー `paces:feed:v3:*`、TTL 60秒。保持するのは `items` 配列のみ）し、無限スクロールのページ毎にテーブル全体を走査しない。プレイヤー・時期・タイムはキャッシュ済みリストへのJSフィルタで適用
  - 「自分のペースを隠す」設定（`showPacemanOnHome`）はここでは適用しない（レスポンスをユーザー間で共有可能にするため）
  - プロフィールを非公開化しても、フィードキャッシュ・`getUserData` キャッシュ（各TTL 60秒）の都合で反映は最大約120秒遅れうる
- **`getViewerPacePrefs(db, auth, request)`**（セッション依存）: `getOptionalSession()` でセッションを取得し、ログインユーザーの `mcid` / `showPacemanOnHome` を返す（未ログイン・未登録ユーザーはフィルタなし扱い）
- 「自分のペースを隠す」フィルタは `getViewerPacePrefs` の結果を使い、`/paces` ページのクライアント側（`paces.tsx`）でMCID一致除外として適用する（ホームの `/api/home-feed` と同じパターン）

### 検索

URLクエリパラメータで指定（`parsePaceSearchParams()` で解析、共有可能なURL）:

| パラメータ | 条件 | 備考 |
|-----------|------|------|
| `q` | プレイヤー | MCID・表示名の部分一致（大文字小文字無視） |
| `split` | 区間 | `PACE_FEED_SPLITS`（`app/lib/pace-splits.ts`）のいずれか。指定時はその区間のIGTで表示・絞り込み |
| `from` / `to` | 時期 | `YYYY-MM-DD`（JSTとして解釈、`to` はその日の終わりまで） |
| `maxTime` | タイム上限 | `m:ss` 形式。表示される区間のIGTに対して適用 |
| `sort` | 並び順 | `time`＝表示タイム（IGT）の昇順（同タイムは新しい順）。未指定・不正値は新しい順。`split` と併用すると区間別最速になる。キャッシュ済みベースのコピーに対して `getPublicPaceFeed` 内でソートする |

検索 UI の挙動（`app/routes/paces.tsx`）:

- 検索条件パネルはモバイルで畳める。畳んだ間も、URL に適用済みの条件を丸ピル（`rounded-full` のチップ）で表示する（入力中の下書きは含めない）
- 並び順はセレクト変更で即時に URL へ反映する（/browse と同じ）。他欄の未送信の入力は保持し、URL 上の適用済み条件に `sort` だけを足す。`sort` 以外のパラメータが変わったときだけ入力欄を URL に同期し直す
- タイム上限は `m:ss`（`^\d{1,3}:[0-5]?\d$`、サーバーの `parseTimeParamToMs` と同じ）をクライアントで検証し、不正なら送信せず入力欄の下にエラーを表示する（`aria-invalid` / `aria-describedby` でエラー文・ヒント文を関連付け）

区間名（セレクトの選択肢・カード・バッジ）は日本語ロケールでも **PaceMan の英語正規名**（Bastion / Fortress / Enter Stronghold 等）のまま表示する（ユーザー判断。`app/lib/paceman.ts` の `getSplitTimeline` / `PaceManSplitMark` が語彙の基準）。

### 遅延ロード・無限スクロール

- loader（SSR）は先頭60件と総件数のみ返す
- 追加ロードは /videos と共通の `use-infinite-scroll` フック（`/api/paces?page=N` + 検索条件、
  レスポンスは `{ items, page, hasMore }` 規約）。検索条件の変更はフックの `resetDeps` でリセット

### /api/paces

ページング+検索用APIエンドポイント。`{ items, page, total, hasMore }` を返す（`page` は1始まり、1ページ60件）。レスポンスは `getPublicPaceFeed()` ＋ `withPaceProfiles`（`items[].profile` 付与）のみを使いセッション非依存（「自分のペースを隠す」フィルタは適用しない）のため、`Cache-Control: public, s-maxage=30, stale-while-revalidate=300` を付与しCDNキャッシュ可能にしている。

---

## 動画一覧画面 (/videos)

### 概要

ホームの動画フィードの全件表示版。`youtube_video_cache`（YouTube動画）と `twitch_vod_cache`（Twitch VOD）に
蓄積された**直近90日**の動画を、検索・無限スクロールで閲覧できる。カードはホームと同じ `FeedVideoCard`
（埋め込み再生 + 外部リンク）。/paces と同じ構成。

### データ取得

共通ロジックは `app/lib/videos-feed.server.ts` に集約（loaderと `/api/videos` で共用）:

- **`getPublicVideoFeed(db, filters)`**（セッション非依存）
  - 両テーブルの保持期間内・`isAvailable=true` の行を取得し、統一形式 `FeedVideo` にマージして新しい順にソート
  - 可視性: 公開プロフィール（viewer除外）に紐付く動画・VODのみ（/paces と同じ「公開のみ」ルール）。
    YouTube は `minefolioMcid`、Twitch は `userLogin` → `social_links.identifier` で読み時に紐付ける
  - フィード全体はインメモリキャッシュ（キー `videos:feed:all`、TTL 60秒）。フィルタはJSで適用
- **`getViewerVideoPrefs(db, auth, request)`**（セッション依存）: `mcid` / `showYoutubeOnHome` / `showTwitchOnHome` を返す。
  「自分の動画を隠す」フィルタはクライアント側でプラットフォーム別に適用

### 検索

| パラメータ | 条件 | 備考 |
|-----------|------|------|
| `q` | プレイヤー | MCID・表示名・slug・チャンネル名の部分一致（大文字小文字無視） |
| `platform` | プラットフォーム | `youtube` / `twitch` |
| `from` / `to` | 時期 | `YYYY-MM-DD`（JSTとして解釈、`to` はその日の終わりまで） |

### 遅延ロード・無限スクロール

- loader（SSR）は先頭24件と総件数のみ返す
- 追加ロードは `/browse` と共通の `use-infinite-scroll` フック（`/api/videos?page=N` + 検索条件、
  レスポンスは `{ items, page, hasMore }` 規約）。検索条件の変更はフックの `resetDeps` でリセット

---

## 旧ライブ画面 (/live) — 廃止済み

- v1.9.0 で `/live` ルートは廃止。**ライブペースはホームのペースフィード内へ移設**した（上記「ホームフィードの構成」参照）
- 旧URLへのアクセスは `app/routes/live-redirect.ts` がホーム（`/`）へリダイレクトする（ブックマーク・外部リンク対策）
- 旧画面にあった配信中セクション（Twitch / YouTube Live）の表示面は廃止。`/api/home-feed` の `twitch-streams` / `youtube-live` エンドポイント自体は公開APIとして残存
- `StreamCard` / `YouTubeLiveCard` コンポーネントは未使用となったため削除済み（必要になればgit履歴から復元可能）

---

## キャッシュテーブル

### youtubeVideoCache

YouTube動画のキャッシュ。

| カラム | 型 | 説明 |
|--------|-----|------|
| `videoId` | text (UNIQUE) | YouTube動画ID |
| `channelId` | text | チャンネルID |
| `minefolioMcid` | text | Minefolioユーザーとの紐付け |
| `title` | text | 動画タイトル |
| `description` | text | 動画説明 |
| `thumbnailUrl` | text | サムネイルURL |
| `channelTitle` | text | チャンネル名 |
| `publishedAt` | timestamp | 公開日時 |
| `lastVerifiedAt` | timestamp | 最終確認日時 |
| `isAvailable` | boolean | 動画が利用可能か |

保持期間は90日（`VIDEO_FEED_RETENTION_DAYS`）。cron `youtube-update?action=update` が超過行を削除する。

### twitchVodCache

Twitch配信アーカイブ（VOD）のキャッシュ。cron `/api/cron/twitch-update` が30分毎に蓄積する。

| カラム | 型 | 説明 |
|--------|-----|------|
| `vodId` | text (UNIQUE) | Twitch VOD ID |
| `userLogin` | text | 配信者のlogin名（小文字）。`social_links.identifier` と読み時に突合 |
| `title` | text | VODタイトル |
| `thumbnailUrl` | text | サムネイルURL（処理中VODは null） |
| `channelTitle` | text | 配信者の表示名 |
| `durationSeconds` | integer | 配信時間（秒） |
| `publishedAt` | timestamp | 公開日時 |
| `lastVerifiedAt` | timestamp | 最終確認日時 |
| `isAvailable` | boolean | VODが利用可能か（Twitch側で自動削除されたものは false） |
| `gameName` | text (nullable) | 取り込み時点の**チャンネルの現在のカテゴリ名**（Helix `GET /channels` の `game_name`。VOD個別のカテゴリではない）。新規行にだけ保存し既存行は上書きしない。取得失敗・カテゴリ未設定は null |

`gameName` は `getRecentVods`（`app/lib/twitch.ts`）が /users 解決後に全チャンネル分を `/channels?broadcaster_id=…`（100件ずつ）で一括取得して付与する（チャンネルごとのN回呼び出しはしない）。失敗しても取り込みは続行する。

保持期間は90日。`verify` アクション（8時間毎）が削除済みVODを `isAvailable=false` にマークする
（Twitch VODは配信者設定により14〜60日で自動削除されるため）。

### youtubeLiveCache

YouTubeライブ配信のキャッシュ。**既知の制限: 現在このテーブルへの書き込みは停止中**（YouTube Search API の
クォータコスト〈1リクエスト100ユニット〉が高く、日次クォータ〈10,000ユニット〉をすぐ消費してしまうため、
更新ロジック自体〈`fetchAndCacheLiveStreams()`、`app/lib/youtube-cache.ts`〉は残存するが `vercel.json` の
crons から `action=live` を外してある）。`/api/home-feed?type=youtube-live` は常に空配列を返し、ホームに
YouTubeライブ配信は表示されない。将来的にRSS/Atomフィード等での再実装を検討中。

| カラム | 型 | 説明 |
|--------|-----|------|
| `videoId` | text (UNIQUE) | YouTube動画ID |
| `channelId` | text | チャンネルID |
| `minefolioMcid` | text | Minefolioユーザーとの紐付け |
| `title` | text | 配信タイトル |
| `thumbnailUrl` | text | サムネイルURL |
| `liveBroadcastContent` | enum | `live` / `upcoming` / `none` |
| `scheduledStartTime` | timestamp | 配信予定開始時刻 |
| `actualStartTime` | timestamp | 実際の開始時刻 |
| `concurrentViewers` | integer | 同時視聴者数 |
| `lastCheckedAt` | timestamp | 最終チェック日時 |

### pacemanPaces

PaceManペースのキャッシュ。Cron（`/api/cron/update-paceman-cache`）がPaceMan APIから直近1週間分を取得し、**蓄積型**で保存する:

- 取得したランと同じ `pacemanRunId` の既存行のみ削除して挿入（取得ウィンドウ外の過去ペースは保持）
- 削除→挿入→プルーニングは `db.batch`（1トランザクション）で実行（途中失敗による蓄積データの消失を防ぐ）
- 保持期間は**過去2か月**。それより古い行はCron実行時に削除される
- 読み取り側（`getPaceFeedEntries`）にも保持期間ガードがあり、Cronが止まっても期間外データは配信されない
- **`user_id` の再リンク**: INSERT 時に `lower(mcid)` が一致する users（公開/視聴者判定なし）の id を `user_id` に入れる。後から MCID を登録・変更したユーザーの既存行は INSERT 時には紐づかないため、Cron が毎回 `relinkPacemanPaceUsers()`（`app/lib/paceman-cache.ts`）を実行し、保持期間内の行の `user_id` を「現在の `lower(users.mcid)` 一致のユーザー」に合わせ直す（未登録・MCID 変更/解除後の旧 MCID 行は `null`、別ユーザーが同 MCID を登録済みならそのユーザーへ付け替え。冪等）。取得結果が0件・登録ユーザー0人でも実行する
- ホームの「お気に入りの動き」「おかえりバーの最新ペース」は `paceman_paces.user_id` で絞る（`idx_paceman_paces_user_id`）。公開プロフィール・視聴者除外などの表示判定はユーザー側の条件で行う
- 許容している一時的なずれ: MCID の登録・変更から次の Cron（30分間隔）までの間は、該当ユーザーの過去行が `user_id` で引けない。他のフィード（`/paces` 等）は mcid 文字列で絞るため影響しない

### apiCache

汎用APIキャッシュ。

| カラム | 型 | 説明 |
|--------|-----|------|
| `cacheKey` | text (UNIQUE) | キャッシュキー |
| `cacheType` | enum | `youtube_videos` / `recent_paces` / `twitch_streams` / `live_runs` / `social_stats` / `twitch_vods` |
| `data` | text | JSONデータ |
| `expiresAt` | timestamp | 有効期限 |

---

## 関連ファイル

### ルート
- `app/routes/home.tsx` - ホーム画面
- `app/routes/paces.tsx` - ペース一覧画面（検索・無限スクロール）
- `app/routes/videos.tsx` - 動画一覧画面（検索・無限スクロール）
- `app/routes/live-redirect.ts` - 旧 `/live` のホームへのリダイレクト
- `app/routes/api/home-feed.ts` - ホームフィード遅延読み込みAPI
- `app/routes/api/paces.ts` - ペース一覧のページング+検索API
- `app/routes/api/videos.ts` - 動画一覧のページング+検索API
- `app/routes/api/cron/twitch-update.ts` - Twitch VODキャッシュ更新Cron
- `app/routes/api/cron/youtube-update.ts` - YouTube動画キャッシュ更新Cron

### ライブラリ
- `app/lib/youtube.ts` - YouTube API連携（アップロード再生リスト解決・取得、チャンネル統計）
- `app/lib/youtube-cache.ts` - YouTube動画・ライブキャッシュ管理
- `app/lib/twitch.ts` - Twitch API連携（トークン取得、ストリーム取得、VODページング取得）
- `app/lib/twitch-vod-cache.ts` - Twitch VODキャッシュ管理（蓄積・差分削除・存在確認・クリーンアップ）
- `app/lib/targeted-refresh.server.ts` - 設定変更時の1ユーザー/1チャンネル単位の即時リフレッシュ（`runAfterResponse` 経由）
- `app/lib/feed-video.ts` - 動画フィードの共有ドメイン型・ユーティリティ（`FeedVideo` / 保持期間定数 / 自分の動画非表示フィルタ）
- `app/lib/videos-feed.server.ts` - 動画一覧の共通ロジック（マージ・可視性・検索条件解析）
- `app/lib/home-visibility.server.ts` - ホーム表示設定をオフにした人（mcid / slug）の一覧
- `app/lib/paceman.ts` - PaceMan API連携（ライブラン取得）
- `app/lib/paceman-cache.ts` - PaceManペースキャッシュ管理（蓄積・保持期間・フィード取得）
- `app/lib/home-featured.ts` / `home-featured.server.ts` - 注目の走者（点数・候補・日替わり・ランダム）
- `app/lib/home-favorite-activity.server.ts` - お気に入りの動き
- `app/lib/ranked-live.server.ts` - MCSR Ranked のライブ試合
- `app/lib/home-live.ts` / `home-format.ts` - 区間進行バー・時刻整形などの純粋ロジック
- `app/routes/api/home-featured.ts` / `home-favorite-activity.ts` - 「別の走者」/お気に入りの動き API
- `app/lib/paces-feed.server.ts` - ペース一覧の共通ロジック（検索条件解析・表示対象の絞り込み）
- `app/lib/pace-splits.ts` - フィード対象区間の定数
- `app/lib/cache.ts` - 汎用インメモリキャッシュ（`getCached`, `setCached`）

### コンポーネント
- `app/components/home/` - ホーム専用（`home-section` 欄枠 / `welcome-bar` / `featured-runner-card` / `live-rail` / `favorite-activity` / `compact-profiles` / `home-video-card` / `twitch-recent-list`）
- `app/components/feed-video-card.tsx` - 動画フィードカード（`/videos` 用。YouTube/Twitch VOD統一・埋め込み再生対応）
- `app/components/pace-feed-card.tsx` - ペースフィードカード（ペース一覧で使用）
- `app/components/profile-feed-card.tsx` - プロフィールフィードカード（お気に入り0人時のおすすめで使用）
- `app/components/paceman-split-mark.tsx` - PaceManスプリットマーク
- `app/components/page-views-meta.tsx` - 直近7日PV表示（`PageViews7dMeta`。ガイドカード・プロフィールカードで共有）
