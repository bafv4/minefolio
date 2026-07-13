# 技術スタック

Minefolio で利用している**外部サービス**と、依存している**ライブラリ**を分けて整理したドキュメント。

> サービス = ホスティング先・SaaS・外部 API 等の運用基盤
> ライブラリ = `package.json` で管理する npm パッケージ

---

## 外部サービス

### ホスティング・実行基盤

| サービス | 用途 |
|---|---|
| **Vercel** | アプリのホスティング、SSR/サーバレス実行、Cron Trigger、エッジ CDN |
| **Vercel Blob** | カスタムスキン・ガイド画像のオブジェクトストレージ |
| **Vercel OG**（`/og-image`） | OGP 画像の動的生成 |
| **Vercel Analytics** | アクセス解析 |

### データベース・認証

| サービス | 用途 |
|---|---|
| **Turso (libSQL)** | 本番 DB（SQLite 互換のエッジ向け分散DB） |
| **Discord OAuth** | ログイン手段（better-auth 経由） |

### 外部 API

| サービス | 用途 |
|---|---|
| **Mojang API** | MCID ↔ UUID 変換、スキンテクスチャ取得 |
| **PaceMan API** | リアルタイムランペース取得 |
| **MCSR Ranked API** | Ranked プレイヤー統計取得 |
| **Speedrun.com API** | スピードラン記録取得 |
| **YouTube Data API** | 動画・ライブ配信取得 |
| **Twitch Helix API** | ライブ配信取得（App Access Token） |

### メール送信

| サービス | 用途 |
|---|---|
| **Resend** | メール送信（フィードバックフォーム等） |

---

## ライブラリ

### フレームワーク・コア

| ライブラリ | 用途 |
|---|---|
| **react** / **react-dom** | UI ライブラリ |
| **react-router** / **@react-router/node** / **@react-router/serve** / **@react-router/dev** | フレームワーク本体（SSR・ルーティング・loader/action） |
| **typescript** | 型システム |
| **vite** / **vite-tsconfig-paths** | ビルドツール・dev サーバ、`@/` パスエイリアス解決 |
| **isbot** | ボット判定 |

### データベース・ORM

| ライブラリ | 用途 |
|---|---|
| **drizzle-orm** | スキーマ定義・型安全な SQL クエリ |
| **drizzle-kit** | マイグレーション生成・適用 |
| **@libsql/client** | Turso 接続クライアント |
| **@paralleldrive/cuid2** | プライマリキー用 ID 生成 |

### 認証

| ライブラリ | 用途 |
|---|---|
| **better-auth** | 認証コア（セッション・OAuth） |
| **@better-auth/drizzle-adapter** | better-auth ↔ Drizzle の橋渡し |

### スタイリング・UI

| ライブラリ | 用途 |
|---|---|
| **tailwindcss** / **@tailwindcss/vite** | ユーティリティ CSS フレームワーク |
| **@tailwindcss/typography** | `prose` クラス（マークダウン本文のスタイル） |
| **tw-animate-css** | Tailwind 拡張アニメーション |
| **shadcn/ui** | コンポーネント集（New York スタイル、Slate base） |
| **@radix-ui/react-\*** / **radix-ui** | shadcn の土台。アクセシビリティ重視のヘッドレスコンポーネント |
| **lucide-react** | アイコンセット |
| **next-themes** | ダーク/ライトテーマ切替 |
| **class-variance-authority** | コンポーネントのバリアント定義 |
| **clsx** / **tailwind-merge** | `cn()` ユーティリティの基盤 |
| **cmdk** | コマンドパレット（コンボボックス・検索 UI） |
| **sonner** | トースト通知 |

### フォーム・バリデーション

| ライブラリ | 用途 |
|---|---|
| **react-hook-form** | フォーム状態管理 |
| **@hookform/resolvers** | バリデーションリゾルバ |
| **zod** | スキーマバリデーション |

### ガイドエディタ

| ライブラリ | 用途 |
|---|---|
| **@tiptap/core** / **@tiptap/react** / **@tiptap/pm** / **@tiptap/starter-kit** | リッチテキストエディタ本体（ProseMirror ベース） |
| **@tiptap/extension-bubble-menu** ほか各種拡張 | コードブロック・カラー・ハイライト・画像・リンク・プレースホルダー・テーブル・YouTube 等 |
| **sanitize-html** | サーバ側で保存時に HTML をサニタイズ |
| **react-markdown** + **remark-gfm** + **rehype-sanitize** | `/developers/api` `/developers/changelog` で `app/content/*.md` をレンダリング |

### ドラッグ&ドロップ

| ライブラリ | 用途 |
|---|---|
| **@dnd-kit/core** / **@dnd-kit/sortable** / **@dnd-kit/utilities** | サーチクラフトのドラッグ並べ替え等 |

### Minecraft 関連

| ライブラリ | 用途 |
|---|---|
| **skinview3d** | プロフィール画面の 3D スキン全身表示（three.js ベース、OrbitControls 操作対応） |
| **@bafv4/mcitems** | Minecraft 1.16 のアイテムアイコン・検索 |

### 各種サービスの SDK

| ライブラリ | 対応サービス |
|---|---|
| **@vercel/blob** | Vercel Blob（ファイルアップロード） |
| **@vercel/og** | Vercel OG（OGP 画像生成） |
| **@vercel/analytics** | Vercel Analytics |
| **resend** | Resend（メール送信） |

### ユーティリティ

| ライブラリ | 用途 |
|---|---|
| **date-fns** | 日付フォーマット・相対時刻 |

### 開発・テスト

| ライブラリ | 用途 |
|---|---|
| **vitest** / **@vitest/coverage-v8** / **@vitest/ui** | テストランナー（`pnpm test` / `test:ui` / `test:coverage`） |
| **tsx** | TypeScript スクリプトの直接実行 |
| **dotenv** | `.env` ローダー（drizzle-kit やスクリプト用） |
| **@types/node** / **@types/react** / **@types/react-dom** / **@types/sanitize-html** | 型定義 |

### 国際化（i18n）

- 自前実装（`app/lib/messages/`）。外部ライブラリ非依存
  - `pages-ja.ts` で日本語メッセージを管理
  - `t("dotPath.key", { params })` でアクセス、`{param}` 補間
  - デフォルトロケール `ja`、Cookie + `Accept-Language` 検出

---

## アーキテクチャ概要

```
[ブラウザ]
   ↓ HTTPS
[Vercel Edge / Serverless]
   ├─ React Router 8 SSR (loader/action)
   ├─ @vercel/og (OGP 生成)
   ├─ Cron Triggers (PaceMan / Rankings / YouTube 同期)
   └─ better-auth (Discord OAuth)
        ↓
   ├─ Turso (libSQL) ← Drizzle ORM
   ├─ Vercel Blob (画像)
   ├─ Resend (メール)
   └─ 外部 API (Mojang / PaceMan / SRC / MCSR Ranked / YouTube / Twitch)
```

- **データの正本**: Turso (DB) と Vercel Blob (画像)
- **キャッシュ**: API レスポンスは DB の `api_cache` テーブルや CDN キャッシュヘッダーで吸収
- **静的アセット**: Tailwind ビルド + Vite チャンク分割（vendor 等）
