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
