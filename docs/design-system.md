# Minefolio デザインシステム

**バージョン**: 1.0
**最終更新**: 2026年1月

---

## 1. デザインコンセプト

### 1.1 ビジョン

**コンセプト**: Modern Portfolio + Gaming Aesthetic

Minecraftスピードランナーのための、モダンでプロフェッショナルなポートフォリオプラットフォーム。
ゲーミング要素を取り入れつつも、過度な装飾を避け、データの視認性を最優先する。

### 1.2 デザイン原則

1. **Clarity（明瞭性）**: 情報は一目で理解できる
2. **Consistency（一貫性）**: 全画面で統一されたUI/UX
3. **Accessibility（アクセシビリティ）**: 誰でも使いやすいデザイン
4. **Performance（パフォーマンス）**: 軽量で高速なレンダリング
5. **Optimistic UI（楽観的UI）**: 即座にフィードバックを返し、体感速度を向上

---

## 1.5 楽観的UI（Optimistic UI）

### 1.5.1 概要

楽観的UIとは、サーバーからの応答を待たずに、ユーザーの操作結果を即座にUIに反映する手法。
ネットワーク遅延を感じさせず、アプリケーションの体感速度を大幅に向上させる。

### 1.5.2 適用箇所

| 操作 | 楽観的更新 | ロールバック条件 |
|------|------------|------------------|
| キーバインド変更 | 即座にUI反映 | サーバーエラー時に元に戻す |
| プロフィール編集 | 即座にUI反映 | バリデーションエラー時に元に戻す |
| 目標タイム設定 | 即座にUI反映 | サーバーエラー時に元に戻す |
| ソーシャルリンク追加/削除 | 即座にリスト更新 | サーバーエラー時に元に戻す |
| 記録のFeatured切り替え | 即座にバッジ表示 | サーバーエラー時に元に戻す |

### 1.5.3 実装パターン

#### React Router の useSubmit + useFetcher

```tsx
import { useFetcher } from "react-router";

function KeybindingEditor({ keybinding }) {
  const fetcher = useFetcher();

  // 楽観的な値: 送信中はformDataを使用、それ以外は実際の値
  const optimisticKeyCode = fetcher.formData
    ? fetcher.formData.get("keyCode")
    : keybinding.keyCode;

  return (
    <fetcher.Form method="post">
      <input type="hidden" name="action" value="updateKeybinding" />
      <input type="hidden" name="id" value={keybinding.id} />
      <KeyInput
        value={optimisticKeyCode}
        onChange={(keyCode) => {
          fetcher.submit(
            { action: "updateKeybinding", id: keybinding.id, keyCode },
            { method: "post" }
          );
        }}
      />
      {/* エラー時の表示 */}
      {fetcher.data?.error && (
        <p className="text-destructive text-sm">{fetcher.data.error}</p>
      )}
    </fetcher.Form>
  );
}
```

#### 状態管理パターン

```tsx
import { useOptimistic } from "react";

function RecordCard({ record }) {
  const [optimisticRecord, setOptimisticRecord] = useOptimistic(
    record,
    (state, newValues) => ({ ...state, ...newValues })
  );

  const handleToggleFeatured = async () => {
    // 1. 楽観的に更新
    setOptimisticRecord({ isFeatured: !optimisticRecord.isFeatured });

    // 2. サーバーに送信
    try {
      await updateRecord(record.id, { isFeatured: !record.isFeatured });
    } catch (error) {
      // 3. エラー時は自動的にロールバック（useOptimisticの機能）
      toast.error("更新に失敗しました");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{optimisticRecord.categoryDisplayName}</CardTitle>
        {optimisticRecord.isFeatured && <Badge>Featured</Badge>}
      </CardHeader>
      <CardContent>
        <Button onClick={handleToggleFeatured}>
          {optimisticRecord.isFeatured ? "Unfeature" : "Feature"}
        </Button>
      </CardContent>
    </Card>
  );
}
```

