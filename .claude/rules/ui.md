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
- ページ内の大型パネル（ホームのヒーロー・おかえりバー・注目の走者、走者画面の身元帯）: `rounded-2xl`（18px）。欄そのものは箱にしない（下記「欄枠」）
- `rounded-3xl` 以上はコンテナには使わない（装飾要素は除く）
- ネスト規則: `rounded-xl` カードの内側にネストするボックス（ドロップゾーン・プレースホルダ等）は1段下げて `rounded-lg`、さらに内側のチップは `rounded` でよい

## カードシステム
カードは用途に応じて次の3レシピのいずれかに従う。

- **インタラクティブカード**（遷移先のある一覧アイテム。走者/ペース/動画/ガイドカード）: `rounded-xl border border-border/70 bg-background/80`。ホバーは外側ラッパーに `-translate-y-0.5` ＋ `border-primary/40` ＋ `shadow-md`。カード全面クリックは上記「カード全体をクリック可能にする（オーバーレイリンク）」の構成に従う
- **静的セクションカード**（情報グルーピング）: shadcn Card を `<Card className="gap-3 py-5">` ＋ `CardHeader`/`CardContent className="px-5"` で使う（外側余白 20px。カード面が大きいため 16px では窮屈になる）。**現行 `card.tsx` 基底は gap 方式のため、旧 API 前提の `pt-0` / `pb-3` / `py-2` は無効または逆効果（禁止）**
- **リスト行**: `divide-y` 区切り＋`hover:bg-muted/50`（行がリンクの場合のみ。クリック不能な行にホバー背景を付けない）。この `divide-y` は既定濃度のままでよい（「カード内区切り `/60`」を適用しない）。`/60` は見出し・サブセクション境界などの `border-t`/`border-b` に適用するもので、両者は矛盾しない
- **編集用高密度ブロック**（サーチクラフトの `SearchCraftTimingBoard` のような、多数のブロックを常設する編集ボード）: 静的セクションカードの代わりに `rounded-xl border border-border/70 bg-background/80`＋ヘッダ帯 `px-4 py-2.5`（`border-b border-border/60`）＋中身 `px-4 py-3` の高密度ブロックを使ってよい。ブロック見出しは `text-sm font-semibold`（CardTitle の `text-base` より1段小さい）
- **欄枠（セクション区切り）**（`PageSection`、`app/components/page-section.tsx`。ホームと走者画面 `/player/:slug` で共有）: 箱なしの1種類（上罫線 `border-t border-foreground/15 pt-6`、見出し h2＝`text-xl font-bold`。アイコンは任意で、付けるときは呼び出し側の色のまま見出しの左に置く。丸背景チップは使わない）。欄の中の小見出しは h3 として1段下げる（`text-base` 程度）。区切り線は `/15` で、`--border`（`/60`〜`/70`）より濃くして欄の切れ目を見せる
  - 欄はパネルやカードで包まない。箱（カード）として残すのは**1件ずつの物**（記録のカテゴリ別カード・動画の埋め込み・ガイドカードなど）だけ。仮想キーボードやアイテム配置のような表示物も、箱に入れず欄の中に直接置く
  - 大型パネル（`rounded-2xl border border-border/70 bg-card/70` 系）は、ホームのヒーロー（未ログイン）・おかえりバー・注目の走者（ワイド）と、走者画面の身元帯（全タブ共通の名前・操作ボタン・ハイライトの帯）だけ
  - ページ幅のパネルはホバーで浮かせない（`-translate-y` と影は一覧アイテムのインタラクティブカード向け。パネルのホバーは枠色だけ）
  - 走者画面は 2026-11 のリデザインで全タブが欄区切りに移行済み。他画面と共用する部品（`player-stats-cards.tsx`・`search-craft-template-view.tsx`・`ItemHotbar`・`SearchCraftGroupedList`・`VirtualKeyboard` 等）は、箱を外す表示を props（`framed` / `collapsible` / `section` 等）で有効にし、他画面の見た目は変えない（既定は従来のまま）
  - 欄どうしの間隔は `space-y-7 sm:space-y-8`（ホーム・走者画面の全タブ共通）。欄の `h2` はアイコンなしでもよい。欄の中の小見出しは `h3`。欄が1つだけのタブ（走者画面のガイド・サーチクラフト）は、欄見出しを `sr-only` の `h3` で置いて見出しの飛びを作らず、その下のカード名・グループ名を `h4`（見た目は変えない）にする
  - 箱なしの欄に置く `HorizontalScrollArea` は `surface="background"`（端のフェードを `from-background` にする。既定はカード内の `from-card`）
