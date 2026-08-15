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

## 角丸（2層ルール）
- 個別のカード・アイテム・ボックス: `rounded-xl`（14px）
- ページ内の大型セクションパネル（ホームのセクション枠など、複数カードを包む面）: `rounded-2xl`（18px）
- `rounded-3xl` 以上はコンテナには使わない（装飾要素は除く）
- ネスト規則: `rounded-xl` カードの内側にネストするボックス（ドロップゾーン・プレースホルダ等）は1段下げて `rounded-lg`、さらに内側のチップは `rounded` でよい

## カードシステム
カードは用途に応じて次の3レシピのいずれかに従う。

- **インタラクティブカード**（遷移先のある一覧アイテム。走者/ペース/動画/ガイドカード）: `rounded-xl border border-border/70 bg-background/80`。ホバーは外側ラッパーに `-translate-y-0.5` ＋ `border-primary/40` ＋ `shadow-md`。カード全面クリックは上記「カード全体をクリック可能にする（オーバーレイリンク）」の構成に従う
- **静的セクションカード**（情報グルーピング）: shadcn Card を `<Card className="gap-3 py-5">` ＋ `CardHeader`/`CardContent className="px-5"` で使う（外側余白 20px。カード面が大きいため 16px では窮屈になる）。**現行 `card.tsx` 基底は gap 方式のため、旧 API 前提の `pt-0` / `pb-3` / `py-2` は無効または逆効果（禁止）**
- **リスト行**: `divide-y` 区切り＋`hover:bg-muted/50`（行がリンクの場合のみ。クリック不能な行にホバー背景を付けない）。この `divide-y` は既定濃度のままでよい（「カード内区切り `/60`」を適用しない）。`/60` は見出し・サブセクション境界などの `border-t`/`border-b` に適用するもので、両者は矛盾しない
- **編集用高密度ブロック**（サーチクラフトの `SearchCraftTimingBoard` のような、多数のブロックを常設する編集ボード）: 静的セクションカードの代わりに `rounded-xl border border-border/70 bg-background/80`＋ヘッダ帯 `px-4 py-2.5`（`border-b border-border/60`）＋中身 `px-4 py-3` の高密度ブロックを使ってよい。ブロック見出しは `text-sm font-semibold`（CardTitle の `text-base` より1段小さい）

### グリッドカードの内部文法
①メディア帯/ヘッダー行 → ②タイトル（`text-base font-semibold`。リスト行は `text-sm font-medium`）＋説明（`text-xs` muted）→ ③タグ行（Badge secondary、`rounded-full px-2 py-0.5 text-[11px]`・最大3個）→ ④フッターメタ行 `mt-3 border-t border-border/60 pt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground`、左＝著者/件数系（`truncate`/`min-w-0`）、右端＝`ml-auto shrink-0` で `Clock3 h-3 w-3` ＋相対時刻。**折返し耐性（`flex-wrap`＋`ml-auto`＋`shrink-0`＋`min-w-0`）は必須**。**フッターは下端固定**: カードを `flex flex-col` にし、フッター直前に伸縮スペーサー `<div className="flex-1" />`（またはヘッダー行に `flex-1`）を置いて、タイトル行数や任意項目の差があっても水平線位置が兄弟カード間で揃うようにする

### 透明度の規格
- border: カード外枠 `/70`・カード内区切り `/60` の2値
- `bg-secondary`: タイル・面 `/50`、kbd チップ `/80`、リンク行 `/30`（hover `/60`）
- 意味色ティント: `/10`

### kbd チップ
`bg-secondary/80 px-2.5 py-1 min-w-16 rounded text-sm font-mono text-center`

### 丸ピル（バッジピル・件数ピル）
`inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background/75 px-2.5 py-1 text-xs text-muted-foreground`

### キーバッジ（サーチクラフト系）
`search-craft-template-view.tsx` の `KeyBadge` と `search-craft-loop-view.tsx` の派生バッジ群で確立した規格。

- 基本形: `inline-flex items-center justify-center rounded border-2 font-mono font-semibold text-sm min-w-7 h-7 px-1.5`
- トーン:
  - 通常キー: `bg-secondary/50 border-border/50 text-muted-foreground`（指割り当てがあれば指色）
  - リマップ済み: `ring-2 ring-primary ring-offset-1 ring-offset-background`
  - Shift 同時押し: `border-warning/50 bg-warning/10`（⇧ Shift バッジは `text-warning`）
  - 制御キー（BS/←/Home/⇧Home）: `rounded-full border-info/50 bg-info/10 text-info px-2.5`（文字入力キーの角丸 `rounded` と一目で区別するためのピル形状）。**リマップ考慮時（`remaps` を渡し、逆引きでリマップが見つかった場合のみ）**は「実キー主表記＋操作ラベルのミニチップ」の複合ピルにする — **主ラベル＝実際に押すキー**（既存の単一ピルと同じ `text-sm`、外側の見た目はそのまま）、その中に「チップの中のチップ」として**出力操作**（`BS` 等）を小さめの丸チップ（`rounded-full border border-info/40 bg-info/15 px-1.5 py-0.5 text-[10px]`）で添える。ピル全体にリマップ用リング（`ring-2 ring-primary ring-offset-1 ring-offset-background`）を付ける。リマップが無い（大多数）場合は非リマップ時と1px も変わらない単一ピルのまま
  - 無効: `border-destructive/50 bg-destructive/10 text-destructive`
