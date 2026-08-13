# アイテム配置・サーチクラフト 仕様書

Minefolioにおけるアイテム配置（ホットバー構成）とサーチクラフト（クラフト検索文字列）・その繋ぎ方（Loop）の仕様を定義する。

---

## アイテム配置

### テーブル: `item_layouts`

| カラム | 型 | 説明 |
|---|---|---|
| id | text (PK) | CUID2 |
| userId | text (FK → users) | ユーザーID |
| segment | text | セグメント識別子 |
| slots | text (JSON配列) | ホットバー9スロットのアイテム情報 |
| offhand | text (JSON配列, nullable) | オフハンドスロットのアイテム情報 |
| notes | text (nullable) | メモ |
| displayOrder | integer | 表示順序（デフォルト: 0） |
| createdAt | timestamp | 作成日時 |
| updatedAt | timestamp | 更新日時 |

- ユニーク制約: `(userId, segment)` の組み合わせ

### セグメント

ゲームの進行フェーズごとにホットバー構成を管理する。プリセットとして以下が用意されている。

| セグメント名 | 説明 |
|---|---|
| Common | 共通 |
| Overworld | オーバーワールド |
| Enter Nether | ネザー突入 |
| Bastion | バスティオン |
| Bastion → Fort | バスティオンからフォートレスへ |
| Fortress | フォートレス |
| Blinded / Stronghold | ブラインド/ストロングホールド |
| Enter End | エンド突入 |
| Enter End (Zero) | エンド突入（ゼロ） |

カスタムセグメント（`custom_*` 形式）もユーザーが自由に追加可能。

### スロット構造

各スロットは以下の構造を持つ。

```typescript
type Slot = {
  slot: number;     // スロット番号（0〜8）
  items: string[];  // アイテムID配列（複数アイテムを格納可能）
};
```

- ホットバーは9スロット（slot 0〜8）
- 各スロットに複数のアイテムを登録可能（状況に応じた代替アイテム）
- オフハンドも同じJSON配列形式

### アイテムアイコン

Minecraft 1.16のアイテムテクスチャを `@bafv4/mcitems` パッケージから取得して表示する。

```typescript
import {
  MinecraftItemIcon,
  searchItems,
  formatItemName,
  ITEM_CATEGORIES,
  getItemsByCategory,
} from "@bafv4/mcitems/1.16/react";
```

- `MinecraftItemIcon`: アイテムアイコンコンポーネント
- `searchItems`: アイテム名検索
- `formatItemName`: アイテムID → 表示名変換
- `ITEM_CATEGORIES` / `getItemsByCategory`: カテゴリ別アイテム取得

テクスチャのベースURL: `/mcitems`

### 編集UI

- Comboboxによるアイテム検索・選択
- カテゴリ別フィルタリング
- セグメントの追加・削除・並べ替え
- プリセットからのセグメント選択
- セグメントの複製機能
- `FloatingSaveBar` による変更の一括保存

---

## サーチクラフト

### テーブル: `search_crafts`

| カラム | 型 | 説明 |
|---|---|---|
| id | text (PK) | CUID2 |
| userId | text (FK → users) | ユーザーID |
| sequence | integer | シーケンス番号（順序管理） |
| items | text (JSON配列) | クラフト対象アイテムID配列 |
| keys | text (JSON配列) | サーチ入力キー配列 |
| searchStr | text (nullable) | **第1バリエーションのミラー**（旧リーダー・ロールバック互換のため書き込みを継続。正準の読み取りは `searchVariations` → `resolveVariations()`） |
| comment | text (nullable) | コメント |
| timing | text (nullable) | クラフトタイミング（ow / bastion / bastion_fort / fortress / blinded / other、null=区分なし） |
| createdAt | timestamp | 作成日時 |
| updatedAt | timestamp | 更新日時 |
| withShift | integer (boolean) | **第1バリエーションのミラー**（デフォルト false。正準は `searchVariations[0].withShift`） |
| searchVariations | text (nullable, JSON配列) | 複数サーチ文字列バリエーション（`SearchCraftVariation[]`、下記「複数サーチ文字列バリエーション」参照） |

- ユニーク制約: `(userId, sequence)` の組み合わせ

### 概要

サーチクラフトは、Minecraftのクラフト画面でレシピ検索バーに文字列を入力して目的のアイテムを素早く選択するテクニック。各エントリは以下を管理する。

- **items**: クラフトしたいアイテムのID配列
- **searchStr**: レシピ検索バーに入力する文字列
- **keys**: 実際にキーボードで押すキーの配列（リマップを考慮した実入力）
- **sequence**: 表示・実行の順序

サーチ文字列の先頭・末尾スペースはスペースキー入力として意味を持つため、保存・コピー・テンプレート化・Playground の全経路で原文のまま保持する（trim は空判定にのみ使う）。読み取り専用の表示（`SearchStringText`、プロフィール・テンプレート詳細・ガイド埋め込みで共用）では半角スペースを「␣」（U+2423）に置き換えて視認化する。コピーボタンは DOM のテキストではなく元の `searchStr` を使うため、クリップボードには半角スペースのまま入る。スペース文字の入力キーバッジは `Space` ラベルで表示される。

### キーリマップとの連携

サーチ文字列の各文字は、ユーザーのキーリマップ設定を考慮して実際に押すべきキーに変換される。`app/lib/remap-utils.ts` の `getActualKeyInfos()` 関数がこの変換を担当する。

例: ユーザーが `Shift+KeyW → KeyA` のリマップを設定している場合、サーチ文字列中の `a` を入力するには `Shift+W` を押す必要がある。