- **ホームのカード面**: ページ背景に直接置くホームのカード（ライブ欄のカードなど）の面は不透明の `bg-card`。`bg-background/80` だと dark / ultra-dark でページ背景と同じ色になり外枠だけで同化する（light は両者とも白だが、不透明にすると背景の格子模様が隠れて面として読める）。ホームでは動画カード・Twitchライブの一覧・プロフィール一覧も `bg-card`、他ページと共有するガイドカードは `GuideCardGrid` の `surface="card"` で同じ面にする。他ページ（`/guides`・`/paces` 等）の一覧カードは従来の `bg-background/80` のまま

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
実装は `app/components/search-craft-badges.tsx`（葉モジュール。`KeyBadge` / `ShiftKeyGroup` / `ControlKeyBadgeView` / `ControlKeyBadge` / `CraftMarker` / `renderVisibleSpaces` 等）に集約している。既存 import 元を保つ re-export が残っているのは `search-craft-template-view.tsx`（`SearchStringText` / `KeyBadge` / `ShiftKeyGroup`）と `search-craft-loop-view.tsx`（`ControlKeyBadge`）のみで、`renderVisibleSpaces` 等の他は本モジュールから直接 import する。依存は `ui/tooltip`・`shift-mark`・`item-icon`・`virtual-keyboard`（`getFingerKeyStyle`）・`lib/keybindings`・`lib/remap-utils` のみで、表示ビュー2ファイル（`search-craft-template-view.tsx`/`search-craft-loop-view.tsx`）にもキー入力順ダイアログ（`search-craft-key-sequence-dialog.tsx`）にも依存しないため、いずれから import しても循環importにならない。見た目を変える場合はこのファイルだけを直せばよい。

- 基本形: `inline-flex items-center justify-center rounded border-2 font-mono font-semibold text-sm min-w-7 h-7 px-1.5`
- トーン:
  - 通常キー: `bg-secondary/50 border-border/50 text-muted-foreground`（指割り当てがあれば指色）
  - リマップ済み: `ring-2 ring-primary ring-offset-1 ring-offset-background`
  - Shift 同時押し（`needsShift`＝非 shiftHeld 時の単発大文字の逆引き）: 個別 `KeyBadge` 自体に `border-warning/50 bg-warning/10` を付ける（変更なし）。一方 `shiftHeld`（行全体で Shift を押しっぱなし＝「Shiftを押しながら」バリエーション）は、キー列の先頭に独立バッジを置くのではなく `ShiftKeyGroup` で実入力キー列全体を1つの枠（`rounded-lg border-2 border-warning/50 bg-warning/10 px-2 py-1.5`。ネスト規則どおり内側の `rounded` チップの1段上。余白はリマップリングの外側はみ出し〈約3px〉が枠に触れない値）で囲み、先頭にコンパクトな「⇧」マークのみ（`text-warning`、可視の "Shift" テキストは置かない。`ShiftMark` 内部の sr-only と Tooltip=`playerProfile.withShiftTooltip` が意味を補う）を置く
  - 制御キー（BS/←/Home/⇧Home）: `rounded-full border-info/50 bg-info/10 text-info px-2.5`（文字入力キーの角丸 `rounded` と一目で区別するためのピル形状）。**リマップ考慮時（`remaps` を渡し、逆引きでリマップが見つかった場合のみ）**は「実キー主表記＋操作ラベルのミニチップ」の複合ピルにする — **主ラベル＝実際に押すキー**（既存の単一ピルと同じ `text-sm`、外側の見た目はそのまま）、その中に「チップの中のチップ」として**出力操作**（`BS` 等）を小さめの丸チップ（`rounded-full border border-info/40 bg-info/15 px-1.5 py-0.5 text-[10px]`）で添える。ピル全体にリマップ用リング（`ring-2 ring-primary ring-offset-1 ring-offset-background`）を付ける。リマップが無い（大多数）場合は非リマップ時と1px も変わらない単一ピルのまま
  - 無効: `border-destructive/50 bg-destructive/10 text-destructive`
