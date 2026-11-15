# UIデザイン規約

**正とする実装**: ホーム（`app/routes/home.tsx` ＋ `app/components/home/*`）と走者画面（`app/routes/player/profile.tsx`）。
迷ったらこの2画面の書き方に合わせる。クラス文字列の正は**部品のソース**で、この規約は「どの部品を・どう使うか」と、
部品になっていない数値（透明度・角丸・タップ領域など）だけを書く。部品の見た目を変えたいときは部品側を直す。

## 1. 原則

### クリーンに
- **面を増やさない。** ページは「欄」（4 章）で区切り、欄そのものは箱にしない。箱（カード）にするのは
  **1件ずつの物**（走者・ペース・動画・ガイド・記録のカテゴリなど）だけ
- 飾りのための面・影・グラデーション・アイコンチップを足さない。差を付けたいときは、まず余白・見出しの大きさ・文字色で付ける
- 新しい種類の面を作らない。面はこの規約に挙げた物（大型パネル・カード・タイル・編集用の高密度ブロック）から選ぶ

### Minefolio／Minecraft らしさは「データ由来の物」で出す
らしさは、**実データを表す部品**を正しく使うことで出す。データの無い場所に Minecraft の飾りを置かない。

| データ | 部品（所在） |
|---|---|
| 走者（人） | `MinecraftAvatar`（`minecraft-avatar.tsx`、スキンの顔をピクセルのまま）／全身は `MinecraftFullBody`（`minecraft-fullbody.tsx`） |
| アイテム | `ItemIcon`（`item-icon.tsx`）。7 章「Minecraft アイテムアイコン」 |
| ホットバー | `ItemHotbar`（`item-hotbar.tsx`） |
| 区間・進行 | `PaceManSplitMark`（`paceman-split-mark.tsx`）／`StageBar`（`pace-stage-bar.tsx`） |
| キー・指 | `KeyBadge` 系（`search-craft-badges.tsx`）／kbd チップ／`VirtualKeyboard`（`virtual-keyboard.tsx`、指色 `--finger-*`） |
| 時間 | `font-mono tabular-nums`。大きな等幅数字はランのタイム（IGT・PB）だけに使う |
| ランク | 鉱石の段階トークン `--rank-*`（`app/app.css`） |
| 言葉 | 「走者」「区間」「ペース」「IGT」。プロフィールの持ち主（走者）を指すときに「ユーザー」と書かない（アカウント・規約の文脈は別） |

- **禁止**: 飾りのピクセル枠、ブロック模様・テクスチャ背景、Minecraft 風フォント、データと関係のないアイテムアイコンの散らし
- 背景の格子模様（`.page-bg-pattern`）はサイト全体で1つだけ。ページごとに背景の飾りを足さない

### 色の役割
- **brand（緑）＝選択中・現在地・進行**: `StageBar` の現在区間、選択中のタブ（タブ上端の線）、
  既定の `Button`（`variant="default"`）、ヘッダーの現在ページ。これ以外に brand を使わない
  - 例外: プロフィールのホットバーの選択中スロットは、Minecraft のホットバーの選択枠に合わせて前景色の枠（`aria-selected:border-foreground`）
- **primary ＝リンク・導線**: テキストリンク、欄見出しのアイコン、カードのホバー枠（`border-primary/40`）
  - 例外: サーチクラフトテンプレートの**ゲーム言語**のアイコン（`Languages`、テンプレート一覧の行・詳細）は primary。テンプレートで最も重要なメタ情報（サーチ文字列がゲーム言語のアイテム名に依存する）なので、ほかのメタ情報と区別して目立たせる。ほかのメタ情報のアイコンに広げない
- **意味色**: 成功・警告・情報・エラーは `--success` / `--warning` / `--info` / `--destructive`（3 章）
- 強調色を増やさない。新しく目立たせたい物は、brand と primary のどちらの役割かで色を決める

## 2. 部品の選び方
- UI 部品は **shadcn/ui** を第一候補にする。導入済みは `app/components/ui/`。新しく要るときは
  `npx shadcn add <component>` で入るか先に確かめる（shadcn MCP があればそれで探す）。無いときだけ自作する