`getActualKeyInfos()`（逆引き）と `simulateRemapOutput()`（順方向シミュレーション）は **chat 文脈専用**。内部で `filterRemapsForChat()` を適用して `trigger` 種別の行を除外し、同一 sourceKey に複数種別の行がある場合は chat > all > unset の優先度で解決する（呼び出し側でのフィルタは不要）。種別の詳細は [`docs/keybindings.md`](keybindings.md) の「リマップ種別と適用文脈」を参照。

逆引きの優先順位: 同じ文字を複数のリマップが出力できる場合、**修飾キーなしのソースを優先**する（例: `E→h` と `Shift+S→h` があるとき `h` は `E` に解決する）。同クラス内で複数候補がある場合は、通常マップは後勝ち、shiftHeld マップは先勝ち（`dedupeRemaps` と同じ規則）。

**制御キー（Backspace / ArrowLeft / Home）の逆引き**: `getActualControlKeyInfo(t, targetKeyCode, remaps, options?)` は、繋ぎ方（Loop）の `ControlKeyBadge` 用に「その制御キーを出力するリマップ」を逆引きする（chat 文脈専用、`filterRemapsForChat()` 適用）。`getActualKeyInfos()` と同じ規則（修飾キーなしのソースを優先、同クラス内は後勝ち）で解決し、該当リマップが無ければ物理キーそのまま（`isRemapped: false`）を返す。**自己リマップ（sourceKey が修飾キーなしで targetKeyCode 自身に正規化される。例: `Backspace → Backspace`、`ShiftLeft → ShiftLeft`）は「リマップ」として扱わない**（見た目上は無変更のリマップ行であり、押すキーも物理キーと変わらないため。`isPhysicalShiftLeftTaken()` の「自己リマップは奪われていない扱い」と同じ考え方で一貫させている）。

`⇧Home`（Shift+Home）は「1キーの出力」に単一化されることがない。実際の入力は**Shift 側のキーと Home 側のキーの同時押し**で、それぞれ独立にリマップされうる（例: `KeyR → ShiftLeft`、`KeyT → Home` のリマップがあれば実入力は `R+T`）。`options.shiftHeld: true` を指定すると、Shift 成分と Home 成分（通常の `Home` 逆引きと同じ規則）を別々に解決し、`"${shiftLabel}+${homeLabel}"` の形で合成する（例: 両方リマップなら `R+T`、Shift のみなら `R+Home`、Home のみなら `⇧+T`）。`isRemapped` はどちらか一方でもリマップされていれば `true`（両方非リマップなら `⇧+Home` を計算した上で `isRemapped: false` を返し、呼び出し側は非リマップ時と同一の単一ピル表示に倒す）。

Shift 成分の解決順は「**左Shift → 右Shift** の順で、各々の中では **リマップ → 物理** の順」の4段階（`resolveShiftComponent()`）:

1. `ShiftLeft` を出力する chat 文脈リマップがあれば、そのソースキー（`isRemapped: true`）
2. 無ければ、**物理 `ShiftLeft` が chat 文脈で奪われていなければ**物理 Shift（`⇧` 表記、`isRemapped: false`）— 「奪われている」は、修飾キーなしで `ShiftLeft` に正規化される sourceKey の行が存在し、かつその出力が `ShiftLeft` 自身でない（無効化・別キー出力・文字出力のいずれか）ことを指す
3. 物理 `ShiftLeft` が奪われている場合のみ右へ進む: `ShiftRight` を出力するリマップがあれば、そのソースキー（`isRemapped: true`）
4. それも無ければ物理 `ShiftRight`（表示は `⇧` のまま、`isRemapped: false`）

**物理 `ShiftLeft` が生きている限り `ShiftRight` 側は一切見ない**（`ShiftRight` のリマップより物理 `ShiftLeft` が優先される）点が、単純な「`ShiftLeft` リマップ → `ShiftRight` リマップ → 物理」との違い。

**既知の限界**: 物理キー自体が chat 文脈で別出力にリマップされており、かつ対象の制御キー（または Shift 成分・Home 成分）を出力するリマップも無い場合（押しても意図したキーが出ない状態）でも、正解となるキーが存在しないため物理キーのまま `isRemapped: false` を返す。

**ツールチップ用の構造化情報**: `getActualKeyInfos()` の `ActualKeyInfo` と `getActualControlKeyInfo()` の `ActualControlKeyInfo` は、バッジ表示用の短縮ラベル（`displayLabel`。⇧ 等の短縮記号を含む）とは別に、Tooltip 専用のフィールドを持つ。

- `remapDetail` / `remapDetails`（`RemapDetail[]`）: リマップされている場合のみの「リマップ: 物理キー名称 → リマップ先」用の詳細（`sourceLabel`／`targetLabel`、いずれもフル名称）。プレイヤープロフィールの keybindings タブ（`key-info-trigger.tsx` の `RemapRow`）と同じ「物理 → 出力」の概念をテキスト版で踏襲したもの。`ActualControlKeyInfo` は `⇧Home` 合成時に成分ごと最大2件持つ
- `ActualControlKeyInfo.tooltipLabel`: 実際に押すキーのフル名称（`⇧` を使わず「左Shift」「右Shift」等で表記。`⇧Home` 合成時は成分ごとのフル名称を `+` で連結、例: `左Shift+サイド1`）

`KeyBadge`（`search-craft-template-view.tsx`）と `ControlKeyBadge`（`search-craft-loop-view.tsx`）はこれらを使い、リマップ時の Tooltip を「実際に押すキー — 操作を入力」＋「リマップ: 物理 → 出力」（成分が複数ならリマップ行を複数並べる）の構成にする。Tooltip 内は `⇧` への省略をせずフルネーム表記にする（バッジ本体の表示は `ShiftMark`/短縮記号のまま変更しない）。翻訳キーは `playerProfile.controlKeyActualTooltip`（`{key} — {op}` の主表記行）と `playerProfile.remapped`（`リマップ: {source} → {target}` のリマップ詳細行、両バッジで共用）。