### 1.5.4 UI状態の表現

#### 送信中（Pending）

```tsx
// ボタンの状態
<Button disabled={fetcher.state === "submitting"}>
  {fetcher.state === "submitting" ? (
    <>
      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
      Saving...
    </>
  ) : (
    "Save"
  )}
</Button>

// 入力フィールドの状態
<Input
  className={cn(
    fetcher.state === "submitting" && "opacity-70 pointer-events-none"
  )}
/>
```

#### 楽観的更新中の視覚的フィードバック

```tsx
// 更新中のカード
<Card
  className={cn(
    "transition-opacity",
    isPending && "opacity-70"
  )}
>
  {isPending && (
    <div className="absolute top-2 right-2">
      <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
    </div>
  )}
  {/* コンテンツ */}
</Card>
```

#### エラー時のロールバック表示

```tsx
// トースト通知
import { toast } from "sonner";

// エラー発生時
toast.error("保存に失敗しました", {
  description: "ネットワーク接続を確認してください",
  action: {
    label: "再試行",
    onClick: () => retry(),
  },
});

// 成功時（必要に応じて）
toast.success("保存しました");
```

### 1.5.5 楽観的UIを使わない場合

以下の操作は、サーバー応答を待ってから反映する:

| 操作 | 理由 |
|------|------|
| MCID登録（オンボーディング） | Mojang API検証が必要 |
| Speedrun.com連携 | 外部API検証が必要 |
| データインポート | 大量データの処理 |
| アカウント削除 | 不可逆な操作 |

これらは明示的なローディング状態を表示:

```tsx
<Button disabled={isLoading}>
  {isLoading ? (
    <>
      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
      Verifying...
    </>
  ) : (
    "Verify MCID"
  )}
</Button>
```

### 1.5.6 実装チェックリスト

- [ ] 全てのフォーム送信で `useFetcher` を使用
- [ ] 楽観的更新が必要な箇所で `useOptimistic` を使用
- [ ] Pending状態の視覚的フィードバック（opacity、スピナー）
- [ ] エラー時のトースト通知とロールバック
- [ ] 不可逆な操作には確認ダイアログ

---

## 2. タイポグラフィ

### 2.1 フォントファミリー

```css
/* メインフォント - 日本語対応 */
--font-sans: "Zen Kaku Gothic New", "Inter", ui-sans-serif, system-ui, sans-serif,
  "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";

/* モノスペース - タイム表示、コード */
--font-mono: "JetBrains Mono", "Fira Code", ui-monospace, SFMono-Regular,
  "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
```

### 2.2 Google Fonts 設定

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@400;500;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
```

### 2.3 フォントウェイト

| 用途 | ウェイト | 例 |
|------|----------|-----|
| 本文 | 400 (Regular) | 説明文、Bio |
| 中見出し、ラベル | 500 (Medium) | カード見出し、フォームラベル |
| 大見出し、強調 | 700 (Bold) | ページタイトル、プレイヤー名 |

### 2.4 フォントサイズ

Tailwind CSSのデフォルトスケールを使用:

| クラス | サイズ | 用途 |
|--------|--------|------|
| `text-xs` | 12px | 補足情報、バッジ |
| `text-sm` | 14px | 小見出し、メタ情報 |
| `text-base` | 16px | 本文（デフォルト） |
| `text-lg` | 18px | セクション見出し |
| `text-xl` | 20px | カードタイトル |
| `text-2xl` | 24px | ページ見出し |
| `text-3xl` | 30px | ヒーローテキスト |
| `text-4xl` | 36px | 大見出し |

### 2.5 タイム表示フォーマット

```css
/* スピードランタイム用 */
.time-display {
  font-family: var(--font-mono);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}
