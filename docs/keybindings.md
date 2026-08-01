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
| remapType | text (enum, NOT NULL) | リマップ種別: `unset`（未設定）/ `all` / `trigger` / `chat`。デフォルト: `unset` |
| createdAt | timestamp | 作成日時 |
| updatedAt | timestamp | 更新日時 |

- ユニーク制約: `(userId, sourceKey, remapType)` の組み合わせ（同一sourceKeyでも種別が異なれば複数登録可能）
- sourceKeyは修飾キー組み合わせを許可（例: `Ctrl+KeyA`, `Shift+KeyW`）
- targetKeyは単一キーのみ（修飾キー組み合わせ不可）

### リマップ例

| sourceKey | targetKey | outputMode | 説明 |
|---|---|---|---|
| `Shift+KeyW` | `KeyA` | key | Shift+W を A に変換 |
| `KeyZ` | null | key | Z キーを無効化 |
| `KeyZ` | - | character | Z キーで文字 `"a"` を出力（outputCharacter: `"a"`） |

### リマップ種別と適用文脈

`remapType` はリマップの用途を表す。既存データ・旧スナップショットJSON（`remapType` フィールド欠落）は `unset` として読み、`unset` / `all` は全用途で有効。

| remapType | ラベル | 用途 |
|---|---|---|
| `unset` | 未設定 | 全用途（既存データのデフォルト） |
| `all` | All | 全用途 |
| `trigger` | Trigger | ゲーム入力（移動・攻撃等） |
| `chat` | Chat | チャット・サーチクラフトの文字入力 |

#### 適用文脈（RemapContext）

`app/lib/remap-utils.ts` の `filterRemapsForContext(remaps, context)`（ショートカット: `filterRemapsForTrigger()` / `filterRemapsForChat()`）で文脈外の種別を除外する。

| 文脈 | 有効な種別 | 適用箇所 |
|---|---|---|
| `trigger` | `trigger` / `all` / `unset` | バーチャルキーボード表示、画像エクスポート |
| `chat` | `chat` / `all` / `unset` | サーチクラフト逆引き（`getActualKeyInfos()`）、タイピングテスト（`simulateRemapOutput()`）。両関数とも内部で `filterRemapsForChat()` を適用するため、呼び出し側でのフィルタは不要 |

- 同一sourceKey（`normalizeKeyCombination()` + 大文字化で照合）に複数種別の行がある場合、**文脈一致 > all > unset** の優先度で1行に解決する（同順位は先勝ち、初出順維持）
- ガイドのリマップ埋め込み（`KeybindEmbedView`）は文脈フィルタではなく **trigger 種別のみ除外**（chat / all / unset を優先解決なしで全表示）。チャット・サーチクラフト用途の紹介という位置づけのため

#### All共存禁止・重複検証

- 同一sourceKeyで `all` は他種別と共存できない。保存時に `findRemapConflict()` で検証し、同一 `(sourceKey, remapType)` の完全重複（`duplicate`）と、`all` 行と他行の同一キー共存（`allConflict`）を拒否する
- 修飾キーの有無が異なるキー（例: `KeyW` と `Shift+KeyW`）は別キー扱い

#### 表示

