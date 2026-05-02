# キー配置・操作設定 仕様書

Minefolioにおけるキーバインド、キーリマップ、マウス/キーボード/コントローラー設定、および一覧・比較ページの仕様を定義する。

---

## キーバインド

### テーブル: `keybindings`

| カラム | 型 | 説明 |
|---|---|---|
| id | text (PK) | CUID2 |
| userId | text (FK → users) | ユーザーID |
| action | text | アクション名 |
| keyCode | text | 割り当てキーコード |
| category | text (enum) | `movement` / `combat` / `inventory` / `ui` |
| createdAt | timestamp | 作成日時 |
| updatedAt | timestamp | 更新日時 |

- ユニーク制約: `(userId, action)` の組み合わせ

### アクション一覧

#### キーボード/マウス用アクション

| カテゴリ | アクション | 日本語ラベル |
|---|---|---|
| movement | forward | 前進 |
| movement | back | 後退 |
| movement | left | 左移動 |
| movement | right | 右移動 |
| movement | jump | ジャンプ |
| movement | sneak | スニーク |
| movement | sprint | ダッシュ |
| combat | attack | 攻撃/破壊 |
| combat | use | 使用/設置 |
| combat | pickBlock | ブロック選択 |
| combat | drop | アイテムを捨てる |
| inventory | inventory | インベントリ |
| inventory | swapHands | オフハンド |
| inventory | hotbar1〜hotbar9 | ホットバー1〜9 |
| ui | togglePerspective | 視点切替 |
| ui | fullscreen | 全画面 |
| ui | chat | チャット |
| ui | command | コマンド |

#### コントローラー用アクション

コントローラーではforward/back/left/rightは左スティック操作のため省略。ホットバーはLB/RB方式（`hotbarLeft` / `hotbarRight`）。

| アクション | デフォルトキー |
|---|---|
| jump | GamepadA |
| sneak | GamepadB |
| sprint | GamepadL3 |
| attack | GamepadRT |
| use | GamepadLT |
| pickBlock | GamepadR3 |
| drop | GamepadDpadDown |
| inventory | GamepadY |
| swapHands | GamepadX |
| hotbarLeft | GamepadLB |
| hotbarRight | GamepadRB |
| togglePerspective | GamepadDpadUp |
| chat | GamepadDpadRight |

### キーコード形式

JavaScript `KeyboardEvent.code` 準拠のPascalCase形式を正規形とする。

| 入力形式 | 正規化結果 |
|---|---|
| `key.keyboard.w` (Minecraft形式) | `KeyW` |
| `KEYW` (大文字形式) | `KeyW` |
| `KeyW` (PascalCase) | `KeyW` |
| `key.mouse.left` | `Mouse0` |
| `key.keyboard.space` | `Space` |

マウスボタン: `Mouse0`(左) / `Mouse1`(右) / `Mouse2`(中) / `Mouse3`(サイド1) / `Mouse4`(サイド2)

コントローラー: `GamepadA`, `GamepadB`, `GamepadX`, `GamepadY`, `GamepadLB`, `GamepadRB`, `GamepadLT`, `GamepadRT`, `GamepadL3`, `GamepadR3`, `GamepadDpadUp/Down/Left/Right`, `GamepadStart`, `GamepadSelect`

### 修飾キー組み合わせ

`+` 区切りで修飾キーとキーコードを連結する。修飾キーの正規化順序: `Ctrl > Shift > Alt > Meta`

```
Ctrl+Shift+KeyA   # Ctrl + Shift + A
Shift+Mouse0      # Shift + 左クリック
```

`parseKeyCombination()` で構造化、`formatKeyCombination()` で文字列化。`normalizeKeyCombination()` で順序・大文字小文字を正規化して比較可能にする。

### 未割り当て

```typescript
export const UNBOUND_KEY = "_UNBOUND";
```

キーが未割り当ての場合、`keyCode` に `"_UNBOUND"` を格納する。表示時は `"-"` と表示される。

---

## キーリマップ

### テーブル: `key_remaps`

| カラム | 型 | 説明 |
|---|---|---|
| id | text (PK) | CUID2 |
| userId | text (FK → users) | ユーザーID |
| sourceKey | text | 入力元キー（修飾キー組み合わせ可。例: `Shift+KeyW`） |
| targetKey | text (nullable) | 出力先キー（単一キーのみ。`null` = 無効化） |
| software | text (nullable) | 使用ソフトウェア名 |
| notes | text (nullable) | メモ |
| outputMode | text (enum) | `key`（キー出力）/ `character`（文字出力）。デフォルト: `key` |
| outputCharacter | text (nullable) | 文字出力モード時の出力文字（例: `"a"`, `"@"`） |
| createdAt | timestamp | 作成日時 |
| updatedAt | timestamp | 更新日時 |

- ユニーク制約: `(userId, sourceKey)` の組み合わせ
- sourceKeyは修飾キー組み合わせを許可（例: `Ctrl+KeyA`, `Shift+KeyW`）
- targetKeyは単一キーのみ（修飾キー組み合わせ不可）

### リマップ例

