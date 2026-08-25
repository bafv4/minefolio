# ランキング・統計 仕様書

## 概要

Minecraft Speedrunのランキング表示、プレイヤー統計、外部サービス連携、PaceManペース追跡を提供する機能群。Speedrun.com、MCSR Ranked、PaceMan等の外部APIと連携し、データをキャッシュ・表示する。

---

## ランキング

### ページ

- `/rankings` — スピードランランキング表示

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

MCSR Ranked API `/leaderboard?country=jp` のレスポンス配列内でのインデックス（`index + 1`）から算出する（`fetchMCSRRankedStats` 内）。**このAPIは上位150件で結果を打ち切るため、`country === "jp"` かつ国内150位以内のプレイヤーのみ順位を表示し、圏外（151位以下・国コード未設定・jp以外）は非表示**とする割り切り仕様。

#### Minefolio内順位

`player_rankings`（`ranking_type = 'ranked_elo'`、cron `/api/cron/update-rankings` で更新）を基に、「公開プロフィール（`profile_visibility = 'public'`）かつRanked統計公開（`users.show_ranked_stats = true`）のユーザーの中で、自分より高いEloの人数 + 1」で算出する（同率は同順位）。実装は `getMinefolioEloRank()`（`app/lib/rankings-query.server.ts`）。

カード上のEloレート自体はMCSR Ranked APIからのライブ取得値、Minefolio内順位はcronキャッシュ（`player_rankings`）基準のため、両者の更新タイミングにはズレが生じうる（許容仕様）。

#### 最近のマッチ

各マッチの日時（`match.date`、epoch秒）は「n時間前 / n日前」の相対日付で表示する。

---

## 統計ページ

### /stats — プラットフォーム全体統計

- Minefolio全体の統合統計データを表示
- 感度分布は `/keybindings/stats` の感度区分（0〜200%基準の10区分・有効範囲外は集計から除外）と揃えている。詳細は [`docs/keybindings.md`](./keybindings.md) の「感度分布（`SENSITIVITY_RANGES`）」を参照

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
| rta | integer (ms) | Real Time Attack（ミリ秒） |
| igt | integer (ms) | In Game Time（ミリ秒） |
| date | timestamp | 実行日時 |
| isNetherEnter | boolean | ネザー入りかどうか |
| is2ndStructureOrLater | boolean | 2つ目以降のストラクチャーかどうか |

### タイムライン（スプリット）

ランの進行状況を示すスプリットポイント:

- `"Enter Nether"` — ネザー突入
- `"Obtain Blaze Rods"` — ブレイズロッド取得
- `"Eye Spy"` — エンダーアイ使用（要塞発見）
- その他のマイルストーン

### キャッシュ更新

- Cronジョブ `/api/cron/update-paceman-cache` で定期的にデータを取得・更新

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
| `checkPaceManPlayer` | PaceManプレイヤーの存在確認 |

### Speedrun.com記録の動画埋め込み

`/me/records`（自分の記録管理）と `/player/:slug` プロフィールの活動・記録タブの両方で、各PBカードに `getSpeedrunComVideoEmbedUrl()` の結果を `aspect-video` の `iframe`（`loading="lazy"`）として埋め込む。YouTube以外の動画リンクや動画リンクが無い記録は、従来通り「記録を見る」外部リンク（Speedrun.comのラン詳細ページ）のみを表示する。

---

## Cronジョブ

全Cronジョブは `CRON_SECRET` 環境変数による認証が必要。

| エンドポイント | 説明 |
|----------------|------|
| `/api/cron/youtube-update` | YouTube動画・ライブ配信のキャッシュ更新 |
| `/api/cron/update-paceman-cache` | PaceManペースデータのキャッシュ更新 |
| `/api/cron/update-rankings` | ランキングデータの更新 |

### 認証

- リクエストヘッダーまたはクエリパラメータで `CRON_SECRET` を検証
- 不正なリクエストは拒否

---

## 関連ファイル

### ページ

- `app/routes/rankings.tsx` — ランキングページ
- `app/routes/stats.tsx` — プラットフォーム統計ページ
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