- プロフィールのバーチャルキーボードは **Trigger / Chat の表示切替**を持つ（`trigger` / `chat` の行が1件もなければ切替UIは非表示）。切替セグメントは `RemapViewToggle`（`app/components/remap-view-toggle.tsx`）として共通化
- `/keybindings` のビジュアルカードビューにも同じ **Trigger / Chat 表示切替**がある。切替は全カード共通（切替UIはリスト上部に1つ。種別付きリマップを持つプレイヤーが1人もいなければ非表示）
- プロフィールのリマップ一覧は全種別を表示し、`RemapTypeBadge`（`app/components/remap-type-badge.tsx`）で種別バッジを付ける（`unset` はバッジなし）
- `/keybindings` 一覧（表ビュー）のリマップ列は全種別を区別なく表示する（v1仕様）
- CSVエクスポート（`remaps` セクション）には Type 列が末尾に追加される（小文字の種別、`unset` は空文字）

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
- 読み取り専用の `VirtualKeyboard` / `VirtualMouse` / `VirtualNumpad`（公開プロフィール・ビジュアルカードビュー）では、`triggerKey` のベースキーが一致するキーのツールチップ（デスクトップ）／情報モーダル（モバイル）に、アクション名・トリガーキー・カテゴリ・説明を表示する（`KeyInfoTrigger` 経由）。修飾キー組み合わせ（例: `Ctrl+KeyX`）はベースキー（`KeyX`）で照合

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
- **Raw Input OFF**: `cm360 = cm360_base / windowsMultiplier`。`windowsMultiplier` は `getWindowsMultiplierOrNull()`（`windowsSpeed` / `windowsSpeedMultiplier` から解決。下記「Windowsポインター速度乗数テーブル」参照）で求め、結果に応じて次のように扱いを分ける
  - `windowsSpeed` も `windowsSpeedMultiplier` も**未設定** → 乗数 `1.0` とみなして計算する（従来どおり）
  - どちらかが**設定済みなのに乗数が決まらない**（例: `windowsSpeed` が係数テーブル 1〜20 の範囲外） → 不正値として `cm360` を計算しない（`null`）。`x1.000` と断定すると Cursor Speed 側（同条件で計算不能）と食い違うため、振り向き側も計算不能に揃える
- **ゲーム内感度の有効範囲**: 内部値 `0..1`（表示 `0〜200%`、閉区間なので両端は有効）。範囲外（表示 `201%` 以上 / `0%` 未満）や `NaN` は無効値として扱い、`cm360` を計算しない（`null`）。判定は `isValidSensitivity()`（`app/lib/mouse-settings.ts`）

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

`windowsSpeed` が保存されていても、値が係数テーブル（1〜20）の範囲外（`/me/devices` は保存時に 1〜20 を強制するが、旧データインポート等では範囲外の値が残りうる）だと乗数は決まらない。この場合、一覧・プロフィールの Win Sens セルは値をそのまま表示しつつ `x1.000` と断定せず警告アイコン + ヒント（`keybindings.windowsSpeedUnknown`）で「乗数不明」を明示する（`WindowsSpeedCell` / `WinSensValue`）。

### カーソル速度 (Cursor Speed)

```
cursorSpeed = round(DPI * windowsMultiplier)
```

Raw Input の状態に関わらず、DPI に Windows ポインター速度の乗数をかけた実効DPIとして計算する。

- **`windowsMultiplier` が決まらなければ計算しない**（`null`）。cm/360 の Raw Input OFF 経路は「両方未設定なら `1.0` にフォールバック」する救済があるのに対し、Cursor Speed（`getWindowsMultiplierOrNull()`）はこの救済を持たず、未設定・係数不明のいずれでも `null` になる。一覧セル・CSVとも未設定時は空欄になる。単位は `DPI`（一覧・プロフィールとも `CursorSpeedCell` / `CursorSpeedValue` が末尾に付与）
- **一覧の「-」セル（cm/360・Cursor Speed）は理由をヒントで示す**。DPI未設定・感度未設定・感度範囲外・Windows乗数未設定/不明のうち該当するものを列挙し（`cm360MissingReasons` / `cursorSpeedMissingReasons`、`app/components/keybindings/keybindings-cells.tsx`）、`HintTip`（`app/components/hint-tip.tsx`）でホバー/フォーカス/タップから読める（理由が無い＝マウス設定自体が未登録の場合は素の「-」のまま）。プロフィールのデバイスカードも同じロジックを共有し、値が計算できない行を非表示にせず「-」+ 理由で残す（`app/routes/player/profile.tsx` の `TurnDistanceValue` / `CursorSpeedValue`）

### 表示パーセントへの換算

内部値（`0..1`）から表示用パーセント（`0〜200%`、Minecraft準拠）への換算は `toSensitivityPercent()`（`app/lib/mouse-settings.ts`）に一本化されている。端数は**切り捨て**（floor）で統一しており、一覧セル・CSVエクスポート・プロフィール・比較ページのいずれも同じ整数%になる（以前はプロフィール・比較ページのみ四捨五入していたため、境界値で表示が1%ずれることがあった）。比較ページは感度 `0`（0%）のプレイヤーの値も表示する（以前は truthy 判定により非表示になっていた）。

### バリデーション

