# Speedrun / MCSR 系サービス 公開API調査まとめ

本資料は、以下3つのサービスについて  
**プレイヤー情報取得を目的とした公開APIの有無およびAPI仕様概要**  
を調査・整理したものです。

対象サービス：
- Speedrun.com
- MCSR PaceMan（paceman.gg / Stats）
- MCSR Ranked（mcsrranked.com）

---

## 1. Speedrun.com

### 公開APIの有無
あり（公式 REST API v1）

### ベースURL
https://www.speedrun.com/api/v1/

### 認証
- 読み取り：不要
- 書き込み：APIキー必要

### 主なエンドポイント
- ユーザー検索  
  GET /users?lookup={username}
- ユーザー詳細  
  GET /users/{userId}
- 自己ベスト  
  GET /users/{userId}/personal-bests

---

## 2. MCSR PaceMan

### 公開APIの有無
あり（非公式だが公開）

### ベースURL
https://paceman.gg/stats/api/

### 認証
- 読み取り：不要（一部エンドポイントはAPIキー必要）
- キャッシュ：20秒（レートリミットは現在なし）

### 主なエンドポイント

#### getSessionStats - セッション統計
```
GET getSessionStats?name={playerName}&hours=24&hoursBetween=6
```

パラメータ：
- `name`: MCユーザー名またはTwitch名
- `hours`: 統計期間（デフォルト: 24）
- `hoursBetween`: セッション間の最大休憩時間（デフォルト: 6）

レスポンス例：
```json
{
  "nether": { "count": 2, "avg": "4:36" },
  "bastion": { "count": 1, "avg": "6:20" },
  "fortress": { "count": 1, "avg": "8:45" },
  "first_structure": { "count": 2, "avg": "5:30" },
  "second_structure": { "count": 1, "avg": "8:45" },
  "first_portal": { "count": 1, "avg": "10:15" },
  "stronghold": { "count": 1, "avg": "12:00" },
  "end": { "count": 1, "avg": "13:30" },
  "finish": { "count": 1, "avg": "15:20" }
}
```

#### getSessionNethers - ネザー入り統計
```
GET getSessionNethers?name={playerName}&hours=24
```

レスポンス例：
```json
{
  "count": 20,
  "avg": "5:40"
}
```

#### getSplitStats - 特定スプリット統計
```
GET getSplitStats?name={playerName}&hours=720
```

レスポンス例：
```json
{
  "count": 1,
  "avg": "2:19",
  "ms": 139993
}
```

#### getRecentRuns - 最近のラン
```
GET getRecentRuns?name={playerName}&hours=24&limit=10
```

レスポンス例：
```json
[
  {
    "id": 2027493,
    "nether": 139993,
    "bastion": 257593,
    "fortress": null,
    "first_portal": null,
    "stronghold": null,
    "end": null,
    "finish": null,
    "lootBastion": null,
    "obtainObsidian": null,
    "obtainCryingObsidian": null,
    "obtainRod": null,
    "time": 1766816383,
    "updatedTime": 1766816511,
    "realUpdated": 1766816511
  }
]
```

注意：タイムスタンプはミリ秒単位

#### getLeaderboard - リーダーボード
```
GET getLeaderboard?gamemode=rsg
```

#### getWorld - 現在のワールド（ライブ用）
```
GET getWorld?name={playerName}
```

#### getAllData - 全データ取得（APIキー必要）
```
GET getAllData?name={playerName}
```

### エラーレスポンス
```json
{"error": "Unknown user"}
```
ステータスコード: 404

---

## 3. MCSR Ranked

### 公開APIの有無
あり（公式）

### ベースURL
https://api.mcsrranked.com/

### 主なエンドポイント
- ユーザー  
  GET /users/{identifier}
- マッチ履歴  
  GET /users/{identifier}/matches
- 実績  
  GET /users/{identifier}/achievements

---

以上
