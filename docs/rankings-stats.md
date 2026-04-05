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

---

## 統計ページ

### /stats — プラットフォーム全体統計

- Minefolio全体の統合統計データを表示

### /keybindings/stats — キー配置統計

- 登録されたキー配置の統計・傾向分析
- 使用率の高いキー配置パターンの表示

### /player/:slug/stats — プレイヤー個別統計

- 特定プレイヤーの詳細な統計情報
- スピードラン記録、Ranked統計等を統合表示

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
| `fetchMCSRRankedStats` | MCSR Rankedの統計取得 |
| `fetchSpeedrunComStats` | Speedrun.comの統計取得 |
| `checkPaceManPlayer` | PaceManプレイヤーの存在確認 |

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
- `app/routes/keybindings-stats.tsx` — キー配置統計ページ

### ライブラリ

- `app/lib/external-stats.ts` — 外部統計取得ロジック
- `app/lib/paceman.ts` — PaceMan API連携
- `app/lib/paceman-cache.ts` — PaceManキャッシュ管理

### Cron API

- `app/routes/api/cron/*.ts` — 各種Cronジョブエンドポイント
