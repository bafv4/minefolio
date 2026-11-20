# 設定プリセット 仕様書

## 概要

プレイヤーの操作設定（キーバインド、デバイス設定、リマップ、指割り当て、アイテム配置、サーチクラフト、サーチクラフトの繋ぎ方（Loop）、カスタムキー、カスタムアクション）をプリセットとして保存・切替できる機能。複数の設定を名前付きで管理し、アクティブなプリセットをプロフィール表示に反映する。

---

## プリセット (configPresets)

### テーブル定義

| カラム | 型 | 説明 |
|--------|-----|------|
| `id` | text (PK) | CUID2 |
| `userId` | text (FK → users) | ユーザーID |
| `name` | text | プリセット名（必須） |
| `description` | text | 説明（任意） |
| `isActive` | boolean | 編集中フラグ — ライブテーブルと同期される編集対象（デフォルト: false） |
| `isMain` | boolean | メインフラグ — 公開面に表示される公開用プリセット（デフォルト: false） |
| `keybindingsData` | text (JSON) | キーバインドのスナップショット |
| `playerConfigData` | text (JSON) | プレイヤー設定のスナップショット |
| `remapsData` | text (JSON) | リマップのスナップショット |
| `fingerAssignmentsData` | text (JSON) | 指割り当て |
| `itemLayoutsData` | text (JSON) | アイテム配置のスナップショット |
| `searchCraftsData` | text (JSON) | サーチクラフトのスナップショット |
| `searchCraftLoopsData` | text (JSON) | サーチクラフトの繋ぎ方（Loop）のスナップショット（`PresetSearchCraftLoopData[]`、下記） |
| `customKeysData` | text (JSON) | カスタムキー定義のスナップショット |
| `customActionsData` | text (JSON) | カスタムアクションのスナップショット |
| `createdAt` | timestamp | 作成日時 |
| `updatedAt` | timestamp | 設定内容の更新日時。編集先（`isActive`）の付け替え（`apply-preset` / `create-preset` による他プリセットの非アクティブ化を含む）では進めない。進めるのは、スナップショットの同期・名前と説明以外の内容の書き換え・メインの付け替え（`set-main`） |

### インデックス

- `idx_config_presets_user_id` - ユーザーIDで検索
- `idx_config_presets_is_active` - 編集中プリセットの高速検索
- `idx_config_presets_is_main` - メインプリセットの高速検索

### 保存データの型

#### PresetKeybindingData

```typescript
{ action: string; keyCode: string; category: string; }
```

#### PresetPlayerConfigData

```typescript
{
  keyboardLayout?: string | null;
  keyboardModel?: string | null;
  mouseDpi?: number | null;
  gameSensitivity?: number | null;
  rawInput?: boolean | null;
  mouseAcceleration?: boolean | null;
  toggleSprint?: boolean | null;
  toggleSneak?: boolean | null;
  autoJump?: boolean | null;
  fov?: number | null;
  guiScale?: number | null;
  gameLanguage?: string | null;
  mouseModel?: string | null;
  windowsSpeed?: number | null;
  windowsSpeedMultiplier?: number | null;
  cm360?: number | null;
  notes?: string | null;
  controllerSettings?: string | null; // JSON文字列
}
```

#### PresetRemapData

```typescript
{
  sourceKey: string;
  targetKey: string | null;
  software: string | null;
  notes: string | null;
  outputMode?: "key" | "character" | null;
  outputCharacter?: string | null;
  remapType?: "unset" | "all" | "trigger" | "chat" | null; // リマップ種別（古いスナップショットには存在しない → unset として読む）
}
```

`serializeRemaps()` は `remapType` を常に出力する。プリセットの適用・作成時、`remapType` は `normalizeKeyRemapType`（`app/lib/remap-utils.ts`）で正規化され、不正値・欠落は `"unset"` として扱われる。復元（`apply-preset`）時は `(sourceKey, remapType)` の組で重複排除され、同一キー・同一種別のリマップが二重に復元されることはない。

#### PresetItemLayoutData

```typescript
{ segment: string; slots: string; offhand: string | null; notes: string | null; displayOrder: number; }
```

#### PresetSearchCraftData

```typescript
{
  sequence: number;
  items: string;
  keys: string;
  searchStr: string | null; // 第1バリエーションのミラー（旧リーダー・ロールバック互換）
  comment: string | null;
  timing?: "ow" | "bastion" | "bastion_fort" | "fortress" | "blinded" | "other" | null;
  withShift?: boolean; // 第1バリエーションのミラー（古いスナップショットには存在しない）
  variations?: SearchCraftVariation[]; // { str: string; withShift: boolean }[]。正準はこちら
}
```