### Shiftを押しながらクラフト（withShift）

スタック単位のクラフト（Shift+クリック）のために Shift を押しっぱなしでサーチ入力するエントリは、`withShift: true` を設定できる。

- 編集UI（/me/search-craft・テンプレートエディタ・Playground）の各行に「Shiftを押しながら」チェックボックスがある
- 表示行の入力キー列の先頭に琥珀色の「⇧ Shift」バッジが付く（凡例にも表示）。**⇧ はフォント依存の Unicode 文字直書きではなく `app/components/shift-mark.tsx` の `ShiftMark`（lucide `ArrowBigUp`）で描画する**（データ層の `displayLabel` 等の文字列は "⇧" のまま。詳細は `.claude/rules/ui.md`「キーバッジ」節）
- 入力キーの逆引きは `getActualKeyInfos(searchStr, remaps, { shiftHeld: true })` となり、**Shift 押下中の出力文字で**解決する:
  - 単一キーソースのリマップは target キーのシフト後文字（例: target が `Semicolon` なら `:`）で逆引きする
  - `Shift+X` ソースの完全一致リマップは X 単独のバッジになる（Shift は押しっぱなしのため ⇧ プレフィックスなし）
  - 同じ基底キーに `Shift+X` リマップがある場合はそちらが優先され、基底キーのシフト文字化はしない（`simulateRemapOutput()` の解決順と対）
  - **通常（Shiftなし）の逆引きマップにはフォールバックしない**。Shift 押下中、通常マップのソースキーは別の文字を出力する（完全一致リマップの発動・シフト文字化）ため、参照すると必ず誤った案内になる
  - 非リマップの記号は `SHIFT_CHAR_MAP` の逆引きで物理キーに解決する（例: `_` → `Minus`）。ただしそのキー自体がリマップで奪われている（単一キーソース or `Shift+同キー` ソースがある）場合は使わない。英字は大文字が出力されるが Minecraft の検索は大文字小文字を区別しないため基底キーをそのまま押す
  - 上記で解決できない文字（Shift 押下中に出せない数字等）は文字そのままの基底キーにフォールバックする

### 複数サーチ文字列バリエーション

1つのサーチクラフトエントリ（アイテム）へ複数のサーチ文字列を登録できる（例: エンダーアイを `en` でも `er` でもクラフトできるようにする）。共有ロジックは純関数の葉モジュール **`app/lib/search-craft-variations.ts`**（`.server` にしない。`app/lib/search-craft-loops.ts` と同じ位置付け）。

```typescript
type SearchCraftVariation = { str: string; withShift: boolean };
const MAX_SEARCH_VARIATIONS = 5; // 1エントリあたりの上限（並べ替えUIなし・最低1件）
```

| 関数 | 説明 |
|---|---|
| `parseVariationsJson(json)` | `search_variations` 列（JSON文字列）の耐性パース。不正な JSON・形状は `null` |
| `resolveVariations(src)` | 正準読み取り: `variations`（`isValidVariationsShape` を満たせば採用）?? `searchStr`/`withShift` から1件合成 ?? `[]`。**旧データのフォールバックは必ずこの関数を経由する**（各所に手書きしない） |
| `variationMirror(variations)` | 書き込みミラー: `searchStr` = 第1バリエーションの `str`（空文字列なら `null`）、`withShift` = 第1バリエーションの `withShift` |
| `isValidVariationsShape(v)` | action 受け口の構造検証（1〜`MAX_SEARCH_VARIATIONS`件、各要素が `{ str: string; withShift: boolean }`）。`str` の非空判定は行わない（呼び出し側の業務検証が `trim` で行う。保存値自体は原文のまま） |

- **withShift はバリエーションごと**に設定できる（エントリ共通ではない）
- **ミラー方針**: DB の `search_str` / `with_shift` 列、プリセットスナップショット (`PresetSearchCraftData`)・テンプレート (`craftsData`) の同名フィールドは、いずれも「第1バリエーションのミラー」として書き込みを継続する（旧リーダー・ロールバック互換）。全 insert 箇所（`me/search-craft.tsx` saveAll・`search-craft-apply.server.ts`・`me/presets.tsx` の3箇所）は `variationMirror()` 経由でこのミラーを書く
- **メモリ上の型**（`TemplateCraft` / `SearchCraftDraft` / `SearchCraftItem` / `SearchCraftRowData` / `LoopCraftInfo` 等）は `variations: SearchCraftVariation[]` を単一の真実とし、スカラーの `searchStr`/`withShift` は持たない（二重管理を型で防ぐ）。ミラーが現れるのはシリアライズ境界（DB列・スナップショットJSON）のみ
- **編集UI**（`SearchCraftTimingBoard` の `EditableSearchCraftRow`）: 1エントリ内にバリエーション行を縦積み表示。各行は検索文字列 Input + 「Shiftを押しながら」Checkbox + 入力キーのライブプレビュー（`shiftHeld` はそのバリエーションの値）+ 削除ボタン（バリエーションが1件のときは disabled）。行リストの下に「サーチ文字列を追加」ボタン（上限到達時は disabled）
- **バリエーション削除時の Loop 連動**: `SearchCraftTimingBoard.handleUpdateCraft` がバリエーション配列の縮小を検知し、`app/lib/search-craft-loops.ts` の `remapVariationRefs(steps, craftId, removedIndex, newCount)` → `resetTransitionCountsForCraft()`（`search-craft-loop-editor.tsx`）の順で該当クラフトを参照する Loop ステップを付け替える（削除された index より後ろの参照は -1、範囲外になった参照は 0 へ倒す。ステップ自体の除去はしない）
- **表示**（`SearchCraftGroupedList` の `SearchCraftRow`）: バリエーションごとにサーチ文字列・入力キーを縦積み表示。コピーボタンはそのバリエーションの元文字列をコピーする