- クラフト実行マーカー: 通常のアイテムチップと同じ見た目の `h-7 rounded bg-secondary/50 px-2`（`ItemIcon` 24px＋文字列。同じサーチ文字列で複数アイテムが出せるクラフトは最初の1件だけでなく全アイテムのアイコンを並べる〈チップは横に伸びる〉。Hammer 等の専用アイコン・破線ボーダーは付けない。「ここでクラフト実行」の説明は Tooltip と凡例が担う）。キー操作列ではキー系バッジと高さ h-7 を揃え、セグメント（制御キー・打鍵キー・チップ）間は `gap-2`、キー同士は `gap-1`
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
- 枠線 `--border` と背景の格子模様 `--page-grid-line`（`.page-bg-pattern`）は別トークン。枠線はカードを背景から区切れる濃さ（light は slate-200 と 300 の間、dark 白14%、ultra-dark 白12%）、格子模様は背景として控えめな濃さ（light slate-200、dark 白10%、ultra-dark 白8%）。枠線を調整するときに背景まで濃くならないよう、格子模様に `--border` を使わない
- ドメイン固有: `--key-movement`, `--key-combat` 等（キーカテゴリ色）、`--finger-*`（指割り当て色）、`--discord`、`--favorite`（お気に入りのハート色。`favorite-button` / `favorites` ページで使用）、`--youtube` / `--twitch` / `--gold` / `--bronze`
- 区間モチーフ（進行バー `StageBar`・ホームのライブの区間分布の帯）: 現在区間／人数ありは `bg-brand`、到達済みは `bg-brand/40`、未到達は `bg-muted`。区間の分布の帯は人が居なくても7段を描く（0人の段は `bg-muted`・人数なし）。終了カード（ライブ欄で消えて少しの間残すもの）の進行バーは現在区間も `bg-brand/40`（強調なし）
- コンポーネント内では `bg-primary`, `text-muted-foreground` 等のTailwindクラスで参照
- 意味を持つ色（成功・警告・情報・エラー/破壊的）は必ずセマンティックトークン（`text-success` / `text-warning` / `text-info` / `text-destructive` と各 `bg-*/10` 等）を使う。`green-500` などのパレット直指定・生 hex は禁止
- セマンティックトークンは `text-*` としても使うため、各テーマの値は背景（ライト=白系、ダーク=暗色）に対して文字コントラスト 4.5:1 以上を保つ（例: ライトの `--warning` は黄色ではなく amber-700 相当）。トークン値を変えるときは全テーマで測る
- ブランド色（`--youtube` / `--twitch`）はダーク側が明るいため、白文字を載せる面には使わない。サムネイル上のバッジは `bg-black/70 text-white` の暗色ピルにしてブランド色はアイコンに置く
- `dark:` バリアントは使わない。3テーマ（light / dark / ultra-dark）はトークン側で吸収する（タブ節の既存方針の一般化）
- inline style で色を書く場合もトークンをそのまま参照する（例: `var(--muted)`）。`hsl(var(--token))` で包むのは oklch 定義のため無効色になるので禁止

## フォント
- 本文: `Zen Kaku Gothic New`（sans-serif）
- コード: `JetBrains Mono`, `Fira Code`（monospace）
- いずれもセルフホスト（`@fontsource/*` を `app/app.css` で import。OGP 用 TTF は `public/fonts/`）。
  **Google Fonts 等の外部配信は使わない**（プライバシーポリシーの外部送信記載と連動するため、
  外部フォント配信を追加する場合はポリシー改定が必要）
- `truncate` / `line-clamp-*`（overflow:hidden）の要素に `leading-none` を付けない。Zen Kaku Gothic New は
  ディセンダーが深く、行間が約1.4em未満だと g / y / p / 括弧の下端が切れる（例: `text-base leading-none` で約2px）。
  詰めたい場合も `leading-snug` 以上にする（`text-xs` 既定の 16px は実害なし）

## レスポンシブ
- モバイルファーストでTailwindブレークポイントを使用（`sm:`, `md:`, `lg:`）
- テーブルなど横幅が必要な要素は `overflow-x: auto` でスクロール対応

## アイコン
- `lucide-react` を統一使用
- ブランドアイコン（YouTube / Twitch / X〔旧 Twitter〕/ GitHub）は lucide-react 1.x で削除されたため、`app/components/brand-icons.tsx`（`@icons-pack/react-simple-icons` のラッパー。`currentColor`・`aria-hidden`・空 `<title>` 既定、`className` の `h-* w-*` でサイズ指定）から import する。`Twitter` は X のロゴを描画する。新しいブランドアイコンが必要なときもこのファイルに追加する
- サイズは用途に合わせる（フッター: `h-3 w-3`、ボタン内: `h-4 w-4`、空状態: `h-12 w-12`）
- `Button` コンポーネント内の svg は基底の `[&_svg:not([class*='size-'])]:size-4` により 16px に強制される。16px 以外にしたい場合は `h-5 w-5` ではなく **`size-5` / `size-6` クラス**を使う（`h-*` 指定は上記セレクタに拾われず死にクラスになる）

### Minecraft アイテムアイコン
- **`ItemIcon`（`app/components/item-icon.tsx`）を使う**。`@bafv4/mcitems` の `MinecraftItemIcon` を直接呼ばない
- ラッパー側でテクスチャ配信元（`TEXTURE_BASE_URL = "/mcitems"`）・`pixelated` クラス・読み込み中の円形プログレスを既定化している
  （`loadLang()` に渡すベースURLも同モジュールの `TEXTURE_BASE_URL` を import する）
