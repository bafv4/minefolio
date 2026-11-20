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

- 横長のキー配置を包む `HorizontalScrollArea`（`app/components/horizontal-scroll-area.tsx`）は、はみ出し時（md 未満）に「横にスクロールできます」のヒントを**スクロール領域の上**に表示し（下だと縦に長い内容で見落とす・下端固定 UI に隠れるため）、左右端のフェードは `w-12`。`/player`・`/me/keybindings`・ガイドのキー配置埋め込みで共通
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
| cm360 | real (nullable) | 振り向き距離。列名は cm360 だが、値は 180° 振り向く距離（cm/180°） |
| mouseModel | text (nullable) | マウスモデル名 |

### 振り向き計算式（cm/180°。関数名は calculateCm360）

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

内部値（`0..1`）から表示用パーセント（`0〜200%`、Minecraft準拠）への換算は `toSensitivityPercent()`（`app/lib/mouse-settings.ts`）に一本化されている。端数は**切り捨て**（floor）で統一しており、一覧セル・CSVエクスポート・プロフィール・比較ページ・`/me/devices` の編集フォーム（内部値欄↔パーセント欄の相互変換）のいずれも同じ整数%になる（以前はプロフィール・比較ページが四捨五入、`/me/devices` は独自の四捨五入ロジックを持っていたため、境界値で表示が1%ずれることがあった）。逆変換（表示%→内部値、フォーム保存値の正規形＝小数4桁固定の文字列）は `fromSensitivityPercent()` が担う。パーセントの上限は定数 `SENSITIVITY_PERCENT_MAX`（`= 200`）で持ち、フィルタダイアログの入力上限（`inputMax`）や感度ビン区分（`SENSITIVITY_PERCENT_BINS`、後述）もここから導出する。比較ページは感度 `0`（0%）のプレイヤーの値も表示する（以前は truthy 判定により非表示になっていた）。

### バリデーション

マウス設定フォームの妥当性検証（パース・検証条件）は `app/lib/mouse-settings.ts` の `parseMouseSettingsInput()` / `validateMouseSettings()` に一本化されており、サーバー側 action・クライアント側の保存前チェックの両方がこれを呼ぶ（値は該当 Input の `id` と揃えた `MouseSettingsField` = `gameSensitivity` / `mouseDpi` / `windowsSpeed` / `windowsSpeedMultiplier` で返す）。

- **`/me/devices` の保存（サーバー側 action）**: フォーム外からの直接 POST でも異常値が DB に入らないよう、保存時に範囲外の値を拒否してエラートーストを表示する。`NaN`（数値変換に失敗した入力）はいずれの条件にも該当せず拒否される。エラーは `{ error, field }` の形で返す
- **`/me/devices` の欄を離れたときの検証（クライアント）**: DPI・ゲーム内感度（0-1 / % の両方）・Win Sens 乗数は、フォーカスが外れた（blur）時点でその欄だけ保存時と同じ `validateMouseSettings` を走らせ、誤りを欄の下に出す（入力の途中では出さない）。保存済みの値のまま触っていない欄は検証しない。エラーは欄ごとに保持し（2つの欄が範囲外なら両方に出す）、別の欄の blur では消えず、その欄を直して blur（または編集）すると消える。感度の組は `gameSensitivity` に出す。**FOV・GUI スケール**も同じ形で検証する（保存と同じ `isValidFov` / `isValidGuiScale`。欄の下に範囲のヒント「30~110」「0~10」を常時出す）。保存時は範囲外の欄すべてにエラーを出し、画面上で最初の欄へスクロールしてトーストを出す。action が返した `field`（`fov` / `guiScale` を含む）も該当の欄に出す

  | 項目 | 条件 | 違反時のエラーキー | `field` |
  |---|---|---|---|
  | ゲーム内感度（`gameSensitivity`） | `isValidSensitivity()`（内部値 `0..1` ＝ 表示 `0〜200%`） | `meDevices.invalidSensitivity` | `gameSensitivity` |
  | DPI（`mouseDpi`） | `isValidMouseDpi()`（正の整数） | `meDevices.invalidDpi` | `mouseDpi` |
  | Windowsポインター速度（`windowsSpeed`） | 乗数テーブル（1〜20）のキー | `meDevices.invalidWindowsSpeed` | `windowsSpeed` |
  | カスタム係数（`windowsSpeedMultiplier`） | 0 より大きい有限数 | `meDevices.invalidWindowsSpeedMultiplier` | `windowsSpeedMultiplier` |
  - 補足と欄の対応: 例の値の placeholder は「例: 0.50」のように例だと分かる形（`meDevices.exampleValue`）。範囲などの補足文（`0.0~1.0`・`0~200%`・カスタム係数のヒント）は `aria-describedby` で欄と結ぶ。キーボード・マウス・コントローラーの「モデル」欄は `aria-label` で「キーボードのモデル」等に区別する

- **クライアント側の保存前検証（`app/routes/me/devices.tsx`）**: 上記と同じ `validateMouseSettings()` で事前チェックし、範囲外の値は送信せずその場で該当欄の直下にインラインエラー（`FieldErrorText`、`aria-invalid` / `aria-describedby` 付き）を表示して該当欄までスクロールする（`showFieldError()`）。サーバー側 action からの `field` 付きエラーも同じ表示経路（`fieldError` state）で扱うため、直接 POST 等でサーバー側だけが弾いたケースでも同様にハイライトされる。該当欄を編集するとエラー表示は消える（感度は内部値 `0..1` 欄・パーセント欄のどちらを編集しても解消扱い）

- **旧データ取り込み（`importFromLegacy`）の書き込みと呼び出し元**: 旧 API の取得（外部 fetch）はトランザクションの外で先に行う。ライブテーブルへの書き込み（既存のキーバインド・設定・カスタムキー・リマップ・アイテム配置・サーチクラフトの削除と挿入）と、**取り込んだ内容での新しいプリセットの作成（編集先にする）は 1 トランザクション**にまとめる（`createPreset` は呼び出し側のトランザクションに参加できる）。途中で失敗すると全体がロールバックされ、既存のライブデータも既存のプリセットも元のまま残り、新しいプリセットも作られない。取り込みのたびに新しいプリセットを作るので（プリセットが 0 件でも 1 件以上でも同じ）、既存プリセットのスナップショット・`updatedAt` は変わらず、取り込み後も元のプリセットへ切り替えて戻せる。ユーザーへ返す失敗文言は翻訳済みの固定文言（走者が見つからない `meImport.legacyNotFound`・その他 `meImport.legacyImportFailed`）だけで、drizzle のエラー文（SQL を含む）は返さない。ログも `errorSummary` を通す。呼び出し元（`/me/keybindings` の `import-legacy`・`/me/account` の `import_legacy`）はどちらも同じ結果になり、取り込み後のスナップショット同期は不要（新しいプリセットが完全なスナップショットを持つ）
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

JIS配列とUS配列で同一キーコードの表示ラベルが異なる。キーコードは物理的な位置（ブラウザの `KeyboardEvent.code`・Minecraft のキー名とも US 配列の位置で名付ける）なので、JIS の表示は仮想キーボードの JIS 配列（`JIS_MAIN_LAYOUT`）の刻印と同じにする。

配列名の判定は `isJisLayout` / `isTklLayout`（`app/lib/keybindings.ts`）に集約している。保存値は `JIS` / `JIS_TKL` / `US` / `US_TKL` だが、ハイフン表記（`JIS-TKL` / `US-TKL`）や大文字小文字違いも受け付ける（大文字化して `JIS` で始まれば JIS、`TKL` を含めば TKL）。`getKeyLabel` と `VirtualKeyboard` は同じ判定を使う。

| キーコード | JIS | US |
|---|---|---|
| Equal | `^` | `=` |
| Quote | `:` | `'` |
| BracketLeft | `@` | `[` |
| BracketRight | `[` | `]` |
| Backslash | `]` | `\` |
| Backquote | `半角` | `` ` `` |
| IntlYen | `半角` | `¥` |
| IntlBackslash | `¥` | （ラベル表なし・生のコード） |