```

表示例:
- `12:34.567` (mm:ss.xxx)
- `1:23:45.678` (h:mm:ss.xxx)

---

## 3. カラーシステム

### 3.1 ベースカラー（OKLCH）

現在のapp.cssで定義済み。Slate系のニュートラルカラーをベースに使用。

#### ライトモード

| 変数 | 値 | 用途 |
|------|-----|------|
| `--background` | `oklch(1 0 0)` | 背景 (白) |
| `--foreground` | `oklch(0.129 0.042 264.695)` | テキスト (ほぼ黒) |
| `--card` | `oklch(1 0 0)` | カード背景 |
| `--primary` | `oklch(0.208 0.042 265.755)` | プライマリ (濃紺) |
| `--secondary` | `oklch(0.968 0.007 247.896)` | セカンダリ (薄グレー) |
| `--muted` | `oklch(0.968 0.007 247.896)` | ミュート |
| `--accent` | `oklch(0.968 0.007 247.896)` | アクセント |
| `--destructive` | `oklch(0.577 0.245 27.325)` | 危険 (赤) |
| `--border` | `oklch(0.929 0.013 255.508)` | ボーダー |

#### ダークモード

| 変数 | 値 | 用途 |
|------|-----|------|
| `--background` | `oklch(0.129 0.042 264.695)` | 背景 (ほぼ黒) |
| `--foreground` | `oklch(0.984 0.003 247.858)` | テキスト (ほぼ白) |
| `--card` | `oklch(0.208 0.042 265.755)` | カード背景 |
| `--primary` | `oklch(0.929 0.013 255.508)` | プライマリ (薄グレー) |
| `--secondary` | `oklch(0.279 0.041 260.031)` | セカンダリ |
| `--destructive` | `oklch(0.704 0.191 22.216)` | 危険 (明るい赤) |
| `--border` | `oklch(1 0 0 / 10%)` | ボーダー (半透明) |

### 3.2 セマンティックカラー

#### ステータスカラー

```css
/* 成功 - 目標達成、検証済み */
--success: oklch(0.723 0.191 142.303);      /* 緑 */
--success-foreground: oklch(1 0 0);

/* 警告 - 注意が必要 */
--warning: oklch(0.828 0.189 84.429);       /* 黄/オレンジ */
--warning-foreground: oklch(0.129 0.042 264.695);

/* エラー - 失敗、削除 */
--error: oklch(0.577 0.245 27.325);         /* 赤 */
--error-foreground: oklch(1 0 0);