- 読み込み中のプレースホルダは `size` と同じ外枠を保つため、画像に切り替わってもレイアウトがずれない
- **例外**: `app/components/paceman-split-mark.tsx`（PaceMan 区間アイコン、固定8種）は `ItemIcon` を使わず、静的 `<img>` で `/mcitems/1.16.1/items/minecraft_*.png` を直接参照する。`ItemIcon` が引き込むアイテム名辞書チャンク（約162KB）をホーム・`/paces` の初期表示から外すため。読み込み中スピナーと取得失敗時フォールバックは無い

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
- ページ・セクションの空状態は共有コンポーネント `EmptyState`（`app/components/empty-state.tsx`、props: `icon` / `title` / `description` / `action?` / `size?`）を使う。既定は破線ボーダー + アイコン `h-12 w-12` + タイトル + 説明（+ 任意の導線）のカード型
- 0件が日常的に起こる欄（ホームの動画欄など、ほかの欄と縦に並ぶ中の1欄）は `size="compact"`（破線枠のまま1〜2行の横並び、アイコンは `h-5 w-5` を渡す）にして、空の面で縦を使い切らない。ページ全体が空のときは既定のまま
- 独自の空状態マークアップを新規に書かない

## 公開一覧ページのヘッダ
- フィード/データ系の公開一覧ページ（`/paces` `/videos` `/rankings` `/stats`）のページヘッダは「丸背景アイコンチップ（`rounded-xl bg-primary/10 p-2` + アイコン）+ `h1`（`text-2xl font-bold`）+ 件数バッジ」の構造
- 英大文字の eyebrow ラベルは既存ページ（ホーム・`/paces`・`/videos`）のみ。新規ページに新設しない
- ページタイトル `h1` のサイト標準は `text-2xl font-bold`（ホームの hero とガイド記事タイトルは例外）

## ダイアログ・モーダル
- shadcn/ui の `Dialog` コンポーネントを使用
- `DialogContent` 基底は `max-h-[calc(100dvh-2rem)] overflow-y-auto` を持つ（低い画面でも内部スクロールで閉じるボタン/フッターに届く）。内側で独自にスクロールさせたい場合のみ消費側で `max-h-*`/`overflow-hidden` を上書きする
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

### 例外: プロフィールのホットバー型タブ
`/player/:slug` のタブは、フォルダ型ではなく**ホットバー型**（`app/components/profile-hotbar-tabs.tsx`）。上の不変条件はこのタブには当てはまらない。

- `ui/tabs.tsx` は変えない。Radix の `TabsPrimitive.List` / `Trigger` を直接使い、消費側の Root は `ui/tabs` の `<Tabs>` に `activationMode="manual"`（矢印はフォーカス移動のみ、Enter/Space で切替）を付ける。タブ切替は履歴に積むので、矢印で動くたびに履歴が増えないようにするため
- 選択中の見た目は **`aria-selected:` で判定する**（`data-[state=active]` は使わない）。ツールチップ付きのスロットは `TooltipTrigger asChild` が `data-state` を `closed` / `delayed-open` で上書きするため、`data-[state=active]` が効かない
- 数字キー 1〜9 のショートカットは tablist にフォーカスがあるときだけ効かせ、修飾キー併用は無視する（ページ全体のキー監視はしない。WCAG 2.1.4）。キーとタブの対応は純粋関数 `hotbarTabForKey`（`app/lib/profile-hotbar.ts`）
- アクセシブルネームは見えている短いラベルを含める（label in name、WCAG 2.5.3）。空スロットは破線で描き、押せる状態のまま、名前に「、未登録」を付ける
- md 未満は画面下端に固定する（下記「下端の固定 UI」）

## 下端の固定 UI（`--bottom-dock-height`）
ページが `[data-bottom-dock]` を持つ要素（現在はプロフィールのホットバー）を描くと、`app/app.css` の `:root:has([data-bottom-dock])` が **md 未満で** `--bottom-dock-height`（`4.75rem + env(safe-area-inset-bottom)`）を解決し、body に同じ高さの `padding-bottom` を付けて末尾がドックに隠れないようにする。ドックの無いページ・md 以上では `0px`。

- 下端に固定する他の UI（クッキーバナー `cookie-consent.tsx`・トップへ戻る `back-to-top-button.tsx` など）は、`bottom-[calc(<元の値>+var(--bottom-dock-height,0px))]` のようにドックの高さぶんずらす。フォールバック `0px` を必ず付ける
- 新しく下端固定の UI を足すときも同じ。ドックを持つページを足すときは、コンテナに `data-bottom-dock` を付け、高さは `--bottom-dock-height` を参照する