- **`/me/devices` の保存（サーバー側 action）**: フォーム外からの直接 POST でも異常値が DB に入らないよう、保存時に範囲外の値を拒否してエラートーストを表示する。`NaN`（数値変換に失敗した入力）はいずれの条件にも該当せず拒否される。エラーは `{ error, field }` の形で返し、`field` にどの項目が弾かれたかを識別子（`DeviceFieldError` = `gameSensitivity` / `mouseDpi` / `windowsSpeed` / `windowsSpeedMultiplier`）で載せる

  | 項目 | 条件 | 違反時のエラーキー | `field` |
  |---|---|---|---|
  | ゲーム内感度（`gameSensitivity`） | `isValidSensitivity()`（内部値 `0..1` ＝ 表示 `0〜200%`） | `meDevices.invalidSensitivity` | `gameSensitivity` |
  | DPI（`mouseDpi`） | 正の整数 | `meDevices.invalidDpi` | `mouseDpi` |
  | Windowsポインター速度（`windowsSpeed`） | 1〜20 の整数 | `meDevices.invalidWindowsSpeed` | `windowsSpeed` |
  | カスタム係数（`windowsSpeedMultiplier`） | 0 より大きい有限数 | `meDevices.invalidWindowsSpeedMultiplier` | `windowsSpeedMultiplier` |

- **クライアント側の保存前検証（`app/routes/me/devices.tsx`）**: 上記と同じ条件・同じ文言を `validateMouseFields()` で事前チェックし、範囲外の値は送信せずその場で該当欄の直下にインラインエラー（`FieldErrorText`、`aria-invalid` / `aria-describedby` 付き）を表示して該当欄までスクロールする（`showFieldError()`）。サーバー側 action からの `field` 付きエラーも同じ表示経路（`fieldError` state）で扱うため、直接 POST 等でサーバー側だけが弾いたケースでも同様にハイライトされる。該当欄を編集するとエラー表示は消える（感度は内部値 `0..1` 欄・パーセント欄のどちらを編集しても解消扱い）

- **旧データインポート（`app/lib/legacy-import.ts`、MCSRer Hotkeys からの `/me/import`）**: 無検証の値が入ってくるため、`mouseDpi` / `gameSensitivity` / `cm360` はそれぞれ上記相当の妥当性を確認する。無効な値は**クランプせず取り込まない**（`null` として保存）。未設定（`undefined`）の項目は従来どおり既存の列を更新しない

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

全プレイヤーのキー配置を横断的に閲覧・比較する。ビューは**独立したルート**に分割されている。

| ルート | ファイル | 内容 |
|---|---|---|
| `/keybindings`（既定） | `routes/keybindings.tsx` | テーブルビュー。サブタブ（`tab`）で表示内容を変更 |
| `/keybindings/visual` | `routes/keybindings-visual.tsx` | **ビジュアルカードビュー**。走者ごとに読み取り専用の `VirtualKeyboard` でキー配置を表示。発見・参考用途向け |
| `/keybindings/stats` | `routes/keybindings-stats.tsx` | 統計ビュー（`loadKeybindingsStats`） |

- 表・ビジュアルは共有ローダー `loadKeybindingsListPlayers`（`lib/keybindings-list.server.ts`）で公開ユーザーを全件取得し、共有レイアウト `KeybindingsListLayout`（`mode="table" | "visual"`）で描画する。ユーザー絞り込み（`slugs`指定）なしの全件取得結果は60秒インメモリキャッシュされる
- ビュー切替（`ViewSwitcher`）は各ルートへの `<Link>`。表・ビジュアル間は現在の検索パラメータ（フィルタ・`tab`）を維持する。ルート遷移のため読み込み中は共通の `NavigationProgress` オーバーレイが表示される

テーブルビュー（`view=table`）のサブタブ。操作系はプレイヤー画面（プロフィール）と同じ粒度（移動 / インベントリ / 戦闘・UI）で分割する:

| タブ (`tab`) | 内容 |
|---|---|
| movement | 移動: forward, back, left, right, jump, sneak, sprint |
| inventory | インベントリ: hotbar（**1〜9 をすべて横一列で表示・折り返しなし**。デフォルト幅広め）, swapHands, inventory, pickBlock, drop |
| combat-ui | 戦闘・UI: attack, use, togglePerspective, chat, command, fullscreen |
| remaps | キーリマップ一覧 |
| custom-actions | カスタムアクション一覧 |
| mouse | マウス設定一覧（DPI、感度、cm/360等） |