- shadcn の設定: スタイル `new-york`／ベースカラー `slate`／アイコン `lucide-react`／CSS 変数あり／RSC なし（SSR）
- ドメイン部品（1 章の表・8 章の状態部品）があるものは、それを使う。同じ見た目をその場で書き直さない
  （例外: ホームの `home/featured-runner-card.tsx` のキーチップは、アイテム名辞書のチャンクを初期表示から外すための意図的な複製）

## 3. スタイリング・テーマ・色

### スタイリング
- **Tailwind CSS 4** のクラスを直接書く。条件付きクラスだけ `cn()`（`@/lib/utils`）
- カスタム CSS は `app/app.css` にまとめる。色は CSS 変数（`--primary` / `--muted` 等）で管理する

### テーマ
- `light` / `dark`（Slate）/ `ultra-dark`（Zinc、より深い黒）の3つ。`.dark` / `.ultra-dark` のクラスで切り替え、
  `@custom-variant dark` は両方に効く
- `next-themes`（`themes={["light","dark","ultra-dark"]}`）で管理し、選択は localStorage（key: `theme`）に保存する。`system` のダークは通常ダーク
- 切替 UI は `app/components/layout/theme-toggle.tsx` の `THEME_OPTIONS`（デスクトップのドロップダウンとモバイルのセグメントで共有）
- **`dark:` バリアントは使わない。** 3テーマの差はトークン側で吸収する

### 色トークン
- テーマ色は **oklch** で CSS 変数に定義する
- 意味色は必ずトークン（`text-success` / `text-warning` / `text-info` / `text-destructive`、面は各 `bg-*/10`、枠は `border-*/30`〜`/50`）。
  `green-500` のようなパレット直指定・生 hex は禁止
- 意味色は文字色にも使うので、全テーマで背景に対して 4.5:1 以上を保つ（例: ライトの `--warning` は amber-700 相当）。値を変えるときは全テーマで測る
- 枠線 `--border` と背景の格子 `--page-grid-line` は別トークン。格子に `--border` を使わない（枠線を濃くすると背景まで濃くなる）
- ドメイン色: キーカテゴリ `--key-*`、指 `--finger-*`、ランク `--rank-*`、`--discord`、`--favorite`（お気に入りのハート）、
  `--youtube` / `--twitch` / `--gold` / `--bronze`
- ブランド色（`--youtube` / `--twitch`）はダークで明るいので、白文字を載せる面に使わない。サムネイル上は `bg-black/70 text-white` のピルにして、ブランド色はアイコンに置く
- inline style で色を書くときもトークンをそのまま参照する（`var(--muted)`）。oklch 定義なので `hsl(var(--token))` で包まない（無効な色になる）

## 4. ページの骨格と欄

### 欄枠（PageSection）
- **欄区切りを全画面の標準にする**（公開ページも編集・設定画面も）。部品は `PageSection`（`app/components/page-section.tsx`）
  - 箱なし。欄の上に `border-t border-foreground/15 pt-6` の罫線を引き、見出しは h2（`text-xl font-bold`）
  - 罫線の `/15` は `--border`（`/60`〜`/70`）より濃くして、欄の切れ目を見せるため
  - 先頭の欄など罫線を消すときは `first` か `className` で外す。見出しは `tabIndex=-1`（フォーカスの戻り先になる）
  - 見出しの右のリンクは `SectionHeaderLink`。見出しのアイコンは任意で、付けるなら呼び出し側の色で左に置く（丸背景のチップにしない）
- 欄どうしの間隔は `space-y-7 sm:space-y-8`
- **中身が無い欄は出さない**（空であることを見せる意味がある欄だけ、8 章の空状態を置く）
- 欄の中に置く表示物（仮想キーボード・アイテム配置・グラフなど）は、箱に入れず直接置く
- 箱なしの欄に置く `HorizontalScrollArea` は `surface="background"`（端のフェードを背景色にする。既定はカード内向け）
- 既存のカード型の画面（`/me/*` の編集画面など）は、**触るときに欄区切りへ移す**。一度に全部は変えない
- 他画面と共用する部品（`player-stats-cards.tsx`・`search-craft-template-view.tsx`・`ItemHotbar`・`SearchCraftGroupedList`・
  `VirtualKeyboard` 等）は、箱を外す表示を props（`framed` / `collapsible` / `section` 等）で選べるようにし、既定は従来の見た目のまま残す

