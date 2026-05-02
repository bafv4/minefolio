# 設定プリセット 仕様書

## 概要

プレイヤーの操作設定（キーバインド、デバイス設定、リマップ、アイテム配置、サーチクラフト）をプリセットとして保存・切替できる機能。複数の設定を名前付きで管理し、アクティブなプリセットをプロフィール表示に反映する。

---

## プリセット (configPresets)

### テーブル定義

| カラム | 型 | 説明 |
|--------|-----|------|
| `id` | text (PK) | CUID2 |
| `userId` | text (FK → users) | ユーザーID |
| `name` | text | プリセット名（必須） |
| `description` | text | 説明（任意） |
| `isActive` | boolean | アクティブフラグ（デフォルト: false） |
| `keybindingsData` | text (JSON) | キーバインドのスナップショット |
| `playerConfigData` | text (JSON) | プレイヤー設定のスナップショット |
| `remapsData` | text (JSON) | リマップのスナップショット |
| `fingerAssignmentsData` | text (JSON) | 指割り当て |
| `itemLayoutsData` | text (JSON) | アイテム配置のスナップショット |
| `searchCraftsData` | text (JSON) | サーチクラフトのスナップショット |
| `customKeysData` | text (JSON) | カスタムキー定義のスナップショット |
| `customActionsData` | text (JSON) | カスタムアクションのスナップショット |
| `createdAt` | timestamp | 作成日時 |
| `updatedAt` | timestamp | 更新日時 |

### インデックス

- `idx_config_presets_user_id` - ユーザーIDで検索
- `idx_config_presets_is_active` - アクティブプリセットの高速検索

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
}
```

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
  searchStr: string | null;
  comment: string | null;
  timing?: "bastion" | "fortress" | "other" | null;
}
```

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

### isActive フラグの管理

- ユーザーごとに最大1つのプリセットが `isActive = true`
- プリセット切替時: `apply-preset` がトランザクション内で **ライブテーブルを全削除→プリセットスナップショットから完全復元** し、既存のアクティブプリセットを `false` にしてから新しいプリセットを `true` に設定する。
- アクティブプリセット = 「現在編集中のプリセット = ライブテーブル」というモデル。`/me/keybindings` 等の編集ページの保存時には `syncActivePresetSnapshot` がアクティブプリセットの該当 `*Data` を最新化する（書き込みスルー）。

### シリアライズ関数

`app/lib/preset-utils.ts` で提供:

| 関数 | 説明 |
|------|------|
| `serializeKeybindings(keybindings)` | `Keybinding[]` → `PresetKeybindingData[]` のJSON文字列 |
| `serializePlayerConfig(config)` | `PlayerConfig` → `PresetPlayerConfigData` のJSON文字列 |
| `serializeRemaps(remaps)` | `KeyRemap[]` → `PresetRemapData[]` のJSON文字列 |
| `serializeItemLayouts(layouts)` | `ItemLayout[]` → `PresetItemLayoutData[]` のJSON文字列 |
| `serializeSearchCrafts(crafts)` | `SearchCraft[]` → `PresetSearchCraftData[]` のJSON文字列 |
| `serializeCustomKeys(keys)` | `CustomKey[]` → `PresetCustomKeyData[]` のJSON文字列 |
| `serializeCustomActions(actions)` | `CustomAction[]` → `PresetCustomActionData[]` のJSON文字列 |
| `createPreset(db, options)` | プリセットをDBに作成 |
| `syncActivePresetSnapshot(db, userId, kinds)` | ライブテーブルの内容をアクティブプリセットの `*Data` に反映 |
| `assertPresetIsActive(db, userId, presetId)` | フォーム送信時の `presetId` がアクティブプリセットと一致するか検証（不一致なら `PresetMismatchError`） |

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
| `newData` | text (JSON) | 変更後のデータ |
| `presetId` | text (FK → configPresets) | 関連プリセットID（任意、ON DELETE SET NULL） |
| `createdAt` | timestamp | 作成日時 |

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

- プリセット一覧表示（アクティブプリセットにバッジ表示）
- 新規プリセット作成（現在の設定をスナップショットとして保存）
- プリセットの編集（名前・説明の変更）
- プリセットの削除（確認ダイアログ付き）
- プリセットの切替（アクティブ化）
- プリセットの複製
- 変更履歴の表示

### action ハンドラ

`useFetcher` を使用してサーバーアクションを呼び出す。フォームの `intent` フィールドで操作を識別する。

---

## プロフィール表示時のプリセット適用

`app/routes/player/profile.tsx` でプロフィールを表示する際:

1. デフォルト表示はライブテーブル（`keybindings`, `playerConfigs`, `keyRemaps`, `itemLayouts`, `searchCrafts`, `customKeys`）の内容をそのまま使用する。
2. URLクエリ `?presetId=...` が指定された場合は、そのプリセットのスナップショットJSONをデシリアライズして上書き表示する（過去プリセットの参照用）。
3. アクティブプリセットのスナップショットは編集タブの保存時に都度同期されているため、ライブテーブルとほぼ常に同一内容を持つ。

---

## 編集ページとプリセットの同期

`/me/keybindings` `/me/devices` `/me/items` `/me/search-craft` の各タブには、上部に **PresetSelector**（`app/components/preset-selector.tsx`）が表示され、以下の動作をする:

- 現在のアクティブプリセットを選択中として表示
- ドロップダウンで他プリセットへ切替可能（`apply-preset` を呼ぶ）
- 未保存の変更がある間はドロップダウンが非活性化（`hasChanges` フラグで制御）。Tooltipで理由を表示。
- 各タブの選択状態は `isActive = true` のサーバー状態で同期される

各保存ハンドラはフォームに `presetId`（ロード時のアクティブID）を含めて送信し、サーバー側 `assertPresetIsActive` で現在のアクティブと突き合わせる。不一致（別タブで切替済みなど）の場合は `mePresets.staleSession` エラーを返す。

保存成功後、サーバーは `syncActivePresetSnapshot` でアクティブプリセットの該当 `*Data` を更新する。

---

## 関連ファイル

- `app/routes/me/presets.tsx` - プリセット管理画面（CRUD操作）
- `app/routes/me/keybindings.tsx` / `devices.tsx` / `items.tsx` / `search-craft.tsx` - 編集ページ（PresetSelectorと保存→同期の呼び出し）
- `app/components/preset-selector.tsx` - 編集中プリセットの表示・切替コンポーネント
- `app/lib/preset-utils.ts` - プリセットのシリアライズ／同期／競合検証ユーティリティ
- `app/lib/schema.ts` - `configPresets`, `configHistory` テーブル定義
- `app/routes/player/profile.tsx` - プロフィール表示時のプリセット適用ロジック