### 編集UI（タイミングブロック型）

編集UIは `app/components/search-craft-editor.tsx` の **`SearchCraftTimingBoard`** に統合されている（サーチクラフトと繋ぎ方〈Loop〉の両方を1つのボードで編集する）。`/me/search-craft` とワークベンチ（`SearchCraftWorkbench`、Playground・テンプレートエディタ共用）で共通。

- **ブロック構成**: 「指定なし」+ `TIMING_META`（`search-craft-template-view.tsx`）の6種、計7ブロックを常時この順で縦に表示する。ブロックヘッダは色ドット（指定なしはドットなし）+ ラベル + 件数
- **クラフト行**: アイテムチップ + 追加ボタン、サーチ文字列 `Input`、「Shiftを押しながら」チェックボックス、入力キーのライブプレビュー（`remaps` 指定時）、コメント、削除（`AlertDialog`）。行UI自体に timing の選択コントロールは無い（timing はブロック帰属で決まる）
- **タイミングの変更＝ブロック間D&D**: `@dnd-kit` のマルチコンテナ Sortable パターン（単一 `DndContext` + ブロックごとの `SortableContext` + 空ブロック用 `useDroppable` ゾーン）。ブロック間へドロップすると対象クラフトの `timing` が移動先ブロックの値に更新される。クラフトと繋ぎ方（Loop）は同一 `DndContext` を共有し、`collisionDetection` をドラッグ中の対象と同じドメイン（craft/loop）に絞り込むことで互いの干渉を防ぐ（`useDraggable`/`useDroppable` は最も近い祖先の `DndContext` にしか束縛できないため、ブロックカード内でクラフト行と Loop 行を同居させたまま完全に別の `DndContext` に分離することはできない）
- **繋ぎ方（Loop）サブセクション**: 各ブロック内、クラフトリストの下に配置。Loop 行の編集UI（`LoopEditorRow`、`app/components/search-craft-loop-editor.tsx` からエクスポート）はステップ選択・遷移行・プレビュー・コメント・削除を持つが、行ヘッダーに timing Select は無い（timing の変更はやはりブロック間D&D）。0件のブロックでは通常サブセクション自体を出さず、**Loop のドラッグ中のみ**全ブロックに破線のドロップゾーンを表示する
- **ブロック内の追加ボタン**: 各ブロックに「クラフトを追加」（新規クラフトの `timing` にそのブロック値を設定）と「Loopを追加」（新規 Loop の `timing` にそのブロック値を設定。全体のクラフト数が2未満なら disabled）を配置
- **空ブロック**: クラフト0件のブロックは破線のプレースホルダを表示し、そのままドロップ先として機能する
- **未知の timing**: 通常は起こらないが、`crafts`/`loops` の `timing` が7ブロックのいずれにも一致しない値だった場合、「指定なし」ブロックへ正規化して表示する（データは残るが未知キーのまま非表示になる、という黙った消失を避けるための防御）
- 保存時の `sequence` は「ブロック表示順にグループを連結したフラット配列」になる。ユーザー操作（D&D・追加・削除・更新）のたびに正規化される（初期ロード時点では再emitしないため、ブロック順に並んでいない既存データを開いてもそれだけでは変更扱いにならない）
- `@bafv4/mcitems` の `getCraftableItems()` / `getCraftableItemsByCategory()` でクラフト可能アイテムをフィルタリング、アイテム検索・カテゴリ別選択
- `FloatingSaveBar` による変更の一括保存
- プリセット機能（`configPresets` テーブルと連携）
- **Board の props 契約**: `crafts`/`onCraftsChange`/`loops`/`onLoopsChange`（フラット配列＋setter）に加え、新規追加は **draft ファクトリ契約**の `createCraft(timing) => T` / `createLoop(timing) => L`（id 生成・初期値の構築は呼び出し側、`reorderByBlock([...list, created])` の emit は Board が担う）を渡す。エントリ削除時の Loop 連動除去・削除確認ダイアログの文言差し替え（`meSearchCraft.deleteEntryUsedByLoops`）は Board 内部で完結し、外部プロップは無い（消費側は `onCraftsChange`/`onLoopsChange` にそのまま `setState` を渡すだけでよい）。`reorderByBlock` はモジュール非公開（Board が D&D・追加・削除・更新のたびに内部で自動適用するため、消費側が呼ぶ必要はない）

---

## 繋ぎ方（Loop）

Loop は、既存のサーチクラフトエントリ（`search_crafts` 行）を **ID 参照で順に繋ぎ**、作業台を閉じずに連続クラフトするキー操作列（BS×n / ←×n 挿入 / Shift+Home 全選択 / Home 先頭追記＋打鍵）を前後エントリの `searchStr` から自動導出して編集・表示する機能。

例: `er` と打つ→ブレイズパウダーをクラフト→（チャットキーで入力欄を再活性化）→Backspace→`n`→エンダーアイをクラフト。

### テーブル: `search_craft_loops`