### 大型パネル
- **ページの顔になる帯**にだけ使う: ホームのヒーロー（未ログイン）・おかえりバー・注目の走者、走者画面の身元帯
- `rounded-2xl border border-border/70 bg-card/70`。ヒーローは不透明の `bg-card` でよい
- ホバーで浮かせない（変えるなら枠色だけ）。新しい画面に大型パネルを足すのは、その画面に「顔」が要るときだけ

### 2列の並び
- 2列にするブレークポイントは**中身の幅で決める**（走者画面: デバイス `md`、プレイスタイル `lg`、アイテム `xl`）。
  2列目の1行目の欄は、`PageSection` の `className` で上罫線を外して1列目と揃える

### タブのあるページ（走者画面）
- タブの中身の先頭にタブ名の h2（`ProfileTabTitle`、`profile.tsx`）を置く
- パネルは `PANEL_CLASS`（`profile.tsx`）。タブ名の直後の欄の上罫線を自動で外す

### カードが残る場面
- **1件ずつの物の静的カード**: shadcn `Card` を `<Card className="gap-3 py-5">` ＋ `CardHeader` / `CardContent className="px-5"` で使う
  - 基底の `card.tsx` は gap 方式なので、旧 API 前提の `pt-0` / `pb-3` / `py-2` は効かないか逆効果になる（禁止）
- **編集用の高密度ブロック**（`SearchCraftTimingBoard` のように、多数のブロックを常に並べる編集ボード）:
  `rounded-xl border border-border/70 bg-background/80`、ヘッダ帯 `px-4 py-2.5 border-b border-border/60`、中身 `px-4 py-3`、ブロック見出し `text-sm font-semibold`

## 5. 見出しと文字

### 見出しの段
| 段 | タブのないページ（ホーム等） | 走者画面 |
|---|---|---|
| h1 | ページ名（`text-2xl font-bold`。ログイン中のホームは `sr-only`） | 走者名（`text-2xl md:text-3xl break-words`、身元帯） |
| h2 | 欄見出し（`PageSection`、`text-xl`） | タブ名（`ProfileTabTitle`、`text-xl md:text-2xl`） |
| h3 | 欄の中の小見出し | 欄見出し（`PageSection headingLevel="h3"`、`text-lg`） |
| h4 | — | 欄の中のカード名・グループ名（`text-base font-semibold`） |

- 欄の中の**ラベルのような小見出し**（ホームのライブ欄の区分など）は `text-sm font-medium text-muted-foreground`。内容のまとまりの名前（グループ名）は h4 の側
- 欄が1つだけのタブ（走者画面のガイド・サーチクラフト）は、欄見出しを `sr-only` の h3 にして段を飛ばさない
- 見た目の大きさのために見出しの段を飛ばさない。大きさはクラスで調整する
- `h1` のサイト標準は `text-2xl font-bold`（ホームのヒーローとガイド記事のタイトルは例外）

### 文字の大きさ
- 本文 `text-sm`、メタ情報 `text-xs`、マイクロテキストは2値（バッジの肩・印 `text-[10px]`、凡例のラベル `text-[11px]`）
- カードのタイトルは `text-base font-semibold`、リスト行のタイトルは `text-sm font-medium`。
  サムネイルが主役のメディアカード（動画）は、長いタイトルを2行に収めるため `text-sm font-semibold line-clamp-2`

### フォント
- 本文 `Zen Kaku Gothic New`、コード `JetBrains Mono` / `Fira Code`。どちらも `@fontsource/*` を `app/app.css` で読むセルフホスト
  （OGP 用の TTF は `public/fonts/`）。**Google Fonts 等の外部配信は使わない**（プライバシーポリシーの外部送信の記載と連動するため。足すならポリシー改定が要る）
- `truncate` / `line-clamp-*` の要素に `leading-none` / `leading-tight` を付けない。このフォントはディセンダーが深く、
  行間が約1.4em未満だと g / y / p / 括弧の下端が切れる。詰めたいときは `leading-snug` 以上にして、余白は負のマージンで詰める
- 等幅は時間・キー・コードに使う。部品の中で等幅をやめたい箇所は、`plain` 等の props で切り替える