#### JIS の半角キーと ¥ キー（サイトの約束ごと）

- サイトの JIS 仮想キーボードは、**半角キーを `IntlYen`、¥ キーを `IntlBackslash`** として描く（クリックで渡るコードもこれ。既存データとの互換のため）
- 実キーボードの半角/全角は、ブラウザでもゲーム（GLFW）でも `Backquote`。Minecraft 取り込みの `key.keyboard.grave.accent` も `Backquote` になる。そのため **JIS では `Backquote` を `IntlYen`（半角）の別名**として扱い、仮想キーボードの半角キーには `IntlYen` と `Backquote` の両方の割り当て（keybindings / fingerAssignments / remaps / customActions、ハイライト等）を重ねて出す（重複は除く。`getKeyCodeAliases`）。US 配列には `Backquote` キーがそのままあるので別名は使わない
- `KeyCaptureButton` は、**JIS の配列を受け取っているときだけ**、押された実キーの ¥（`IntlYen`）を `IntlBackslash` に読み替えて保存する（サイトの ¥ キーと一致させるため）。実キーの半角（`Backquote`）はそのまま保存する。配列が `null`・US のときは読み替えない
- DB のデータは書き換えない。表示・入力側で吸収する
- `/keybindings/stats` はキーコード単位で集計し、配列を見ずにラベルを引く。JIS の走者の `Backquote` と `IntlYen` は別の行になる（現状は寄せていない）

### 指割り当て

`fingerAssignments` はJSON形式で、各キーコードに対応する指の種類を配列で格納する。

指の種類: `left-pinky`, `left-ring`, `left-middle`, `left-index`, `left-thumb`, `left-palm`, `right-palm`, `right-thumb`, `right-index`, `right-middle`, `right-ring`, `right-pinky`（`left-palm` / `right-palm` は手のひら。色トークン `--finger-palm`）

**1キーに複数の指を割り当てられる**（例: 親指と手のひらで押す、人差指と中指で押す）。`/me/keybindings` のキー編集ダイアログでは `FingerToggleGroup`（`finger-toggle-group.tsx`。左手6・右手6のトグル＋解除ボタン）で選ぶ。配列の順序は編集UIの正準順（上記の並び）に揃えて保存する。表示時の扱い:

- 指の**色**（小指/薬指/中指/人差指/親指/手のひら。左右は同色）が1種類だけなら、従来と同じ単色表示（例: `left-index` + `right-index`）
- 色が2種類以上なら、キー背景を色ごとの等幅バンドに分割して表示する（`getFingerKeyStyle` in `virtual-keyboard.tsx`。`VirtualKeyboard` / `VirtualMouse` / テンキー / サーチクラフトの `KeyBadge` で共通。JIS Enter の L 字は上段・下段で帯が揃う）。枠線とアクション名チップの色は先頭の指のもの
- キー情報（ツールチップ/モーダル）には割り当てられた全ての指を色ドット＋ラベルで並べる

デフォルトはWASD配置に基づく一般的な指割り当てが定義されている（`DEFAULT_FINGER_ASSIGNMENTS`）。

**検証（`app/lib/finger-assignments.ts`、許可リストは `keybindings.ts` の `FINGER_TYPES` が単一情報源）**
- 保存時（`validateFingerAssignments`）: 値はすべて「有効な指の配列」であること。キー数は 200 以下、キー名は 1〜32 文字、1 キーの指は 12 個以下。1 つでも不正なら `invalidPayload` のエラーを返し、保存しない（null・空で上書きしない）。通す経路: `/me/keybindings` の `save-fingers` / `save-all`、レガシー API 取り込み（`legacy-import.ts`。不正な項目は落とす `sanitizeFingerAssignments`）。`/me/import` と playground は指割り当てを書き込まない。プリセットのスナップショットは保存済みの検証済みデータの複製で、「他のプリセットからコピー」はクライアントで `parseFingerAssignments` を通してから取り込む
- 読み取り時（`parseFingerAssignments` → `sanitizeFingerAssignments`）: 配列でない項目・有効でない指・上限超過を落として返す（すでに不正な行が保存されていても、公開ページの描画を落とさない保険）。`VirtualKeyboard` / `VirtualMouse` も配列でない値は無視する

### 仮想キーボードのキーの状態

`VirtualKeyboard`（メインのキー・JIS Enter・カスタムキー）・`VirtualMouse`・`VirtualNumpad` のキーの面・枠・ラベル色は、`getKeySurface`（`virtual-keyboard.tsx`）1か所で決める。「情報がある」の判定は `KeyInfoTrigger` と同じ述語 `hasKeyInfo`（`key-info-trigger.tsx`。操作・リマップ・カスタムアクション・指のどれかがある）を使う。

| 状態 | 条件 | 見た目 |
|---|---|---|
| 指色 | `showFingerAssignments` かつ指あり | `getFingerKeyStyle` の指色（従来どおり） |
| データあり | 指色でない、かつ情報がある | 面 `bg-secondary`・枠 `border-muted-foreground/70`・ラベル `text-foreground` |
| 空き・読み取り専用 | 情報が無く、押せない（`onKeyClick` なし） | 面 `bg-secondary/50`・枠 `border-border`・ラベル muted。後ろへ引かせる |
| 空き・編集 | 情報が無く、押せる（`onKeyClick` あり） | 面 `bg-secondary/50`・枠 `border-muted-foreground/70`（フォーム部品と同じ、3:1 以上）・ラベル muted |
| リマップ済み | `showRemaps` でそのキーにリマップがある | 上の状態の枠だけ `border-primary` に上書き（指色のキーにも適用） |

- 一時的な強調（`highlightedKeys`）は `ring-primary` のリングなので、リマップの枠と重ねられる。保持中（`heldKeys`）の warning の枠はリマップより優先する
- 押せないキーにはホバーの見た目を付けない（JIS Enter の `group-hover` も同じ）。押せるキーのホバー・active は従来どおり

### 仮想キーボードのキーボード操作

`VirtualKeyboard`（`section` で分けた main / nav はそれぞれ別）・`VirtualMouse`・`VirtualNumpad` の1インスタンスを1つの複合部品として扱う（roving tabindex。`useRovingKeyFocus` in `app/hooks/use-roving-key-focus.ts`）。

- ルートは `role="group"` と名前（「キーボード（US）」「キーボード（ナビゲーションキー）」「テンキー」「マウス」。`keyboardView.groupLabel*`）。フォーカスできるキーがあるときだけ、`aria-describedby` の sr-only の一文で矢印キーで移動できることを伝える
- **フォーカスできるキー**: 編集（`onKeyClick` / `onButtonClick` あり）では全キー。読み取り専用では、`hasKeyInfo` が true のキー（ツールチップ／モバイルの情報ダイアログを持つキー）と、カスタムキー・カスタムボタン（`alwaysShow`）だけ。読み取り専用で情報の無いキーは `button` ではなく `aria-hidden="true"` の `div` で描く（見た目は同じ。JIS Enter も同じ）
- **Tab 停止点は1インスタンスにつき1つ**（`tabIndex=0` は「現在のキー」だけ、ほかは `-1`）。現在のキーは最後にフォーカスしたキーで、初期値（SSR の HTML を含む）は DOM 順で最初のフォーカスできるキー。現在のキーが描画から消えたら（配列・プリセット・`section`・リマップの変更）最初のキーに戻す。フォーカスできるキーが0個なら Tab 停止点を持たない
- **矢印キー**（修飾キー併用は無視。移動したら `preventDefault`）: ←/→ は同じ段でその方向のいちばん近いキー、↑/↓ はその方向でキーのある最も近い段の、x の中心がいちばん近いキー。Home / End はその段の最初／最後のキー。行き先が無ければ何もしない。「同じ段」は、片方の中心 y が相手の縦の範囲に入ること（2段ぶんの高さのキー〔JIS Enter・テンキーの + / Enter・マウスの左中右〕は両方の段に属する）。行き先は keydown 時の `getBoundingClientRect` から純粋関数 `findNextKeyInGrid`（`app/lib/key-grid-navigation.ts`）で求める。移動先は `scrollIntoView({ block: "nearest", inline: "nearest" })` で横スクロールの枠の中に入れる
- フォーカスリングは `--ring` の 2px のアウトラインを内側（`-outline-offset-2`）に描く（横スクロールの枠で左端・上端のキーのリングが切れないため）。JIS Enter は L 字の外接矩形に描く
- React のイベントはポータルを越えて上がるので、keydown は「そのルートの DOM 内のキー」から来たものだけを扱う（モバイルの情報ダイアログ内の矢印キーは無視）

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

