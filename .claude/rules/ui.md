# UIデザイン規約

## コンポーネント選定
- UIコンポーネントは **shadcn/ui** を第一候補とする
- 新規コンポーネントが必要な場合、まず `npx shadcn add <component>` で追加可能か確認すること
  - shadcn MCP toolが利用可能な場合はそれを使って検索する
- shadcn/uiに該当するものがない場合のみ、独自コンポーネントを作成する
- 導入済みコンポーネントは `app/components/ui/` に格納されている

## shadcn/ui 設定
- スタイル: `new-york`
- ベースカラー: `slate`
- アイコン: `lucide-react`
- CSS変数: 有効
- RSC: 無効（SSR利用）

## スタイリング
- **Tailwind CSS 4** を使用、クラスを直接記述
- 条件付きクラスは `cn()` ユーティリティ（`@/lib/utils`）を使用
- カスタムCSSは `app/app.css` に集約
- CSSカスタムプロパティ（`--primary`, `--muted` 等）でテーマカラーを管理
- ダークモード: `.dark`（通常ダーク=Slate）/ `.ultra-dark`（ウルトラダーク=Zinc・より深い黒）のクラスベース。`@custom-variant dark` は両クラスに適用される
  - テーマは `next-themes`（`themes={["light","dark","ultra-dark"]}`）で管理し、選択は localStorage（key: `theme`）に永続化。`system` のダーク解決先は通常ダーク（Slate）
  - 切替UIは `app/components/layout/theme-toggle.tsx` の `THEME_OPTIONS` に集約（デスクトップのドロップダウン / モバイルのセグメント切替で共有）

## カラーシステム
- テーマカラーは **oklch** 形式でCSS変数に定義
- セマンティックカラー: `--success`, `--warning`, `--info`, `--destructive`
- ドメイン固有: `--key-movement`, `--key-combat` 等（キーカテゴリ色）、`--finger-*`（指割り当て色）、`--discord`
- コンポーネント内では `bg-primary`, `text-muted-foreground` 等のTailwindクラスで参照

## フォント
- 本文: `Zen Kaku Gothic New`, `Inter`（sans-serif）
- コード: `JetBrains Mono`, `Fira Code`（monospace）

## レスポンシブ
- モバイルファーストでTailwindブレークポイントを使用（`sm:`, `md:`, `lg:`）
- テーブルなど横幅が必要な要素は `overflow-x: auto` でスクロール対応

## アイコン
- `lucide-react` を統一使用
- サイズは用途に合わせる（フッター: `h-3 w-3`、ボタン内: `h-4 w-4`、空状態: `h-12 w-12`）

## ダイアログ・モーダル
- shadcn/ui の `Dialog` コンポーネントを使用
- 構造: `DialogHeader` → `DialogTitle` → コンテンツ → `DialogFooter`（キャンセル + アクションボタン）

## トースト通知
- `sonner` ライブラリ経由: `toast.success()`, `toast.error()`
- メッセージは翻訳キーを使用

## タブ
`app/components/ui/tabs.tsx` はフォルダ型（接続パネル）デザイン。アクティブタブがコンテンツパネルと一続きの面に見えるよう、以下の構造で成立している:

- **ベースライン**: タブ列下の 1px 横線は `TabsContent` の上ボーダーが担う（TabsList 自体は下線を持たない）
- **連結**: `TabsList` が `-mb-px` でパネルに 1px 重なり、`relative z-[1]` でパネルより手前に描画される
- **アクティブタブ**: `bg-card` + 上・左・右ボーダー（`border-border`）+ 下ボーダー透明。bg-card が透明な下ボーダー帯まで塗られ、パネル上辺のベースラインを覆って連結する
- **アクセント**: アクティブタブ上辺内側にブランド色バー（`before:` 疑似要素 + `bg-brand`）
- **横スクロール**: TabsList 自身が `overflow-x-auto`（スクロールバー非表示）。モバイルでは横スクロールする

### 消費側の不変条件
1. `TabsList` と `TabsContent` の間に `gap-*` / `space-y-*` を入れない（1px の重なりが壊れ、タブとパネルの間に線が見える）
2. `TabsContent` に display ユーティリティ（`block` / `flex` / `grid` 等）を足さない（非アクティブパネルの `hidden` 属性が無効化され同時表示される）
3. `TabsTrigger` に外側リング・`shadow`・`-mb-px` を足さない（TabsList のスクロールコンテナにクリップされる）
4. `TabsList` を別のスクロールコンテナ（`overflow-x-auto` の div 等）で包まない（基底が対応済み。包むと 1px 重なりがクリップされる）
5. `dark:` バリアント禁止 — テーマトークン（`bg-card` / `border` / `bg-brand` / `ring-ring`）のみで 3 テーマ（light / dark / ultra-dark）に対応する
6. Dialog 内など枠付きパネルが過剰な場面では、`TabsContent` に `rounded-none border-0 border-t bg-transparent p-0 pt-4`、`TabsTrigger` に `data-[state=active]:bg-background` を付けるデグレード構成を使う