## 6. 面・角丸・枠

### 角丸（2層）
- カード・アイテム・ボックス: `rounded-xl`（14px）
- 大型パネル: `rounded-2xl`（18px）。`rounded-3xl` 以上はコンテナに使わない（飾りの要素は除く）
- 入れ子は1段ずつ下げる: `rounded-xl` の中のボックス（ドロップゾーン・プレースホルダ等）は `rounded-lg`、その中のチップは `rounded`
- アバターは大きさで決める: 96 / 64 / 44px は `rounded-xl`、36 / 32px は `rounded-lg`、20px は `rounded-md`

### 透明度
| 用途 | 値 |
|---|---|
| カードの外枠 | `border-border/70` |
| カード内の区切り・見出しの境界 | `/60`（`border-t` / `border-b`。リスト行の `divide-border/60` も同じ） |
| 欄の区切り | `border-foreground/15` |
| 意味色の面 | `/10`（枠は `/30`〜`/50`）。`text-[10px]` の小さな文字を載せる制御キーのピル（`ControlKeyBadge`）は、dark の card 上で 4.5:1 を保つため `bg-info/8` |
| `bg-secondary` | タイル・面 `/50`、kbd チップ `/80`、リンク行 `/30`（hover `/60`） |

### カードの面
- 欄の中にページ背景へ直接並べる**一覧カード**（ホームのライブ・動画・プロフィール一覧など）は不透明の **`bg-card`**（`bg-background/80` だと dark / ultra-dark で背景と同じ色になり、枠線だけで同化する）。編集用の高密度ブロックは 4 章のとおり `bg-background/80`
- 大型パネルの中に置くカードと、一覧ページ（`/guides`・`/paces` 等）の既存のカードは `bg-background/80`。共有部品は `surface` 等の props で面を選ぶ（例: `GuideCardGrid surface="card"`）
- 箱にしない1件ずつのタイル（欄の中の小さなまとまり）は `rounded-xl bg-secondary/50 p-3`（枠なし）

### ホバー
- **遷移先のある一覧カード**（走者・ペース・動画・ガイド）: 外側のラッパーで `-translate-y-0.5`、カードで `border-primary/40` ＋ `shadow-md`。
  動きには `motion-reduce:` の打ち消しを付ける
- パネル・タイル・ハイライトなど、ページ側の面は浮かせない。ホバーで変えるのは枠色（`border-primary/40`）と面（`bg-muted/50`）まで
- クリックできない物にホバーの見た目を付けない

### リスト行
- `divide-y divide-border/60` で区切り、行がリンクのときだけ `hover:bg-muted/50`
- 走者のリスト行は高さ `h-14`、アバター 32px

### グリッドカードの中身の順
1. メディア帯／ヘッダー行
2. タイトル＋説明（`text-xs` muted）
3. タグ行（Badge secondary、`rounded-full px-2 py-0.5 text-[11px]`、最大3個）
4. フッターのメタ行（`mt-3 border-t border-border/60 pt-3`、`text-xs text-muted-foreground`）。左に著者・件数、右端（`ml-auto shrink-0`）に時刻

- フッターは折り返しに耐えさせる（`flex-wrap`＋`ml-auto`＋`shrink-0`＋`min-w-0`）
- カードを `flex flex-col` にし、フッターの直前に `<div className="flex-1" />` を置いて、兄弟カードどうしで区切り線の高さを揃える
- 項目は中身に合わせて省いてよい（動画カードは時刻なし、等）。順番は変えない

### グリッドの段
- 4件のグリッドは `grid-cols-1 sm:grid-cols-2 xl:grid-cols-4`（中間の幅で3＋1の孤立を作らない）
- 3列は `md:grid-cols-3` から（走者画面の記録は `md:grid-cols-2 lg:grid-cols-3`）
- モバイルで横に流すときは、`HorizontalScrollArea` か、スナップするレール
  （`-mx-2 -mt-2 flex snap-x snap-mandatory scroll-px-2 gap-4 overflow-x-auto px-2 pt-2 pb-3`、各要素 `w-[83%] shrink-0 snap-start`）

### 丸ピル
`inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background/75 px-2.5 py-1 text-xs text-muted-foreground`（件数・状態のピル）

## 7. Minecraft 由来の部品