`users.inputMethod` で入力方法を管理する。**編集は `/me/playstyle` に一本化**しており、`/me/devices` は今の値の表示と playstyle へのリンクだけを持つ（`/me/devices` の action は `inputMethod` を受け付けない。旧 `saveInputMethod` も廃止）。

| 値 | ラベル | 短縮 |
|---|---|---|
| keyboard_mouse | キーボード/マウス | KBM |
| controller | コントローラー | Controller |
| touch | タッチ | Touch |

### /me/devices の画面構成（UI）

欄は `PageSection`（h2）の欄区切り: 入力方法（今の値の表示＋「プレイスタイルで変更する」リンクのみ）→ コントローラー／キーボード／マウス（入力方法に応じて出し分け）→ ゲーム内設定。Select（キーボードのレイアウト・Windows ポインター速度）とゲーム言語の Combobox は `id` を付けて `Label htmlFor` と結び、ゲーム内感度（%）の欄には sr-only のラベルを付ける。プリセット未作成時の案内は `NoticeBanner`。

### /me/keybindings の画面構成（UI）

- 見出しの段は h1（ページ名）→ h2（`PageSection`: キーボードビュー／コントローラービュー／各タブの欄）→ h3（操作割り当てのグループ名）。欄は `PageSection` の欄区切り（箱なし）。操作割り当ての欄の見出しは `keybindings-actions-heading` の id を持ち、スキップリンクの移動先を兼ねる。
- 離脱時の警告は `FloatingSaveBar` が内蔵する（`docs/me-common.md`）。画面側で `useUnsavedWarning` は持たない。
- 行ごとの確定結果の読み上げは、ページに1つだけの `role="status" aria-live="polite"` 領域で行う（`KeybindingRow` の `onAnnounce`）。
- **モバイル（md 未満）のキーボード**: 既定は左手側だけを大きく見せ、キーを押して編集できる（`KeyboardScaledPreview` の `crop={LEFT_HAND_CROP}` ＋ `interactive`。公開の `/keybindings/visual` と同じ切り出し）。右側・ナビゲーション・テンキーのキーは、下の「操作割り当て」から編集できる旨を1文で案内する。「キーボード全体を横スクロールで見る」ボタンで従来の横スクロール表示（`HorizontalScrollArea`）へ切り替えられる。md 以上は常に横スクロール表示（2つの表示は CSS で出し分ける）。
- **キー編集ダイアログ**は段階的に見せる（`components/keybindings/key-dialog-section.tsx` の `KeyDialogSection`、標準の `<details>`）。操作割り当ては常に開き、リマップ・指・カスタムアクションは中身（そのキーの件数）があるときだけ初期表示で開く。各段の見出し行に件数の要約を出す。操作割り当ての分類・並び順は、ページの「操作割り当て」一覧と同じ定義（`groupKeybindingsForDisplay`。キーボード/マウスはプロフィールと同じ3グループ・意味順、コントローラーは DB カテゴリ準拠）から出す。フッターに「「適用」はこの画面への反映。ページ下の保存で確定します」を示す（2段階の確定）。
- **モバイルのキー押下**: `KeyInfoTrigger` は、キー自身が押下の操作を持つ（`onKeyClick` / `onButtonClick` があり、`interactive`）ときは、モバイルでも情報ダイアログの DialogTrigger で包まない（編集ダイアログと2枚同時に開くため）。閲覧（走者画面・一覧）は従来どおり、モバイルは Dialog・デスクトップは Tooltip。
- **リマップの入力の名前**: `KeyCaptureButton` の `ariaLabel` で「変更元のキー: Q」のような名前にする。リマップ行の削除・出力種別・文字入力にも名前を付ける。
- **キー上の操作名チップ**は `text-[10px] leading-snug`（`cn()` の tailwind-merge は `text-[10px]` が後ろの `leading-*` を落とすため、`leading-snug` を後ろに置く）。

---

## 一覧・比較ページ

### /keybindings（キー配置一覧）

全プレイヤーのキー配置を横断的に閲覧・比較する。ビューは**独立したルート**に分割されている。

| ルート | ファイル | 内容 |
|---|---|---|
| `/keybindings`（既定） | `routes/keybindings.tsx` | テーブルビュー。サブタブ（`tab`）で表示内容を変更 |
| `/keybindings/visual` | `routes/keybindings-visual.tsx` | **ビジュアルカードビュー**。ページ上端に1行の凡例（指色・リマップ済みの枠・空きキー）と、2人を並べる `/compare` へのリンクを置く。走者ごとに読み取り専用の `VirtualKeyboard` でキー配置を表示。発見・参考用途向け。h1 / `<title>` は「操作設定ビジュアル」 |
| `/keybindings/stats` | `routes/keybindings-stats.tsx` | 統計ビュー（`loadKeybindingsStats`） |

- 表・ビジュアルは共有ローダー `loadKeybindingsListPlayers`（`lib/keybindings-list.server.ts`）で公開ユーザーを全件取得し、共有レイアウト `KeybindingsListLayout`（`mode="table" | "visual"`）で描画する。ユーザー絞り込み（`slugs`指定）なしの全件取得結果は60秒インメモリキャッシュされる
- **件数と指定走者の注記（表）**: ツールバーの件数（`aria-live`）は表では「このタブ N人 / 全 M人」（`keybindings.countTabText`。N はいまのタブの行数、M は絞り込み後の全走者）。ビジュアルは絞り込み後の走者数のみ。統計などから `users=` で走者を指定して表へ移ったとき、指定した走者のうちそのタブに載らない人がいれば、ツールバーの下に「指定した N 人のうち、このタブに設定のある M 人を表示しています」（`keybindings.usersOnTabNote`、`role="status"`）を出す（黙って減らさない）。タブを替えるとき、移った先に無い列の並べ替え（`sort`）は外す（`sortKeyBelongsToTab`）
- ビュー切替（`ViewSwitcher`）は各ルートへの `<Link>`で、`nav`（`aria-label`）＋ `aria-current="page"`（`role="tablist"` / `tab` ではない。ui.md 11 章・`ContentTabs` と同じ）。表・ビジュアル間は現在の検索パラメータ（フィルタ・`tab`）を維持する。ルート遷移のため読み込み中は共通の `NavigationProgress` オーバーレイが表示される

テーブルビュー（`view=table`）のサブタブ。操作系はプレイヤー画面（プロフィール）と同じ粒度（移動 / インベントリ / 戦闘・UI）で分割する:

| タブ (`tab`) | 内容 |
|---|---|
| movement | 移動: forward, back, left, right, jump, sneak, sprint |
| inventory | インベントリ: hotbar（1〜9 をすべて表示。長いカスタムキー名で幅を超える場合は折り返して 9 枠目まで見せる）, swapHands, inventory, pickBlock, drop |
| combat-ui | 戦闘・UI: attack, use, togglePerspective, chat, command, fullscreen |
| remaps | キーリマップ一覧 |
| custom-actions | カスタムアクション一覧 |
| mouse | マウス設定一覧（DPI、感度、cm/360等） |