| sourceKey | targetKey | outputMode | 説明 |
|---|---|---|---|
| `Shift+KeyW` | `KeyA` | key | Shift+W を A に変換 |
| `KeyZ` | null | key | Z キーを無効化 |
| `KeyZ` | - | character | Z キーで文字 `"a"` を出力（outputCharacter: `"a"`） |

### ターゲットキー判定

`isKeyRemapTarget()` で Web Keyboard Code 形式のキーコードかどうかを検証する。正規表現パターンに一致しないターゲットは「特殊リマップターゲット」（`isSpecialRemapTarget()`）として扱われ、文字出力等に対応する。

### サーチクラフトとの連携

`getActualKeyInfos()` 関数で、サーチ文字列の各文字に対してリマップを逆引きし、実際に押すべきキーを算出する。修飾キー付きリマップの場合、表示ラベルに修飾キー記号（`◆`=Ctrl, `⇧`=Shift, `⌥`=Alt, `◇`=Meta）を付与する。

---

## カスタムキー

### テーブル: `custom_keys`

| カラム | 型 | 説明 |
|---|---|---|
| id | text (PK) | CUID2 |
| userId | text (FK → users) | ユーザーID |
| keyCode | text | キーコード |
| keyName | text | 表示名 |
| category | text (enum) | `mouse` / `keyboard` / `controller` |
| position | text (nullable) | JSON: `{ x: number, y: number }` |
| size | text (nullable) | JSON: `{ width: number, height: number }` |
| notes | text (nullable) | メモ |
| createdAt | timestamp | 作成日時 |
| updatedAt | timestamp | 更新日時 |

- ユニーク制約: `(userId, keyCode)` の組み合わせ
- バーチャルキーボード上でのカスタムキー位置・サイズを定義
- マウスのサイドボタンやコントローラーの追加ボタンなど、標準レイアウトにないキーを表現

---

## カスタムアクション

### テーブル: `custom_actions`

| カラム | 型 | 説明 |
|---|---|---|
| id | text (PK) | CUID2 |
| userId | text (FK → users) | ユーザーID |
| actionName | text | アクション名（例: "DPIスイッチ", "感度切替"） |
| description | text (nullable) | アクションの説明 |
| category | text (enum) | `other` / `macro` / `tool` |
| triggerKey | text | トリガーキー（修飾キー組み合わせ可） |
| displayOrder | integer | 表示順序（デフォルト: 0） |
| createdAt | timestamp | 作成日時 |
| updatedAt | timestamp | 更新日時 |

- ユニーク制約: `(userId, triggerKey)` の組み合わせ
- 外部ツール（マクロソフト、DPIスイッチ等）と連携するカスタムアクションを定義
- 標準のMinecraftアクションに含まれない任意の操作を登録可能

---

## マウス設定

### テーブル: `player_configs`（マウス関連カラム）

| カラム | 型 | 説明 |
|---|---|---|
| mouseDpi | integer (nullable) | マウスDPI |
| gameSensitivity | real (nullable) | ゲーム内感度 |
| windowsSpeed | integer (nullable) | Windowsポインター速度（1〜20） |
| windowsSpeedMultiplier | real (nullable) | 独自乗数（設定時はwindowsSpeedより優先） |
| mouseAcceleration | boolean | マウス加速（デフォルト: false） |
| rawInput | boolean | Raw Input（デフォルト: true） |
| cm360 | real (nullable) | 振り向き距離（cm/360度） |
| mouseModel | text (nullable) | マウスモデル名 |

### 振り向き計算式 (cm/360)

```
f = 0.6 * sensitivity + 0.2
cm360_base = 6096 / (DPI * 8 * f^3) / 2
```

- **Raw Input ON**: `cm360 = cm360_base`
- **Raw Input OFF**: `cm360 = cm360_base / windowsMultiplier`

### Windowsポインター速度乗数テーブル

| 段階 | 乗数 | 段階 | 乗数 |
|---|---|---|---|
| 1 | 0.03125 | 11 | 1.25 |
| 2 | 0.0625 | 12 | 1.5 |
| 3 | 0.125 | 13 | 1.75 |
| 4 | 0.25 | 14 | 2 |
| 5 | 0.375 | 15 | 2.25 |
| 6 (default) | 0.5 | 16 | 2.5 |
| 7 | 0.625 | 17 | 2.75 |
| 8 | 0.75 | 18 | 3 |
| 9 | 0.875 | 19 | 3.25 |
| 10 | 1 | 20 | 3.5 |

`windowsSpeedMultiplier` が設定されている場合はそちらを優先し、`windowsSpeed` からの自動変換は行わない。

---

## キーボード設定

### テーブル: `player_configs`（キーボード関連カラム）

| カラム | 型 | 説明 |
|---|---|---|
| keyboardLayout | text (enum) | `JIS` / `US` / `JIS_TKL` / `US_TKL` |
| keyboardModel | text (nullable) | キーボードモデル名（自由入力） |
| fingerAssignments | text (nullable) | 指割り当て（JSON） |

### キーボード配列による表示差異

JIS配列とUS配列で同一キーコードの表示ラベルが異なる。