### Minecraft アイテムアイコン
- **`ItemIcon`（`app/components/item-icon.tsx`）を使う。** `@bafv4/mcitems` の `MinecraftItemIcon` を直接呼ばない
- ラッパーが配信元（`TEXTURE_BASE_URL = "/mcitems"`）・`pixelated`・読み込み中の円形プログレスを既定にしている。
  `loadLang()` に渡すベース URL も同じモジュールの `TEXTURE_BASE_URL` を使う
- 読み込み中も `size` と同じ外枠を保つので、画像に変わってもずれない
- **例外**: `app/components/paceman-split-mark.tsx`（PaceMan の区間アイコン、固定8種）は静的な `<img>` で `/mcitems/1.16.1/items/minecraft_*.png` を参照する。
  `ItemIcon` が引き込むアイテム名辞書（約162KB）を、ホーム・`/paces` の初期表示から外すため。読み込み中の表示と失敗時の代替は無い

### キーバッジ（サーチクラフト系）
- 実装は `app/components/search-craft-badges.tsx`（`KeyBadge` / `ShiftKeyGroup` / `ControlKeyBadgeView` / `ControlKeyBadge` / `CraftMarker` /
  `renderVisibleSpaces` 等）に集める。見た目を変えるときはこのファイルだけを直す
  - 依存は `ui/tooltip`・`shift-mark`・`item-icon`・`virtual-keyboard`（`getFingerKeyStyle`）・`lib/keybindings`・`lib/remap-utils` だけ。
    表示ビューやキー入力順ダイアログに依存しないので、どこから import しても循環しない
  - 旧 import 元を保つ re-export は `search-craft-template-view.tsx`（`SearchStringText` / `KeyBadge` / `ShiftKeyGroup`）と
    `search-craft-loop-view.tsx`（`ControlKeyBadge`）だけ。他は本モジュールから直接 import する
- 形と色の意味（クラスはソースが正）:
  - 文字入力キーは角の小さい `rounded` の四角、制御キー（BS / ← / Home / ⇧Home）は `info` 色の丸ピル。形でひと目で区別する
  - リマップ済みは `ring-primary` のリング。制御キーがリマップされているときだけ「実際に押すキー＋操作名のミニチップ」の複合ピルにする（リマップが無ければ単一のピルのまま）
  - Shift: 単発の大文字は個々のバッジを `warning` 色にする。行全体で Shift を押し続ける（`shiftHeld`）ときは、`ShiftKeyGroup` がキー列全体を
    `warning` 色の枠（`rounded-lg`）で囲み、先頭に「⇧」マークだけを置く
  - 無効は `destructive` 色。回数は右肩の `×n` で表す（バッジを並べない）
  - クラフト実行は、通常のアイテムチップと同じ見た目の `CraftMarker`（同じ文字列で出せるアイテムは全部並べる）。説明は Tooltip と凡例が担う
  - キー系のバッジとチップは高さ `h-7` で揃え、セグメント間は `gap-2`、キー同士は `gap-1`
- Shift の「⇧」は `ShiftMark`（`shift-mark.tsx`、lucide `ArrowBigUp` ＋ sr-only の "Shift"）で描く。文字列中の "⇧" をまとめて置き換えるときは `KeyLabelText`
  （`text-sm` の文脈は既定の `size-3.5`、`text-[10px]` の文脈は `size-2.5`）。データ層・翻訳文言・Tooltip・aria-label のような純テキストは "⇧" 文字のまま持ち、アイコンにするのは描画する JSX 側だけ

### kbd チップ
`bg-secondary/80 px-2.5 py-1 min-w-16 rounded text-sm font-mono text-center`（キー割り当ての一覧などの単発のキー表示）

### 仮想キーボード・指色
- キーボードの表示は `VirtualKeyboard`。指の色は `getFingerKeyStyle`（同じファイル）を使い、色の組み立てをその場で書かない
- 使えないリマップの表示など、トークン同士を混ぜる色は `color-mix()` でトークンから作る

