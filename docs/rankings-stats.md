# ランキング・統計 仕様書

## 概要

Minecraft Speedrunのランキング表示、プレイヤー統計、外部サービス連携、PaceManペース追跡を提供する機能群。Speedrun.com、MCSR Ranked、PaceMan等の外部APIと連携し、データをキャッシュ・表示する。

---

## ランキング

### ページ

- `/rankings` — スピードランランキング表示
- **インメモリキャッシュ**（`app/lib/cache.ts`、TTL **60秒**）: `rankings:categories`（カテゴリ一覧）、`rankings:speedruncom:<categoryId|none>`、`rankings:ranked:{pb|elo}`。ランキング自体は12時間毎の cron でしか変わらないが、プロフィール非公開化の反映遅延を `getUserData`（60秒）と同程度に抑えるため TTL は短くしている
- **表の横スクロール（モバイル）**: 3つの表は角丸の枠の内側の横スクロールの器（`ScrollUpStickyHeader` の `scrollRegionLabel`）に入る。sm 未満は `table-fixed` でヘッダ行の幅だけで列を決め（プレイヤー列は残り幅、長い名前は省略）、MCSR Ranked PB は 375 幅でスクロールなしに収まり、Speedrun.com・Elo は `#`・名前・主な値（タイム／Elo）が最初に見え、残りの列は横スクロールで見る。`#` 列は左に残る。器ははみ出しているときだけ Tab で止まれる region（「表（横にスクロールできます）」）になる。上スクロールで出る固定ヘッダの複製は、器の位置・幅と scrollLeft に追従する
- **カテゴリの切替**: ボタンは選択中を `aria-pressed` で伝える（見た目は既定の `Button`＝brand）。高さはモバイル 44px・sm 以上 32px。Speedrun.com のカテゴリが0件のときは、見出し「Speedrun.com」ごと出さない
- **再取得中**: `/rankings` 内の切替（`navigation.location.pathname === "/rankings"`）のときだけ、表示中の表を差し替えずに `opacity-50`＋`aria-busy` で残す（走者のページへ移るときは薄くしない）。表が無い（空状態から切り替えた）ときだけスケルトンを出し、列数は遷移先の表（Speedrun.com 5列・Ranked PB 3列・Elo 5列）に合わせる
- **順位の色**: 1位 `text-gold`、3位 `text-bronze`。2位（銀）の色トークンは無く、muted にすると4位以下より淡く見えるため、2位と4位以下は前景色
- **既定のタブ**: `tab` の指定が無く Speedrun.com のカテゴリが0件のときは、loader が Ranked PB を既定にする（`tab=speedruncom` を明示したときは Speedrun.com のまま）。カテゴリ0件の Speedrun.com の空状態は「Speedrun.com のランキングはまだありません」＋ PB ランキングへ切り替えるボタン。それ以外の空状態は、タブごとの説明文（description は空にしない）。カテゴリ切替のボタン群は `role="group"` ＋ `aria-labelledby`（Speedrun.com / MCSR Ranked の見出し）で結ぶ
- **注記**: 「記録の公開設定によっては…」（`rankings.publicityNote`）は見出しの下に1回だけ出す（空状態では繰り返さない）
- **審査待ち（Speedrun.com の `verificationStatus = "new"`）**: 順位の欄に時計（飾り、`aria-hidden`）、名前の下の行に「審査待ち」（`rankings.pendingVerification`、`text-xs text-warning`）。名前とは別の行なので、名前が省略されても切れずに読め、Tooltip に頼らないのでタッチでも分かる

### categoryRecordsテーブル

| カラム | 型 | 説明 |
|--------|------|------|
| id | string (PK) | レコードID |
| category | string | カテゴリ識別子 |
| categoryDisplayName | string | カテゴリ表示名 |
| subcategory | string | サブカテゴリ |
| version | string | Minecraftバージョン |
| recordType | enum | `speedruncom` / `ranked` / `custom` |
| personalBest | integer (ms) | 自己ベスト記録（ミリ秒） |
| targetTime | integer (ms) | 目標タイム（ミリ秒） |

### Speedrun.com連携

- `speedruncomUsername` — Speedrun.comのユーザー名
- `speedruncomId` — Speedrun.comのプレイヤーID
- これらのフィールドでMinefolioユーザーとSpeedrun.comプレイヤーを紐付け

### MCSR Ranked連携