/* 情報 - ヒント、補足 */
--info: oklch(0.623 0.214 259.815);         /* 青 */
--info-foreground: oklch(1 0 0);
```

#### キーバインドカテゴリカラー

```css
/* Virtual Keyboard用 */
--key-movement: oklch(0.723 0.191 142.303);    /* 緑 - WASD等 */
--key-combat: oklch(0.623 0.214 259.815);      /* 青 - 攻撃、使用 */
--key-inventory: oklch(0.828 0.189 84.429);    /* 黄 - インベントリ */
--key-hotbar: oklch(0.577 0.245 27.325);       /* 赤 - ホットバー1-9 */
--key-ui: oklch(0.627 0.265 303.9);            /* 紫 - UI操作 */
```

### 3.3 チャートカラー

```css
/* Recharts用 5色パレット */
--chart-1: oklch(0.646 0.222 41.116);   /* オレンジ */
--chart-2: oklch(0.6 0.118 184.704);    /* ティール */
--chart-3: oklch(0.398 0.07 227.392);   /* ダークブルー */
--chart-4: oklch(0.828 0.189 84.429);   /* イエロー */
--chart-5: oklch(0.769 0.188 70.08);    /* ライトオレンジ */
```

### 3.4 Minecraft テーマカラー（オプション）

```css
/* アクセントとして使用可能 */
--mc-grass: oklch(0.55 0.15 145);       /* 草ブロック緑 */
--mc-dirt: oklch(0.45 0.08 55);         /* 土ブロック茶 */
--mc-stone: oklch(0.55 0.01 250);       /* 石ブロックグレー */
--mc-diamond: oklch(0.7 0.18 200);      /* ダイヤモンド水色 */
--mc-gold: oklch(0.8 0.18 85);          /* 金ブロック黄 */
--mc-nether: oklch(0.45 0.2 25);        /* ネザー赤紫 */
--mc-end: oklch(0.35 0.15 290);         /* エンド紫 */
```

---

## 4. スペーシング

### 4.1 基本スケール

Tailwind CSSの4pxベーススケール:

| クラス | 値 | 用途 |
|--------|-----|------|
| `p-1` / `m-1` | 4px | 最小間隔 |
| `p-2` / `m-2` | 8px | 密な間隔 |
| `p-3` / `m-3` | 12px | 小間隔 |
| `p-4` / `m-4` | 16px | 標準間隔 |
| `p-6` / `m-6` | 24px | 中間隔 |
| `p-8` / `m-8` | 32px | 大間隔 |
| `p-12` / `m-12` | 48px | セクション間隔 |
| `p-16` / `m-16` | 64px | 大セクション間隔 |

### 4.2 レイアウトガイドライン

```
┌────────────────────────────────────────────────────────┐
│ Container (max-w-7xl, mx-auto, px-4 sm:px-6 lg:px-8)  │
│ ┌────────────────────────────────────────────────────┐ │
│ │ Section (py-8 sm:py-12)                            │ │
│ │ ┌────────────────────────────────────────────────┐ │ │
│ │ │ Card (p-4 sm:p-6)                              │ │ │
│ │ │ ┌────────────────────────────────────────────┐ │ │ │
│ │ │ │ Content                                    │ │ │ │
│ │ │ └────────────────────────────────────────────┘ │ │ │
│ │ └────────────────────────────────────────────────┘ │ │
│ └────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────┘
```

### 4.3 グリッドシステム

```css
/* プレイヤーカード一覧 */
.player-grid {
  display: grid;
  grid-template-columns: repeat(1, 1fr);  /* モバイル: 1列 */
  gap: 1rem;
}

@media (min-width: 640px) {
  .player-grid {
    grid-template-columns: repeat(2, 1fr);  /* sm: 2列 */
  }
}

@media (min-width: 1024px) {
  .player-grid {
    grid-template-columns: repeat(3, 1fr);  /* lg: 3列 */
  }
}

@media (min-width: 1280px) {
  .player-grid {
    grid-template-columns: repeat(4, 1fr);  /* xl: 4列 */
  }
}
```

---

## 5. コンポーネントスタイル

### 5.1 ボーダー半径

```css
--radius: 0.625rem;  /* 10px - ベース値 */

/* 派生値 */
--radius-sm: 6px;    /* 小ボタン、バッジ */
--radius-md: 8px;    /* 入力フィールド */
--radius-lg: 10px;   /* カード、ダイアログ */
--radius-xl: 14px;   /* 大きなカード */
--radius-2xl: 18px;  /* モーダル */
--radius-full: 9999px; /* 円形（アバター） */
```

### 5.2 シャドウ

```css
/* Tailwind デフォルト使用 */
shadow-sm    /* 小さなカード、ボタン */
shadow       /* 通常のカード */
shadow-md    /* 浮いたカード */
shadow-lg    /* ドロップダウン、ポップオーバー */
shadow-xl    /* モーダル、ダイアログ */
```

### 5.3 カード

```tsx
// 基本カード
<Card className="bg-card border border-border rounded-lg shadow-sm">
  <CardHeader className="p-4 sm:p-6">
    <CardTitle className="text-lg font-bold">Title</CardTitle>
  </CardHeader>
  <CardContent className="p-4 sm:p-6 pt-0">
    {/* コンテンツ */}
  </CardContent>
</Card>

