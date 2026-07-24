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

### Minecraft アイテムアイコン
- **`ItemIcon`（`app/components/item-icon.tsx`）を使う**。`@bafv4/mcitems` の `MinecraftItemIcon` を直接呼ばない
- ラッパー側でテクスチャ配信元（`TEXTURE_BASE_URL = "/mcitems"`）・`pixelated` クラス・読み込み中の円形プログレスを既定化している
  （`loadLang()` に渡すベースURLも同モジュールの `TEXTURE_BASE_URL` を import する）
- 読み込み中のプレースホルダは `size` と同じ外枠を保つため、画像に切り替わってもレイアウトがずれない

## ダイアログ・モーダル
- shadcn/ui の `Dialog` コンポーネントを使用
- 構造: `DialogHeader` → `DialogTitle` → コンテンツ → `DialogFooter`（キャンセル + アクションボタン）

## トースト通知
- `sonner` ライブラリ経由: `toast.success()`, `toast.error()`
- メッセージは翻訳キーを使用

## タブ
`app/components/ui/tabs.tsx` はフォルダ型（一体カード）デザイン。タブ列とコンテンツ全体が 1 枚のカードに収まり、その中でアクティブタブがコンテンツ面と一続きに見える。以下の構造で成立している:

- **カード**: `Tabs` ルート自体が `rounded-xl border bg-card overflow-hidden` の 1 枚のカードとしてタブ列 + コンテンツを囲む
- **タブ帯**: `TabsList` はカード上部の帯（`bg-muted/40` + `px-1.5 pt-1.5` = `p-1.5` 相当）。上下左右で余白量を揃え、カード枠線との間に均等な余白を持たせる（下方向は `-mb-px` の重なり機構のため pb なし）
- **ベースライン**: 帯とコンテンツの境の 1px 横線は `TabsContent` の上ボーダー（`border-t`）が担う（TabsList 自体は下線を持たない）
- **連結**: `TabsList` が `-mb-px` でコンテンツに 1px 重なり、`relative z-[1]` で手前に描画される
- **アクティブタブ**: `bg-card` + 全周ボーダーのうち下だけ透明。bg-card が透明な下ボーダー帯まで塗られ、ベースラインを覆ってコンテンツ面と連結する
- **非アクティブタブ**: 常時 1px 枠（`border-border`）+ `bg-muted/50` のくぼんだ面。アクティブとの色差で選択状態を示す
- **アクセント**: アクティブタブ上辺内側にブランド色バー（`before:` 疑似要素 + `bg-brand`）
- **横スクロール**: TabsList 自身が `overflow-x-auto`。ネイティブスクロールバーは非表示（帯内に高さを取りタブがベースラインから浮くため）で、代わりに `useTabScrollbar`（`app/hooks/use-tab-scrollbar.tsx`）のオーバーレイ型カスタムスクロールバー（スクロール可能時のみ表示・ドラッグ可・レイアウト高さゼロ）を重ねる。Link ベースの ContentTabs / ViewSwitcher も同じフックを使用
- **カード化の打ち消し**: Dialog 内や独自レイアウト（プロフィールの縦サイドバー等）では、ルートに `rounded-none border-0 bg-transparent overflow-visible`、`TabsList` に `bg-transparent p-0` を指定して素の構造に戻す（プロフィールの縦サイドバーでは `TabsContent` も `rounded-none border-0 bg-transparent p-0 sm:p-0` で素通しにし、枠は中身の各 Card に任せる。パネル自体をカード化すると中の Card と二重枠になるため行わない）

### 消費側の不変条件
1. `TabsList` と `TabsContent` の間に `gap-*` / `space-y-*` を入れない（1px の重なりが壊れ、タブとパネルの間に線が見える）
2. `TabsContent` に display ユーティリティ（`block` / `flex` / `grid` 等）を足さない（非アクティブパネルの `hidden` 属性が無効化され同時表示される）
3. `TabsTrigger` に外側リング・`shadow`・`-mb-px` を足さない（TabsList のスクロールコンテナにクリップされる）
4. `TabsList` を別のスクロールコンテナ（`overflow-x-auto` の div 等）で包まない（基底が対応済み。包むと 1px 重なりがクリップされる）
5. `dark:` バリアント禁止 — テーマトークン（`bg-card` / `border` / `bg-brand` / `ring-ring`）のみで 3 テーマ（light / dark / ultra-dark）に対応する
6. Dialog 内など枠付きパネルが過剰な場面では、`TabsContent` に `rounded-none border-0 border-t bg-transparent p-0 pt-4`、`TabsTrigger` に `data-[state=active]:bg-background` を付けるデグレード構成を使う