- 外部API経由でランク・統計情報を取得
- Eloレーティング、勝敗数等の統計データ
- プロフィールの活動・記録タブ（`/player/:slug`）と `/player/:slug/stats` の MCSR Ranked カードで、Eloレーティングに加えて以下を表示する（カード実装は共有コンポーネント。下記「関連ファイル」参照）
- `users.show_ranked_stats = false` のユーザーは**両ルートとも** MCSR Ranked カード自体を表示しない（活動・記録タブはタブ内の表示条件で非表示、`/player/:slug/stats` は loader で `externalStats.ranked` を落として非表示。閲覧者が本人でも同じ）

#### レート帯チップ

MCSR Ranked APIはユーザーのEloレート（`eloRate`）のみを返し、階級（Coal〜Netherite）は含まれない。そのため公式ゲーム内UI（[wiki.mcsrranked.com/gameplay/elo_and_ranks](https://wiki.mcsrranked.com/gameplay/elo_and_ranks)のスクリーンショットで確認済みの閾値）を基に、Eloレートからクライアント側で階級を算出する（`app/lib/mcsr-ranked-tiers.ts` の `getRankTier()`）。

| 階級 | Elo範囲 | サブディビジョン境界 |
|---|---|---|
| Coal | 0〜599 | I: 0 / II: 400 / III: 500 |
| Iron | 600〜899 | 100刻み（I: 600 / II: 700 / III: 800） |
| Gold | 900〜1199 | 100刻み（I: 900 / II: 1000 / III: 1100） |
| Emerald | 1200〜1499 | 100刻み（I: 1200 / II: 1300 / III: 1400） |
| Diamond | 1500〜1999 | I: 1500 / II: 1650 / III: 1800（非対称） |
| Netherite | 2000〜 | サブディビジョンなし |

表示色は同UIのスクリーンショットから抽出したドメイン色トークン `--rank-coal` 〜 `--rank-netherite`（`app/app.css`。ライト/ダークテーマで明度のみ異なる）を使用する。階級名（"Coal I" 等）は英語固有名のため翻訳しない。

#### Win Rate / FF Rate

いずれも今シーズンのRankedモードの `statistics`（`seasonData`）から算出する。

- **Win Rate** = `wins / (wins + loses)`。Cronが `/rankings` 用に保存する `player_rankings.win_rate` と同じ計算式
- **FF Rate**（不戦敗率） = `forfeits / playedMatches`

APIの `wins + loses` と `playedMatches` は一致しない場合がある（decay等による差分）ため、分母を式ごとに使い分けている。

#### 国内順位（countryRank）

MCSR Ranked API `/leaderboard?country=jp` のレスポンス配列内でのインデックス（`index + 1`）から算出する（`fetchMCSRRankedStats` 内）。**このAPIは上位150件で結果を打ち切るため、`country === "jp"` かつ国内150位以内のプレイヤーのみ順位を表示し、圏外（151位以下・国コード未設定・jp以外）は非表示**とする割り切り仕様。JP リーダーボードの取得結果は `app/lib/external-stats.ts` のモジュール内で5分キャッシュし、プレイヤーごとに再取得しない。

#### Minefolio内順位

`player_rankings`（`ranking_type = 'ranked_elo'`、cron `/api/cron/update-rankings` で更新）を基に、「公開プロフィール（`profile_visibility = 'public'`）かつRanked統計公開（`users.show_ranked_stats = true`）のユーザーの中で、自分より高いEloの人数 + 1」で算出する（同率は同順位）。実装は `getMinefolioEloRank()`（`app/lib/rankings-query.server.ts`）で、全件を取得せず SQL の件数集計（`count`）で順位を求める。

カード上のEloレート自体はMCSR Ranked APIからのライブ取得値、Minefolio内順位はcronキャッシュ（`player_rankings`）基準のため、両者の更新タイミングにはズレが生じうる（許容仕様）。

#### 最近のマッチ

各マッチの日時（`match.date`、epoch秒）は「n時間前 / n日前」の相対日付で表示する。

---

## 統計ページ

### /stats — 廃止（`/keybindings/stats` へ統合）

- `/stats` は `/keybindings/stats` へ統合し、301 でリダイレクトする（`app/routes/stats.ts`。クエリ文字列は引き継がない）。旧ページは非公開の走者も集計に含めていたが、統合後は公開の走者だけを集計する

### /keybindings/stats — キー配置統計

- 登録されたキー配置の統計・傾向分析
- 使用率の高いキー配置パターンの表示

### /player/:slug/stats — プレイヤー個別統計

- 特定プレイヤーの詳細な統計情報
- スピードラン記録、Ranked統計等を統合表示
- MCSR Ranked / PaceMan / Speedrun.comの各カードは、プロフィールの活動・記録タブ（`/player/:slug`）と共通の表示コンポーネント（`app/components/player-stats-cards.tsx`）を使用する。MCSR Rankedカードの詳細（レート帯チップ・Win Rate/FF Rate・国内順位・Minefolio内順位）は上記「MCSR Ranked連携」を参照

---

## PaceManペース追跡

### pacemanPacesテーブル

| カラム | 型 | 説明 |
|--------|------|------|
| id | string (PK) | レコードID |
| pacemanRunId | string | PaceManのランID |
| mcid | string | MinecraftプレイヤーID |
| timeline | string | スプリット名 |
| rta | integer (ms) | 区間タイム（ミリ秒）。**列名に反して中身は IGT**（PaceMan stats API `getRecentRuns` の値は IGT。画面では「IGT」と明記して表示する） |
| igt | integer (ms) | 未使用（常に null） |
| date | timestamp | 実行日時 |
| isNetherEnter | boolean | ネザー入りかどうか |
| is2ndStructureOrLater | boolean | 2つ目以降のストラクチャーかどうか |

### タイムライン（スプリット）

ランの進行状況を示すスプリットポイント:

進行順（`paceman-cache.ts` の `SPLIT_ORDER`）:

1. `"Enter Nether"` — ネザー突入
2. `"Bastion"` / `"Fortress"` — 各ストラクチャー到達
3. `"Obtain Blaze Rods"` — ブレイズロッド取得（`getRecentRuns` の `obtainRod` から。他の区間と同じ IGT。`is2ndStructureOrLater` は false で、「主なペース」には含めない。含めるかは未決）
4. `"First Portal"` — 2つ目のポータル（Blind）
5. `"Enter Stronghold"` / `"Enter End"` / `"Finish"`

過去に保存された `Obtain Blaze Rods` 行は無い（obtainRod 対応前は一度も保存されていない。埋め直しはしない）。

### キャッシュ更新

- Cronジョブ `/api/cron/update-paceman-cache` で定期的にデータを取得・更新
- キャッシュ書き込み（既存ラン行の削除→挿入→プルーニング）は `db.batch`（1トランザクション）で実行する

---

## 外部サービス連携

### externalStatsテーブル

| カラム | 型 | 説明 |
|--------|------|------|
| id | string (PK) | レコードID |
| service | enum | `speedruncom` / `ranked` |
| data | JSON | 取得した統計データ |
| lastFetched | timestamp | 最終取得日時 |

### 連携サービス一覧

| サービス | 用途 |
|----------|------|
| Speedrun.com API | スピードラン記録の取得・同期 |
| MCSR Ranked API | ランク・統計情報の取得 |
| PaceMan API | リアルタイムペース追跡データの取得 |

### external-stats.ts の主要関数

| 関数 | 説明 |
|------|------|
| `fetchAllExternalStats` | 全外部統計を一括取得 |
| `fetchMCSRRankedStats` | MCSR Rankedの統計取得。今シーズンの `forfeits` / `playedMatches`（Win Rate/FF Rate算出用）と、`country === "jp"` かつ150位以内の場合の `countryRank` を含む |
| `fetchSpeedrunComStats` | Speedrun.comの統計取得（`personal-bests` APIに動画リンク`run.videos.links`が同梱されるため追加のAPI呼び出しは不要） |
| `getSpeedrunComVideoEmbedUrl` | Speedrun.com記録の動画リンクのうちYouTube埋め込みに変換できる最初のURLを返す（`youtube-url.ts`の`getYouTubeEmbedUrl`を利用）。Twitch等YouTube以外や動画リンク自体が無い場合はnullを返し、呼び出し側は外部リンク表示にフォールバックする |
| `checkPaceManPlayer` | PaceManプレイヤーの存在確認。404／`error`フィールド付き200は未登録、それ以外の非2xx・通信エラーは例外（取得失敗）。`fetchAllExternalStats` は失敗を未登録扱いにする。ブラウザからは CORS 非対応のため `/api/paceman-registration`（`fetchPaceManRegistration`）経由 |

### Speedrun.com記録の動画埋め込み

`/me/records`（自分の記録管理）と `/player/:slug` プロフィールの活動・記録タブの両方で、各PBカードに `getSpeedrunComVideoEmbedUrl()` の結果を `aspect-video` の `iframe`（`loading="lazy"`）として埋め込む。YouTube以外の動画リンクや動画リンクが無い記録は、従来通り「記録を見る」外部リンク（Speedrun.comのラン詳細ページ）のみを表示する。

---

## Cronジョブ

全Cronジョブは `CRON_SECRET` 環境変数による認証が必要。

| エンドポイント | 説明 |
|----------------|------|
| `/api/cron/youtube-update` | YouTube動画のキャッシュ更新（ライブ配信確認は現在停止中。詳細は [`docs/home-live.md`](./home-live.md#youtubelivecache)） |
| `/api/cron/twitch-update` | Twitch配信アーカイブ（VOD）のキャッシュ更新（詳細は [`docs/home-live.md`](./home-live.md#twitchvodcache)） |
| `/api/cron/update-paceman-cache` | PaceManペースデータのキャッシュ更新 |
| `/api/cron/update-rankings` | ランキングデータの更新。あわせて Ranked レートを `ranked_elo_snapshots` に日次記録（下記） |

### 認証

- リクエストヘッダーまたはクエリパラメータで `CRON_SECRET` を検証
- 不正なリクエストは拒否

### Ranked レート日次スナップショット

`update-rankings` cron が各ユーザーの Ranked レート（eloRate）を取得できたとき、`ranked_elo_snapshots` に `(userId, 当日UTCの YYYY-MM-DD)` で upsert する（`upsertEloSnapshot`、`app/lib/rankings-update.server.ts`）。同日に複数回走っても1行で、`eloRate` と `updatedAt` が後の値に更新される。レートが取れない／uuid 未登録のユーザーは書かない。1ユーザー分の処理（`updateUserRankings`）に入っているため、`targeted-refresh.server.ts` の即時更新でも同様に記録される。

保持期間は30日（`ELO_SNAPSHOT_RETENTION_DAYS`）。cron 1回の最後に `cleanupOldEloSnapshots` が、30日より古い `snapshot_date` を1文の DELETE で削除する（レスポンスの `stats.eloSnapshotsRemoved`）。ホームで使うのは直近7日のみ。

### Ranked PB の recordDate

MCSR Ranked API は PB を出した日時を返さないため、`ranked_pb` 行の `recordDate`（`YYYY-MM-DD`、UTC）は cron が「前回より速くなった」ことを検出した日だけ入れる。PB が変わらない・遅くなる更新では既存値を書き換えない。初回挿入（行がまだ無い）は過去の PB を「今日の更新」と誤認しないよう null のまま。

cron は同じ MCSR Ranked 応答の `statistics.total.bestTime`（数値、または `{ ranked, casual }`）から全期間ベストも `ranking_type = 'ranked_pb_all_time'` の行として保存する（追加の API 呼び出しなし・`recordDate` は常に null・取れない応答では既存行を触らない）。ホームの注目の走者の自己ベストが使う（`ranked_pb` を数える既存の集計には混ざらない）。

---

## 関連ファイル

### ページ

- `app/routes/rankings.tsx` — ランキングページ
- `app/routes/stats.ts` — 旧 `/stats` から `/keybindings/stats` への 301 リダイレクト
- `app/routes/player/stats.tsx` — プレイヤー個別統計ページ
- `app/routes/player/profile.tsx` — プレイヤープロフィール（活動・記録タブでMCSR Ranked等の外部統計カードを表示）
- `app/routes/keybindings-stats.tsx` — キー配置統計ページ

### ライブラリ

- `app/lib/external-stats.ts` — 外部統計取得ロジック
- `app/lib/mcsr-ranked-tiers.ts` — MCSR Rankedの階級（レート帯）算出（`getRankTier()`）
- `app/lib/rankings-query.server.ts` — ランキング一覧クエリ、及びMinefolio内Elo順位算出（`getMinefolioEloRank()`）
- `app/lib/paceman.ts` — PaceMan API連携
- `app/lib/paceman-cache.ts` — PaceManキャッシュ管理

### コンポーネント

- `app/components/player-stats-cards.tsx` — MCSR Ranked / PaceMan / Speedrun.comの統計カード（プロフィールの活動・記録タブと `/player/:slug/stats` で共有）

### Cron API

- `app/routes/api/cron/*.ts` — 各種Cronジョブエンドポイント