| カラム | 型 | 説明 |
|---|---|---|
| id | text (PK) | CUID2 |
| userId | text (FK → users, cascade) | ユーザーID |
| sequence | integer | シーケンス番号（順序管理） |
| steps | text (JSON配列) | ステップ列（`LoopStepData[]`、下記） |
| comment | text (nullable) | コメント |
| timing | text (nullable) | クラフトタイミング（`search_crafts` と同じ enum） |
| createdAt / updatedAt | timestamp | 作成・更新日時 |

- ユニーク制約: `(userId, sequence)` の組み合わせ
- `steps` は JSON 列（子テーブルは不採用。ループは常に丸ごと読み書きし、保存経路が全削除→全挿入のため行 FK が成立しない）。`craftId` は `search_crafts.id` への参照だが、DB の FK 制約はなくアプリ層で整合性を管理する

### 共有ロジック: `app/lib/search-craft-loops.ts`

`.server` にはしない純粋関数モジュール（Playground・ライブプレビュー・全表示箇所のクライアント側から直接呼ぶため。`app/lib/remap-utils.ts` と同じ位置付け）。**モジュール内で `searchStr` の trim・正規化は一切行わない**（先頭・末尾スペースがスペースキー入力として意味を持つ既存仕様を踏襲する）。

#### steps（`LoopStepData[]`）の形

```typescript
type LoopTransition =
  | { type: "backspace"; bsCount: number }
  | { type: "arrowLeft"; arrowCount: number }
  | { type: "selectAll" }
  | { type: "home" };

type LoopStepData = {
  craftId: string;                    // search_crafts.id への参照
  transition: LoopTransition | null;  // 先頭ステップのみ null
  variationIndex?: number;            // 参照先クラフトのバリエーション index（0始まり）
};
```

`variationIndex` は「エントリ×バリエーション」のうちどのバリエーションを参照するかを表す。シリアライズ時は `0` を省略する（既存データとバイト同一を保つため）。パース時は欠落=0・不正値（非負整数でない）も0に矯正する（`normalizeVariationIndex()`）。メモリ上（`parseLoopSteps`/`remapLoopSteps`/`remapVariationRefs` の戻り値、エディタの状態）は常に明示した数値を持つ（`hasChanges` の JSON 比較を安定させるため）。範囲外の `variationIndex`（対象クラフトのバリエーション数以上）は `missing_search_str` invalid に倒す（クラッシュ・黙った誤導出はしない）。

#### 遷移4方式のセマンティクス

前後ステップの `searchStr`（`prev` → `next`）から `deriveTransition()` がキー操作列を導出する。

| 方式 | 操作 | 妥当条件 |
|---|---|---|
| `backspace` | BS を `bsCount` 回押してから続きを打つ | `bsCount` が整数で `0 <= bsCount <= prev.length`、かつ `next` が残存接頭辞 `prev.slice(0, prev.length - bsCount)` から始まる |
| `arrowLeft` | ← を `arrowCount` 回押してカーソルを末尾から `arrowCount` 文字戻し、その位置に文字列を挿入する（削除は伴わない） | `arrowCount` が整数で `1 <= arrowCount <= prev.length`（0 は「末尾に追記」＝backspace(0) と等価のため範囲外）、かつ `next.length > prev.length`、かつ `next` が残存接頭辞 `prev.slice(0, prev.length - arrowCount)` から始まり、残存接尾辞 `prev.slice(prev.length - arrowCount)` で終わる（= `next` が `prev` 前半 + 挿入文字列 + `prev` 後半 `arrowCount` 文字の形になっている） |
| `selectAll` | Shift+Home で全選択→打ち直す | 常に妥当 |
| `home` | Home で先頭へ戻り、先頭に打ち足す | `next.endsWith(prev)` かつ `next.length > prev.length` |

- 方式選択 UI のラベルは `meSearchCraft.loopTransitionBackspace` / `loopTransitionArrowLeft` / `loopTransitionSelectAll` / `loopTransitionHome`（`app/lib/messages/pages-ja.ts`）。回数ステッパーのラベルは `loopBsCountLabel` / `loopArrowCountLabel`、無効理由の表示文言は `loopInvalidBsRange` / `loopInvalidArrowRange` / `loopInvalidArrowLeft` / `loopInvalidHome` 等
- `minBs`（`minBackspaceCount(prev, next)` = `prev.length - 共通接頭辞長`）と `maxBs`（= `prev.length`）は4方式共通で常に算出される（arrowLeft/selectAll/home でも「BS 方式に切り替えた場合の目安」として提示する）
- 回数（`bsCount` / `arrowCount`）は UTF-16 コード単位で数える。サロゲートペア（非BMP文字）は1文字が2カウントになり実キー押下数と乖離するが、実運用のサーチ文字列（ASCII・かな漢字＝BMP）では影響しない
- `arrowLeft` の既定値（Select で方式を切り替えた直後の初期 `arrowCount`）は `minArrowLeftCount(prev, next)`（妥当な最小 `k`）。妥当な `k` は連続しているとは限らない（周期的な文字列など、途中の `k` だけ有効なことがある）ため `k=1〜prev.length` を総当たりし、1件も見つからなければ `null`（呼び出し側は既定値 `1` のまま invalid 表示に倒す）
- 妥当性は `DerivedTransition`（`{ valid: true, ops, typed, minBs, maxBs }` または `{ valid: false, reason }`）で表現する。`reason` は `bs_out_of_range` / `prefix_mismatch` / `arrow_out_of_range` / `not_insertion` / `not_extension` / `missing_search_str`（`arrow_out_of_range` は `arrowCount` が範囲外、`not_insertion` は挿入として成立しない場合）
- **意味的に無効な遷移（BS範囲外・←範囲外・挿入不成立・home不成立・参照切れによる searchStr 欠落等）は警告表示のみで、保存自体は拒否しない**。保存後も `searchStr` は編集できるため、事後的に矛盾が生じうることを前提にした仕様（`resolveLoopSteps()` が全ステップの妥当性を集約して Loop 全体の `valid` を返すが、これは表示上の警告用の値であり保存条件ではない）
- 一方、**構造的な不正（steps が2件未満・先頭以外の transition が null・bsCount / arrowCount が非負整数でない等）は `isValidLoopStepsShape()` で拒否**する（保存action側の受け口の検証）