`variations` は複数サーチ文字列バリエーション（`app/lib/search-craft-variations.ts`）。読み取りは常に `resolveVariations({ variations, searchStr, withShift })` を経由する（`variations` が有効ならそれを採用、無ければ `searchStr`/`withShift` から1件合成）。書き込みは `variationMirror(variations)` で `searchStr`/`withShift` をミラーしつつ `variations` も併記する。詳細は [`docs/items-searchcraft.md`](items-searchcraft.md) の「複数サーチ文字列バリエーション」参照。

#### PresetSearchCraftLoopData

```typescript
{
  sequence: number;
  steps: { craftSeq: number; transition: LoopTransition | null; variationIndex?: number }[];
  comment: string | null;
  timing?: "ow" | "bastion" | "bastion_fort" | "fortress" | "blinded" | "other" | null;
}
```

プリセットスナップショットは行 id を保持しない（本ドキュメント末尾を参照）ため、ステップの参照先を **`craftSeq`（同一スナップショット内 `searchCraftsData` の `sequence` 値）** で表す。`variationIndex` は参照先クラフトのバリエーション index（0始まり、0 は省略してシリアライズ）。`LoopTransition` の型は `app/lib/search-craft-loops.ts` を参照（`{ type: "backspace"; bsCount: number } | { type: "selectAll" } | { type: "home" }`）。詳細な遷移方式・バリエーションのセマンティクスは [`docs/items-searchcraft.md`](items-searchcraft.md) の「繋ぎ方（Loop）」「複数サーチ文字列バリエーション」参照。

#### PresetCustomKeyData

```typescript
{
  keyCode: string;
  keyName: string;
  category: "mouse" | "keyboard" | "controller";
  position: string | null;
  size: string | null;
  notes: string | null;
}
```

#### PresetCustomActionData

```typescript
{
  actionName: string;
  description: string | null;
  category: "other" | "macro" | "tool";
  triggerKey: string;
  displayOrder: number;
}
```

### isActive（編集中）/ isMain（メイン・公開用）の二重フラグモデル

プリセットには独立した2つのフラグがあり、**「他ユーザーに見せるプリセット」と「いま編集しているプリセット」を別々に管理**する:

| フラグ | 意味 | 影響範囲 |
|--------|------|----------|
| `isActive` | **編集中**。ライブテーブルと同期される編集対象 | `/me/*` 編集ページの読み書き・`syncActivePresetSnapshot` の同期先 |
| `isMain` | **メイン（公開用）**。公開面に表示される | プロフィール・操作設定一覧・比較・CSV・ガイド埋め込みの表示ソース |