// インタラクティブカード（ホバー効果）
<Card className="bg-card border border-border rounded-lg shadow-sm
                transition-all duration-200
                hover:shadow-md hover:border-primary/20
                cursor-pointer">
```

### 5.4 ボタン

```tsx
// プライマリボタン
<Button className="bg-primary text-primary-foreground
                   hover:bg-primary/90
                   h-10 px-4 py-2 rounded-md font-medium">
  Action
</Button>

// セカンダリボタン
<Button variant="secondary" className="bg-secondary text-secondary-foreground
                                        hover:bg-secondary/80">
  Cancel
</Button>

// ゴーストボタン
<Button variant="ghost" className="hover:bg-accent hover:text-accent-foreground">
  Link
</Button>

// Discordログインボタン
<Button className="bg-[#5865F2] text-white hover:bg-[#4752C4]
                   h-12 px-6 rounded-lg font-medium
                   flex items-center gap-2">
  <DiscordIcon className="w-5 h-5" />
  Continue with Discord
</Button>
```

### 5.5 入力フィールド

```tsx
<Input className="h-10 px-3 py-2
                  bg-background border border-input rounded-md
                  text-base placeholder:text-muted-foreground
                  focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2
                  disabled:cursor-not-allowed disabled:opacity-50" />
```

### 5.6 バッジ

```tsx
// デフォルトバッジ
<Badge className="bg-secondary text-secondary-foreground
                  px-2.5 py-0.5 rounded-full text-xs font-medium">
  Label
</Badge>

// ステータスバッジ
<Badge className="bg-green-500/10 text-green-600 dark:text-green-400">
  Verified
</Badge>

<Badge className="bg-blue-500/10 text-blue-600 dark:text-blue-400">
  Featured
</Badge>

<Badge className="bg-purple-500/10 text-purple-600 dark:text-purple-400">
  Speedrun.com
</Badge>
```

---

## 6. アイコン

### 6.1 アイコンライブラリ

**Lucide React** を使用（500+ SVGアイコン）

```tsx
import {
  User, Settings, LogOut, Search, Menu,
  Keyboard, Mouse, Trophy, Target, Clock,
  ChevronRight, ExternalLink, Check, X
} from "lucide-react";
```

### 6.2 アイコンサイズ

| サイズ | クラス | 用途 |
|--------|--------|------|
| 16px | `w-4 h-4` | インライン、ボタン内 |
| 20px | `w-5 h-5` | ナビゲーション、リスト |
| 24px | `w-6 h-6` | カード見出し |
| 32px | `w-8 h-8` | 大きなアイコン |
| 48px | `w-12 h-12` | ヒーロー、空状態 |

### 6.3 ソーシャルアイコン

```tsx
// カスタムSVGアイコンを用意
<DiscordIcon />      // Discord
<YouTubeIcon />      // YouTube
<TwitchIcon />       // Twitch
<TwitterIcon />      // Twitter/X
<SpeedrunComIcon />  // Speedrun.com
```

---

## 7. アニメーション

### 7.1 トランジション

```css
/* 標準トランジション */
transition-all duration-200 ease-in-out

/* ホバー効果 */
transition-colors duration-150

/* スケール効果 */
transition-transform duration-200 hover:scale-105

/* フェード効果 */
transition-opacity duration-300
```

### 7.2 アニメーション（tw-animate-css）

```tsx
// フェードイン
<div className="animate-in fade-in duration-300">

// スライドイン
<div className="animate-in slide-in-from-bottom-4 duration-300">

// ズームイン
<div className="animate-in zoom-in-95 duration-200">
```

### 7.3 ローディング状態

```tsx
// スピナー
<div className="animate-spin rounded-full h-8 w-8
               border-2 border-primary border-t-transparent" />

// スケルトン
<div className="animate-pulse bg-muted rounded-md h-4 w-full" />

// プログレスバー
<div className="h-2 bg-secondary rounded-full overflow-hidden">
  <div className="h-full bg-primary animate-pulse" style={{ width: '60%' }} />