- クラフト実行マーカー: 通常のアイテムチップと同じ見た目の `h-7 rounded bg-secondary/50 px-2`（`ItemIcon` 24px＋文字列。Hammer 等の専用アイコン・破線ボーダーは付けない。「ここでクラフト実行」の説明は Tooltip と凡例が担う）。キー操作列ではキー系バッジと高さ h-7 を揃え、セグメント（制御キー・打鍵キー・チップ）間は `gap-2`、キー同士は `gap-1`
- 回数は右肩の `×n` カウンタで表す（バッジを並べない）
- マイクロテキストは2値: バッジ肩・印 = `text-[10px]`、凡例ラベル = `text-[11px]`
- Shift の「⇧」はフォント依存でグリフが揺れるため、Unicode 文字の直書きではなく `app/components/shift-mark.tsx` の
  `ShiftMark`（lucide `ArrowBigUp`、`aria-hidden` + `sr-only` の "Shift" 併記）で描画する。ラベル文字列中の "⇧" を
  まとめて置換する場合は `KeyLabelText`（サイズは `shiftClassName` で調整。バッジ/`text-sm` 文脈は既定の `size-3.5`、
  ミニチップ/`text-[10px]` 文脈は `size-2.5`）を使う。**データ層（`app/lib/remap-utils.ts` の `displayLabel` 等の
  返り値、翻訳文言・Tooltip・aria-label のような純テキスト文脈）は "⇧" 文字のまま保持し、アイコンへの変換は
  それを画面に描画する JSX 側でのみ行う**

### カード内アイコン
- セクション見出し（CardTitle）先頭: `h-5 w-5`
- メタ行: `h-3 w-3`（テキストとは `gap-1`）
- タイトル内の状態マーカー（Pin 等）: `h-4 w-4`

### グリッド段階
セクションに常に4件表示するグリッドは `grid-cols-1 sm:grid-cols-2 xl:grid-cols-4`（中間幅で3+1の孤立を作らない。4カラムは `xl` 以上）

## カラーシステム
- テーマカラーは **oklch** 形式でCSS変数に定義
- セマンティックカラー: `--success`, `--warning`, `--info`, `--destructive`
- ドメイン固有: `--key-movement`, `--key-combat` 等（キーカテゴリ色）、`--finger-*`（指割り当て色）、`--discord`、`--favorite`（お気に入りのハート色。`favorite-button` / `favorites` ページで使用）、`--youtube` / `--twitch` / `--gold` / `--bronze`
- コンポーネント内では `bg-primary`, `text-muted-foreground` 等のTailwindクラスで参照
- 意味を持つ色（成功・警告・情報・エラー/破壊的）は必ずセマンティックトークン（`text-success` / `text-warning` / `text-info` / `text-destructive` と各 `bg-*/10` 等）を使う。`green-500` などのパレット直指定・生 hex は禁止
- `dark:` バリアントは使わない。3テーマ（light / dark / ultra-dark）はトークン側で吸収する（タブ節の既存方針の一般化）
- inline style で色を書く場合もトークンをそのまま参照する（例: `var(--muted)`）。`hsl(var(--token))` で包むのは oklch 定義のため無効色になるので禁止

## フォント
- 本文: `Zen Kaku Gothic New`, `Inter`（sans-serif）
- コード: `JetBrains Mono`, `Fira Code`（monospace）

## レスポンシブ
- モバイルファーストでTailwindブレークポイントを使用（`sm:`, `md:`, `lg:`）
- テーブルなど横幅が必要な要素は `overflow-x: auto` でスクロール対応

## アイコン
- `lucide-react` を統一使用
- サイズは用途に合わせる（フッター: `h-3 w-3`、ボタン内: `h-4 w-4`、空状態: `h-12 w-12`）
- `Button` コンポーネント内の svg は基底の `[&_svg:not([class*='size-'])]:size-4` により 16px に強制される。16px 以外にしたい場合は `h-5 w-5` ではなく **`size-5` / `size-6` クラス**を使う（`h-*` 指定は上記セレクタに拾われず死にクラスになる）

