# アイテム配置・サーチクラフト 仕様書

Minefolioにおけるアイテム配置（ホットバー構成）とサーチクラフト（クラフト検索文字列）の仕様を定義する。

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
| searchStr | text (nullable) | サーチ文字列 |
| comment | text (nullable) | コメント |
| timing | text (nullable) | クラフトタイミング（ow / bastion / bastion_fort / fortress / blinded / other、null=区分なし） |
| createdAt | timestamp | 作成日時 |
| updatedAt | timestamp | 更新日時 |
| withShift | integer (boolean) | Shiftを押しながらクラフトするか（デフォルト false） |

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

### Shiftを押しながらクラフト（withShift）

スタック単位のクラフト（Shift+クリック）のために Shift を押しっぱなしでサーチ入力するエントリは、`withShift: true` を設定できる。

- 編集UI（/me/search-craft・テンプレートエディタ・Playground）の各行に「Shiftを押しながら」チェックボックスがある
- 表示行の入力キー列の先頭に琥珀色の「⇧ Shift」バッジが付く（凡例にも表示）
- 入力キーの逆引きは `getActualKeyInfos(searchStr, remaps, { shiftHeld: true })` となり、**Shift 押下中の出力文字で**解決する:
  - 単一キーソースのリマップは target キーのシフト後文字（例: target が `Semicolon` なら `:`）で逆引きする
  - `Shift+X` ソースの完全一致リマップは X 単独のバッジになる（Shift は押しっぱなしのため ⇧ プレフィックスなし）
  - 同じ基底キーに `Shift+X` リマップがある場合はそちらが優先され、基底キーのシフト文字化はしない（`simulateRemapOutput()` の解決順と対）
  - **通常（Shiftなし）の逆引きマップにはフォールバックしない**。Shift 押下中、通常マップのソースキーは別の文字を出力する（完全一致リマップの発動・シフト文字化）ため、参照すると必ず誤った案内になる
  - 非リマップの記号は `SHIFT_CHAR_MAP` の逆引きで物理キーに解決する（例: `_` → `Minus`）。ただしそのキー自体がリマップで奪われている（単一キーソース or `Shift+同キー` ソースがある）場合は使わない。英字は大文字が出力されるが Minecraft の検索は大文字小文字を区別しないため基底キーをそのまま押す
  - 上記で解決できない文字（Shift 押下中に出せない数字等）は文字そのままの基底キーにフォールバックする

### 編集UI

- `@dnd-kit` によるドラッグ&ドロップでエントリの並べ替え
- `@bafv4/mcitems` の `getCraftableItems()` / `getCraftableItemsByCategory()` でクラフト可能アイテムをフィルタリング
- アイテム検索・カテゴリ別選択
- サーチクラフトエントリの追加・削除・複製
- `FloatingSaveBar` による変更の一括保存
- プリセット機能（`configPresets` テーブルと連携）

---

## プロフィールページでの表示

`app/routes/player/profile.tsx` でプレイヤーのプロフィールページにアイテム配置とサーチクラフトを表示する。

- アイテム配置: セグメントごとにホットバー9スロット + オフハンドのアイテムアイコンを表示
- サーチクラフト（v1.6.0 で表示刷新）:
  - **サマリーバー**: ゲーム内言語（日本語名併記）・総件数・キーバッジの凡例（リマップ済み / Shift同時押し / 指割り当て色。指割り当ては設定がある場合のみ）
  - **タイミング別グループカード**: Bastion（金）/ Fortress（赤）/ その他（青）/ 指定なし の順に、色ドット + 件数付きヘッダーのカードでグループ表示。タイミング未設定のみの場合はヘッダーなしの1枚のカード
  - **行リスト**: カード内は `divide-y` の行リスト。デスクトップ（lg以上）は「アイテム / サーチ文字列 / 入力キー」の3カラム表（列ヘッダー付き）、モバイルは縦積み + インラインラベル
  - 各行: シーケンス番号、アイテムチップ、サーチ文字列（クリックでコピー、`navigator.clipboard` + toast）、実入力キーバッジ（指割り当て色・リマップring・Shift琥珀色、ツールチップ付き）、コメント
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
| `app/lib/schema.ts` | DBスキーマ定義（itemLayouts, searchCrafts, searchCraftTemplates） |
| `app/routes/me/items.tsx` | アイテム配置編集ページ |
| `app/routes/me/search-craft.tsx` | サーチクラフト編集ページ |
| `app/routes/player/profile.tsx` | プロフィールページ（表示側） |
| `app/lib/remap-utils.ts` | サーチクラフトのキーリマップ連携（`getActualKeyInfos()`） |
| `docs/search-craft-templates.md` | テンプレート公開・適用・Playground 仕様 |
| `@bafv4/mcitems` | Minecraft 1.16アイテムアイコン・検索パッケージ |