- 列定義は `COLUMN_PRESETS`（`keybindings-columns.tsx`）でプリセット名＝タブ名として管理する
- **各カラムはドラッグでリサイズ可能**（TanStack Table の `columnResizeMode: "onChange"`）。`KeybindingsTable` は `getSize()` から `grid-template-columns` を算出する
- テーブルは **TanStack Table v9**（`useTable`）。使う機能だけを `keybindingsTableFeatures`（`keybindings-columns.tsx`）に明示登録している（`rowSortingFeature` ＋ `sortedRowModel` / `columnSizingFeature` / `columnResizingFeature`、ソート関数は数値列用の `basic` のみ登録し、アクション列（キー名）は列定義の関数 `sortFn` で比較する）。列定義の型は `KeybindingsColumnDef`（= `ColumnDef<KeybindingsFeatures, KeybindingsRow>`）。列の可視性機能は使わないため `getAllLeafColumns()` / `row.getAllCells()` で描画する。リサイズ中の列幅は `table.state.columnSizing`（v8 の `getState()` は廃止）
- **表は仮想化しない**（走者は高々数百・タブごとに 1 表）。role は `table`（`rowgroup` / `row` / `columnheader` / `cell`、並べ替え中の列に `aria-sort`、`aria-rowcount` / `aria-rowindex`）。SSR でも全行が出る。0 件は表を描かず `KeybindingsEmptyState`（共有 `EmptyState`）
- ヘッダーは折り返して全文を読めるようにする。セルは `overflow-hidden` で列幅にクリップ。マウス列の見出しは翻訳キー（`keybindings.columnWinSens` 等。モバイルの短縮は `columnSensShort` / `columnTurnShort`）。未設定の表記は「-」に統一し、見た目は `text-muted-foreground`（薄くしすぎない）、読み上げは sr-only の文言に差し替える（`EmptyMark`: キー未割り当て = 「未割り当て」、マウスの値 = 「未設定」、リマップ・カスタムアクションなし = 「なし」。見える「-」は `aria-hidden`）
- **見出しの説明**: 見えている文字と同じ内容の Tooltip は付けない。意味の説明が要る見出し（cm/180°・カーソル速度・Win Sens・Raw Input・マウス加速）だけ、並べ替えボタンの外に `HintTip`（Info アイコン。`column.meta.hint`）を置く
- **キーバッジ**（`KeyBadge`、`keybindings-cells.tsx`）: 文字キーは角の小さい `rounded` の四角（ui.md 7 章。`search-craft-badges` の KeyBadge と語彙をそろえる。指色は持たないので部品は共有しない）。マウスボタンだけ info 色。表示幅（全角=2）の上限を超えると省略し、**全文は `HintTip`（ボタン。aria-label = 全文、ホバー/フォーカス = Tooltip、タッチ = Popover）で届ける**
- **ホットバー列**: 9 スロットを同じ幅のグリッド（md 以上 9 列 / md 未満 5 + 4 の 2 段）に並べ、行ごとに 1〜9 の位置がそろう。ラベルは省略（上限 4 幅）し、全文は `KeyBadge` の `HintTip`
- **列リサイズの取っ手**（`role="separator"`）: フォーカス可能（`tabIndex=0`、`aria-valuenow/min/max`）。左右キーで ±16px（Shift で ±64px）、Enter・ダブルクリックで既定の幅に戻す
- **キー名の表示ラベル**（`getKeyLabel`）: JIS の変換系（`NonConvert` = 無変換 / `Convert` = 変換 / `KanaMode` = かな）と、Minecraft がキー名を持たないキーの `scancode.N`（= 「スキャンコード N」）に表示名を付ける（`keyLabels.*`）
- **縦スクロールは全幅でページに任せる**（本体に内側の縦スクロール枠〔旧 `md:max-h-[70vh]`〕は持たない）。**見出し行は本体の横スクロール枠の外**に置き、本体の `scrollLeft` に CSS 変数 `--kb-scroll-left` で追従させる（走者列だけ打ち消して固定）。見出しは md 未満・以上とも `top-[64px]` でページに貼り付く。貼り付きのため、表の `Tabs` ルートは `overflow-clip`（既定の `overflow-hidden` はスクロールコンテナになり sticky を止める）
- **横スクロールバー**: 長い表では本体の下端が画面外になるため、md 以上は本体のネイティブバーを隠し、下端（`--bottom-fixed-inset` の上）に貼り付く同期スクロールバー（`StickyScrollbar`、`keybindings-table.tsx`）を出す。横にあふれていないときは出さない。md 未満はネイティブのまま
- **列幅**: 各列は grid の `minmax(下限, 基準幅fr)` で、表の合計が枠より狭いときは余りを全列で基準幅に比例して分け合う（右に空き帯を作らない）。行は `w-max` にせず、下限の合計を `min-width`（`calc()`）に渡す（`w-max` だと fr が中身の max-content まで広がり、チップが折り返さない）。md 未満 / 以上で下限が違う列は CSS 変数で持つ（列の `meta.widthVar`。リサイズした列だけ px で固定。リサイズ開始時に描画中の幅へ固定してから始める）。末尾の見出しの右には区切りを出さない
  - `--kb-runner-col`: 走者列（md 未満 128px / md 以上 224px。固定幅）。走者セルはどの幅でも横並び（頭 32px ＋ 名前 truncate）にして、モバイルの行を低く保つ
  - `--kb-action-col`: 1 キーのアクション列（md 未満 56px / md 以上 104px）。md 未満は見出しの並べ替え矢印を文字の下に置く
  - `--kb-hotbar-col`: ホットバー列（md 未満 240px / md 以上 360px。md 未満は 9 枠が 2 行に折り返す）
  - `--kb-fill-col`: リマップ・カスタムアクション列（md 未満は下限 0 で残りの幅に収めてチップを折り返す / md 以上は 600px 下限）