### 区間・進行
- `StageBar`: 現在区間と人数ありは `bg-brand`、到達済みは `bg-brand/40`、未到達は `bg-muted`
- ホームのライブの区間分布の帯は、人が居なくても7段を描く（0人の段は `bg-muted`・人数なし）
- 終わったカード（ライブ欄で少しの間残す物）の進行バーは、現在区間も `bg-brand/40`（`StageBar muted`）
- **完走は金色**: 完走したランは Finish の段を `bg-gold`（「完走」の文字と同じ `--gold`）にする（`StageBar finished`）。完走は事実なので、終わったカードでも金色は保つ。
  見ているあいだに完走した瞬間は、区間到達の色の合図も金色で少し長く出す。金色は完走だけに使い、ほかの強調に流用しない

### 時間・数値
- 時間は `font-mono tabular-nums`。整形は既存の関数を使い、その場で整形しない: 記録・走者画面は `formatTime`（`app/lib/time-utils.ts`）、ホームのライブ・配信は `formatClock` / `formatClockSeconds`（`app/lib/home-format.ts`）、相対時刻は `app/lib/relative-time.ts`
- 時刻・相対時刻のようにサーバーとクライアントで変わる文字には `suppressHydrationWarning` を付ける

## 8. 状態（空・読み込み・失敗）

### 空
- ページ・欄の空状態は `EmptyState`（`app/components/empty-state.tsx`、props: `icon` / `title` / `description` / `action?` / `size?`）。独自のマークアップを書かない
- 0件がよく起きる欄（ほかの欄と縦に並ぶ欄）は `size="compact"`（アイコンは `h-5 w-5`）。ページ全体が空のときは既定の大きさ
- 欄の中の1項目が空なだけなら、muted の1文でよい。値が無いだけなら `EmptyValue`（`player-profile-bits.tsx`）
- 本人が見ているときは編集への導線（`OwnerEditAction`、同じファイル）、他人が見ているときは状況の説明を出す

### 読み込み
- スケルトンは**本物と同じ配置**で描き、`aria-hidden` にする。読み込みの前後で高さが変わらないよう、高さを先に確保する
- 再取得中の中身は `opacity-50` ＋ `aria-busy` で残す（消して空にしない）
- 重い外部埋め込み（YouTube）は `YouTubeClickEmbed`（`youtube-click-embed.tsx`）で、クリックしてから読み込む

### 失敗
- フィードの失敗は `FeedErrorNotice`（`app/components/home/feed-error-notice.tsx`）、外部統計の読み込み中・失敗は `StatsServiceLoadingCard`（`player-stats-cards.tsx`）
- 共通: `role="status"`、面は `border-destructive/30 bg-destructive/10`。再試行ボタンは押した直後に `aria-disabled` にし、
  成功したら欄の見出しへフォーカスを戻す
- 外部統計の取得は `createStatsCache`（`app/lib/stats-cache.ts`）を通す。再試行は `force` で取り直す

### 読み上げ
- `aria-live="polite"` は意味のある変化（件数・結果）だけに付ける。時刻の更新や飾りの変化には付けない

## 9. 操作部品とアクセシビリティ

### タップ領域
- モバイルの押せる物は高さ 44px（`min-h-11`）。`sm` 以上で縮めてよい（例: `min-h-11 sm:min-h-8`）。最小でも 24px
- 見た目を変えずに押せる範囲を広げるときは、負のマージン＋同じ量の padding で広げる

### ボタン
- 既定の `Button` は brand 色（＝主操作）。並ぶ副次の操作は `outline` / `ghost` にする
- モバイルでアイコンだけにするボタンは、文字を `sr-only` で残す。切り替える幅は、ページの操作行（身元帯など）は `md`、欄見出しのリンク（`SectionHeaderLink`）は `sm`
- 幅で表示を切り替える部品は、両方を描いて CSS で出し分ける（`useMediaQuery` で描き分けない。SSR とずれるため）
- `Button` の中の svg は基底の `[&_svg:not([class*='size-'])]:size-4` で 16px になる。他の大きさにするときは `h-5 w-5` ではなく `size-5` を使う（`h-*` は効かない）

### 名前と読み上げ
- アクセシブルネームは、見えている短いラベルを含める（label in name）。短い表示と完全な文を出し分けるときは、見える短い文＋ `sr-only` の完全な文の組にする
- 同じ情報を2回描くとき（アイコン＋文字など）は、片方を `aria-hidden` にする
- 画像の `alt`: 隣に名前があるアバターは `alt=""`。名前が近くに無いときだけ名前を入れる
- まとまりは `aria-labelledby` で見出しと結ぶ。スイッチは `label` で包んで、文字ごと押せるようにする
- 操作の後のフォーカス先を決めておく（再試行の成功 → 欄見出し、など）