| キーコード | JIS | US |
|---|---|---|
| Semicolon | `:` | `;` |
| Quote | `^` | `'` |
| BracketLeft | `@` | `[` |
| BracketRight | `[` | `]` |
| Backslash | `]` | `\` |
| Backquote | `半角` | `` ` `` |

### 指割り当て

`fingerAssignments` はJSON形式で、各キーコードに対応する指の種類を配列で格納する。

指の種類: `left-pinky`, `left-ring`, `left-middle`, `left-index`, `left-thumb`, `right-thumb`, `right-index`, `right-middle`, `right-ring`, `right-pinky`

デフォルトはWASD配置に基づく一般的な指割り当てが定義されている（`DEFAULT_FINGER_ASSIGNMENTS`）。

---

## コントローラー設定

### テーブル: `player_configs`（コントローラー関連カラム）

| カラム | 型 | 説明 |
|---|---|---|
| controllerSettings | text (nullable) | JSON形式のコントローラー設定 |

### controllerSettings JSON構造

```typescript
type ControllerSettings = {
  controllerModel: string | null;  // コントローラーモデル名
  lookSensitivity: number | null;  // 視点感度（デフォルト: 50）
  invertYAxis: boolean;            // Y軸反転（デフォルト: false）
  vibration: boolean;              // 振動（デフォルト: true）
};
```

### 入力方法

`users.inputMethod` で入力方法を管理する。

| 値 | ラベル | 短縮 |
|---|---|---|
| keyboard_mouse | キーボード/マウス | KBM |
| controller | コントローラー | Controller |
| touch | タッチ | Touch |

---

## 一覧・比較ページ

### /keybindings（キー配置一覧）

全プレイヤーのキー配置を横断的に閲覧・比較するページ。タブ切り替えで表示内容を変更する。

| タブ | 内容 |
|---|---|
| actions | アクション別キー割り当て一覧 |
| remaps | キーリマップ一覧 |
| custom-actions | カスタムアクション一覧 |
| mouse | マウス設定一覧（DPI、感度、cm/360等） |

- プレイヤー検索・フィルタリング機能
- ソート機能（各カラム）
- プレイヤー名クリックでプロフィールページへ遷移
- **視聴者ロール（`role = "viewer"`）のユーザーは一覧から除外される**（v1.4.0〜）

### /keybindings/stats（統計ページ）

キー配置の統計・傾向分析ページ。各アクションに対するキー割り当ての分布や、マウスDPI/感度の傾向を表示する。

「登録走者数」「キーバインド設定者数」「マウス設定者数」の集計からは視聴者ロールを除外している（v1.4.0〜）。

### CSVエクスポート

`/developers/export` ページから出力項目と対象ユーザーを選んでダウンロードする（v1.4.0 でフッターから移動）。

- セクション選択: `actions`, `remaps`, `custom-actions`, `mouse` の中から複数選択可能
- 対象ユーザー: 設定登録済みの全公開ユーザー（デフォルト）または個別指定（検索 UI）
- API: `GET /api/keybindings-csv?sections=...&userSlugs=...`（`userSlugs` は任意、未指定なら全ユーザー）
- キーバインドは各プレイヤーのキーボード配列に応じた表示ラベルで出力

---

## 編集ページとプリセットの同期

`/me/keybindings` の編集ページは v1.4.0 で次のように変更された：

- 上部に **PresetSelector** ドロップダウンを表示（詳細は [`docs/presets.md`](presets.md) 参照）
- 保存（`save-keybindings` / `save-remaps` / `save-fingers` / `save-custom-keys` / `save-custom-actions` / `save-all`）の各 intent で `syncActivePresetSnapshot(db, userId, kinds)` を呼び、アクティブプリセットの該当 `*Data` JSON を最新化（書き込みスルー）
- カスタムキー定義（`customKeys`）とカスタムアクション（`customActions`）もプリセットスナップショットの対象（`customKeysData` / `customActionsData` カラム）
- 保存リクエストにロード時の `presetId` を含め、別タブ等で切替済みなら `mePresets.staleSession` で拒否

---

## 関連ファイル

| ファイル | 役割 |
|---|---|
| `app/lib/keybindings.ts` | 定数定義、キーコード正規化、ラベル変換、修飾キー組み合わせ処理、指割り当て、コントローラー設定 |
| `app/lib/remap-utils.ts` | リマップのUI変換、永続化ペイロード生成、出力ラベル、サーチクラフト連携 |
| `app/lib/schema.ts` | DBスキーマ定義（keybindings, keyRemaps, customKeys, customActions, playerConfigs） |
| `app/routes/keybindings.tsx` | 全プレイヤーのキー配置一覧ページ |
| `app/routes/keybindings-stats.tsx` | キー配置の統計・傾向ページ |
| `app/routes/me/keybindings.tsx` | 自分のキー配置編集ページ |
| `app/routes/me/devices.tsx` | 自分のデバイス設定編集ページ |
| `app/components/virtual-keyboard.tsx` | バーチャルキーボードコンポーネント |
| `app/routes/api/keybindings-csv.ts` | CSVエクスポートAPIエンドポイント |