#### 参照解決・パース関数

| 関数 | 説明 |
|---|---|
| `resolveLoopSteps(steps, getCraft)` | ステップ列を craftId 参照解決し、全ステップの遷移導出と全体 valid を集約する（編集プレビュー・全表示コンポーネントの共通入口）。`getCraft` は `{ searchStrs: string[] }`（対象クラフトの全バリエーションの文字列）を返す契約。各 `ResolvedLoopStep` は正規化済み `variationIndex` と、それに対応する `searchStr`（範囲外・参照切れなら `null`）を持つ。**表示文字列は必ず `ResolvedLoopStep.searchStr` から取ること**（`getCraft` を呼び出し側で再度呼んで `searchStrs[0]` 等を参照すると、variationIndex を無視した誤表示になる） |
| `minArrowLeftCount(prev, next)` | `arrowLeft` 方式で `prev` → `next` に遷移できる、妥当な最小の `k`。見つからなければ `null` |
| `parseLoopSteps(json)` | steps JSON 列の耐性パース。壊れた要素は除去し、フィルタ後に「先頭のみ transition null」という規則が成立しなければ配列ごと `[]` にする。`variationIndex` は欠落・不正値を 0 に矯正する |
| `isValidLoopStepsShape(value)` | `LoopStepData[]` としての構造検証（保存action の受け口用）。`variationIndex` は存在する場合のみ非負整数であることを検証する |
| `remapLoopSteps(steps, idMap)` | craftId を idMap（旧id→新id）で引き換える。マップに存在しない craftId（削除済みエントリへの参照）を持つステップは除去し、残りが2件未満になった場合は Loop ごと `null` を返す。`variationIndex` は正規化した上でそのまま引き継ぐ |
| `remapVariationRefs(steps, craftId, removedIndex, newCount)` | 指定 craftId のバリエーションが1件削除されたことに伴う参照の付け替え。`removedIndex` より後ろ（`>`）を参照するステップは `-1`、結果が範囲外（0未満または `newCount` 以上）になったステップは `0` へ倒す。ステップ自体の除去はしない。エディタは削除後 `remapVariationRefs` → `resetTransitionCountsForCraft`（BS/← 最小値再初期化、`search-craft-loop-editor.tsx`）の順で適用する |
| `typedCharSegments(prev, next, transition)` | 表示専用の補助。`next` を「実際にタイプする文字（`typed: true`）」と「前ステップから検索欄に残存するだけの文字（`typed: false`）」の `TypedCharSegment[]`（`{ text, typed }`、空セグメントは含めない）に分割する。先頭ステップ（`transition === null`）・`prev` が null/空・`deriveTransition()` が invalid のいずれかなら全部 `typed: true`（判定不能時は薄くしない）。方式ごとの区切り方は `backspace`＝残存接頭辞(false)+続き(true)、`arrowLeft`＝残存接頭辞(false)+挿入部(true)+残存接尾辞(false)、`selectAll`＝全部true、`home`＝先頭追記部(true)+末尾に残る `prev` 部分(false)。`typed` 部分の文字列は `deriveTransition()` の `typed` をそのまま使い、重複計算による食い違いを避ける |

### 編集UI