### カード全体をクリック可能にする（オーバーレイリンク）
カード内にボタン（いいね等）を置く場合、カード全体を `<a>` で包むと不正な HTML になるため、全面を覆うリンクを敷く。
`pace-feed-card.tsx` と `guide-list-views.tsx` が基準。

- 敷き方は2通り: `absolute inset-0 z-0` のリンク／ボタンを置くか、タイトルのリンクに `after:absolute after:inset-0` を付ける
- 外枠を `group relative` にし、**ホバーの `transform`（`-translate-y-*` / `scale-*`）は必ずこの外枠に置く**
  - 兄弟要素（`Card` 等）に transform を置くと、その要素が**重ね合わせコンテキストを作ってオーバーレイリンクより手前に描かれ**、
    カードのクリックが届かなくなる。ホバーしてからクリックする実際の操作では常に死ぬので、静止状態の見た目やスナップショットでは気づけない
  - `shadow` / `border` / `background` のホバー変化は重ね合わせコンテキストを作らないので、`Card` 側でよい
- カード内の操作要素（`LikeButton` など）は `relative z-10` でオーバーレイより手前に出す
- 変えたら**実際にホバーしてからクリック**して遷移を確かめる

### 動き
- 動きは状態の変化・位置の関係・操作の手応えを説明するときだけ付ける。欄ごとの登場演出やスクロール連動の飾りは付けない
- **サイトの見せ場は「区間到達」の1つ**: ホームのライブ欄で走者が次の区間に着いたとき、新しい段の帯が左から伸び、
  区間・時間の行に brand の淡い面が一瞬付き、並べ替えで新しい位置へ滑る（`live-rail.tsx` / `pace-stage-bar.tsx`）。
  ほかの画面に同じ強さの演出を増やさない
- 初回表示（SSR・ハイドレーション・URL で直接開いたとき）では動かさない。ページを開いただけで演出を待たせない
- 時間の目安: 手応え 100〜150ms、状態の切替 150〜300ms、並べ替え・重なり 300〜500ms。イージングは `cubic-bezier(0.16, 1, 0.3, 1)` 系の減速で、跳ねる曲線は使わない。退場は登場より速く（多くは即時）
- 走者画面のタブ切替は、新しいタブの中身を opacity だけで 150ms 出す。ホットバーの選択枠は Minecraft と同じく瞬時に切り替える（移動させない）
- 移動・拡大・スクロールのアニメーションには `motion-reduce:` の打ち消しを付ける
- `app/app.css` の reduced-motion ルールは CSS のアニメーション・トランジションにしか効かない。Web Animations API（`element.animate`）を使うときは
  `matchMedia("(prefers-reduced-motion: reduce)")` を見て、移動をやめる。意味のある色・opacity の変化は残してよい
- 選択状態のように SSR 直後から正しく見えるべきものに、移動のアニメーションを付けない

## 10. 貼り付く UI

### 上端
- サイトヘッダーは高さ 65px（`h-16` ＋ 1px の線）、`z-50`。貼り付いている間は不透明になる（`app/app.css`）
- ヘッダーの下に貼り付く物は `top-[64px]`（1px 沈めてヘッダーの線に重ねる）。重なり順はヘッダー `z-50` ＞ ホットバー `z-40` ＞ 見出し `z-30`
- 貼り付いた面は `-mx-2 px-2` で、左右のはみ出し（リング・影）まで覆う
- 貼り付く物を足したら、`:root` の `--sticky-bar-inset` / `--sticky-heading-inset`（`app/app.css`）に高さを足す。
  `scroll-padding-top` がこの合計を読むので、アンカー移動やフォーカスで中身が貼り付いた物の裏に隠れない
- タブの中で `scroll-mt-*` を個別に付けない（`scroll-padding-top` に任せる。Tabs のルートは `[&_[id]]:scroll-mt-0`）