</div>
```

---

## 8. レスポンシブデザイン

### 8.1 ブレークポイント

Tailwind CSSデフォルト:

| プレフィックス | 最小幅 | デバイス |
|----------------|--------|----------|
| (default) | 0px | モバイル |
| `sm:` | 640px | 大型スマホ |
| `md:` | 768px | タブレット |
| `lg:` | 1024px | ラップトップ |
| `xl:` | 1280px | デスクトップ |
| `2xl:` | 1536px | 大型デスクトップ |

### 8.2 モバイルファースト

```tsx
// 例: パディング
<div className="p-4 sm:p-6 lg:p-8">

// 例: グリッド
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">

// 例: フォントサイズ
<h1 className="text-2xl sm:text-3xl lg:text-4xl">

// 例: 表示/非表示
<div className="hidden md:block">  {/* モバイルで非表示 */}
<div className="md:hidden">        {/* デスクトップで非表示 */}
```

### 8.3 コンテナ幅

```tsx
// 標準コンテナ
<div className="container mx-auto px-4 sm:px-6 lg:px-8">

// 最大幅指定
<div className="max-w-7xl mx-auto">  {/* 1280px */}
<div className="max-w-4xl mx-auto">  {/* 896px - フォーム等 */}
<div className="max-w-2xl mx-auto">  {/* 672px - ログイン等 */}
```

---

## 9. アクセシビリティ

### 9.1 カラーコントラスト

- テキスト: WCAG AA準拠 (4.5:1以上)
- 大きなテキスト: 3:1以上
- インタラクティブ要素: フォーカス状態を明確に

### 9.2 フォーカス状態

```css
/* フォーカスリング */
focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2

/* キーボードナビゲーション用 */
focus-visible:ring-2 focus-visible:ring-ring
```

### 9.3 スクリーンリーダー

```tsx
// 視覚的に非表示だがスクリーンリーダーには読み上げ
<span className="sr-only">Close menu</span>

// ARIAラベル
<button aria-label="Toggle dark mode">
  <SunIcon />
</button>

// ライブリージョン
<div role="status" aria-live="polite">
  Saving...
</div>
```

---

## 10. ダークモード

### 10.1 実装方法

`next-themes` を使用したシステム連動 + 手動切り替え

```tsx
// ThemeProvider設定
<ThemeProvider
  attribute="class"
  defaultTheme="system"
  enableSystem
  disableTransitionOnChange
>
  {children}
</ThemeProvider>
```

### 10.2 カラー切り替え

```tsx
// 自動切り替え（CSS変数）
<div className="bg-background text-foreground">

// 明示的な切り替え
<div className="bg-white dark:bg-gray-900">
<div className="text-gray-900 dark:text-gray-100">
```

### 10.3 テーマトグルボタン

```tsx
<Button
  variant="ghost"
  size="icon"
  onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
>
  <SunIcon className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
  <MoonIcon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
  <span className="sr-only">Toggle theme</span>
</Button>
```

---

## 11. 特殊コンポーネント

### 11.1 Virtual Keyboard

```
┌─────────────────────────────────────────────────────────────┐
│ Layout: [US ▼]                                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌───┐┌───┐┌───┐┌───┐┌───┐┌───┐┌───┐┌───┐┌───┐┌───┐┌───┐   │
│  │Esc││F1 ││F2 ││F3 ││F4 ││F5 ││F6 ││F7 ││F8 ││F9 ││...│   │
│  └───┘└───┘└───┘└───┘└───┘└───┘└───┘└───┘└───┘└───┘└───┘   │
│                                                             │
│  キーの色分け:                                               │
│  - 緑: Movement (WASD, Space, Shift, Ctrl)                  │
│  - 青: Combat (マウスボタン)                                 │
│  - 黄: Inventory (E, F, 1-9)                                │
│  - 紫: UI (F1, F5, F11, T, /)                               │
│  - グレー: 未割り当て                                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 11.2 タイム入力