- ビュー切替（`ViewSwitcher`）はセグメント形（タブの線は使わない）で、タイトル行の右（`KeybindingsPageTitle` の `trailing`）に置く。sm 未満はタイトルの下で全幅 3 分割。件数・フィルタは別のツールバー行。サブタブは `TabsList scrollFade`（`ui/tabs.tsx` の opt-in。続きがある側の端にフェード）。選択中のタブが横スクロールで隠れていれば、マウント時（動きなし）と選択変更時に見える位置へ寄せる（`TabsList` の共通挙動。リスト自身の `scrollLeft` だけを動かす）。タップ領域は 44px（`max-md:h-11` / `max-md:min-h-11`）
- 件数表示は、いま見えている表の行数（タブごと）。**キーのタブ（移動・インベントリ・戦闘・UI）は、そのタブの列がすべて「未割り当て」の走者を載せず**（タブごとに判定。インベントリはホットバー 1〜9 を含む）、マウスタブも設定のある走者のみ（`hasKeyBindings` / `hasMouseSettings`、`lib/keybindings-filter.ts`）。ビジュアルは、キーボードに描くものが何もない走者（割り当て・リマップ・カスタムアクションのどれも無い。`hasKeyboardContent`）を除いた、絞り込み後の走者。件数は `aria-live="polite"` で変化を伝える（初回表示では読まれない）
- アクション/ホットバー/**リマップ**列のキー表示は、各走者の `customKeys`（keyCode→keyName）を優先して**カスタムキー名**を表示する（`KeyBadge` および `getRemapSourceLabel`/`getRemapOutputLabel` の `customKeyNames` 引数）

- **統合フィルタモーダル**（`FilterDialog`）: 走者の絞り込み・操作＝キー・数値範囲フィルタを1つのモーダルに統合。すべてドラフトとして編集し、「適用」を押すまで URL（クエリ）へ反映しない
  - 走者の絞り込み（`users` パラメータ。ダイアログの見出しは「走者で絞り込み」）: 表示する走者を検索してリスト登録する横断フィルタ（値ではなくユーザーで絞る）。表・ビジュアル両ビューで適用され、選択中ユーザーはヘッダー下の `UserFilterChips` で表示
  - 効いている数値範囲は `UserFilterChips` の行に「DPI 400〜800 ×」のチップで出し、そこから外せる。「フィルタをクリア」はチップ行の 1 か所（ダイアログ内はフッターの 1 つ）
  - **操作＝キー**（`bind` パラメータ。例: `bind=sprint:ControlLeft,jump:Space`）: 「ダッシュ = 左Ctrl」のように、操作に割り当てているキーで絞る。表・ビジュアル両ビューで適用される
    - 複数条件は **AND**（すべて満たす走者）。**同じ操作の条件は置き換える**（1 つの操作に同時に割り当てられるキーは 1 つなので、同じ操作の AND は常に空になるため）。形式は `<操作>:<keyCode>`（最初の `:` で分ける）。未知の操作・キーが空の要素は無視する。選べる操作は表の列と同じ（`BIND_FILTER_ACTIONS`）
    - キーは、選んだ操作に**いずれかの走者が実際に割り当てているキー**の一覧（表示名の昇順。人数順にはしない）から選ぶ（物理キーのないスマホ・マウスボタンでも選べる）。「キーを押して指定」（`KeyCaptureButton`、ダイアログ内のため `keyCaptureEscapeGuard` で Escape をキーとして受ける）でも指定できる。修飾キーとの組み合わせ（`Ctrl+KeyA`）は `bind` に載せない
    - 比較は `keysEqual`（大文字小文字・Minecraft 形式の違いを吸収）で、JIS の半角（`IntlYen` と `Backquote`）は走者の配列で `getKeyCodeAliases` を両側に当てて同じキーとして扱う（`bindKeysMatch`、`lib/keybindings-filter.ts`）。その操作が未割り当て・不使用の走者は条件を満たさない
    - 効いている条件は `UserFilterChips` の行に「ダッシュ = 左Ctrl ×」のチップで出し、そこから外せる。`clearFilters` と「フィルタ数」にも含まれる
  - モバイル（md 未満）: 閉じる×・フッターのボタン・数値入力・走者候補・操作＝キーの部品は 44px（`min-h-11`）。閉じる×は共有の `ui/dialog.tsx` を変えず、`FilterDialog` が自前の `DialogClose` を出す。開いたとき**検索欄へ自動でフォーカスを入れない**（ソフトキーボードが画面の半分を覆うため。`onOpenAutoFocus` を止めてダイアログ自身へフォーカスを置くので、Tab で最初の操作に進める）
  - ユーザー検索欄の Enter は、矢印キー・ポインタで候補に触れるまで無効（cmdk が先頭の候補を自動選択してしまうため）
  - 数値欄は最小・最大それぞれに sr-only の `Label` を `id` で結ぶ（プレースホルダは「最小」「最大」）
  - 数値の絞り込みは**キーボードのタブにも効く**（DPI・感度・振り向きのいずれかを指定すると、マウス設定がある走者だけに絞られる。`dpiMin=400&dpiMax=800` で移動タブも該当者のみになる）。この挙動は保ち、ダイアログの数値の欄に注記する（`keybindings.numericFilterNote`）
  - 数値範囲フィルタ（`dpiMin/Max`, `sensMin/Max`, `cm360Min/Max`）: DPI・ゲーム内感度・振り向きで絞り込む。`sensMin/Max` は一覧の表示・CSVと同じ **0〜200%**（Minecraft準拠、内部値 `0..1` を `*200` 換算）基準で比較する（`app/hooks/use-keybindings-filters.ts`）
  - 各入力欄は number input の `min` / `max` 属性で有効範囲を示し（DPI: `min=1`、感度: `0〜200`、振り向き: `min=0`）、感度欄には有効範囲の補足テキスト（`keybindings.sensitivityRangeHint`）を常時表示する（`FilterRange` の `inputMin` / `inputMax` / `hint`）
  - 範囲外の値（DPI が 1 未満、感度が 0〜200 の外、振り向きが 0 未満）は、その欄に `aria-invalid` を付け、欄の下にエラー文（`keybindings.rangeErrorBetween` / `rangeErrorMin`）を出して `aria-describedby` で結ぶ。フォームは `noValidate`（ブラウザの吹き出しは出さない）で、範囲外の欄があると「適用」しても閉じず、最初の範囲外の欄へフォーカスを移す
  - 「適用」時に **min > max（範囲の取り違え）は自動で入れ替えて**救済する（`orderedRange()`）。0件になって理由が分からないより、意図どおりの範囲で結果を返すほうが摩擦が少ないため
  - 絞り込みはすべてクライアント側で適用（loader 再走なし）。loader は常に全公開ユーザーを取得する
- ソート機能（各カラム）
  - **アクション列（1 キーの列）はキー名で並べ替えられる**（`sort=action.<操作>:asc|desc`。例: `action.sprint:asc`）。並べ替えのキーは表示ラベル（カスタムキー名 → 組み合わせ → その走者の配列を考慮した `getKeyLabel`。`getBoundKeyLabel`）。比較は数値順（F2 < F10）で、ロケールを明示した `localeCompare`（`compareKeyLabels`）。**未割り当て・不使用は昇順・降順どちらでも末尾**。ホットバー列（9 キーの集約）は並べ替えない。ビジュアルの `sortKeybindingsRows(rows, sort, t, locale)` も同じ `sort` に対応する（URL を共有しているため）。1 つの操作を全員で見比べる手段は、並べ替え・操作＝キーの絞り込み・統計からの導線（中立な手段）に限る
  - **未設定の行は昇順・降順のどちらでも末尾**。TanStack Table の `sortUndefined: "last"` は
    `undefined` のみを見る（`null` は素通りして通常比較に回り、昇順で先頭に来る）ため、
    ソート対象の `accessorFn` は未設定を必ず `undefined` で返す（`keybindings-columns.tsx` の `forSort()`）
  - **ゲーム内感度が有効範囲外**（内部値 `0..1` ＝ 表示 `0〜200%` の外）の行は、感度ソートで未設定と同様に末尾へ落ちる（`sensitivityPercent()` が `null` を返し `forSort()` で `undefined` 化）。一覧セルには値をそのまま表示しつつ警告アイコン（`TriangleAlert`、`text-warning`）+ ヒント（`keybindings.sensitivityOutOfRange`）で理由を示す（`SensitivityCell` → 共有コンポーネント `SensitivityWarning`、`app/components/sensitivity-warning.tsx`）
    - 警告・「-」理由の吹き出しは共有コンポーネント `HintTip`（`app/components/hint-tip.tsx`）が担う。ポインタ端末（マウス等）は Tooltip（ホバー/フォーカス）、タッチ端末（`pointer: coarse`）は Popover（タップ）に自動で出し分ける（`KeyInfoTrigger` と同じ方針）。SR 向けにトリガーは `<button aria-label="{説明文}">` で実装する
  - **0件になったときの空状態**（`KeybindingsEmptyState`、表・カードビュー共通）: 有効なフィルタが1つでもある場合は理由が伝わる文言（`keybindings.emptyFiltered`）とその場でフィルタを一括解除できる「クリア」ボタン（`clearFilters()`、ソート・タブは維持）を出す。フィルタなしで0件（そもそも登録者がいない）なら従来どおり `keybindings.noPlayers`。表のタブで、フィルタに一致する走者は居るがそのタブのデータを持つ人が居ない場合は、「このタブの設定を登録している走者はいません」（`keybindings.emptyNoTabData` / `emptyNoTabDataHint`。`KeybindingsTable` の `noTabData`）にして、フィルタ不一致と区別する
- プレイヤー名クリックでプロフィールページへ遷移
- **ビジュアルカードビュー**（要約行: マウス設定がまったく無い走者は、未設定の 3 項目を並べず 1 つの「マウス設定なし」〔muted〕にする。Trigger / Chat 切替には `HintTip` の説明を添え、md 未満は 44px。カードの仮の高さ `contain-intrinsic-size` は md 未満 560px / md 以上 700px、未描画のプレースホルダーは md 未満が切り出し表示と同じ縦横比〔`aspect-[479/508]`〕/ md 以上 550px で、描画時の高さの跳ねを抑える）: キーボード（実寸 1120px）とマウスを走者画面のモバイル表示と同じ `KeyboardScaledPreview` で包み、カード幅に収まるよう縮小する（スケール上限 1。タップ/クリックで実寸の Dialog。縮小中は inert でツールチップは効かない。**縮小していない〔scale が 1〕ときは、拡大の印・ボタン・inert を出さず**ツールチップが効く通常の表示。幅の変化は ResizeObserver に加え、ウィンドウの resize と交差の変化でも再計測する〔`content-visibility:auto` の画面外カードは ResizeObserver が届かないため〕）。マウスはキーボードの下に置き、カード幅 1360px 以上（`@container`）のときだけ横に並べる。並び順は表と同じ URL の `sort`（`sortKeybindingsRows`。未設定は末尾）。**描画は 20 人ずつ**（「さらに表示」。メモリ内の state のみ）。画面外のカードは IntersectionObserver で可視化されるまでキーボードを描かない
  - **md 未満（モバイル）は左手側だけを大きく見せる**: キーボードの左から 7.75 ユニット（478.5px。Z 段の B の右端＝7.25 ユニット〔447.5px〕＋右端のフェードが B に掛からない分。数字 1〜5・QWERT・ASDFG・ZXCVB・Tab・Caps・左 Shift・左 Ctrl・スペースの左側・F 行の左側が入る）をカード幅いっぱいに縮小し、右側は切り落とす（スクロールさせない）。切り落とした右端にはカードの面の色のフェード（画面 16px）を重ねる。切り出し中は縮小率が 1 でも拡大の操作を出して inert にする（右側が見えないため）。`KeyboardScaledPreview` の `crop`（`{ width, media: "(width < 48rem)" }`。計測の中で matchMedia を見るので SSR とずれない）で実装し、中身は全体（`section` は変えない）のまま左端から切り出すので、JIS / US・指色・リマップの枠はそのまま出る。縮小図は従来どおり inert で、**「拡大」で全体（右側・ナビ・マウス）を実寸の Dialog で見られる**。375 幅でカードの中 301px に対し縮小率約 0.63（キー 1 個約 37.7px）
  - **md 未満は、キーボードの下に「キーの割り当て（N件）」の折りたたみ**（`AssignmentAccordion`、`assignment-accordion.tsx`。素の `<details>`、既定は閉じる、状態は保存しない、summary は 44px）を置き、その走者の割り当てをすべて「操作名（`getActionLabel`）＋ キー（kbd チップ。カスタムキー名 → `getKeyLabel` を配列に合わせて）」の `dl`（`dt` / `dd`）で並べる。まとまりと並び順は表のタブ（移動 / インベントリ〔ホットバー 1〜9 が先〕/ 戦闘・UI。表に無い操作は戦闘・UI の後ろ）、その後にカスタムアクション、Trigger / Chat の切替で絞ったリマップ（表のリマップ列と同じ「Q → P」「B → ×」）。件数は中に並べる物の数（操作の割り当て〔未割り当て・廃止の `toggleHud` を除く〕＋カスタムアクション＋表示中の文脈のリマップ）で、0 の走者には出さない。中身は開いたときに初めて描く。md 以上は出さない（`md:hidden`）
- ビジュアルカードビューは指割り当てを描画するため、loader で `playerConfig.fingerAssignments` を取得する
- **視聴者ロール（`role = "viewer"`）のユーザーは一覧から除外される**（v1.4.0〜）

### /keybindings/stats（統計ページ）

キー配置の統計・傾向分析ページ。各アクションに対するキー割り当ての分布や、マウスDPI/感度の傾向を表示する。`loadKeybindingsStats`（`lib/keybindings-stats.server.ts`）の集計結果は60秒インメモリキャッシュされる（内部的には全アクション分を1クエリにまとめて取得し、JS側で「操作 → キー」（追跡対象のみ）と「キー → 操作」（全操作）に分けて集計）。

視聴者ロールは集計から除外している（v1.4.0〜）。h1 は「操作設定統計」。

- **統計は公開走者の全員が対象**（一覧の絞り込みは効かない）。概要に注記を出す。DPI の区分は幅がそろっていないので、棒の長さは人数の割合であることを欄の説明に添える
- **キーの統計の「未割り当て」**: 集計は不使用（`UNBOUND_KEY`）の割り当ても 1 つのキーとして数える。その行は「-」というキーではなく「未割り当て」と表示する（F3 欄の未設定〔`UNASSIGNED_INPUT_KEY`〕と同じ `keybindingsStats.unassigned`）。Minus キーは「-」のまま。「未割り当て」の走者群から表へのリンクは `users` のみ（`bind` では絞れない）
- 統計の見出しにアイコンは付けない（全欄そろえる）。統計のサブタブは md 未満で高さ 44px（`max-md:min-h-11`）
- 統計の行ボタンのアクセシブルネームは「5位、2キー、1人、1%、走者を見る」のようなまとまった文（`keybindingsStats.rowAria` / `rangeRowAria`）。割合のバー（`Progress`）にも名前（行のラベル）と値（`aria-valuetext`＝見えている「N人 (P%)」）を付ける（旧 `/stats` の `StatBar` の書き方を引き継いだもの）。割合の表記は整数の %（`formatPercent`、四捨五入）にそろえる。走者一覧ダイアログには `DialogDescription`（人数と案内）を付ける
- **行から表へ直接**: 統計の各行（キー・F3・マウスの区分・Raw Input など）は、走者一覧ダイアログを開くボタンの右に「表で見る」アイコンリンク（`RowTableLink`、`keybindingsStats.rowOpenInTable`、md 未満で 44px）を並べる。行き先は下の `tableHrefFor`（ダイアログの「この N 人を表で見る」と同じ。行き先が無い区分は出さない）。表は URL の `tab` / `users` / `bind` を受ける（nuqs）
- **走者一覧ダイアログから表へ**: キー・F3・マウスの各区分の走者一覧ダイアログに「この N 人を表で見る」リンクを出す。行き先は `/keybindings?users=<slug,…>&tab=<その操作が載っているタブ>`（キーの操作は `tabForAction`、F3 は `remaps`、マウス系・Raw Input は `mouse`。`buildKeybindingsTableHref`）。`users` に載せるのは **100 人まで**（`MAX_USERS_IN_LINK`。URL が長くなりすぎるため）。超えたときは、キーの統計なら `users` の代わりに `bind=<操作>:<キー>` で同じ走者群を表で絞り込む。それ以外（マウスの区分）はリンクを出さない。F3 の区分は、リマップした走者（元のキーごとの区分）は `remaps` タブへリンクし、「F3 のまま」の区分（リマップ行を持たず表のリマップタブに出ない）はリンクを出さない。表の行数は、統計（ライブのテーブル）と一覧（メインプリセットのスナップショット・公開走者）の母集団の違いで、ダイアログの人数と一致しないことがある（マウスタブは DPI・感度・Windows 速度のある走者のみ。統計の「マウス設定の登録者」と Raw Input・マウス加速の ON/OFF 分布も同じ条件〔`hasMouseSettings`〕の走者だけを数える。Raw Input〔既定 ON〕とマウス加速〔既定 OFF〕は設定行ができた時点で値が入るため、これを根拠にすると何も入力していない走者まで分布に入り、「表で見る」の人数が表と合わなくなる。表のマウスタブをこの 2 項目まで広げると、設定行のある走者全員が載ってしまうので、統計側を表に揃えた）
- Raw Input の ON / OFF（統計・表）はどちらも同じ見た目（`Badge variant="secondary"`）で、文字だけで区別する。走者の設定値に優劣・多数派/少数派を思わせる装飾をしない
- **キー → 操作タブ**（旧 `/stats` から移した）: キーを起点に、そのキーへ何の操作が割り当てられているかを見る。対象は `KEY_ACTION_STATS_KEYS`（`keybindings-stats-shared.ts`、E/Q/R/F/C/X/Z/G/V・Shift/Ctrl/Tab/CapsLock/Space・Mouse0〜4・数字 1〜9 の28個）で、元データは追跡対象外の操作も含む全操作（集計クエリは操作 → キーと共通の1本で、JS 側で分ける）。未割り当て（不使用）の行はキーとして数えない。`totalCount` はそのキーに何かを割り当てている走者数、各操作の割合の分母もそれ。1人が同じキーに複数の操作を置けるので割合の合計は100%を超えうる（タブ冒頭にその旨と、対象が上の28キーに限られること〔W/A/S/D などの移動キーは含まない。`keybindingsStats.keyActionScope`〕を添える）。上位5件、データの無いキーの欄は出さない（全部空なら `EmptyState`）。行を押すと走者ダイアログ（題は「キー名: 操作名」）、表リンクは `tabForAction`（表に無い操作はリンクなし）。キーコードの正規化はしない（DB の `key_code` はこの形式に統一されている）
- **ON / OFF 分布**: Raw Input・マウス加速（マウスタブ）・ダッシュ切替（キーボードタブの「ダッシュ」の直後）は共通部品 `BooleanDistribution`。`BooleanSettingStats`（`mouseConfigs` 由来、null は母数に入れない）。マウス加速の表リンクは `mouse` タブ、ダッシュ切替は表に列が無いのでリンクなし。ON / OFF は同じ見た目
- 概要の人数は母集団が違うので、名前と注記で区別する: **登録走者数**（操作設定を登録している公開走者。`/keybindings` の一覧と同じ母集団で、`loadKeybindingsListPlayers` の件数）／**キー配置の登録者**・**マウス設定の登録者**（ライブの `keybindings` / `playerConfigs`（DPI あり）テーブルを数える）／**公開プロフィール**（公開設定の全走者）。割合は母集団が揃わないため出さない
- 注意: 一覧は「メインプリセットが非アクティブならそのスナップショット」を、統計の集計はライブテーブルを元にする（今は未統一）
- サブタブ（操作 → キー／キー → 操作／マウス。1つ目の名前は `keybindingsStats.keyboardTab`）は URL の `statsTab`（`keyboard` / `keys` / `mouse`）（表の `tab` と衝突させない）。統計は箱（Card）にせず、欄の見出し（h3）＋箱なしで並べる。概要はタイル（`rounded-xl bg-secondary/50`）

#### 感度分布（`SENSITIVITY_RANGES`）

- 表示・CSV・編集画面と同じ **0〜200%**（Minecraft準拠）基準の**10区分**（`< 20%`, `20-39%`, `40-59%`, `60-79%`, `80-99%`, `100-119%`, `120-139%`, `140-159%`, `160-179%`, `180-200%`）。区分は閉端（最終区分の `200%` を含む）で、換算は一覧・CSVと同じ `toSensitivityPercent()` を使う。数値境界の実体は `SENSITIVITY_PERCENT_BINS`（`app/lib/keybindings-stats-shared.ts`）で、`SENSITIVITY_RANGES` はそこからラベルを付けて導出する
- **有効範囲（内部値 `0..1` ＝ 表示 `0〜200%`）外の感度は、分布・平均の母数から除外**する（`isValidSensitivity()` で判定。平均と中央値を出す）。感度ちょうど `0%` は含む
- 除外した人数（感度は登録済みだが範囲外）はカード下に注記として表示する（`SensitivityStats.excludedCount`、`keybindingsStats.excludedOutOfRange`）。0人のときは注記自体を出さない
- 旧サイト全体統計（`/stats`）は `/keybindings/stats` へ統合した。感度分布の除外方針は `isOutOfRangeSensitivity()` で一覧・CSV と揃える（未設定=`null`は元々対象外なので除外人数には含めない）

### CSVエクスポート

`/developers/export` ページから出力項目と対象ユーザーを選んでダウンロードする（v1.4.0 でフッターから移動）。

- セクション選択: `actions`, `remaps`, `custom-actions`, `mouse` の中から複数選択可能
- 対象ユーザー: 設定登録済みの全公開ユーザー（デフォルト）または個別指定（検索 UI）
- API: `GET /api/keybindings-csv?sections=...&userSlugs=...`（`userSlugs` は任意、未指定なら全ユーザー）
- キーバインドは各プレイヤーのキーボード配列に応じた表示ラベルで出力
- `mouse` セクションの `cm/180°` `Cursor Speed` は一覧と同じ計算関数（`calculateCm360` / `calculateCursorSpeed`）に統一されており、計算できない場合は空欄。`Win Sens Multiplier` 列も `windowsSpeed` / `windowsSpeedMultiplier` が未設定なら空欄（`1` にフォールバックしない）。`Sensitivity (%)` 列は有効範囲外の値も含め生データをそのまま出力する

---

## キー編集ダイアログの操作割り当て（`/me/keybindings`）

キーを選んで開くダイアログの「操作割り当て」行は、状態を `getActionAssignmentStatus()`（`app/lib/keybindings-assignment.ts`）で3つに分ける。ほぼ全ての操作がどこかのキーに割り当て済みのため、「他キーに割当済」を警告にすると全行が警告になり本当の衝突が埋もれる。

- `conflict`: このキーに割り当て済みで、同じキーに他の操作も載っている場合だけ警告表示（`text-warning`「同じキーに他の操作もあります」）
- `moves`: 他のキーに割り当て済み。控えめな注記のみ（チェックするとそのキーから移動する）
- `none`: 上記以外。`_UNBOUND`（不使用）は割り当て済みに数えない

ダイアログのスクロール領域は本文1つだけにする（`max-h-[calc(100dvh-2rem)]`）。内側のリストに `max-h` / `overflow-y-auto` を付けない（二重スクロールになるため）。

---

## 編集ページとプリセットの同期

`/me/keybindings` の編集ページは v1.4.0 で次のように変更された：

- 上部に **PresetSelector** ドロップダウンを表示（詳細は [`docs/presets.md`](presets.md) 参照）
- 保存（`save-keybindings` / `save-remaps` / `save-fingers` / `save-custom-actions` / `save-all`）の各 intent で `syncActivePresetSnapshot(db, userId, kinds)` を呼び、アクティブプリセットの該当 `*Data` JSON を最新化（書き込みスルー）
- カスタムキー定義（`customKeys`）とカスタムアクション（`customActions`）もプリセットスナップショットの対象（`customKeysData` / `customActionsData` カラム）
- **カスタムキーの保存は保存バー（`save-all`）に統合**されている。専用の保存ボタンと `save-custom-keys` intent は廃止。カスタムキーの変更（追加・編集・削除）は `hasUnsavedChanges` に含まれ、離脱確認・「保存して移動」・「取消」の対象になる。`save-all` の `customKeys`（JSON）は変更があるときだけ送り、他の変更と同じトランザクションで確定する（途中で失敗すると全体がロールバックされ、画面の下書きは残る）。変更履歴の「…を更新」には「カスタムキー」が加わる
- キーのダイアログのチェックボックスのラベルは、操作名と「割当済」「同じキーに他の操作もあります」の補足の間に sr-only の読点を挟む（「後退、S に割当済」の形に読まれる）
- 保存リクエストにロード時の `presetId` を含め、別タブ等で切替済みなら `mePresets.staleSession` で拒否

---

## キーボードビューの画像出力

プロフィール（`/player/:slug?tab=keybindings`）のキーボードビュー右上に「画像で保存」ボタンを表示し、モーダルからキーボードビューを PNG として書き出せる。

- **含める範囲**: 走者情報（アバター・名前）/ キーボード / テンキー（TKL では非表示）/ マウス をチェックボックスで選択
  - 走者情報ブロックは `MinecraftAvatar`（頭・データURL描画なので画像化時の CORS 汚染なし）+ 表示名 + `@MCID`
- **記載内容**: リマップ・指の色・操作内容 をスイッチで個別にオン/オフ（`VirtualKeyboard` 等の `showRemaps` / `showFingerAssignments` / `showActionLabels` に対応）
  - 指の色を表示する場合は `FingerLegend`（凡例）も自動で出力に含める
- **テーマ**: ライト / ダーク / ウルトラダーク を選択。プレビュー用ノードにテーマクラス（`.light` / `.dark` / `.ultra-dark`）を付与して CSS 変数を局所適用するため、ページのグローバルテーマに依存せず出力できる
  - そのため指色チップの文字色は `dark:` 変種ではなく CSS 変数 `--finger-chip-fg`（`--color-finger-chip-foreground`）で切り替える（ライト=暗色 / ダーク・ウルトラダーク=白。指色背景に対し全指で 4.5:1 以上）
- 画像化はプレビューノードを `html-to-image` でラスタライズ（クライアントサイド完結）
  - **ダウンロード**: `toPng` で PNG データURLを生成して保存
  - **コピー**: `toBlob` で PNG Blob を生成し `navigator.clipboard.write`（`ClipboardItem`）でクリップボードへ。非対応ブラウザ（`ClipboardItem` 無し）ではコピーボタンを表示しない

## 保存の検証と上限（キー配置・デバイス・アイテム・サーチクラフト・プリセット・インポート共通）

設定・装備系の保存 action は、**書き込みを始める前**に次を検証し、1つでも不正なら全体を拒否して何も書かない。定数は `app/lib/save-limits.ts` の `SAVE_LIMITS` が単一情報源（**上限の一覧はここだけに書く**）。上限は「悪用で DB を膨らませられない」水準で、現実的な最大のおよそ10倍に置く。画面側の既存の上限（件数制限など）より緩い。

| 対象 | 上限 |
|---|---|
| プリセット | 1ユーザー 50 個（`create-preset`。コピーも数える）、名前 100 文字、説明 500 文字（`create-preset` / `update-preset`） |
| リマップ | 保存後の総数 1000 件（`/me/import` の1回あたり上限と同じ）。キー名・ソフト名 200 文字、メモ 1000 文字 |
| カスタムキー・カスタムアクション | 保存後の総数 各 200 件。キーコード・名前・トリガーキー 200 文字、説明 1000 文字 |
| キーバインド更新 | 1000 件（既存）。キーコード 200 文字 |
| アイテム配置 | 100 件、セグメント名 100 文字、メモ 10000 文字、1配置あたりスロット 100、1スロットまたはオフハンドのアイテム 50 個、アイテム ID 200 文字 |
| サーチクラフト | 500 件、1件あたりアイテム 50 個（ID 200 文字）、コメント 500 文字、サーチ文字列 500 文字（バリエーションは既存の 5 件まで） |
| Loop | 200 件、ステップは `MAX_LOOP_STEPS`（100）まで、コメント 500 文字 |
| デバイス | キーボード・マウスのモデル名 各 100 文字、メモ 10000 文字、コントローラー名 100 文字 |

- **既に保存されている値は通す**: 画面は保存済みの行をそのまま送り返すため、過去に（検証が無かった頃に）許可リスト外・上限超過の値が保存された行があると、別の行を編集しただけで保存が全部拒否される。サーチクラフト・Loop は `timing`・`comment` が**同じ id の既存行の保存値と一致するなら**検証を免除し、null に丸めず保存値のまま書き戻す（新しく送られた不正値はエラー）。デバイスのメモ・アイテム配置のメモは、リサイズされない自由記述なので上限を 10000 文字に緩めて対応した。カスタムキーの空のキーコード・名前も同じ規則で、**同じ id の既存行に保存済みの値と同じ値の送り返しは通し**（そのまま書き戻す。値は変えず削除もしない）、新しく空にする更新（保存値は空でないのに空で送る）は拒否する（過去の実装は既存行を空の値で更新できたため、空のコードを持つ行が実在する）。カスタムアクションには「既存行を空で上書きさせない」規則自体が無い（空の名前・トリガーの行は従来どおり黙ってスキップする）ため対応不要。カスタムキー・アクションの `category` は、UI・legacy インポート・スナップショット復元のどれからも enum 外の値は入らないため免除していない
- **件数は保存後の総数**で判定する（既存 − 削除 + 新規）。ペイロードの件数だけでは、id 無しの行を繰り返し送って増やせるため。超過は `limitExceeded`（プリセットは `tooManyPresets`）で、削除も含めて何も確定しない
- **検証の置き場所**: `app/lib/keybindings-payload.ts`（リマップ・カスタムキー・カスタムアクション）、`item-layouts-payload.ts`、`search-craft-payload.ts`。`save-remaps` / `save-all` / `save-custom-actions` は同じ関数を通す
  - `_delete` の行は id だけを見る。新規の空行（キー名などが空）は従来どおり黙ってスキップする。**既存行（id あり）のカスタムキーを空のキーコード・名前で更新する保存は拒否**する
  - `category`（カスタムキー・カスタムアクション）は `テーブル.列.enumValues` で検証する。サーチクラフト・Loop の `timing` は `SEARCH_CRAFT_TIMINGS`（未指定・null・空文字は「区分なし」、許可リスト外はエラーで null に丸めない）
  - アイテム配置のセグメント名は空・大文字小文字を無視した重複を拒否する（画面側と同じ規則）。id のペイロード内の重複も拒否する
- **文字列欄は `formString()`（`save-limits.ts`）で取り出す**。`formData.get(x) as string` に File を送られると `.trim` が TypeError で 500 になるため、文字列でなければ「未送信」として扱う
- **id の引き継ぎ規則**（`/me/items` の `saveAll`・`/me/search-craft` の `saveAll`）: 送られた id を保存行の主キーとして引き継ぐのは**自分の既存行にある id だけ**。`new-` 始まり・他人の id・任意の文字列は `createId()` で採番し直す（任意の文字列を主キーにできると、他人の id の存在を成功・失敗から判定できてしまう）。サーチクラフトは「送信 id → 最終 id」を craft・Loop とも全件 `craftIdMap` に登録し、Loop の `craftId` 引き換えは常にこの対応を通す
- **FOV・GUI スケール**は `isValidFov`（整数 30〜110）・`isValidGuiScale`（整数 0〜10）を `/me/devices` の保存と `/me/import` の Minecraft 設定取り込みで共有する。`/me/devices` は範囲外をエラーにする。`/me/import` は、型違い（数値でない値）だけ取り込み全体を拒否し、数値だが範囲外・非整数の値は**その項目だけ取り込まず既存値を保持する**（改造クライアントの値や想定と違う形式のファイルで、キー配置ごと取り込めなくなるのを避ける。ゲーム言語と同じ扱い）
- **ゲーム言語**は `app/lib/game-languages.ts` の `normalizeGameLanguage`（許可リスト・小文字化）で検証する。`/me/devices` は許可リスト外の値をエラーにする（保存済みの値と同一なら通す＝旧データの持ち主が保存不能にならない）。`/me/import` は許可リスト外を取り込まず**既存値を保持**する
- **コントローラー設定**は既知の4項目（`controllerModel` / `lookSensitivity` / `invertYAxis` / `vibration`）だけを再シリアライズして保存する。型が合わない場合は既存値を保持する
- **変更履歴にクライアントの生ペイロードを残さない**: `save-all` の `config_history` 行は `changeDescription` と `presetId` だけを書き、`newData` / `previousData` は書かない（読む側が無く、保存のたびに DB が増えるため。列は残す）

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
| `app/components/keybindings/filter-dialog.tsx` | 統合フィルタモーダル（ユーザー絞り込み + 操作＝キー + 数値範囲、適用で反映） |
| `app/lib/keybindings-filter.ts` | キー名の表示ラベル・比較（並べ替え）と、操作＝キーの絞り込み判定（`rowMatchesBind`）の純粋ロジック |
| `app/lib/keybindings-search-params.ts` | URL パラメータ定義（`bind` の parse / format、操作→タブの対応、統計→表のリンク組み立て） |
| `app/components/keybindings/user-filter.tsx` | ユーザー検索・選択リスト（`UserSelectList`）と選択チップ（`UserFilterChips`、`users` パラメータ） |
| `app/components/keybindings/keybindings-empty-state.tsx` | 0件表示（表・カードビュー共通）。フィルタ起因なら理由 + クリアボタンを出す |
| `app/components/sensitivity-warning.tsx` | 感度が有効範囲外のときの警告表示（値 + 警告アイコン + ヒント）。一覧・プロフィール共通 |
| `app/components/hint-tip.tsx` | 短い補足説明の共有トリガー（ポインタ端末は Tooltip、タッチ端末は Popover に自動で出し分ける） |
| `app/routes/keybindings-stats.tsx` | キー配置の統計・傾向ページ |
| `app/routes/me/keybindings.tsx` | 自分のキー配置編集ページ |
| `app/routes/me/devices.tsx` | 自分のデバイス設定編集ページ |
| `app/components/virtual-keyboard.tsx` | バーチャルキーボードコンポーネント |
| `app/routes/api/keybindings-csv.ts` | CSVエクスポートAPIエンドポイント |