### 下端の固定 UI（`--bottom-dock-height`）
ページが `[data-bottom-dock]` を持つ要素（現在はプロフィールのホットバー）を描くと、`app/app.css` の `:root:has([data-bottom-dock])` が
**md 未満で** `--bottom-dock-height`（`4.75rem + env(safe-area-inset-bottom)`）を解決し、body に同じ高さの `padding-bottom` を付けて末尾がドックに隠れないようにする。
ドックの無いページ・md 以上では `0px`。

- 下端に固定する他の UI（クッキーバナー `cookie-consent.tsx`・トップへ戻る `back-to-top-button.tsx` など）は、
  `bottom-[calc(<元の値>+var(--bottom-dock-height,0px))]` のようにドックの高さぶんずらす。フォールバック `0px` を必ず付ける
- `:root` の `--bottom-fixed-inset`（`--bottom-dock-height` ＋ Cookie バナーの `--cookie-banner-offset`。body の `padding-bottom` と `scroll-padding-bottom` が読む）を、下端インセットの合計として参照してよい
- 新しく下端固定の UI を足すときも同じ。ドックを持つページを足すときは、コンテナに `data-bottom-dock` を付け、高さは `--bottom-dock-height` を参照する

## 11. タブ
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
  - キーボードでホットバーにフォーカスがある間だけ（`:focus-visible`、md 以上。貼り付いたコンパクトな帯では出さない）、スロットの角に番号を出して数字キーで切り替えられることを知らせる。番号は `aria-hidden`（意味は `aria-keyshortcuts` とツールチップが担う）。マウス操作では出さない
- アクセシブルネームは見えている短いラベルを含める（label in name、WCAG 2.5.3）。空スロットは破線で描き、押せる状態のまま、名前に「、未登録」を付ける
- md 未満は画面下端に固定する（10 章「下端の固定 UI」）。md 以上はヘッダーの下に貼り付き、貼り付いている間は小さな帯になる

## 12. ダイアログ・トースト
- ダイアログは shadcn/ui の `Dialog`。構造は `DialogHeader` → `DialogTitle` → 中身 → `DialogFooter`（キャンセル＋操作ボタン）。見るだけのダイアログは `DialogFooter` を省いてよい
- `DialogContent` の基底は `max-h-[calc(100dvh-2rem)] overflow-y-auto`（低い画面でも閉じるボタン・フッターに届く）。中で別にスクロールさせたいときだけ `max-h-*` / `overflow-hidden` を上書きする
- トーストは `sonner`（`toast.success()` / `toast.error()`）。文言は翻訳キーを使う

## 13. 公開一覧ページのヘッダ
- フィード・データ系の公開一覧ページ（`/paces` `/videos` `/rankings` `/stats`）のヘッダは「丸背景のアイコンチップ（`rounded-xl bg-primary/10 p-2` ＋アイコン）＋ `h1`（`text-2xl font-bold`）＋件数バッジ」
- これは既存の4ページの形。丸背景のアイコンチップはこのヘッダだけで、欄見出し・カード・ハイライトには広げない（1 章「クリーンに」）
- 英大文字の eyebrow ラベルは既存のページだけ。新しいページには作らない

## 14. アイコン
- `lucide-react` に統一する
- ブランドアイコン（YouTube / Twitch / X〔旧 Twitter〕/ GitHub）は lucide-react 1.x で消えたため、`app/components/brand-icons.tsx`
  （`@icons-pack/react-simple-icons` のラッパー。`currentColor`・`aria-hidden`・空の `<title>` が既定、大きさは `className` の `h-* w-*`）から import する。
  `Twitter` は X のロゴを描く。新しいブランドアイコンもこのファイルに足す
- 大きさ: 欄・カードの見出し `h-5 w-5`、ボタン内 `h-4 w-4`（`Button` の中は 9 章の `size-*`）、タイトル内の状態マーク（Pin 等）`h-4 w-4`、メタ行・フッター `h-3 w-3`（文字とは `gap-1`）、空状態 `h-12 w-12`

## 15. レスポンシブ
- モバイルファーストで Tailwind のブレークポイント（`sm:` / `md:` / `lg:` / `xl:`）を使う
- 表など横幅が要る物は、`HorizontalScrollArea` か `overflow-x-auto` で横にスクロールさせる。ページ全体を横にスクロールさせない