```tsx
// mm:ss.xxx フォーマット
<TimeInput
  value={timeInMs}
  onChange={setTimeInMs}
  className="font-mono text-lg"
  placeholder="00:00.000"
/>
```

### 11.3 プログレスバー（目標達成率）

```tsx
<div className="space-y-1">
  <div className="flex justify-between text-sm">
    <span>Progress to goal</span>
    <span>80%</span>
  </div>
  <div className="h-2 bg-secondary rounded-full overflow-hidden">
    <div
      className="h-full bg-primary rounded-full transition-all duration-500"
      style={{ width: '80%' }}
    />
  </div>
</div>
```

### 11.4 プレイヤーカード

```tsx
<Card className="group hover:shadow-lg transition-all duration-200 cursor-pointer">
  <CardContent className="p-4">
    <div className="flex items-start gap-4">
      <Avatar className="w-16 h-16 rounded-full">
        <AvatarImage src={avatarUrl} />
        <AvatarFallback>{mcid[0]}</AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <h3 className="font-bold text-lg truncate">{displayName}</h3>
        <p className="text-muted-foreground text-sm">@{mcid}</p>
        {featuredRecord && (
          <div className="mt-2">
            <span className="text-xs text-muted-foreground">{category}</span>
            <p className="font-mono text-xl font-medium">{formatTime(pb)}</p>
          </div>
        )}
        {location && (
          <p className="text-sm text-muted-foreground mt-1">
            <MapPinIcon className="w-3 h-3 inline mr-1" />
            {location}
          </p>
        )}
      </div>
    </div>
  </CardContent>
</Card>
```

---

## 12. 実装チェックリスト

### フォント設定

- [ ] Google Fonts (Zen Kaku Gothic New, JetBrains Mono) を追加
- [ ] app.css の `--font-sans` を更新
- [ ] `--font-mono` を追加

### カラー設定

- [ ] セマンティックカラー変数を追加
- [ ] キーバインドカテゴリカラーを追加
- [ ] Minecraftテーマカラーを追加（オプション）

### コンポーネント

- [ ] Discordログインボタンスタイル
- [ ] プレイヤーカードコンポーネント
- [ ] タイム表示コンポーネント
- [ ] Virtual Keyboardコンポーネント
- [ ] プログレスバーコンポーネント

### アクセシビリティ

- [ ] フォーカス状態の確認
- [ ] カラーコントラストの確認
- [ ] スクリーンリーダーテスト

---

## 付録: カラーパレット一覧

### Light Mode

| 用途 | OKLCH | HEX (参考) |
|------|-------|------------|
| Background | `oklch(1 0 0)` | #FFFFFF |
| Foreground | `oklch(0.129 0.042 264.695)` | #0F172A |
| Primary | `oklch(0.208 0.042 265.755)` | #1E293B |
| Secondary | `oklch(0.968 0.007 247.896)` | #F1F5F9 |
| Muted | `oklch(0.554 0.046 257.417)` | #64748B |
| Border | `oklch(0.929 0.013 255.508)` | #E2E8F0 |
| Destructive | `oklch(0.577 0.245 27.325)` | #DC2626 |

### Dark Mode

| 用途 | OKLCH | HEX (参考) |
|------|-------|------------|
| Background | `oklch(0.129 0.042 264.695)` | #0F172A |
| Foreground | `oklch(0.984 0.003 247.858)` | #F8FAFC |
| Primary | `oklch(0.929 0.013 255.508)` | #E2E8F0 |
| Secondary | `oklch(0.279 0.041 260.031)` | #334155 |
| Muted | `oklch(0.704 0.04 256.788)` | #94A3B8 |
| Border | `oklch(1 0 0 / 10%)` | rgba(255,255,255,0.1) |
| Destructive | `oklch(0.704 0.191 22.216)` | #F87171 |