- 列定義は `COLUMN_PRESETS`（`keybindings-columns.tsx`）でプリセット名＝タブ名として管理する
- **各カラムはドラッグでリサイズ可能**（TanStack Table の `columnResizeMode: "onChange"`）。`KeybindingsTable` は `getSize()` から `grid-template-columns` を算出する
- ヘッダーは折り返さない（`whitespace-nowrap` + `truncate`）。セルは `overflow-hidden` で列幅にクリップ
- アクション/ホットバー/**リマップ**列のキー表示は、各走者の `customKeys`（keyCode→keyName）を優先して**カスタムキー名**を表示する（`KeyBadge` および `getRemapSourceLabel`/`getRemapOutputLabel` の `customKeyNames` 引数）

- **統合フィルターモーダル**（`FilterDialog`）: ユーザー絞り込みと数値範囲フィルタを1つのモーダルに統合。すべてドラフトとして編集し、「適用」を押すまで URL（クエリ）へ反映しない
  - ユーザー絞り込み（`users` パラメータ）: 表示するユーザーを検索してリスト登録する横断フィルター（値ではなくユーザーで絞る）。表・ビジュアル両ビューで適用され、選択中ユーザーはヘッダー下の `UserFilterChips` で表示
  - 数値範囲フィルタ（`dpiMin/Max`, `sensMin/Max`, `cm360Min/Max`）: DPI・ゲーム内感度・振り向きで絞り込む。`sensMin/Max` は一覧の表示・CSVと同じ **0〜200%**（Minecraft準拠、内部値 `0..1` を `*200` 換算）基準で比較する（`app/hooks/use-keybindings-filters.ts`）
  - 各入力欄は number input の `min` / `max` 属性で有効範囲を示し（DPI: `min=1`、感度: `0〜200`、振り向き: `min=0`）、感度欄には有効範囲の補足テキスト（`keybindings.sensitivityRangeHint`）を常時表示する（`FilterRange` の `inputMin` / `inputMax` / `hint`）
  - 「適用」時に **min > max（範囲の取り違え）は自動で入れ替えて**救済する（`orderedRange()`）。0件になって理由が分からないより、意図どおりの範囲で結果を返すほうが摩擦が少ないため
  - 絞り込みはすべてクライアント側で適用（loader 再走なし）。loader は常に全公開ユーザーを取得する
- ソート機能（各カラム）
  - **未設定の行は昇順・降順のどちらでも末尾**。TanStack Table の `sortUndefined: "last"` は
    `undefined` のみを見る（`null` は素通りして通常比較に回り、昇順で先頭に来る）ため、
    ソート対象の `accessorFn` は未設定を必ず `undefined` で返す（`keybindings-columns.tsx` の `forSort()`）
  - **ゲーム内感度が有効範囲外**（内部値 `0..1` ＝ 表示 `0〜200%` の外）の行は、感度ソートで未設定と同様に末尾へ落ちる（`sensitivityPercent()` が `null` を返し `forSort()` で `undefined` 化）。一覧セルには値をそのまま表示しつつ警告アイコン（`TriangleAlert`、`text-warning`）+ ヒント（`keybindings.sensitivityOutOfRange`）で理由を示す（`SensitivityCell` → 共有コンポーネント `SensitivityWarning`、`app/components/sensitivity-warning.tsx`）
    - 警告・「-」理由の吹き出しは共有コンポーネント `HintTip`（`app/components/hint-tip.tsx`）が担う。ポインタ端末（マウス等）は Tooltip（ホバー/フォーカス）、タッチ端末（`pointer: coarse`）は Popover（タップ）に自動で出し分ける（`KeyInfoTrigger` と同じ方針）。SR 向けにトリガーは `<button aria-label="{説明文}">` で実装する
  - **0件になったときの空状態**（`KeybindingsEmptyState`、表・カードビュー共通）: 有効なフィルタが1つでもある場合は理由が伝わる文言（`keybindings.emptyFiltered`）とその場でフィルタを一括解除できる「クリア」ボタン（`clearFilters()`、ソート・タブは維持）を出す。フィルタなしで0件（そもそも登録者がいない）なら従来どおり `keybindings.noPlayers`
- プレイヤー名クリックでプロフィールページへ遷移
- ビジュアルカードビューは指割り当てを描画するため、loader で `playerConfig.fingerAssignments` を取得する
- **視聴者ロール（`role = "viewer"`）のユーザーは一覧から除外される**（v1.4.0〜）

### /keybindings/stats（統計ページ）

キー配置の統計・傾向分析ページ。各アクションに対するキー割り当ての分布や、マウスDPI/感度の傾向を表示する。`loadKeybindingsStats`（`lib/keybindings-stats.server.ts`）の集計結果は60秒インメモリキャッシュされる（内部的には対象アクション分を `inArray` で1クエリにまとめて取得し、JS側で集計）。

「登録走者数」「キーバインド設定者数」「マウス設定者数」の集計からは視聴者ロールを除外している（v1.4.0〜）。

#### 感度分布（`SENSITIVITY_RANGES`）

- 表示・CSV・編集画面と同じ **0〜200%**（Minecraft準拠）基準の**10区分**（`< 20%`, `20-39%`, `40-59%`, `60-79%`, `80-99%`, `100-119%`, `120-139%`, `140-159%`, `160-179%`, `180-200%`）。区分は閉端（最終区分の `200%` を含む）で、換算は一覧・CSVと同じ `toSensitivityPercent()` を使う
- **有効範囲（内部値 `0..1` ＝ 表示 `0〜200%`）外の感度は、分布・平均の母数から除外**する（`isValidSensitivity()` で判定。感度統計に中央値は無い）。感度ちょうど `0%` は含む
- 除外した人数（感度は登録済みだが範囲外）はカード下に注記として表示する（`SensitivityStats.excludedCount`、`keybindingsStats.excludedOutOfRange`）。0人のときは注記自体を出さない
- サイト全体統計（`/stats`、`app/routes/stats.tsx`）の感度分布も同じ区分設計・除外方針で揃えており、同様に除外人数の注記（`stats.sensitivityExcludedNote`）を分布カード下に表示する（未設定=`null`は元々対象外なので除外人数には含めない）

### CSVエクスポート

`/developers/export` ページから出力項目と対象ユーザーを選んでダウンロードする（v1.4.0 でフッターから移動）。

- セクション選択: `actions`, `remaps`, `custom-actions`, `mouse` の中から複数選択可能
- 対象ユーザー: 設定登録済みの全公開ユーザー（デフォルト）または個別指定（検索 UI）
- API: `GET /api/keybindings-csv?sections=...&userSlugs=...`（`userSlugs` は任意、未指定なら全ユーザー）
- キーバインドは各プレイヤーのキーボード配列に応じた表示ラベルで出力
- `mouse` セクションの `cm/360` `Cursor Speed` は一覧と同じ計算関数（`calculateCm360` / `calculateCursorSpeed`）に統一されており、計算できない場合は空欄。`Win Sens Multiplier` 列も `windowsSpeed` / `windowsSpeedMultiplier` が未設定なら空欄（`1` にフォールバックしない）。`Sensitivity (%)` 列は有効範囲外の値も含め生データをそのまま出力する

---

## 編集ページとプリセットの同期

`/me/keybindings` の編集ページは v1.4.0 で次のように変更された：

- 上部に **PresetSelector** ドロップダウンを表示（詳細は [`docs/presets.md`](presets.md) 参照）
- 保存（`save-keybindings` / `save-remaps` / `save-fingers` / `save-custom-keys` / `save-custom-actions` / `save-all`）の各 intent で `syncActivePresetSnapshot(db, userId, kinds)` を呼び、アクティブプリセットの該当 `*Data` JSON を最新化（書き込みスルー）
- カスタムキー定義（`customKeys`）とカスタムアクション（`customActions`）もプリセットスナップショットの対象（`customKeysData` / `customActionsData` カラム）
- 保存リクエストにロード時の `presetId` を含め、別タブ等で切替済みなら `mePresets.staleSession` で拒否

---

## キーボードビューの画像出力

プロフィール（`/player/:slug?tab=keybindings`）のキーボードビュー右上に「画像で保存」ボタンを表示し、モーダルからキーボードビューを PNG として書き出せる。

- **含める範囲**: 走者情報（アバター・名前）/ キーボード / テンキー（TKL では非表示）/ マウス をチェックボックスで選択
  - 走者情報ブロックは `MinecraftAvatar`（頭・データURL描画なので画像化時の CORS 汚染なし）+ 表示名 + `@MCID`
- **記載内容**: リマップ・指の色・操作内容 をスイッチで個別にオン/オフ（`VirtualKeyboard` 等の `showRemaps` / `showFingerAssignments` / `showActionLabels` に対応）
  - 指の色を表示する場合は `FingerLegend`（凡例）も自動で出力に含める
- **テーマ**: ライト / ダーク / ウルトラダーク を選択。プレビュー用ノードにテーマクラス（`.light` / `.dark` / `.ultra-dark`）を付与して CSS 変数を局所適用するため、ページのグローバルテーマに依存せず出力できる
  - そのため指色チップの文字色は `dark:` 変種ではなく CSS 変数 `--finger-chip-fg`（`--color-finger-chip-foreground`）で切り替える
- 画像化はプレビューノードを `html-to-image` でラスタライズ（クライアントサイド完結）
  - **ダウンロード**: `toPng` で PNG データURLを生成して保存
  - **コピー**: `toBlob` で PNG Blob を生成し `navigator.clipboard.write`（`ClipboardItem`）でクリップボードへ。非対応ブラウザ（`ClipboardItem` 無し）ではコピーボタンを表示しない

## 関連ファイル

| ファイル | 役割 |
|---|---|
| `app/components/keybindings/keyboard-export-dialog.tsx` | キーボードビューの画像出力モーダル（範囲・記載内容・テーマ選択 + `html-to-image` 出力） |
| `app/lib/keybindings.ts` | 定数定義、キーコード正規化、ラベル変換、修飾キー組み合わせ処理、指割り当て、コントローラー設定 |
| `app/lib/remap-utils.ts` | リマップのUI変換、永続化ペイロード生成、出力ラベル、種別フィルタ（`filterRemapsForContext` 等）・重複検証（`findRemapConflict`）、サーチクラフト連携 |
| `app/components/remap-row.tsx` | リマップ編集行（種別Select対応、Playground と共通） |
| `app/components/remap-type-badge.tsx` | リマップ種別バッジ（Trigger / Chat / All、未設定は非表示） |
| `app/lib/schema.ts` | DBスキーマ定義（keybindings, keyRemaps, customKeys, customActions, playerConfigs） |
| `app/routes/keybindings.tsx` | 一覧（表ビュー）ルート |
| `app/routes/keybindings-visual.tsx` | 一覧（ビジュアルビュー）ルート |
| `app/routes/keybindings-stats.tsx` | 統計ビュールート |
| `app/lib/keybindings-list.server.ts` | 表・ビジュアル共有の走者一覧ローダー |
| `app/components/keybindings/keybindings-list-layout.tsx` | 表・ビジュアル共有レイアウト（タイトル・ツールバー・フィルタ適用） |
| `app/components/keybindings/card-view.tsx` | ビジュアルカードビュー（`VirtualKeyboard` を読み取り専用で再利用） |
| `app/components/keybindings/filter-dialog.tsx` | 統合フィルターモーダル（ユーザー絞り込み + 数値範囲、適用で反映） |
| `app/components/keybindings/user-filter.tsx` | ユーザー検索・選択リスト（`UserSelectList`）と選択チップ（`UserFilterChips`、`users` パラメータ） |
| `app/components/keybindings/keybindings-empty-state.tsx` | 0件表示（表・カードビュー共通）。フィルタ起因なら理由 + クリアボタンを出す |
| `app/components/sensitivity-warning.tsx` | 感度が有効範囲外のときの警告表示（値 + 警告アイコン + ヒント）。一覧・プロフィール共通 |
| `app/components/hint-tip.tsx` | 短い補足説明の共有トリガー（ポインタ端末は Tooltip、タッチ端末は Popover に自動で出し分ける） |
| `app/routes/keybindings-stats.tsx` | キー配置の統計・傾向ページ |
| `app/routes/me/keybindings.tsx` | 自分のキー配置編集ページ |
| `app/routes/me/devices.tsx` | 自分のデバイス設定編集ページ |
| `app/components/virtual-keyboard.tsx` | バーチャルキーボードコンポーネント |
| `app/routes/api/keybindings-csv.ts` | CSVエクスポートAPIエンドポイント |