### Minecraft アイテムアイコン
- **`ItemIcon`（`app/components/item-icon.tsx`）を使う**。`@bafv4/mcitems` の `MinecraftItemIcon` を直接呼ばない
- ラッパー側でテクスチャ配信元（`TEXTURE_BASE_URL = "/mcitems"`）・`pixelated` クラス・読み込み中の円形プログレスを既定化している
  （`loadLang()` に渡すベースURLも同モジュールの `TEXTURE_BASE_URL` を import する）
- 読み込み中のプレースホルダは `size` と同じ外枠を保つため、画像に切り替わってもレイアウトがずれない

## カード全体をクリック可能にする（オーバーレイリンク）

カード内にボタン（いいね等）を置く場合、カード全体を `<a>` で包むと不正なHTMLになるため、
`absolute inset-0 z-0` のリンク／ボタンを敷いてカード全体のクリックを受ける。構成は
`pace-feed-card.tsx` と `guide-list-views.tsx` が基準。

- 外枠を `group relative` にし、**ホバー時の `transform`（`-translate-y-*` / `scale-*`）は必ずこの外枠に置く**
  - 兄弟要素（`Card` 等）に transform を置くと、その要素が**重ね合わせコンテキストを作って
    オーバーレイリンクより手前に描画され**、カードのクリックが届かなくなる。
    ホバーしないと transform が効かない＝ホバーしてからクリックする実際の操作では常に死ぬため、
    静止状態の見た目やスナップショットでは気づけない
  - `shadow` / `border` / `background` のホバー変化は重ね合わせコンテキストを作らないので、`Card` 側でよい
- カード内の操作要素（`LikeButton` など）は `relative z-10` でオーバーレイより手前に出す
- 変更したら**実際にホバーしてからクリック**して遷移を確認する

## 空状態
- ページ・セクションの空状態は共有コンポーネント `EmptyState`（`app/components/empty-state.tsx`、props: `icon` / `title` / `description` / `action?`）を使う。破線ボーダー + アイコン `h-12 w-12` + タイトル + 説明（+ 任意の導線）のカード型
- 独自の空状態マークアップを新規に書かない

## 公開一覧ページのヘッダ
- フィード/データ系の公開一覧ページ（`/paces` `/videos` `/rankings` `/stats`）のページヘッダは「丸背景アイコンチップ（`rounded-xl bg-primary/10 p-2` + アイコン）+ `h1`（`text-2xl font-bold`）+ 件数バッジ」の構造
- 英大文字の eyebrow ラベルは既存ページ（ホーム・`/paces`・`/videos`）のみ。新規ページに新設しない
- ページタイトル `h1` のサイト標準は `text-2xl font-bold`（ホームの hero とガイド記事タイトルは例外）

## ダイアログ・モーダル
- shadcn/ui の `Dialog` コンポーネントを使用
- 構造: `DialogHeader` → `DialogTitle` → コンテンツ → `DialogFooter`（キャンセル + アクションボタン）

## トースト通知
- `sonner` ライブラリ経由: `toast.success()`, `toast.error()`
- メッセージは翻訳キーを使用

## タブ
`app/components/ui/tabs.tsx` はフォルダ型（一体カード）デザイン。タブ列とコンテンツ全体が 1 枚のカードに収まり、その中でアクティブタブがコンテンツ面と一続きに見える。**1px 単位の重なりで成立している**ため、下の不変条件を破ると崩れる。

> タブUI そのものを改修する・見た目を変える・カード化を打ち消す・崩れを直す場合は、
> 内部構造（帯／ベースライン／連結／横スクロール機構）をまとめた **`ui-tabs` スキル**を読む。

### 消費側の不変条件
1. `TabsList` と `TabsContent` の間に `gap-*` / `space-y-*` を入れない（1px の重なりが壊れ、タブとパネルの間に線が見える）
2. `TabsContent` に display ユーティリティ（`block` / `flex` / `grid` 等）を足さない（非アクティブパネルの `hidden` 属性が無効化され同時表示される）
3. `TabsTrigger` に外側リング・`shadow`・`-mb-px` を足さない（TabsList のスクロールコンテナにクリップされる）
4. `TabsList` を別のスクロールコンテナ（`overflow-x-auto` の div 等）で包まない（基底が対応済み。包むと 1px 重なりがクリップされる）
5. `dark:` バリアント禁止 — テーマトークン（`bg-card` / `border` / `bg-brand` / `ring-ring`）のみで 3 テーマ（light / dark / ultra-dark）に対応する
6. Dialog 内など枠付きパネルが過剰な場面では、`TabsContent` に `rounded-none border-0 border-t bg-transparent p-0 pt-4`、`TabsTrigger` に `data-[state=active]:bg-background` を付けるデグレード構成を使う