Loop の編集UIは、サーチクラフトと同じ `SearchCraftTimingBoard`（`app/components/search-craft-editor.tsx`、上記「[編集UI（タイミングブロック型）](#編集ui)」参照）に統合されている。各タイミングブロック内、クラフトリストの下に「繋ぎ方（Loop）」サブセクションとして表示・編集する。

- 行UI本体は `app/components/search-craft-loop-editor.tsx` がエクスポートする **`LoopEditorRow`** をボード側から再利用する（旧 `SearchCraftLoopListEditor`〈単一フラットリスト＋行ヘッダーの timing Select〉は廃止）
- 各行（`LoopEditorRow`）: ヘッダ（並べ替えハンドル・連番・削除の AlertDialog。timing Select は無い）→ ステップ行（エントリ選択の shadcn `Select`。将来エントリ数が増えたら `ui/combobox.tsx` への差替えを想定）→ 遷移行（ステップ2以降。方式 Select + BS/← `[-][n][+]` ステッパー + ライブプレビュー）→ ステップ追加ボタン → Loop 全体プレビュー → コメント入力
- **ステップ選択（`EntrySelect`）はエントリ×バリエーションを展開**した選択肢を持つ。value は `${craftId}:${variationIndex}` の複合キー、ラベルはアイコン＋アイテム名＋`(str)`＋（`withShift` の場合）⇧マーク
- BS ステッパーの範囲は `minBackspaceCount(prev, next)`〜`prev.length`（TransitionRow が自前で算出する。`deriveTransition()` の戻り値に min/max は含まれない）。← ステッパーの範囲は `1`〜`prev.length`（妥当な `k` は連続とは限らないため固定範囲のみをステッパーの min/max とし、範囲内の無効値は invalid 表示に倒す）。**回数は常に「最小回数を初期表示」する**: 遷移方式や前後エントリ・バリエーションの変更時、および**参照先エントリのサーチ文字列を編集した時**（`resetTransitionCountsForCraft()`、`SearchCraftTimingBoard` の行更新ハンドラから呼ぶ）に、`bsCount`/`arrowCount` を新しい最小値（`minBackspaceCount()`/`minArrowLeftCount()`、後者が見つからなければ `1`）にリセットする。編集セッション外で生じた矛盾（保存済みデータの読み込み時など）は値を保持したまま invalid 表示に倒す
- 保存をブロックする条件は「未選択ステップ」「2ステップ未満」のみ。意味的無効（BS範囲外・←範囲外・挿入不成立・home不成立等）は警告表示のみで保存できる
- Loop の timing 変更はブロック間D&D（`SearchCraftTimingBoard` 内、クラフトとは別ドメインとして扱う `DndContext`）で行う。ドラッグ中のみ、Loop が0件のブロックにも破線のドロップゾーンが表示される
- **エントリ削除時の連動**: `SearchCraftTimingBoard` が内部で、削除対象エントリを参照する Loop 数に応じて削除確認ダイアログの文言を差し替える（`meSearchCraft.deleteEntryUsedByLoops`、`{count}` 補間。旧 `getDeleteWarning` 外部プロップは廃止しボード内部に吸収）。削除確定時、該当ステップは `remapLoopSteps()` の除去規則で自動的に取り除かれ、2件未満になった Loop は自動削除される（これも Board 内部の `handleDeleteCraft` が担う）

### 表示

`app/components/search-craft-loop-view.tsx`:

| コンポーネント | 説明 |
|---|---|
| `ControlKeyBadge` | 制御キー（Backspace / ArrowLeft / Home / Shift+Home）用バッジ。文字入力キー（`KeyBadge`、secondary系・角丸 `rounded`）と一目で区別できるよう、info トーン（`border-info/50 bg-info/10 text-info`）＋ **`rounded-full` のピル形状**で表示する。BS×n / ←×n はバッジを n 個並べず右肩に `×n` を併記する（モバイル幅対策）。任意 prop `remaps` を渡すと、その制御キーの出力になっているリマップを `getActualControlKeyInfo()`（`app/lib/remap-utils.ts`）で逆引きする。リマップが見つかった場合のみ「実際に押すキーを主ラベル（外側）、出力操作（`BS` 等）をミニチップ（`text-[10px]`、チップの中のチップ）」の複合ピル表示＋リマップ用リングになる。リマップが無い（大多数）場合は非リマップ時と同一の単一ピルのまま |
| `LoopKeySequence` | `LoopKeyOp[]` とクラフト実行マーカー（ItemIcon 24px＋サーチ文字列。通常のアイテムチップと同じ見た目でキー系バッジと同じ高さ h-7、専用アイコンなし・Tooltip 付き）を `ChevronRight` を挟んで交互に描画。セグメント間は gap-2。`type` セグメントは `ActualKeyBadges`（リマップ・指色が自動適用）。マーカー内のサーチ文字列は `typedCharSegments()` で「実際にタイプする文字」と「前ステップから残存するだけの文字」に分け、後者を薄く表示する |
| `SearchCraftLoopRow` | Loop 一覧の行表示。1行＝キー操作列（`LoopKeySequence`）に統合された単一表示＋timing色ドット（`h-2.5 w-2.5`、`showTiming={false}` で非表示）＋コメント。各ステップのアイテム＋サーチ文字列はキー操作列内のクラフト実行マーカーが担い、独立したステップ連鎖サマリー行・ステップ数バッジは置かない。無効な Loop は行頭に destructive の `AlertTriangle`、無効セグメントは `[?]` バッジで示す |
| `SearchCraftLoopGroupSection` | タイミンググループカード埋め込み用の Loop サブセクション（Card なし）。`Repeat` アイコン＋`playerProfile.loopSectionTitle` の見出し＋`SearchCraftLoopRow`（`showTiming={false}`）の行リスト。見出しと行リストの間は `space-y-2`（8px）で区切る。グループ見出しと重複するため各行の timing 色ドットは出さない。loops が空なら何も描画しない |

サーチ文字列の「実際にタイプしない文字（前ステップから検索欄に残存する部分）」の薄表示は、ファイル内のローカルヘルパー `SegmentedSearchString`（`typedCharSegments()` の結果を描画）が担う。`typed: false` のセグメントは `text-muted-foreground/70`（`SearchStringText` の半角スペース可視化と同じトーン）で表示し、セグメント内でも半角スペースは `SearchStringText` と同じ「␣」可視化を維持する。読み上げ用にラッパーへ元の文字列全体を `aria-label` で渡し、セグメント自体は `aria-hidden` にする（`SearchStringText` と同じ方針）。編集UI（`SearchCraftTimingBoard` 内の Loop 全体プレビュー）も `LoopKeySequence` を共用するため、この表示は自動的に反映される。クラフト実行マーカー（`CraftMarker`）の背景は `bg-secondary/30`。

プレイヤープロフィールのサーチクラフトタブでは、独立した Loop セクションを持たず、`SearchCraftGroupedList` の `renderGroupExtra` / `extraTimings` を使って各タイミンググループカード内のサブセクションとして Loop を表示する（Loop を timing ごとにグループ化し、`renderGroupExtra(timing)` で該当グループの `SearchCraftLoopGroupSection` を返す。`extraTimings` には Loop が持つ timing の distinct 値を渡し、その timing のクラフトが0件でも Loop 用のグループカードが漏れなく出るようにする）。サマリーバーに Loop 件数バッジ（0件なら非表示）、凡例（`KeyBadgeLegend`）に制御キー（BS/←/Home/⇧Home、infoトーン）バッジの説明を Loop がある場合のみ追加するのは変更なし（クラフト実行マーカー自体の凡例項目は廃止済み。マーカーの見た目は Tooltip で説明する）。

### saveAll での id リマップと後方互換

`/me/search-craft` の `saveAll` アクション（`app/routes/me/search-craft.tsx`）は crafts・loops を毎回全削除→全挿入する。

1. crafts の submittedId→finalId マップを**挿入前に**構築する（`new-` 始まりの id のみ `createId()` で新規採番）。Loop の craftId 引き換えにも同じマップを使うため、挿入と同じタイミングでは id を振り直せない
2. `remapLoopSteps()` で loops の craftId を最終idへ引き換える。削除済みエントリへの参照はステップ除去、残りが2件未満になった Loop は破棄する（保存自体は拒否しない安全網）
3. トランザクション内で `loops 削除 → crafts 削除 → crafts 挿入 → loops 挿入`（sequence は挿入順の連番）の順に実行する

**後方互換**: フォームの `loops` フィールド自体が**未送信（`null`）**の場合は、Loop 機能追加前の古いクライアントからの保存とみなし、DB の既存 loops をそのまま温存する（明示的に空配列 `"[]"` が送信された場合＝新しいクライアントでの全削除は従来どおり尊重する）。これにより、保存のたびに既存 Loop が無警告で全消去される事故を防いでいる。

`syncActivePresetSnapshot(db, userId, ["searchCrafts"])` の呼び出し自体は変更していない。同期処理の内部で crafts・loops 両方のスナップショット列を同時に書くよう拡張されている（詳細は [`docs/presets.md`](presets.md)）。

---

## プロフィールページでの表示

`app/routes/player/profile.tsx` でプレイヤーのプロフィールページにアイテム配置とサーチクラフトを表示する。

- アイテム配置: セグメントごとにホットバー9スロット + オフハンドのアイテムアイコンを表示
- サーチクラフト（v1.6.0 で表示刷新）:
  - **サマリーバー**: ゲーム内言語（日本語名併記）・総件数・キーバッジの凡例（リマップ済み / Shift同時押し / 指割り当て色。指割り当ては設定がある場合のみ）
  - **タイミング別グループカード**: Bastion（金）/ Fortress（赤）/ その他（青）/ 指定なし の順に、色ドット + 件数付きヘッダーのカードでグループ表示。タイミング未設定のみの場合はヘッダーなしの1枚のカード
  - **行リスト**: カード内は `divide-y` の行リスト。デスクトップ（lg以上）は「アイテム / サーチ文字列 / 入力キー」の3カラム表（列ヘッダー付き）、モバイルは縦積み + インラインラベル
  - 各行: シーケンス番号、アイテムチップ、サーチ文字列（クリックでコピー、`navigator.clipboard` + toast）、実入力キーバッジ（指割り当て色・リマップring・Shift琥珀色、ツールチップ付き）、コメント
  - **繋ぎ方（Loop）セクション**: Loop が1件以上ある場合のみ、行リストの後に独立表示する（詳細は「[繋ぎ方（Loop）](#繋ぎ方loop)」参照）
- 複数プリセットがある場合はプリセット切替ドロップダウンが表示される

---

## 編集ページとプリセットの同期

`/me/items` および `/me/search-craft` の編集ページは v1.4.0 で次のように変更された：

- 上部に **PresetSelector** ドロップダウンを表示（詳細は [`docs/presets.md`](presets.md) 参照）
- `saveAll` 保存後に `syncActivePresetSnapshot(db, userId, ["itemLayouts"])` または `["searchCrafts"]` が呼ばれ、アクティブプリセットの該当 `*Data` JSON が最新化される（書き込みスルー）
- 保存リクエストにロード時の `presetId` を含め、別タブ等で切替済みなら `mePresets.staleSession` で拒否

---

## テンプレート公開・Playground

サーチクラフト設定はテンプレートとして公開し、他のプレイヤーが自分の設定に反映したり Playground で試したりできる。詳細は [`docs/search-craft-templates.md`](search-craft-templates.md) を参照。

---

## 関連ファイル

| ファイル | 役割 |
|---|---|
| `app/lib/schema.ts` | DBスキーマ定義（itemLayouts, searchCrafts, searchCraftLoops, searchCraftTemplates） |
| `app/routes/me/items.tsx` | アイテム配置編集ページ |
| `app/routes/me/search-craft.tsx` | サーチクラフト編集ページ（Loop の saveAll も含む） |
| `app/routes/player/profile.tsx` | プロフィールページ（表示側。Loop セクションも含む） |
| `app/lib/remap-utils.ts` | サーチクラフトのキーリマップ連携（`getActualKeyInfos()`） |
| `app/lib/search-craft-loops.ts` | Loop の共有ロジック（遷移導出・参照解決・パース・idリマップ） |
| `app/components/search-craft-editor.tsx` | サーチクラフト＋繋ぎ方（Loop）のタイミングブロック型編集UI（`SearchCraftTimingBoard`） |
| `app/components/search-craft-loop-editor.tsx` | Loop 行編集UI（`LoopEditorRow`。`SearchCraftTimingBoard` から再利用される） |
| `app/components/search-craft-loop-view.tsx` | Loop 表示UI（`SearchCraftLoopRow` / `SearchCraftLoopGroupSection` 等） |
| `docs/search-craft-templates.md` | テンプレート公開・適用・Playground 仕様（Loop の craftIndex 参照も含む） |
| `docs/presets.md` | プリセットスナップショット仕様（Loop の craftSeq 参照も含む） |
| `@bafv4/mcitems` | Minecraft 1.16アイテムアイコン・検索パッケージ |