- どちらもユーザーごとに最大1件（アプリケーションロジックで維持。DB制約は未導入 → [既知の制限](#既知の制限フォローアップ予定) 参照）
- **編集対象の切替（`apply-preset`）はメインに影響しない** — 編集するプリセットを変えても公開プロフィールの見え方は変わらない（この分離が本モデルの核）
- **メインの切替（`set-main` / `setMainPreset`）は `is_main` フラグの排他的付け替えのみ** — ライブテーブル・`isActive` には一切触れず、公開面は即座に新メインの表示になる

#### isActive（編集中）の管理

- プリセット作成時: `createPreset` が既存のアクティブプリセットを自動で非アクティブ化してから、新規プリセットを `isActive = true` で作成する。レガシーインポート経由の作成でも、全データ種別（キーバインド／プレイヤー設定／リマップ／指割り当て／アイテム配置／サーチクラフト／繋ぎ方（Loop）／カスタムキー／カスタムアクション）をスナップショットに含める。
- プリセット切替時: `apply-preset` がトランザクション内で、プリセット対象の**全データ種別（`keybindings` / `playerConfigs` / `keyRemaps` / `fingerAssignments` / `itemLayouts` / `searchCrafts` / `searchCraftLoops` / `customKeys` / `customActions`）を対称に「ライブテーブル全削除→スナップショットから復元」**し、既存のアクティブプリセットを `false` にしてから新しいプリセットを `true` に設定する。
  - スナップショットが `null` の種別は削除のみ行われ、ライブテーブルは空になる（切替前のデータが残留しない）。
  - `fingerAssignments` は `fingerAssignmentsData` から、`playerConfigData` とは独立に復元される。
  - **`searchCraftLoops` だけは他種別と対称ではなく、`searchCrafts` の復元に従属する**（`searchCraftsData` が非 null のときのみ試みる）。プリセットスナップショットは行 id を持たないため、crafts を `sequence → 新 craftId` のマップに記録しながら挿入し、その場でこのマップを使って `searchCraftLoopsData` の `craftSeq` 参照を新しい `craftId` へ解決する（`restoreSearchCraftLoopsFromSnapshot`）。参照切れ・構造不正なステップは除去し、残り2件未満の Loop は書き込まない。`sequence` はスナップショット値をそのまま使わず、実際に挿入した順の連番（1始まり）に振り直す（スナップショット由来の重複 `sequence` が `(userId, sequence)` の unique index に違反してトランザクション全体が失敗し、プリセット切替自体が恒久的にできなくなる事故を避けるため）。
- アクティブプリセット = 「現在編集中のプリセット = ライブテーブル」というモデル。`/me/keybindings` 等の編集ページの保存時には `syncActivePresetSnapshot` がアクティブプリセットの該当 `*Data` を最新化する（書き込みスルー）。

#### isMain（メイン・公開用）の管理

- プリセット作成時: メインが未設定のユーザーのみ、新規プリセットが自動でメインにもなる（初回作成・オンボーディング・インポート・Playground / ガイドテンプレート経由のすべての作成経路が `resolveIsMainForNewPreset` を共有）。**既にメインがある場合、新規作成は編集対象になるだけでメインは変わらない**。
- `/me/presets` の「メインに設定」で任意のプリセットをメインに切替できる。
- 削除: メインのプリセットは削除不可（先に別のプリセットをメインに設定するよう案内）。唯一のプリセット（メイン兼編集中）の削除は許可され、確認ダイアログの上でライブテーブルも全削除される。
- 公開面の表示元は `shouldUsePresetSnapshot()`（`app/lib/preset-read.ts`）が単一の決定点。**メインが非アクティブ（編集対象でない）ときだけスナップショットを使い**、それ以外（メインが無い移行前データ、およびメイン ＝ 編集中）はライブテーブルを使う。
  - **メイン ＝ 編集中のときにスナップショットを使ってはならない**。不変条件「アクティブプリセット = ライブテーブル」により、現在適用中の設定そのものはライブ側だからである。スナップショットは同期漏れや同期機構（2026-05 導入）より前の編集で古くなりうるため、これを表示すると公開面（一覧・比較・ガイド埋め込み）だけが「現在適用中でない設定」を出し、ライブを表示するプロフィールページと食い違う。
  - スナップショットを使う場合（メインが非アクティブ）、**`null` の種別は「空」であり、編集中のライブデータへフォールバックしてはならない**（編集内容の漏出になるため）。
- メイン ＝ 編集中（既定状態）のときは、保存が書き込みスルーでスナップショットへ同期され、表示もライブ基準のため、公開面は即時更新される（従来どおりの体験）。

#### 繋ぎ方（Loop）の id 復元（3経路）

プリセットスナップショットは行 id を保持しない（`PresetSearchCraftData` に `id` フィールドが無い）ため、`/me/presets`（`app/routes/me/presets.tsx`）がライブテーブルへスナップショットを展開する3つの経路すべてで、**crafts を挿入するたびに新しい `craftId` を採番し、その対応表で Loop の参照を書き換える**という同じパターンを踏む。

| 経路（`intent`） | crafts の新id採番元 | 対応表 | Loop の変換 |
|---|---|---|---|
| `apply-preset`（編集対象の切替） | スナップショット（`preset.searchCraftsData`）から挿入時に採番 | `sequence → 新craftId` | `restoreSearchCraftLoopsFromSnapshot()` が `searchCraftLoopsData` の `craftSeq` をこの対応表で解決 |
| `create-preset`（既存プリセットをコピー） | 同上（`sourcePreset.searchCraftsData`） | `sequence → 新craftId` | 同上（コピー先プリセットの `searchCraftLoopsData` は `sourcePreset.searchCraftLoopsData` をそのまま複写し、ライブ展開時に対応表で解決） |
| `create-preset`（現在のライブ設定から作成） | 削除前のライブ `search_crafts` 行を再挿入する際に採番 | `旧craftId → 新craftId`（`Map<string, string>`） | `remapLoopSteps()`（`app/lib/search-craft-loops.ts`）で `searchCraftLoops` 行の `steps` をこの対応表で書き換える。参照切れステップは除去、2件未満になった Loop は破棄 |

いずれの経路も、対応表に無い参照（削除済みエントリ・破損データ）を持つステップは安全側で除去し、除去の結果2件未満になった Loop は書き込まない。

### シリアライズ関数

`app/lib/preset-utils.ts` で提供:

| 関数 | 説明 |
|------|------|
| `serializeKeybindings(keybindings)` | `Keybinding[]` → `PresetKeybindingData[]` のJSON文字列 |
| `serializePlayerConfig(config)` | `PlayerConfig` → `PresetPlayerConfigData` のJSON文字列 |
| `serializeRemaps(remaps)` | `KeyRemap[]` → `PresetRemapData[]` のJSON文字列 |
| `serializeItemLayouts(layouts)` | `ItemLayout[]` → `PresetItemLayoutData[]` のJSON文字列 |
| `serializeSearchCrafts(crafts)` | `SearchCraft[]` → `PresetSearchCraftData[]` のJSON文字列 |
| `serializeSearchCraftLoops(loops, crafts)` | `SearchCraftLoop[]` → `PresetSearchCraftLoopData[]` のJSON文字列。`craftId` を同一スナップショット内 `crafts` の `sequence` 値（`craftSeq`）へ変換する。参照切れステップは除去、2件未満になった Loop は除去、0件なら `null` |
| `serializeCustomKeys(keys)` | `CustomKey[]` → `PresetCustomKeyData[]` のJSON文字列 |
| `serializeCustomActions(actions)` | `CustomAction[]` → `PresetCustomActionData[]` のJSON文字列 |
| `createPreset(db, options)` | プリセットをDBに作成（`options.searchCraftLoops` を渡すと `searchCraftLoopsData` も生成する） |
| `syncActivePresetSnapshot(db, userId, kinds)` | ライブテーブルの内容をアクティブプリセットの `*Data` に反映 |
| `assertPresetIsActive(db, userId, presetId)` | フォーム送信時の `presetId` がアクティブプリセットと一致するか検証（不一致なら `PresetMismatchError`） |

デコード側は `app/lib/preset-read.ts` の `decodePresetSearchCraftLoops(json, decodedCrafts)`。`craftSeq` を `decodePresetSearchCrafts()` の結果（`sequence` フィールド）で突合し、合成 id（`preset-craft-${idx}`）へ解決する（`decodedCrafts` は `sequence` でソート済みのため、配列位置ではなく `sequence` フィールドで突合する）。解決できないステップ（参照切れ）・構造的に不正な `transition` は除去し、残り2件未満の Loop は除去する。`decodePresetConfig()` の返り値に `searchCraftLoops`（既定 `[]`）として含まれる。

**`syncActivePresetSnapshot` に `searchCraftLoops` 専用の kind は無い**。`PresetSyncKind` の `"searchCrafts"` ケースが `searchCraftsData` と `searchCraftLoopsData` の**両列を常に同時に書く**よう拡張されている（`crafts` と `loops` のスキュー — 片方だけ古くなって参照が壊れること — を構造的に防ぐため）。そのため `/me/search-craft` の保存など、既存の `syncActivePresetSnapshot(db, userId, ["searchCrafts"])` 呼び出しはコード変更なしで Loop の同期も付いてくる。

---

## 設定変更履歴 (configHistory)

### テーブル定義

| カラム | 型 | 説明 |
|--------|-----|------|
| `id` | text (PK) | CUID2 |
| `userId` | text (FK → users) | ユーザーID |
| `changeType` | enum | `keybinding` / `device` / `game_setting` / `remap` / `preset_switch` |
| `changeDescription` | text | 変更内容の説明（必須） |
| `previousData` | text (JSON) | 変更前のデータ |
| `newData` | text (JSON) | 変更後のデータ（現在はどの保存経路も書かない。クライアントの生ペイロードを残さない方針。[`docs/keybindings.md`](keybindings.md)「保存の検証と上限」） |
| `presetId` | text (FK → configPresets) | **公開面に影響する変更のときだけ**そのメインプリセットの id（それ以外は null。下記「公開影響の記録規約」。ON DELETE SET NULL） |
| `createdAt` | timestamp | 作成日時 |

### /me/presets の変更履歴の表示

履歴は各保存の1回ごとに1行（二重 insert はしていない。同じ内容が数秒おきに並ぶのは、保存を繰り返した結果）。表示では、種別・文言・プリセットが同じ連続した行を1行にまとめて「×N」と最新の時刻を出し、行の `presetId` から引いたプリセット名（`with: { preset }`。削除済みは null で出さない）を添える。

### 公開影響の記録規約（お気に入り走者の動き用）

公開面はメインのスナップショットを表示するため、メインでない編集は公開内容を変えない。
「お気に入り走者の動き」に操作設定の変更を出す対象を、書き込み時点で `presetId` に畳み込む（スキーマ変更なし）。
判定の単一情報源は `app/lib/config-history.ts`。

- **公開影響あり（`presetId` = メインの id）**: ①メインへの切替（`set-main`）／初回作成などでメインが新しく決まった作成（`create-preset`・`createPreset()`・Playground・テンプレート反映で自動メインになった場合）②メイン＝編集中（isActive）プリセットへの保存（キー配置・リマップ・指割り当て・デバイス・アイテム配置・サーチクラフト）、メインを反映先にした Playground / テンプレート反映
- **公開影響なし（`presetId` = null）**: 非メインの編集・作成・削除、編集対象の切替（`apply-preset`）
- 書き込み側は `resolvePublicPresetId()`（指定プリセットがメインなら id）／`resolveActivePublicPresetId()`（編集中がメインなら id）の返り値を `presetId` に入れる。**`changeType` は従来どおり**（メイン切替は `preset_switch`）
- 読み取り側は `publicConfigChangeCondition()` で絞る（`presetId IS NOT NULL` かつ `createdAt >= PUBLIC_CONFIG_HISTORY_SINCE`）。旧実装は apply-preset や非メイン作成でも `presetId` を入れていたため、`PUBLIC_CONFIG_HISTORY_SINCE` より前の行は一律で公開影響なし扱い（プライバシー保護側）
- `/me/presets` の履歴表示は `presetId` を読まない（`id` / `changeType` / `changeDescription` / `createdAt` のみ）
- **編集先の切替（`apply-preset`）は履歴に記録しない**（公開内容も設定内容も変えず、履歴が切替の繰り返しで埋まるため）。過去に記録された行（旧文言「プリセット「…」を適用しました」/ `Applied preset "…"`）は DB に残すが、`/me/presets` の loader が文言（`LEGACY_APPLY_HISTORY_PATTERNS`）で除外して表示しない。作成・削除・メインに設定の説明文は「プリセット「名前」を作成（…）」「…を削除」「…をメインに設定」の形にそろえる

### インデックス

- `idx_config_history_user_id` - ユーザーIDで検索
- `idx_config_history_created_at` - 日時順ソート
- `idx_config_history_change_type` - 変更種別でフィルタ

### 変更種別

| changeType | 説明 |
|------------|------|
| `keybinding` | キーバインドの変更 |
| `device` | デバイス設定（マウス、キーボード）の変更 |
| `game_setting` | ゲーム内設定の変更 |
| `remap` | キーリマップの変更 |
| `preset_switch` | プリセットの切替 |

---

## プリセット管理画面 (/me/presets)

### 機能

- プリセット一覧表示（「メイン」「編集中」バッジ表示。メイン → 編集中 → 更新日時順）
- 新規プリセット作成（現在の設定をスナップショットとして保存。既存のアクティブプリセットは自動で非アクティブ化され、新規プリセットが編集対象になる。**メインは変わらない**。メイン未設定ユーザーのみ自動でメインにもなる）
- プリセットの編集（名前・説明の変更）: 一覧の各行の「名前を変更」（`Pencil`。ダイアログで名前と説明を編集、フッターはキャンセル＋保存）から `update-preset` を送る。
  - 検証は `create-preset` と同じ（名前は trim して必須、説明は trim して空なら null。名前 100 文字・説明 500 文字の上限あり。重複名の禁止は無い）。所有確認あり（他人・存在しない id は `presetNotFound`）
  - 名前・説明以外（スナップショット・ライブテーブル・編集先・メイン・`updatedAt`）には触れない。`updatedAt` は設定内容の更新日時（一覧の並び順・「更新:」表示）なので変えない
  - **履歴**: 名前または説明が変わったときだけ `preset_switch` で記録する（「プリセット「旧」の名前を「新」に変更」/「…の説明を変更」）。**`presetId` は null**（公開影響なし）。名前は走者画面のプリセット選択にも出るが、公開される操作設定の内容は変わらず「お気に入り走者の動き」に出す種類ではないため。変更が無ければ何も書かない
- 「編集中」と「メイン」は別の軸（ページ説明で明示する）: **編集中**＝各設定画面で編集するプリセット（`isActive`、`Crosshair` アイコン。バッジ「編集中」）、**メイン**＝走者画面に公開されるプリセット（`isMain`、`Star`）
- 操作の結果は `intent` つきで返す（成功: `{ success, intent, message }`）。画面は**成功した操作に対応するダイアログだけ**を閉じる（作成ダイアログ＝`create-preset`、名前・説明の変更ダイアログ＝`update-preset`。別の操作の成功で、入力中のダイアログは閉じない）
- 「編集中にする」（`apply-preset` = 編集対象の切替。モバイルでも文字付きの 44px ボタン。「編集中」バッジ・「編集中のプリセット」と同じ言い方）・「メインに設定」（`set-main` = 公開用の切替）
- プリセットの削除（確認ダイアログ付き）
  - メインのプリセットは削除不可（先に別のプリセットをメインに設定するよう案内）
  - 編集中のプリセットは他のプリセットが残る場合は削除不可
  - 上の2つは**サーバーが拒否する前に、UIで削除ボタンを無効にして理由を Tooltip と読み上げで示す**（他のプリセットが残るときだけ。唯一のプリセットは削除できる）
  - 唯一のプリセットを削除する場合は、プリセット対象のライブテーブル（現在の設定）も全削除される。確認ダイアログにその旨を明示した上で実行する。
- プリセットの複製
- プリセットは 1 ユーザー 50 個まで（`create-preset` で、コピーも数える。超過は `tooManyPresets`）。上限の一覧は [`docs/keybindings.md`](keybindings.md)「保存の検証と上限」
- 変更履歴の表示（直近20件。種別ラベルは行ごとの種別が1種類だけのとき〔全行「プリセット」など〕出さない。何が変わったか〔説明〕・種別・日時の絶対表記＋相対表記を並べる。相対表記は `app/lib/relative-time.ts` の `formatRelativeDate`、時刻は `suppressHydrationWarning`）
- 画面は `PageSection`（h2）の欄区切り。一覧の見出し・履歴の見出しがともに h2

### インポート（/me/import）の取り込み先の確認

画面は「取り込み先: ○○（編集中のプリセット）」を出す。別タブで編集先を切り替えた後に取り込むと別のプリセットを上書きするため、他のプリセット対象画面（devices・items 等）と同じく**取り込み先の確認**を行う。

- loader が編集中プリセットの id（`activePresetId`）を返し、`ImportDialog` が `presetId` として送り返す（プリセットが無いときは送らない）
- action 冒頭で `assertPresetIsActive` を呼び、不一致なら何も書かずに `{ success: false, error: mePresets.staleSession }` を返す
- ダイアログは `success !== true` を失敗として表示する（完了画面へ進まない）。未知の intent も `success: false` とエラー文言を返す
- 既知の制約: プリセットが 0 件の画面（`activePresetId` が null）から取り込む間に別タブでプリセットが作られた場合は、presetId が無いので確認をすり抜ける（初回取り込みは「プリセットが無ければ自動作成」の経路のため、実害は小さい）

### action ハンドラ

`useFetcher` を使用してサーバーアクションを呼び出す。フォームの `intent` フィールドで操作を識別する。

---

## 公開面の表示ソース

公開面は**メイン（`isMain`）プリセットのスナップショット**を表示する。編集中（`isActive`）の内容は公開面に出ない（メイン ＝ 編集中の場合を除く）。

### プロフィール（`app/routes/player/profile.tsx`）

1. 既定表示（URLクエリ `?preset=` なし）は**メインプリセット**。メインが編集中でもある場合はライブテーブルをそのまま使用し（同期済みのため同値）、メイン ≠ 編集中の場合はメインのスナップショットをデシリアライズして表示する。
2. URLクエリ `?preset=<presetId>` が指定された場合は、そのプリセットのスナップショットを表示する（他プリセットの参照用）。不正・削除済みIDはメインへフォールバック。
3. プリセット切替UIに「現在の設定（current）」という独立項目は存在しない。メインプリセットが既定選択（suffix「(メイン)」）となり、`?preset=` なし＝メイン表示として扱う。「プリセット表示中」バッジはメイン以外を選択したときのみ表示される。
4. メインプリセットのスナップショットは、メインが編集対象のときは保存の都度同期される（例外は [既知の制限](#既知の制限フォローアップ予定) を参照）。

### その他の公開面

| 公開面 | 実装 | ソース |
|--------|------|--------|
| 操作設定一覧（表/ビジュアル） | `app/lib/keybindings-list.server.ts` | メインのスナップショット優先・無ければライブ |
| 比較（/compare・類似走者） | `app/routes/compare.tsx` | 同上 |
| 開発者向けCSV | `app/routes/api/keybindings-csv.ts` | 同上 |
| ガイド埋め込み | `app/routes/guides/view.tsx`（`data-preset-name` 指定なしの既定） | 同上。private ユーザーは埋め込み対象外（public/unlisted のみ） |
| キー割当統計（/keybindings/stats）・全体統計（/stats） | SQL集計 | **ライブテーブルのまま**（フォローアップ → [既知の制限](#既知の制限フォローアップ予定)） |

スナップショットのデコードは `app/lib/preset-read.ts`（`decodePresetConfig` ほか）に集約されている。

---

## 編集ページとプリセットの同期

`/me/keybindings` `/me/devices` `/me/items` `/me/search-craft` の各タブには、上部に **PresetSelector**（`app/components/preset-selector.tsx`）が表示され、以下の動作をする:

- 現在の編集対象（アクティブ）プリセットを選択中として表示。**編集対象の切替はメイン（公開表示）に影響しない**
- 選択欄の `SelectValue` は子に編集中のプリセット名（メインなら「（メイン）」付き）を明示して描く（Radix は SSR で選択項目の文字を描けず、HTML の時点で欄が空になるため）
- ドロップダウンで他プリセットへ切替可能（`apply-preset` を呼ぶ。失敗したときは action が返す理由をトーストで出す）。メインのプリセットには「（メイン）」suffix を表示し、どれが公開中か分かるようにする
- 未保存の変更がある間はドロップダウンと「他のプリセットからコピー」が非活性化（`hasChanges` フラグで制御）。無効の要素にはフォーカスが届かず Tooltip は読み上げられないため、理由は行の下の見える1文（`mePresets.disabledHint`）で示し、両方の `aria-describedby` で結ぶ（「メインに設定」の帯と同じ作り）
- ルート要素に `data-me-tour="preset-selector"`（はじめにガイドのツアーが指す）
- 見た目は枠・アイコンチップの無い1行の帯（ui.md 1章・4章。h1 の説明の下・最初の欄の前に置く）。選択欄は `min-w-0 flex-1`、外側は `flex-wrap` で、どの幅でも右の操作（コピー・プリセット管理）と重ならない。リンクは `Button asChild` ＋ `Link`
- **編集中がメインでないとき**（メインが別にあるときだけ）、部品の直下に `NoticeBanner tone="info"` で「保存しても走者画面には出ません」と［メインに設定］を出す。ボタンは `/me/presets` の `set-main` を別の fetcher で送る（編集対象の切替ロック・セレクトの「…」表示は起こさない）。**未保存の変更がある間は非活性**（切替ロックと同じ考え方。再検証で編集中の内容を失わないため）。理由は帯の中に文で出し、`aria-describedby` で結ぶ
- `/me/presets` の「編集中にする」「メインに設定」ボタンの読み上げ名にはプリセット名を含める（削除ボタンと同じ）
- 各タブの選択状態は `isActive = true` のサーバー状態で同期される
- window focus 時にサーバー状態を再検証し、別タブでのプリセット切替を検知して表示中のデータを最新化する。ただし未保存の変更がある間は再検証を始めない（編集中の内容を破棄しないため）。
- 再検証の応答が返る前に編集を始めた場合も、編集は消さない: 各画面の下書きは `useLoaderSyncedDraft`（`app/hooks/use-loader-synced-draft.ts`）で loader と同期し、**下書きが前回の基準値と同じ（未変更）のときだけ新しい値で置き換える**。編集済みなら下書きを残して基準値だけ進める。**ただし編集先プリセットが変わったとき（`resetKey` = アクティブID）は編集済みでも新しい値へ置き換え、キーボード画面の差分・ダイアログの下書きも捨てる**（旧プリセットの内容を新しいプリセットへ保存しないため。`staleSession` は「ロード時のアクティブID」との突き合わせなので、再検証後は新しいIDが送られて通ってしまい、防げない）。保存成功の直後だけは強制的に置き換える（サーバーで正規化・採番された値に揃えるため）。詳細は [`docs/me-common.md`](me-common.md) の「再検証と下書きの同期」

各保存ハンドラはフォームに `presetId`（保存時点の loader のアクティブID。下書きは同じIDのものに限る）を含めて送信し、サーバー側 `assertPresetIsActive` で現在のアクティブと突き合わせる。不一致（別タブで切替済みなど）の場合は `mePresets.staleSession` エラーを返す。

保存成功後、サーバーは `syncActivePresetSnapshot` でアクティブプリセットの該当 `*Data` を更新する。

### プリセット未作成時の制限

アクティブなプリセットが無い状態では `syncActivePresetSnapshot` が無言でスキップされるため、書き込んだデータがどのプリセットにも属さなくなる。これを防ぐため、編集ページの `action` は冒頭でアクティブプリセットの有無を判定し、ガード対象の保存を `presetRequired` エラーで拒否する。ページごとのガード範囲は以下の通り:

- **`/me/keybindings`**: キー割り当て・指割り当て・リマップ・カスタムキー・カスタムアクションの登録・更新と、レガシーインポート（`import-legacy`）がすべて不可。既存データは読み取り専用で表示され、各タブ（およびキー編集モーダルの各セクション）は薄色表示・非活性化され、プリセット作成への案内が表示される。
- **`/me/devices` `/me/items` `/me/search-craft`**: すべての保存にアクティブプリセットが必須。入力方法（`users.inputMethod`）の編集は `/me/playstyle` に一本化しており、`/me/devices` の保存には含まれない（プリセットが無いときの `/me/devices` は保存できる項目が無い）。

クライアント側も、プリセットが無い場合はガード対象の編集UIを非活性化し、プリセット作成への案内を表示する。

---

## 履歴文・自動作成されるプリセット名の言語

自動作成プリセットの名前・説明・変更履歴の文言（`preset-utils.ts` の `createPreset` / `createPresetFromImport` / `createPresetFromOnboarding` / `generateInitialPresetName`）は、呼び出し側の `Translator` を引数（`t`）で受け取り、`mePresets.autoCreated*` / `initialName*` / `initialDescription*` の翻訳キーで作る（保存時のロケールで DB に入る）。新しい履歴文言は `LEGACY_APPLY_HISTORY_PATTERNS`（`プリセット「%」を適用しました` / `Applied preset "%"`）に一致しない形にする（一致すると履歴の一覧から消える）。既に保存済みの過去の文言は書き換えない。

## 既知の制限（フォローアップ予定）

- `syncActivePresetSnapshot` はライブテーブルへの書き込みトランザクションの**外**で実行される。ライブ書き込み成功後・同期完了前に処理が中断した場合、ライブテーブルとアクティブプリセットのスナップショットが一時的に乖離しうる（次回保存時に解消される）。表示面はメイン ＝ 編集中ならライブを使うため影響しないが、そのプリセットを適用し直すと古い内容でライブが上書きされる。乖離の検出・修復は `scripts/resync-active-preset-snapshots.ts`（一回限り・dry-run 既定）で行う。
- `syncActivePresetSnapshot` の導入（2026-05）より前に行われたライブ設定の編集は、スナップショットに反映されていない。上記スクリプトで再同期する。
- `isActive` / `isMain` の「ユーザーごとに高々1件」はDB制約（部分ユニークインデックス等）では強制されておらず、アプリケーションロジックで維持している。過去の不具合等で複数プリセットがアクティブになったデータは `scripts/fix-duplicate-active-presets.ts` で修復できる。
- キー割当統計（`app/lib/keybindings-stats.server.ts`）はライブテーブルへの SQL 集計のため、**編集中の内容が集計に含まれる**（メイン基準化はスナップショットの JS 集計化が必要でフォローアップ）。
- `is_main` 列の追加・バックフィルは `scripts/add-main-preset-column.ts`（一回限り・dry-run 既定）で行う。

---

## 関連ファイル

- `app/routes/me/presets.tsx` - プリセット管理画面（CRUD操作。繋ぎ方（Loop）の id リマップもここに集約）
- `app/routes/me/keybindings.tsx` / `devices.tsx` / `items.tsx` / `search-craft.tsx` - 編集ページ（PresetSelectorと保存→同期の呼び出し）
- `app/components/preset-selector.tsx` - 編集中プリセットの表示・切替コンポーネント
- `app/lib/preset-utils.ts` - プリセットのシリアライズ／同期／競合検証ユーティリティ（`serializeSearchCraftLoops` 含む）
- `app/lib/preset-read.ts` - スナップショットのデコードユーティリティ（`decodePresetSearchCraftLoops` 含む） / `shouldUsePresetSnapshot()`
- `app/lib/search-craft-loops.ts` - 繋ぎ方（Loop）の共有ロジック（遷移導出・参照解決・idリマップ。詳細は [`docs/items-searchcraft.md`](items-searchcraft.md)）
- `app/lib/schema.ts` - `configPresets`, `configHistory` テーブル定義
- `app/routes/player/profile.tsx` - プロフィール表示時のプリセット適用ロジック
