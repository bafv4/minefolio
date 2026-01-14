# Minefolio - 総合設計書（最終版）

**バージョン**: 1.0 Final  
**最終更新**: 2026年1月  
**プロジェクト名**: Minefolio  
**説明**: Minecraft Java Edition スピードランナーのための総合ポートフォリオサイト

---

## 目次

1. [システム概要](#1-システム概要)
2. [技術スタック](#2-技術スタック)
3. [開発環境セットアップ](#3-開発環境セットアップ)
4. [データベース設計](#4-データベース設計)
5. [認証・登録フロー](#5-認証登録フロー)
6. [API設計](#6-api設計)
7. [画面設計・ルート構成](#7-画面設計ルート構成)
8. [外部サービス連携](#8-外部サービス連携)
9. [実装優先順位](#9-実装優先順位)
10. [UI/UXコンセプト](#10-uiuxコンセプト)

---

## 1. システム概要

### 1.1 プロジェクト概要

**目的**: Minecraft Java Edition スピードランナーのキーバインド・デバイス設定・記録を共有する総合ポートフォリオサイト

**対象ユーザー**: MCSR（Minecraft Speedrun）コミュニティ

**既存アプリとの関係**: MCSRer Hotkeys の後継・拡張版

### 1.2 主要機能

#### コア機能
- Discord OAuth認証（パスワード不要）
- 既存データインポート（MCSRer Hotkeysから）
- キーバインド管理（27個の標準キー + カスタマイズ）
- VirtualKeyboard表示（JIS/US/JIS-TKL/US-TKL対応）
- デバイス設定（マウス・キーボード）

#### ポートフォリオ機能
- プレイヤープロフィール（Bio、Location、Pronouns）
- ソーシャルリンク（Discord、YouTube、Twitch、Twitter）
- 記録と目標の統合管理
- カスタム項目

#### 外部サービス連携
- **Speedrun.com**: 記録自動取得（APIから都度）
- **MCSR PaceMan**: 統計画像埋め込み
- **MCSR Ranked**: Elo、ベストタイム取得

#### コミュニティ機能
- プレイヤー一覧・検索
- カテゴリー別ランキング
- キーバインド・デバイス一覧
- 統計機能

### 1.3 既存アプリとの差分

| 項目           | MCSRer Hotkeys    | Minefolio                  |
| -------------- | ----------------- | -------------------------- |
| 認証           | MCID + Passphrase | Discord OAuth              |
| フレームワーク | Next.js 15        | React Router v7            |
| ORM            | Prisma            | Drizzle ORM                |
| ホスティング   | Vercel            | Cloudflare Pages + Workers |
| データ移行     | -                 | インポート機能あり         |
| ゲストユーザー | あり              | なし（廃止）               |
| 記録管理       | 手動入力          | 外部API連携（都度取得）    |
| ポートフォリオ | なし              | あり                       |

---

## 2. 技術スタック

### 2.1 フロントエンド

```json
{
  "framework": "React Router v7",
  "language": "TypeScript",
  "ui": "Shadcn/ui",
  "styling": "Tailwind CSS",
  "charting": "Recharts",
  "forms": "React Hook Form + Zod",
  "icons": "Lucide React"
}
```

### 2.2 バックエンド

```json
{
  "runtime": "Cloudflare Workers",
  "database": "SQLite (Cloudflare D1)",
  "orm": "Drizzle ORM",
  "auth": "Better Auth",
  "validation": "Zod",
  "http": "@neondatabase/serverless (HTTP)"
}
```

### 2.3 外部API

```json
{
  "discord": "Discord OAuth 2.0",
  "mojang": "Mojang API (UUID検証、スキン取得)",
  "speedruncom": "Speedrun.com API v1",
  "ranked": "MCSR Ranked API (要調査)",
  "legacy": "MCSRer Hotkeys API (データインポート用)"
}
```

### 2.4 デプロイ・インフラ

```json
{
  "hosting": "Cloudflare Pages",
  "functions": "Cloudflare Workers",
  "database": "Neon PostgreSQL (Serverless)",
  "cdn": "Cloudflare CDN",
  "cron": "Cloudflare Cron Triggers",
  "storage": "Cloudflare R2 (画像等)"
}
```

### 2.5 開発ツール

```json
{
  "package_manager": "pnpm",
  "build_tool": "Vite",
  "linter": "ESLint",
  "formatter": "Prettier",
  "testing": "Vitest"
}
```

---

## 3. 開発環境セットアップ

### 3.1 前提条件

- Node.js 20.x 以上
- pnpm 8.x 以上
- Discord アカウント
- Cloudflare アカウント
- Neon PostgreSQL アカウント

### 3.2 Discord OAuth セットアップ

#### Step 1: Discord Developer Portal でアプリケーション作成

1. [Discord Developer Portal](https://discord.com/developers/applications) にアクセス
2. 「New Application」をクリック
3. アプリケーション名を入力（例: "Minefolio"）
4. 利用規約に同意して「Create」

#### Step 2: OAuth2 設定

1. 左サイドバーから「OAuth2」→「General」を選択
2. 「Client ID」と「Client Secret」をコピー（後で使用）
3. 「Redirects」セクションで「Add Redirect」をクリック
4. リダイレクトURLを追加:
   - 開発環境: `http://localhost:5173/api/auth/callback/discord`
   - 本番環境: `https://your-domain.com/api/auth/callback/discord`

#### Step 3: Bot 設定（オプション）

1. 左サイドバーから「Bot」を選択
2. 「Add Bot」をクリック（将来的な拡張用）
3. 「Public Bot」をオフにする（プライベートボット）

#### Step 4: アプリケーション情報設定

1. 「General Information」に戻る
2. アプリケーションの説明を記入
3. アイコンをアップロード
4. 「Save Changes」

### 3.3 プロジェクトセットアップ

#### Step 1: プロジェクト作成

```bash
# React Router v7 + Cloudflare テンプレート
npx create-react-router@latest minefolio --template cloudflare

cd minefolio

# 依存関係インストール
pnpm install
```

#### Step 2: 追加パッケージインストール

```bash
# データベース・ORM
pnpm add drizzle-orm @neondatabase/serverless
pnpm add -D drizzle-kit

# 認証
pnpm add better-auth

# UI
pnpm add @radix-ui/react-dialog @radix-ui/react-dropdown-menu
pnpm add @radix-ui/react-select @radix-ui/react-tabs
pnpm add class-variance-authority clsx tailwind-merge
pnpm add lucide-react

# バリデーション
pnpm add zod

# ユーティリティ
pnpm add @paralleldrive/cuid2
pnpm add date-fns
```

#### Step 3: 環境変数設定

`.env` ファイルを作成:

```env
# Database
DATABASE_URL=postgresql://user:password@host/database?sslmode=require

# Discord OAuth
DISCORD_CLIENT_ID=your_discord_client_id
DISCORD_CLIENT_SECRET=your_discord_client_secret

# App
APP_URL=http://localhost:5173

# Auth
BETTER_AUTH_SECRET=your_random_secret_key_here

# Legacy App (for import)
LEGACY_API_URL=https://mchotkeys.vercel.app
```

**SECRET生成方法**:
```bash
# ランダムな文字列を生成
openssl rand -base64 32
```

#### Step 4: Neon PostgreSQL セットアップ

1. [Neon Console](https://console.neon.tech/) にアクセス
2. 「New Project」をクリック
3. プロジェクト名とリージョン（Tokyo推奨）を選択
4. 「Create Project」
5. 接続文字列（Connection String）をコピー
6. `.env` の `DATABASE_URL` に貼り付け

#### Step 5: Better Auth 設定

`lib/auth.ts` を作成:

```typescript
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./db";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
  }),
  socialProviders: {
    discord: {
      clientId: process.env.DISCORD_CLIENT_ID!,
      clientSecret: process.env.DISCORD_CLIENT_SECRET!,
      redirectURI: `${process.env.APP_URL}/api/auth/callback/discord`,
      scope: "identify email",
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7日間
    updateAge: 60 * 60 * 24, // 1日ごとに更新
  },
  advanced: {
    cookiePrefix: "minefolio",
  },
});

export type Session = typeof auth.$Infer.Session;
```

#### Step 6: Drizzle ORM 設定

`drizzle.config.ts` を作成:

```typescript
import type { Config } from "drizzle-kit";

export default {
  schema: "./lib/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
} satisfies Config;
```

`lib/db.ts` を作成:

```typescript
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";

const sql = neon(process.env.DATABASE_URL!);
export const db = drizzle(sql, { schema });
```

#### Step 7: 開発サーバー起動

```bash
# データベースマイグレーション
pnpm drizzle-kit generate
pnpm drizzle-kit migrate

# 開発サーバー起動
pnpm dev
```

ブラウザで http://localhost:5173 を開く

### 3.4 Cloudflare Pages デプロイ

#### Step 1: wrangler.toml 設定

```toml
name = "minefolio"
compatibility_date = "2024-01-01"

[site]
bucket = "./build/client"

# 環境変数（本番用）
[env.production]
vars = { APP_URL = "https://minefolio.pages.dev" }

# Cron設定
[triggers]
crons = [
  "0 0 * * *",  # MCID同期 (毎日0:00 UTC)
  "0 1 * * *",  # Speedrun.com同期 (毎日1:00 UTC)
]

# KV設定（オプション）
[[kv_namespaces]]
binding = "CACHE"
id = "your_kv_namespace_id"
```

#### Step 2: Cloudflare ダッシュボード設定

1. [Cloudflare Dashboard](https://dash.cloudflare.com/) にアクセス
2. 「Workers & Pages」→「Create application」→「Pages」
3. GitHubリポジトリを連携
4. ビルド設定:
   - **Build command**: `pnpm build`
   - **Build output directory**: `build/client`
5. 環境変数を設定:
   - `DATABASE_URL`
   - `DISCORD_CLIENT_ID`
   - `DISCORD_CLIENT_SECRET`
   - `BETTER_AUTH_SECRET`

#### Step 3: デプロイ

```bash
# 手動デプロイ
pnpm run deploy

# または、GitHubにpushすると自動デプロイ
git push origin main
```

---

## 4. データベース設計

### 4.1 ER図

```
                    ┌─────────────┐
                    │   users     │
                    ├─────────────┤
                    │ id (PK)     │
                    │ discordId   │
                    │ mcid        │
                    │ uuid        │
                    └─────────────┘
                           │
        ┌──────────────────┼──────────────────┬──────────────────┬──────────────────┐
        │                  │                  │                  │                  │
        ▼                  ▼                  ▼                  ▼                  ▼
┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│player_configs│   │ keybindings  │   │ social_links │   │category_     │   │custom_fields │
│              │   │              │   │              │   │records       │   │              │
└──────────────┘   └──────────────┘   └──────────────┘   └──────────────┘   └──────────────┘
        │                  │                                     
        │                  ▼                                     
        │          ┌──────────────┐                             
        │          │ custom_keys  │                             
        │          └──────────────┘                             
        │                  │                                     
        │                  ▼                                     
        │          ┌──────────────┐                             
        │          │  key_remaps  │                             
        │          └──────────────┘                             
        │                  │                                     
        │                  ▼                                     
        │          ┌──────────────┐                             
        │          │external_tools│                             
        │          └──────────────┘                             
        ▼                                                        
┌──────────────┐                                                
│item_layouts  │                                                
└──────────────┘                                                
        │                                                        
        ▼                                                        
┌──────────────┐                                                
│search_crafts │                                                
└──────────────┘                                                
        │                                                        
        ▼                                                        
┌──────────────┐                                                
│external_stats│                                                
└──────────────┘                                                
```

### 4.2 テーブル定義

#### 4.2.1 users（ユーザー）

```typescript
{
  id: string (cuid, PK)
  discordId: string (unique, indexed, NOT NULL)
  mcid: string (unique, indexed, NOT NULL)
  uuid: string (unique, NOT NULL) // Mojang UUID
  displayName: string? // 表示名（カスタマイズ可能）
  discordAvatar: string? // Discord avatar URL
  bio: text? // 自己紹介（Markdown対応）
  hasImported: boolean (default: false) // 既存データインポート済みフラグ
  
  // プロフィール設定
  profileVisibility: string (default: "public") // "public" | "unlisted" | "private"
  location: string? // "Japan", "USA", etc.
  pronouns: string? // "he/him", "she/her", "they/them", etc.
  
  // Speedrun.com連携
  speedruncomUsername: string? // Speedrun.comユーザー名
  speedruncomId: string? // Speedrun.com User ID（API用）
  speedruncomLastSync: timestamp? // 最終同期日時
  
  // 統計
  profileViews: integer (default: 0)
  lastActive: timestamp?
  
  createdAt: timestamp (default: now())
  updatedAt: timestamp (default: now())
}

// インデックス
CREATE INDEX idx_users_discord_id ON users(discord_id);
CREATE INDEX idx_users_mcid ON users(mcid);
CREATE INDEX idx_users_uuid ON users(uuid);
CREATE INDEX idx_users_speedruncom_id ON users(speedruncom_id);
```

#### 4.2.2 player_configs（プレイヤー設定）

```typescript
{
  id: string (cuid, PK)
  userId: string (FK: users.id, unique, NOT NULL)
  
  // キーボード設定
  keyboardLayout: string? // "JIS" | "US" | "JIS_TKL" | "US_TKL"
  keyboardModel: string? // 機種名
  
  // マウス設定
  mouseDpi: integer?
  gameSensitivity: real? // 0.0 - 1.0
  windowsSpeed: integer? // 1 - 20
  mouseAcceleration: boolean (default: false)
  rawInput: boolean (default: true)
  cm360: real? // 自動計算値
  mouseModel: string?
  
  // ゲーム内設定
  toggleSprint: boolean?
  toggleSneak: boolean?
  autoJump: boolean?
  gameLanguage: string?
  
  // 指割り当て（JSON）
  fingerAssignments: json? // { "KeyW": ["left-middle"], "Space": ["left-thumb", "right-thumb"] }
  
  // その他
  notes: text?
  
  createdAt: timestamp
  updatedAt: timestamp
}

// cm/360 計算式
function calculateCm360(dpi: number, sensitivity: number, windowsSpeed: number): number {
  const mcSensitivity = sensitivity * 0.6 + 0.2;
  const winMultiplier = windowsSpeed / 11;
  const eDPI = dpi * mcSensitivity * winMultiplier;
  return Math.round((360 / eDPI) * 2.54 * 10) / 10;
}
```

#### 4.2.3 keybindings（キーバインド）

```typescript
{
  id: string (cuid, PK)
  userId: string (FK: users.id, NOT NULL)
  action: string (NOT NULL) // "forward", "attack", "inventory", etc.
  keyCode: string (NOT NULL) // "KeyW", "Mouse0", etc.
  category: string (NOT NULL) // "movement" | "combat" | "inventory" | "ui"
  
  createdAt: timestamp
  updatedAt: timestamp
  
  UNIQUE(userId, action)
}

// インデックス
CREATE INDEX idx_keybindings_user_id ON keybindings(user_id);
CREATE INDEX idx_keybindings_category ON keybindings(category);
```

**27個の標準キーバインド**:

| カテゴリ       | アクション        | デフォルト   |
| -------------- | ----------------- | ------------ |
| Movement (7)   | forward           | W            |
|                | back              | S            |
|                | left              | A            |
|                | right             | D            |
|                | jump              | Space        |
|                | sneak             | Left Shift   |
|                | sprint            | Left Ctrl    |
| Combat (4)     | attack            | Mouse Left   |
|                | use               | Mouse Right  |
|                | pickBlock         | Mouse Middle |
|                | drop              | Q            |
| Inventory (11) | inventory         | E            |
|                | swapHands         | F            |
|                | hotbar1-9         | 1-9          |
| UI (5)         | togglePerspective | F5           |
|                | fullscreen        | F11          |
|                | chat              | T            |
|                | command           | /            |
|                | toggleHud         | F1           |

#### 4.2.4 custom_keys（カスタムキー定義）

```typescript
{
  id: string (cuid, PK)
  userId: string (FK: users.id, NOT NULL)
  keyCode: string (NOT NULL) // "Mouse10", "F13", etc.
  keyName: string (NOT NULL) // "マウス左サイド", "F13キー", etc.
  category: string (NOT NULL) // "mouse" | "keyboard"
  position: json? // VirtualKeyboard上の位置 { x: number, y: number }
  size: json? // VirtualKeyboard上のサイズ { width: number, height: number }
  notes: text?
  
  createdAt: timestamp
  updatedAt: timestamp
  
  UNIQUE(userId, keyCode)
}
```

#### 4.2.5 key_remaps（キーリマップ）

```typescript
{
  id: string (cuid, PK)
  userId: string (FK: users.id, NOT NULL)
  sourceKey: string (NOT NULL) // "CapsLock", "NonConvert", etc.
  targetKey: string? // "ControlLeft", etc. (nullで無効化)
  software: string? // "AutoHotKey", etc.
  notes: text?
  
  createdAt: timestamp
  updatedAt: timestamp
  
  UNIQUE(userId, sourceKey)
}
```

#### 4.2.6 external_tools（外部ツール連携）

```typescript
{
  id: string (cuid, PK)
  userId: string (FK: users.id, NOT NULL)
  triggerKey: string (NOT NULL) // "KeyF"
  toolName: string (NOT NULL) // "Ninb", "SeedQueue", "AutoHotKey"
  actionName: string (NOT NULL) // "リセット", "インスタンス切り替え"
  description: text?
  
  createdAt: timestamp
  updatedAt: timestamp
  
  UNIQUE(userId, triggerKey, toolName)
}
```

#### 4.2.7 item_layouts（アイテム配置）

```typescript
{
  id: string (cuid, PK)
  userId: string (FK: users.id, NOT NULL)
  segment: string (NOT NULL) // "overworld" | "nether" | "end" | "stronghold" | "custom_1"
  
  // スロット配置（JSON配列）
  slots: json (NOT NULL) // [{ slot: 1, items: ["iron_pickaxe"] }, ...]
  offhand: json // ["shield"]
  
  notes: text?
  displayOrder: integer (default: 0)
  
  createdAt: timestamp
  updatedAt: timestamp
  
  UNIQUE(userId, segment)
}

// slots JSON構造例
[
  { "slot": 1, "items": ["iron_pickaxe"] },
  { "slot": 2, "items": ["crafting_table"] },
  { "slot": 3, "items": ["water_bucket", "lava_bucket"] },
  { "slot": 4, "items": ["food"] },
  { "slot": 5, "items": ["wood"] },
  { "slot": 6, "items": ["bed"] },
  { "slot": 7, "items": ["flint_and_steel"] },
  { "slot": 8, "items": [] },
  { "slot": 9, "items": [] }
]
```

#### 4.2.8 search_crafts（サーチクラフト）

```typescript
{
  id: string (cuid, PK)
  userId: string (FK: users.id, NOT NULL)
  sequence: integer (NOT NULL) // 順番
  
  items: json (NOT NULL) // ["stick", "crafting_table", "wooden_pickaxe"]
  keys: json (NOT NULL) // ["KeyS", "KeyC", "KeyR"]
  searchStr: string? // "scr" (自動生成)
  comment: text?
  
  createdAt: timestamp
  updatedAt: timestamp
  
  UNIQUE(userId, sequence)
}
```

#### 4.2.9 social_links（ソーシャルリンク）

```typescript
{
  id: string (cuid, PK)
  userId: string (FK: users.id, NOT NULL)
  platform: string (NOT NULL) // "speedruncom" | "youtube" | "twitch" | "twitter" | "discord" | "custom"
  url: string (NOT NULL)
  username: string? // 表示名
  displayOrder: integer (default: 0)
  
  createdAt: timestamp
  updatedAt: timestamp
  
  UNIQUE(userId, platform)
}
```

**対応プラットフォーム**:
- `speedruncom` - Speedrun.com
- `youtube` - YouTube
- `twitch` - Twitch
- `twitter` - Twitter/X
- `discord` - Discord
- `custom` - その他（カスタムURL）

#### 4.2.10 category_records（記録・目標統合）

**記録と目標を統合したテーブル**

```typescript
{
  id: string (cuid, PK)
  userId: string (FK: users.id, NOT NULL)
  
  // カテゴリ情報
  category: string (NOT NULL) // "any-glitchless", "set-seed", "ranked"
  categoryDisplayName: string (NOT NULL) // "Any% Glitchless", "Ranked"
  subcategory: string? // "Pre 1.16", "1.16+", etc.
  version: string? // "1.16.1", "1.21.1", etc.
  
  // 記録タイプ
  recordType: string (NOT NULL) // "speedruncom" | "ranked" | "custom"
  
  // 自己ベスト（手動入力用）
  personalBest: integer? // ミリ秒単位
  pbDate: timestamp? // 記録達成日
  pbVideoUrl: string? // 動画URL
  pbNotes: text? // メモ
  
  // 目標
  targetTime: integer? // 目標タイム（ミリ秒）
  targetDeadline: timestamp? // 達成期限
  targetNotes: text? // 目標メモ
  achieved: boolean (default: false) // 目標達成フラグ
  achievedAt: timestamp?
  
  // 表示設定
  isVisible: boolean (default: true) // プロフィールに表示するか
  isFeatured: boolean (default: false) // メインカテゴリーとして表示
  displayOrder: integer (default: 0) // 表示順
  
  createdAt: timestamp
  updatedAt: timestamp
  
  UNIQUE(userId, category, recordType)
}

// インデックス
CREATE INDEX idx_category_records_user_id ON category_records(user_id);
CREATE INDEX idx_category_records_category ON category_records(category);
CREATE INDEX idx_category_records_type ON category_records(record_type);
CREATE INDEX idx_category_records_featured ON category_records(is_featured);
```

**recordType の説明**:
- `speedruncom`: Speedrun.com から取得（外部API、PBはDBに保存しない）
- `ranked`: MCSR Ranked から取得（外部API、PBはDBに保存しない）
- `custom`: ユーザーが手動入力（PBをDBに保存）

#### 4.2.11 custom_fields（カスタム項目）

```typescript
{
  id: string (cuid, PK)
  userId: string (FK: users.id, NOT NULL)
  fieldName: string (NOT NULL) // "Favorite Runner", "Setup Cost"
  fieldValue: text (NOT NULL)
  fieldType: string (default: "text") // "text" | "number" | "url" | "date"
  displayOrder: integer (default: 0)
  
  createdAt: timestamp
  updatedAt: timestamp
}
```

#### 4.2.12 external_stats（外部サービス統計キャッシュ）

```typescript
{
  id: string (cuid, PK)
  userId: string (FK: users.id, NOT NULL)
  service: string (NOT NULL) // "speedruncom" | "ranked"
  data: json (NOT NULL) // サービスごとの統計データ（PBを除く）
  lastFetched: timestamp (NOT NULL)
  
  createdAt: timestamp
  updatedAt: timestamp
  
  UNIQUE(userId, service)
}

// インデックス
CREATE INDEX idx_external_stats_user_id ON external_stats(user_id);
CREATE INDEX idx_external_stats_service ON external_stats(service);
```

**Speedrun.com data JSON構造（統計のみ）**:

```typescript
{
  userId: string,
  username: string,
  weblink: string,
  stats: {
    totalRuns: number,
    verifiedRuns: number,
    worldRecords: number,
    topTens: number
  }
}
```

**Ranked data JSON構造（統計のみ）**:

```typescript
{
  uuid: string,
  elo: number,
  rank: number,
  wins: number,
  losses: number,
  winRate: number,
  season: string
}
```

---

## 5. 認証・登録フロー

### 5.1 初回登録フロー

```mermaid
graph TD
    A[トップページ訪問] --> B{ログイン状態?}
    B -->|未ログイン| C[Login with Discord ボタン]
    B -->|ログイン済み| D[/player/:mcid]
    
    C --> E[Discord OAuth認証]
    E --> F{discordId存在?}
    
    F -->|既存ユーザー| D
    F -->|新規ユーザー| G[/onboarding]
    
    G --> H[MCID入力]
    H --> I[Mojang API検証]
    I --> J{UUID取得成功?}
    
    J -->|成功| K{MCID重複?}
    J -->|失敗| L[エラー: 無効なMCID]
    
    K -->|重複なし| M[User作成]
    K -->|重複あり| N[エラー: 既に登録済み]
    
    M --> O{既存データあり?}
    O -->|あり| P[/import]
    O -->|なし| Q[デフォルト設定作成]
    
    P --> R[インポート完了]
    Q --> D
    R --> D
```

### 5.2 認証実装

#### セッション取得

```typescript
// lib/session.ts
export async function getSession(request: Request) {
  const session = await auth.api.getSession({
    headers: request.headers,
  });
  
  if (!session) {
    throw redirect("/login");
  }
  
  return session;
}

export async function getCurrentUser(request: Request) {
  const session = await getSession(request);
  
  const user = await db.query.users.findFirst({
    where: eq(users.discordId, session.user.id),
  });
  
  if (!user) {
    throw redirect("/onboarding");
  }
  
  return user;
}
```

### 5.3 MCID検証（Mojang API）

```typescript
// lib/mojang.ts

export async function fetchUuidFromMcid(mcid: string): Promise<string> {
  const response = await fetch(
    `https://api.mojang.com/users/profiles/minecraft/${mcid}`
  );
  
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("MCID not found");
    }
    throw new Error("Mojang API error");
  }
  
  const data = await response.json();
  
  // ハイフン付きUUIDに変換
  const uuid = data.id.replace(
    /(.{8})(.{4})(.{4})(.{4})(.{12})/,
    "$1-$2-$3-$4-$5"
  );
  
  return uuid;
}

// MCID同期（Cron用）
export async function syncMcid(uuid: string): Promise<string> {
  const response = await fetch(
    `https://sessionserver.mojang.com/session/minecraft/profile/${uuid}`
  );
  
  if (!response.ok) {
    throw new Error("Failed to fetch profile");
  }
  
  const data = await response.json();
  return data.name;
}
```

### 5.4 デフォルト設定の生成

```typescript
// lib/defaults.ts

export async function createDefaultKeybindings(userId: string) {
  const defaults = [
    // Movement
    { action: "forward", keyCode: "KeyW", category: "movement" },
    { action: "back", keyCode: "KeyS", category: "movement" },
    { action: "left", keyCode: "KeyA", category: "movement" },
    { action: "right", keyCode: "KeyD", category: "movement" },
    { action: "jump", keyCode: "Space", category: "movement" },
    { action: "sneak", keyCode: "ShiftLeft", category: "movement" },
    { action: "sprint", keyCode: "ControlLeft", category: "movement" },
    
    // Combat
    { action: "attack", keyCode: "Mouse0", category: "combat" },
    { action: "use", keyCode: "Mouse1", category: "combat" },
    { action: "pickBlock", keyCode: "Mouse2", category: "combat" },
    { action: "drop", keyCode: "KeyQ", category: "combat" },
    
    // Inventory
    { action: "inventory", keyCode: "KeyE", category: "inventory" },
    { action: "swapHands", keyCode: "KeyF", category: "inventory" },
    { action: "hotbar1", keyCode: "Digit1", category: "inventory" },
    { action: "hotbar2", keyCode: "Digit2", category: "inventory" },
    { action: "hotbar3", keyCode: "Digit3", category: "inventory" },
    { action: "hotbar4", keyCode: "Digit4", category: "inventory" },
    { action: "hotbar5", keyCode: "Digit5", category: "inventory" },
    { action: "hotbar6", keyCode: "Digit6", category: "inventory" },
    { action: "hotbar7", keyCode: "Digit7", category: "inventory" },
    { action: "hotbar8", keyCode: "Digit8", category: "inventory" },
    { action: "hotbar9", keyCode: "Digit9", category: "inventory" },
    
    // UI
    { action: "togglePerspective", keyCode: "F5", category: "ui" },
    { action: "fullscreen", keyCode: "F11", category: "ui" },
    { action: "chat", keyCode: "KeyT", category: "ui" },
    { action: "command", keyCode: "Slash", category: "ui" },
    { action: "toggleHud", keyCode: "F1", category: "ui" },
  ];
  
  await db.insert(keybindings).values(
    defaults.map(kb => ({ ...kb, userId, id: createId() }))
  );
}
```

---

## 6. API設計

### 6.1 エンドポイント一覧

#### 認証不要（Public API）

| メソッド | パス                        | 説明                              | レスポンス                             |
| -------- | --------------------------- | --------------------------------- | -------------------------------------- |
| GET      | `/api/players`              | プレイヤーリスト                  | `{ players: Player[], total: number }` |
| GET      | `/api/player/:mcid`         | プレイヤー詳細                    | `Player`                               |
| GET      | `/api/player/:mcid/records` | プレイヤーの記録（外部APIマージ） | `MergedRecord[]`                       |
| GET      | `/api/stats/keys`           | キー使用統計                      | `KeyStats[]`                           |
| GET      | `/api/stats/devices`        | デバイス統計                      | `DeviceStats[]`                        |
| GET      | `/api/rankings/:category`   | カテゴリー別ランキング            | `Ranking[]`                            |
| GET      | `/api/search`               | プレイヤー検索                    | `SearchResult[]`                       |

#### 認証必要（Protected API）

| メソッド | パス                  | 説明                     | リクエスト              | レスポンス             |
| -------- | --------------------- | ------------------------ | ----------------------- | ---------------------- |
| POST     | `/api/onboarding`     | MCID登録                 | `{ mcid: string }`      | `User`                 |
| POST     | `/api/import`         | データインポート         | `{ mcid: string }`      | `ImportResult`         |
| GET      | `/api/me`             | 自分の情報               | -                       | `User`                 |
| PATCH    | `/api/me`             | プロフィール更新         | `Partial<User>`         | `User`                 |
| GET      | `/api/me/keybindings` | キーバインド取得         | -                       | `Keybinding[]`         |
| POST     | `/api/me/keybindings` | キーバインド更新         | `Keybinding[]`          | `Keybinding[]`         |
| PATCH    | `/api/me/config`      | デバイス設定更新         | `Partial<PlayerConfig>` | `PlayerConfig`         |
| GET      | `/api/me/records`     | 記録一覧取得（設定のみ） | -                       | `CategoryRecord[]`     |
| POST     | `/api/me/records`     | カテゴリ追加             | `CreateRecordInput`     | `CategoryRecord`       |
| PATCH    | `/api/me/records/:id` | 記録・目標更新           | `UpdateRecordInput`     | `CategoryRecord`       |
| DELETE   | `/api/me/records/:id` | カテゴリ削除             | -                       | `{ success: boolean }` |

#### Speedrun.com連携

| メソッド | パス                             | 説明                    | リクエスト                   | レスポンス                                 |
| -------- | -------------------------------- | ----------------------- | ---------------------------- | ------------------------------------------ |
| POST     | `/api/me/speedruncom/connect`    | 連携 & カテゴリ自動作成 | `{ speedruncomUrl: string }` | `{ success: boolean, categories: number }` |
| POST     | `/api/me/speedruncom/sync`       | カテゴリ再同期          | -                            | `{ success: boolean }`                     |
| DELETE   | `/api/me/speedruncom/disconnect` | 連携解除                | -                            | `{ success: boolean }`                     |

#### Cron（内部API）

| メソッド | パス                         | 説明                 | トリガー     |
| -------- | ---------------------------- | -------------------- | ------------ |
| POST     | `/api/cron/sync-mcid`        | MCID同期             | 毎日0:00 UTC |
| POST     | `/api/cron/sync-speedruncom` | Speedrun.com統計同期 | 毎日1:00 UTC |

### 6.2 主要API詳細

#### 6.2.1 POST /api/onboarding

```typescript
export async function action({ request }: ActionFunctionArgs) {
  const session = await getSession(request);
  const { mcid } = await request.json();
  
  // 1. MCID重複チェック
  const existing = await db.query.users.findFirst({
    where: eq(users.mcid, mcid),
  });
  
  if (existing) {
    throw new Error("This MCID is already registered");
  }
  
  // 2. Mojang APIで実在確認
  const uuid = await fetchUuidFromMcid(mcid);
  
  // 3. User作成
  const [user] = await db.insert(users).values({
    id: createId(),
    discordId: session.user.id,
    mcid,
    uuid,
    displayName: session.user.name,
    discordAvatar: session.user.image,
  }).returning();
  
  // 4. デフォルトキーバインド作成
  await createDefaultKeybindings(user.id);
  
  // 5. Rankedデータ確認
  await checkAndCreateRankedRecord(user.id, uuid);
  
  // 6. 既存データチェック
  try {
    const legacyResponse = await fetch(
      `https://mchotkeys.vercel.app/api/player/${mcid}`
    );
    const hasLegacyData = legacyResponse.ok;
    
    return { user, hasLegacyData };
  } catch {
    return { user, hasLegacyData: false };
  }
}
```

#### 6.2.2 POST /api/me/speedruncom/connect

```typescript
export async function action({ request }: ActionFunctionArgs) {
  const user = await getCurrentUser(request);
  const { speedruncomUrl } = await request.json();
  
  // 1. Speedrun.comユーザー検索
  const username = speedruncomUrl.split("/users/")[1]?.split("/")[0];
  const srcUser = await searchSpeedruncomUser(username);
  
  // 2. 記録取得
  const runs = await fetchSpeedruncomRuns(srcUser.id);
  
  // 3. カテゴリ抽出
  const categories = new Set<string>();
  runs.forEach(run => {
    if (run.status.status === "verified") {
      categories.add(run.category.data.name);
    }
  });
  
  // 4. users更新
  await db.update(users).set({
    speedruncomUsername: srcUser.names.international,
    speedruncomId: srcUser.id,
  }).where(eq(users.id, user.id));
  
  // 5. category_records作成（PBは保存しない）
  const records = Array.from(categories).map(category => ({
    id: createId(),
    userId: user.id,
    category: mapSpeedruncomCategory(category),
    categoryDisplayName: category,
    recordType: "speedruncom" as const,
    personalBest: null, // 重要: PBは保存しない
    targetTime: null,
    isVisible: true,
    isFeatured: false,
  }));
  
  await db.insert(categoryRecords).values(records);
  
  // 6. external_stats作成（統計のみ）
  const stats = {
    userId: srcUser.id,
    username: srcUser.names.international,
    weblink: `https://www.speedrun.com/users/${username}`,
    stats: {
      totalRuns: runs.length,
      verifiedRuns: runs.filter(r => r.status.status === "verified").length,
      worldRecords: runs.filter(r => r.place === 1).length,
      topTens: runs.filter(r => r.place <= 10).length,
    },
  };
  
  await db.insert(externalStats).values({
    id: createId(),
    userId: user.id,
    service: "speedruncom",
    data: stats,
    lastFetched: new Date(),
  }).onConflictDoUpdate({
    target: [externalStats.userId, externalStats.service],
    set: {
      data: stats,
      lastFetched: new Date(),
    },
  });
  
  return {
    success: true,
    categories: records.length,
  };
}
```

#### 6.2.3 GET /api/player/:mcid/records

**外部APIとマージして返す**

```typescript
export async function loader({ params }: LoaderFunctionArgs) {
  const player = await db.query.users.findFirst({
    where: eq(users.mcid, params.mcid),
  });
  
  if (!player) {
    throw new Response("Player not found", { status: 404 });
  }
  
  // 1. category_records取得（設定のみ）
  const records = await db.query.categoryRecords.findMany({
    where: and(
      eq(categoryRecords.userId, player.id),
      eq(categoryRecords.isVisible, true)
    ),
    orderBy: [
      desc(categoryRecords.isFeatured),
      asc(categoryRecords.displayOrder),
    ],
  });
  
  // 2. Speedrun.comのPBを取得
  const speedruncomRecords = records.filter(r => r.recordType === "speedruncom");
  let speedruncomPBs: Record<string, any> = {};
  
  if (player.speedruncomId && speedruncomRecords.length > 0) {
    const runs = await fetchSpeedruncomRuns(player.speedruncomId);
    speedruncomPBs = calculatePersonalBests(runs);
  }
  
  // 3. RankedのPBを取得
  const rankedRecords = records.filter(r => r.recordType === "ranked");
  let rankedPB: number | null = null;
  
  if (rankedRecords.length > 0) {
    const rankedData = await fetchRankedStats(player.uuid);
    rankedPB = rankedData?.bestTime || null;
  }
  
  // 4. マージ
  const mergedRecords = records.map(record => {
    let externalPB = null;
    let externalRank = null;
    let externalVideoUrl = null;
    let externalDate = null;
    
    if (record.recordType === "speedruncom") {
      const pb = speedruncomPBs[record.categoryDisplayName];
      if (pb) {
        externalPB = pb.time * 1000; // 秒 → ミリ秒
        externalRank = pb.rank;
        externalVideoUrl = pb.videoUrl;
        externalDate = pb.date;
      }
    } else if (record.recordType === "ranked") {
      externalPB = rankedPB;
    }
    
    return {
      ...record,
      // 外部PBを優先、なければ手動入力値
      displayPB: externalPB || record.personalBest,
      externalPB,
      externalRank,
      externalVideoUrl,
      externalDate,
      isExternal: !!externalPB,
    };
  });
  
  return { records: mergedRecords };
}
```

---

## 7. 画面設計・ルート構成

### 7.1 ルート構成

```typescript
// routes.ts
export const routes = [
  {
    path: "/",
    element: <RootLayout />,
    children: [
      // ホーム（プレイヤー一覧）
      { index: true, element: <Home /> },
      
      // 認証
      { path: "login", element: <Login /> },
      { path: "onboarding", element: <Onboarding /> },
      { path: "import", element: <Import /> },
      
      // プレイヤープロフィール
      { 
        path: "player/:mcid", 
        element: <PlayerProfile />,
        children: [
          { index: true, element: <ProfileOverview /> },
          { path: "keybindings", element: <ProfileKeybindings /> },
          { path: "devices", element: <ProfileDevices /> },
          { path: "items", element: <ProfileItems /> },
        ]
      },
      
      // 自分のプロフィール編集
      {
        path: "me",
        element: <ProtectedLayout />,
        children: [
          { index: true, element: <MyProfile /> },
          { path: "edit", element: <EditProfile /> },
          { path: "records", element: <EditRecords /> },
          { path: "social", element: <EditSocialLinks /> },
          { path: "keybindings", element: <EditKeybindings /> },
          { path: "devices", element: <EditDevices /> },
          { path: "items", element: <EditItemLayouts /> },
          { path: "search-craft", element: <EditSearchCraft /> },
        ],
      },
      
      // 一覧・ランキング
      { path: "browse", element: <Browse /> },
      { path: "browse/keybindings", element: <BrowseKeybindings /> },
      { path: "browse/devices", element: <BrowseDevices /> },
      { path: "rankings", element: <Rankings /> },
      { path: "rankings/elo", element: <RankingsElo /> },
      { path: "rankings/:category", element: <RankingsCategory /> },
      
      // 統計
      { path: "stats", element: <Stats /> },
      { path: "stats/keys", element: <KeyStats /> },
      { path: "stats/devices", element: <DeviceStats /> },
      
      // 検索
      { path: "search", element: <Search /> },
    ],
  },
];
```

### 7.2 主要画面

#### 7.2.1 Home（プレイヤー一覧）

**表示内容**:
- ヒーローセクション
- 検索バー
- フィルター（カテゴリー、Elo）
- プレイヤーカード（4列グリッド）
- ページネーション

#### 7.2.2 ProfileOverview（記録・目標統合表示）

```tsx
<Card>
  <CardHeader>
    <CardTitle>Records & Goals</CardTitle>
  </CardHeader>
  
  <CardContent className="space-y-4">
    {records.map(record => (
      <RecordCard key={record.id} record={record} />
    ))}
  </CardContent>
</Card>
```

**RecordCard**:
- カテゴリ名（Featured Badge、External Badge）
- Personal Best（外部APIまたは手動入力）
  - タイム、ランク、日付、動画リンク
- Target Time（目標タイム）
  - 期限、達成状況
- Progress Bar（目標がある場合）

#### 7.2.3 EditRecords（記録・目標編集）

**表示内容**:
- Speedrun.com連携状態
- 記録一覧
  - 外部連携カテゴリ（PB表示のみ、目標設定可能）
  - カスタムカテゴリ（PB・目標両方編集可能）
- カスタムカテゴリ追加フォーム

---

## 8. 外部サービス連携

### 8.1 Speedrun.com API

#### API関数

```typescript
// lib/speedruncom.ts

const SPEEDRUNCOM_API = "https://www.speedrun.com/api/v1";
const MINECRAFT_JAVA_GAME_ID = "j1npme6p";

export async function searchSpeedruncomUser(username: string) {
  const response = await fetch(
    `${SPEEDRUNCOM_API}/users?lookup=${username}`
  );
  const data = await response.json();
  
  if (data.data.length === 0) {
    throw new Error("User not found");
  }
  
  return data.data[0];
}

export async function fetchSpeedruncomRuns(userId: string, max = 100) {
  const params = new URLSearchParams({
    user: userId,
    game: MINECRAFT_JAVA_GAME_ID,
    max: max.toString(),
    embed: "category",
  });
  
  const response = await fetch(`${SPEEDRUNCOM_API}/runs?${params}`);
  const data = await response.json();
  
  return data.data;
}

export function calculatePersonalBests(runs: any[]) {
  const pbs: Record<string, any> = {};
  
  runs
    .filter(run => run.status.status === "verified")
    .forEach(run => {
      const categoryName = run.category.data.name;
      const time = run.times.primary_t;
      
      if (!pbs[categoryName] || time < pbs[categoryName].time) {
        pbs[categoryName] = {
          time,
          rank: run.place || 0,
          verified: true,
          date: run.date,
          videoUrl: run.videos?.links[0]?.uri,
          runId: run.id,
        };
      }
    });
  
  return pbs;
}
```

#### Cron同期

```typescript
// worker.ts
export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const hour = new Date().getUTCHours();
    
    if (hour === 1) {
      await syncAllSpeedruncom(env);
    }
  }
}

async function syncAllSpeedruncom(env: Env) {
  const users = await db.query.users.findMany({
    where: isNotNull(users.speedruncomId),
  });
  
  for (const user of users) {
    try {
      await sleep(1000); // レート制限
      
      const runs = await fetchSpeedruncomRuns(user.speedruncomId);
      const stats = {
        totalRuns: runs.length,
        verifiedRuns: runs.filter(r => r.status.status === "verified").length,
        worldRecords: runs.filter(r => r.place === 1).length,
        topTens: runs.filter(r => r.place <= 10).length,
      };
      
      await db.insert(externalStats).values({
        id: createId(),
        userId: user.id,
        service: "speedruncom",
        data: stats,
        lastFetched: new Date(),
      }).onConflictDoUpdate({
        target: [externalStats.userId, externalStats.service],
        set: { data: stats, lastFetched: new Date() },
      });
    } catch (error) {
      console.error(`Failed to sync ${user.mcid}:`, error);
    }
  }
}
```

### 8.2 PaceMan統計

**画像埋め込み方式**:

```tsx
<img 
  src={`https://paceman.gg/stats/image/${player.mcid}`}
  alt="PaceMan Stats"
  className="w-full rounded-lg"
/>
```

### 8.3 MCSR Ranked

**API確認が必要**

```typescript
// lib/ranked.ts

export async function fetchRankedStats(uuid: string) {
  try {
    // TODO: 実際のRanked API URLを確認
    const response = await fetch(
      `https://mcsrranked.com/api/users/${uuid}`
    );
    
    if (!response.ok) {
      if (response.status === 404) {
        return null; // プレイヤーデータなし
      }
      throw new Error("Ranked API error");
    }
    
    const data = await response.json();
    
    return {
      elo: data.elo,
      rank: data.rank,
      wins: data.wins,
      losses: data.losses,
      winRate: data.wins / (data.wins + data.losses),
      season: data.season,
      bestTime: data.bestTime, // ミリ秒
    };
  } catch (error) {
    console.error("Failed to fetch Ranked stats:", error);
    return null;
  }
}

// Rankedレコード自動作成
export async function checkAndCreateRankedRecord(userId: string, uuid: string) {
  const rankedData = await fetchRankedStats(uuid);
  
  if (!rankedData) {
    return; // Rankedデータなし
  }
  
  // 既存確認
  const existing = await db.query.categoryRecords.findFirst({
    where: and(
      eq(categoryRecords.userId, userId),
      eq(categoryRecords.recordType, "ranked")
    ),
  });
  
  if (existing) {
    return;
  }
  
  // Rankedレコード作成
  await db.insert(categoryRecords).values({
    id: createId(),
    userId,
    category: "ranked",
    categoryDisplayName: "MCSR Ranked",
    recordType: "ranked",
    personalBest: null, // APIから都度取得
    targetTime: null,
    isVisible: true,
    isFeatured: false,
  });
}
```

---

## 9. 実装優先順位

### Phase 1: MVP - 2-3週間

**目標**: 基本的な認証・インポート・表示機能

#### Week 1: 基盤構築
- [ ] プロジェクトセットアップ
- [ ] Discord OAuth設定
- [ ] Drizzle ORM + Neon PostgreSQL
- [ ] Better Auth設定

#### Week 2: 認証・インポート
- [ ] Discord OAuth認証フロー
- [ ] Onboarding（MCID登録）
- [ ] Mojang API連携
- [ ] インポート機能実装

#### Week 3: 基本表示・編集
- [ ] ホームページ
- [ ] プロフィール表示
- [ ] キーバインド編集

**完成基準**:
- ✅ Discord OAuthでログイン
- ✅ MCIDを登録
- ✅ 既存データインポート
- ✅ キーバインド表示・編集

---

### Phase 2: ポートフォリオ機能 - 3-4週間

#### Week 4: データベース拡張
- [ ] 新規テーブル作成
- [ ] マイグレーション実行

#### Week 5: Speedrun.com連携
- [ ] Speedrun.com API実装
- [ ] 連携フロー
- [ ] category_records作成
- [ ] Cron同期処理

#### Week 6: 記録・目標機能
- [ ] EditRecords画面
- [ ] 外部APIマージ実装
- [ ] RecordCard表示

#### Week 7: プロフィール強化
- [ ] ProfileOverview再設計
- [ ] PaceMan埋め込み
- [ ] Ranked連携

**完成基準**:
- ✅ Speedrun.com連携動作
- ✅ 記録自動取得
- ✅ 目標設定可能

---

### Phase 3: 一覧・ランキング - 2-3週間

#### Week 8-10
- [ ] 検索・フィルター
- [ ] ランキング
- [ ] ホーム再設計

---

### Phase 4: VirtualKeyboard - 2-3週間

#### Week 11-13
- [ ] VirtualKeyboard実装
- [ ] デバイス設定
- [ ] キーバインド詳細機能

---

### Phase 5-7: その他機能 - 5-6週間

- アイテム配置
- サーチクラフト
- 統計機能

---

## 10. UI/UXコンセプト

### 10.1 デザインテーマ

**コンセプト**: Modern Portfolio Site + Gaming Aesthetic

#### カラースキーム

```css
:root {
  --primary: 118 90% 45%; /* Minecraft Green */
  --secondary: 280 60% 40%; /* Nether Purple */
  --accent: 36 100% 50%; /* Gold */
}
```

#### タイポグラフィ

```css
body {
  font-family: 'Inter', sans-serif;
}

h1, h2, h3, h4, h5, h6 {
  font-weight: 700;
}

code, pre {
  font-family: 'JetBrains Mono', monospace;
}
```

### 10.2 主要コンポーネント

#### プレイヤーカード

```tsx
<Card className="group hover:shadow-xl transition-all">
  <CardHeader>
    <Avatar size="lg" />
    <Badge>{location}</Badge>
  </CardHeader>
  <CardContent>
    <h3>{displayName}</h3>
    <p>@{mcid}</p>
    {featuredPB && (
      <div className="mt-4">
        <span>{featuredCategory}</span>
        <p className="text-2xl font-mono">{formatTime(featuredPB)}</p>
      </div>
    )}
  </CardContent>
</Card>
```

#### RecordCard

```tsx
<div className="p-4 border rounded-lg">
  <h4>{categoryDisplayName}</h4>
  <div className="grid grid-cols-2 gap-4">
    <div>
      <p className="text-xs">Personal Best</p>
      <p className="text-2xl font-mono">{formatTime(displayPB)}</p>
    </div>
    <div>
      <p className="text-xs">Target Time</p>
      <p className="text-2xl font-mono text-accent">{formatTime(targetTime)}</p>
    </div>
  </div>
  {showProgress && <Progress value={progress} />}
</div>
```

---

## 付録

### A. 環境変数一覧

```env
# Database
DATABASE_URL=postgresql://...

# Discord OAuth
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...

# App
APP_URL=https://minefolio.example.com

# Auth
BETTER_AUTH_SECRET=...

# Legacy App
LEGACY_API_URL=https://mchotkeys.vercel.app
```

### B. 参考リンク

- **React Router v7**: https://reactrouter.com/
- **Cloudflare Pages**: https://pages.cloudflare.com/
- **Drizzle ORM**: https://orm.drizzle.team/
- **Better Auth**: https://www.better-auth.com/
- **Shadcn/ui**: https://ui.shadcn.com/
- **Discord Developer Portal**: https://discord.com/developers/applications
- **Mojang API**: https://wiki.vg/Mojang_API
- **Speedrun.com API**: https://github.com/speedruncomorg/api
- **Neon PostgreSQL**: https://neon.tech/

---

**以上、Minefolio 総合設計書（最終版）**
