# サーチクラフトテンプレート・Playground 仕様書

サーチクラフト設定のテンプレート公開・適用機能と、サーチクラフト×キーリマップの Playground の仕様を定義する。

---

## サーチクラフトテンプレート

### テーブル: `search_craft_templates`

| カラム | 型 | 説明 |
|---|---|---|
| id | text (PK) | CUID2 |
| userId | text (FK → users, cascade) | 作成者のユーザーID |
| title | text | テンプレート名（必須、最大100文字） |
| description | text (nullable) | 説明（最大500文字） |
| craftsData | text (JSON) | サーチクラフトのスナップショット（`PresetSearchCraftData[]`） |
| remapsData | text (JSON, nullable) | リマップのスナップショット（`PresetRemapData[]`、登録した場合のみ） |
| isPublished | boolean | 公開フラグ（デフォルト: true） |
| applyCount | integer | 適用された回数（デフォルト: 0、自分自身による適用はカウントしない） |
| createdAt / updatedAt | timestamp | 作成・更新日時 |
| gameLanguage | text (nullable) | サーチ文字列が想定するゲーム内言語コード（例: `ja_jp`、最大32文字。一覧・詳細・管理画面にバッジ表示） |
| loopsData | text (JSON, nullable) | 繋ぎ方（Loop）のスナップショット（`PresetSearchCraftLoopData[]` と同一形式。`TemplateLoop[]` として読み書きする、下記） |

- インデックス: `idx_search_craft_templates_user_id`、`idx_search_craft_templates_published_created`
- **データ形式は `config_presets` のスナップショット（`searchCraftsData` / `remapsData` / `searchCraftLoopsData`）と同一**。シリアライズには `app/lib/preset-utils.ts` の `serializeSearchCrafts()` / `serializeRemaps()` をそのまま使用する。
- 制限: 1ユーザーあたり最大 **20件**（`MAX_TEMPLATES_PER_USER`）。

### パースユーティリティ（`app/lib/search-craft-templates.ts`）

| 関数 | 説明 |
|---|---|
| `parseTemplateCrafts(craftsData)` | `PresetSearchCraftData[]` JSON → 表示用 `TemplateCraft[]`（items の二重エンコードを解決、sequence順ソート、timing正規化、withShift は boolean に正規化。不正データは空配列） |
| `parseTemplateRemapData(remapsData)` | `PresetRemapData[]` JSON をパース（不正データは空配列） |
| `parseTemplateRemaps(remapsData)` | 表示・シミュレーション用 `UiRemapInfo[]` に変換（`outputMode: "character"` は `outputCharacter` を出力先として扱う） |
| `serializeTemplateCrafts()` / `serializeTemplateRemaps()` | 上記の逆変換。編集状態や Playground の一時データをDB保存用JSONにする |
| `parseTemplateLoops(loopsData, craftCount)` | `loopsData` JSON（`craftSeq = craftIndex + 1`）→ `TemplateLoop[]`。`craftCount` の範囲外を指す `craftSeq` のステップは除去し、残り2件未満の Loop は除去。不正JSON・要素は捨てる（例外を投げない） |
| `serializeTemplateLoops(loops)` | `TemplateLoop[]` → `loopsData` JSON 文字列（`parseTemplateLoops` の逆変換） |
| `parseLoopsField(formData, craftCount)` | フォームの `loops` フィールド（`TemplateLoop[]` 形状、`craftIndex` 参照）を検証。構造不正（非配列・`craftIndex` 範囲外・`bsCount`/`arrowCount` 非負整数でない等）は `{ error: true }` |
| `toSubmittableLoops(crafts, loops)` | 編集用 Loop（`craftId` 参照）を送信直前に現在の `crafts` 配列内の位置（`craftIndex`）へ変換。`crafts` に見つからない `craftId` を含むステップがあれば、その Loop ごと除外する安全網 |
| `parseEditorSubmission(formData)` | テンプレートエディタの送信を検証してDB保存形式へ変換（不正なら `{ error }`。`loopsData` も含む） |
| `toEditorCrafts()` / `toEditorRemaps()` | パース済みデータにエディタ用の安定したIDを付与 |

#### 繋ぎ方（Loop）: `TemplateLoop`

```typescript
type TemplateLoop = {
  steps: { craftIndex: number; transition: LoopTransition | null }[];
  comment: string | null;
  timing: SearchCraftTiming | null;
};
```

テンプレート・Playground は `crafts` に安定した行 id を持たない（`/me/search-craft` の `search_crafts.id` と異なり、編集中は毎回配列の位置が変わりうる）ため、ステップの参照先は **`craftIndex`（0始まりの配列位置）** で表す。保存形式は `config_presets.search_craft_loops_data` と同一の `PresetSearchCraftLoopData[]`（`craftSeq` 参照）を流用し、`serializeTemplateCrafts()` が常に `sequence = index + 1` を書くことを利用して **`craftSeq = craftIndex + 1` を恒等関係**として変換する（`docs/presets.md` の `PresetLoopStepData` 参照）。

上限は JSON爆弾対策のサニティ値（意味的な仕様上限ではない）: `MAX_TEMPLATE_LOOPS = 50`（1テンプレートあたりの Loop 数）、`MAX_LOOP_STEPS = 100`（1 Loop あたりのステップ数）。

### 管理・エディタ（/my-guides/templates）

- `/my-guides/templates`（`app/routes/my-guides/templates.tsx`）で管理する。ガイド管理（`/my-guides`）と同じ「自分の公開コンテンツ」エリアに置かれ、両ページ間は `MyContentTabs`（`app/components/content-tabs.tsx`）のタブで行き来する。管理ページの action は `toggle-publish` / `delete` のみ（いいねは `/api/likes` が担当）。
- **作成 `/my-guides/templates/new`**（`app/routes/my-guides/template-new.tsx`）・**編集 `/my-guides/templates/:templateId/edit`**（`app/routes/my-guides/template-edit.tsx`）: テンプレートエディタでテンプレートの内容そのものを直接編集する。**プリセットや現在の設定を経由せずゼロから作成できる**。
  - 構成: 基本情報（テンプレート名・説明・ゲーム内言語 = `GAME_LANGUAGE_OPTIONS` の Combobox、任意）+ **`SearchCraftWorkbench`**（`app/components/search-craft-workbench.tsx`）。ワークベンチは **Playground と同一構成**（バーチャルキーボード → キーリマップ編集 → サーチクラフト編集。タイピングテストはバーチャルキーボードカード右上のボタンから開くモーダル。詳細は後述「Playground > セクション構成」参照）。
  - サーチクラフト編集部の `SearchCraftListEditor` は行形式（ドラッグハンドル + 順番 + アイテムチップ + サーチ文字列 + タイミング + 「Shiftを押しながら」チェックボックス + コメント常時表示）。`remaps` prop を渡すと**入力キーのライブプレビュー**（`ActualKeyBadges`）が各行に表示される（ワークベンチは編集中のリマップ、`/me/search-craft` はユーザーの現在のリマップを使用）。withShift が有効な行のプレビューは Shift 押下前提の逆引きになり、先頭に「⇧ Shift」バッジが付く。
  - 「現在の設定を読み込む」ボタンでライブテーブル（`search_crafts` / `key_remaps`）の内容を編集中の内容に読み込める（確認ダイアログ付き）。
  - 送信は `parseEditorSubmission()` でサーバー側検証（タイトル必須・各クラフトにアイテム1件以上とサーチ文字列必須・上限チェック・未入力リマップ行と重複 sourceKey の除外）。作成時は `isPublished: true` で公開される。
- `/me/search-craft` の「テンプレートとして公開」ボタンから `/my-guides/templates` へ遷移できる。

### 公開ページ

- **一覧 `/guides/templates`**（`app/routes/guides/templates/index.tsx`）: `isPublished = true` **かつ著者が公開プロフィール（`profileVisibility = "public"`）** のテンプレートを最大100件、ガイド一覧のリスト表示（`GuideListView`）と同様の `divide-y` コンパクト行形式で表示。ゲーム内言語は最重要メタ情報としてタイトル行の右側に大きめに表示する。認証不要。公開ガイド一覧（`/guides`）と `GuidesContentTabs` のタブで行き来する（ヘッダーナビ「ガイド」から到達）。
  - **並び替え**: `?sort=` で「新着順（既定、`createdAt` 降順）」と「いいね数順（総いいね数降順）」を切り替えられる（`ContentSortSelect`、`TEMPLATE_SORTS = ["new", "likes"]`）。`.limit(100)` より前に SQL の `ORDER BY` で並べる（メモリ上で並べ替えると「新しい100件をいいね数順に並べた」結果になるため）。同数時は `createdAt` → `id` でタイブレークする。旧ラベル「人気順」（`?sort=popular`）は v1.13.0 で「いいね数順」（`likes`）に改名し、旧クエリ値は既定の新着順へフォールバックする（詳細は [`docs/likes.md`](./likes.md#並び替え)）
  - **いいね**: 各行にいいね数を表示し、ログイン中は行内のグッドボタンで直接いいねできる（自分のテンプレートは件数のみ）。詳細は `docs/likes.md`
  - **検索バー**: テンプレート名（`?q=`、部分一致・大文字小文字無視、メモリ上でフィルタ）とゲーム内言語（`?lang=`、SQLで完全一致）で絞り込める。並び順は hidden input で持ち越す。ガイド一覧と同じ `Form method="get"` 方式で、**検索ボタン押下時にページが更新される**。言語はComboboxで選択（`__all` = 絞り込みなし、hidden input でGET送信）。絞り込み結果が0件の場合はリセットリンク付きの専用メッセージを表示。
- **詳細 `/guides/templates/:templateId`**（`app/routes/guides/templates/view.tsx`）: テンプレートの内容（リマップ・サーチクラフト一覧）を表示。ゲーム内言語はバッジではなくヘッダー部に大きく表示する（サーチ文字列の前提となる最重要情報のため）。
  - 実入力キーはテンプレートに含まれるリマップを前提に `getActualKeyInfos()` で導出して表示する。withShift のエントリは `{ shiftHeld: true }` で導出し「⇧ Shift」バッジ付きで表示する（詳細は docs/items-searchcraft.md の「Shiftを押しながらクラフト」参照）。
  - 非公開テンプレートは作成者本人のみ閲覧可能（他者には404）。**著者のプロフィールが非公開（private）の場合も本人以外は404**（限定公開 unlisted はURL指定なら閲覧可）。
  - アクション行に**いいねボタン**を置く（`ShareButton` の直後）。自分のテンプレートでは押せず件数のみ表示する。
  - OGP: `/og-image?title=...` を使用。`ShareButton` で共有可能。

## テンプレートの適用（自分の設定への反映）

`/guides/templates/:templateId` の「自分の設定に反映」ボタン（要ログイン。未ログイン時はログインページへの導線）。

ダイアログで**反映先を選択**する:

- **新規プリセットを作成して反映**（デフォルト。プリセット名の初期値はテンプレート名）
  - **元となるプリセット**（任意）を選ぶと、そのプリセットの全設定データ（キーバインド・デバイス設定・アイテム配置等）をコピーした上でサーチクラフト（＋リマップ）を上書きする
  - 新規プリセットは**常に非アクティブ**で作成される（ライブ設定は変更されない）。使用するには `/me/presets` から適用する
- **既存のプリセットに反映**（反映先プリセットを選択）
  - 反映先が**アクティブプリセット**の場合: 「アクティブプリセット = ライブテーブル」の不変条件を保つため、ライブテーブルを全置換して `syncActivePresetSnapshot()` で同期する（警告表示あり）
  - 非アクティブの場合: プリセットのJSON列（`searchCraftsData` / `remapsData` / `searchCraftLoopsData`）のみ更新
- リマップを含むテンプレートは「リマップも反映する」チェックボックスで選択（外すと反映先のリマップは変更されない）
- `configHistory` に変更履歴（`game_setting`、反映先プリセット名入り）を記録。作成者以外による適用の場合は `applyCount` をインクリメント

適用ロジックはサーバー専用ヘルパー **`app/lib/search-craft-apply.server.ts`** に集約されており、Playground の「保存」も同じヘルパーを使う:

| 関数 | 説明 |
|---|---|
| `applyCraftsToExistingPreset(db, userId, presetId, input)` | 既存プリセットへの反映（アクティブ判定・ライブ置換・同期を内包） |
| `createPresetWithCrafts(db, userId, { name, description, basePresetId }, input)` | 新規プリセット作成（ベースプリセットの全データコピー対応、常に非アクティブ） |

`input.remaps` が `null` の場合はリマップに触れない（既存値 / ベースの値を維持）。`sourceKey` 重複は先勝ちで除外し、`sanitizeRemapTargetKey` でサニタイズする。

`input`（`ApplyCraftsInput`）は `crafts`・`remaps`（null=変更なし）に加えて **`loops: TemplateLoop[]`** を持つ。`remaps` と異なり **loops は「変更なし」の選択肢がなく、crafts を置換する経路は常に loops も置換する**（crafts が入れ替わると、旧 loops が参照する `craftIndex`/`craftId` は入れ替え後の crafts と対応しなくなり必ず腐るため）。

- ライブ置換（`replaceLiveTables`）: `search_craft_loops` を全削除してから `search_crafts` を挿入し、`TemplateLoop[]` の `craftIndex` を挿入直後の新 id 配列で `LoopStepData`（`craftId` 参照）へ解決して再挿入する（`resolveLoopsToNewCraftIds`。範囲外ステップは除去、残り2件未満の Loop は破棄）
- 非アクティブプリセット更新・新規プリセット作成: `searchCraftLoopsData` を `serializeTemplateLoops(input.loops)`（0件なら `null`）でそのまま上書きする。**`createPresetWithCrafts` はベースプリセットの `searchCraftLoopsData` を継承しない**（`keybindingsData` 等の他の列はベースからコピーするが、loops だけは crafts と一緒に必ず上書きされる）

リマップ種別（`remapType`、詳細は [`docs/keybindings.md`](keybindings.md) の「リマップ種別と適用文脈」参照）の扱い:

- ワークベンチ（Playground・テンプレートエディタ）のリマップは種別を持たず、保存・適用時に `chat` として扱われる（挿入行は `remapType: "chat"`）
- ライブテーブルへの反映時は `chat` / `unset` の行のみ削除し、`trigger` / `all` の行は保持する
- テンプレート行と同一 sourceKey の `all` 行は `trigger` に変換する（All は他種別と共存できないため）

---

## Playground（/playground）

`app/routes/playground.tsx`。**閲覧・編集は認証不要**（ログインなしで自由に試せる）。サーチクラフトとキーリマップの組み合わせをその場で試せる実験場。ログインすると、編集内容をプリセットとして保存したり、自分のプリセットを選んで読み込んだりできる。

### データ読み込み

初期データの優先順位: `?template=<id>` クエリ（公開テンプレート or 自分の非公開テンプレート）→ ログイン中ユーザーのアクティブなプリセット（プリセット未作成ならライブテーブルの内容）→ 空の状態。

- 読み込みバーから「テンプレートを再読み込み」「自分の設定を読み込む」「クリア」を実行できる。
- 「自分の設定を読み込む」はダイアログでプリセットを選択できる（`loader` がユーザーの全プリセットを `myPresets` として返す。プリセットを1件も作成していないユーザーには、ライブテーブルの内容を「現在の設定」という擬似プリセット1件として見せる）。
- 「サンプルを読み込む」機能は廃止。

### ブラウザへの仮保存（localStorage）

- リマップ・サーチクラフト・**繋ぎ方（Loop）**・キーボードレイアウトの編集内容は `window.localStorage`（キー: `minefolio.playground.draft.v1`）へ変更のたびに自動保存される。サーバーには送信されない。
- ページ再訪問時、`?template=` 指定がなければこの下書きを最優先で復元する（SSRとの表示差異を避けるためマウント後の `useEffect` で復元する）。
- 「クリア」を押すと空の状態になり、その空状態がそのまま下書きとして保存される（明示的な下書き削除ボタンはない）。
- `PlaygroundDraft` 型に `loops: SearchCraftLoopDraft[]`（`craftId` 参照）フィールドを持つ。**下書きキー自体は `v1` のまま**（新バージョンへの移行は行わない）。`loops` フィールドが無い旧形式の下書き（Loop機能追加前に保存されたもの）は `[]` として扱い、読み込み時にクラッシュしない。
- メモリ上は draft id（`craftId`）参照で持ち、**localStorage・フォーム送信・下書き/プリセット/テンプレート読込の境界でだけ `craftIndex` と相互変換する**。下書き復元やプリセット/テンプレート読込で crafts の draft id が全振り直しになるのに合わせて、`remapLoopSteps()` で loops の `craftId` 参照も新しい id へ再解決する（参照切れは自動除去、2件未満になった Loop は破棄）。

### プリセットへの保存（ログイン時のみ）

読み込みバーの「保存」ボタンからダイアログを開き、以下のいずれかを選べる。

- **新規プリセットとして保存**: 名前・説明を入力して新しい `config_presets` 行を作成する。**元となるプリセット**（任意）を選ぶと、そのプリセットの全設定データをコピーした上でサーチクラフト・リマップ・繋ぎ方（Loop）を上書きする。**常に非アクティブ**で作成する（ライブテーブルは書き換えない）。反映するには `/me/presets` から「適用」する必要がある。
- **既存のプリセットに保存**: 対象プリセットを選択して上書きする。
  - 対象が**非アクティブ**な場合: そのプリセットの `searchCraftsData` / `remapsData` / `searchCraftLoopsData` 列のみを直接更新する（ライブテーブル・他のプリセットには影響しない）。
  - 対象が**アクティブ**な場合: アクティブプリセット = ライブテーブルという不変条件を保つため、ライブの `search_crafts` / `search_craft_loops` / `key_remaps` を全置換した上で `syncActivePresetSnapshot()` を呼び、アクティブプリセットのスナップショットを同期する（`/me/search-craft` の保存と同じ書き込みスルー）。
- リマップを含めるかはチェックボックスで選択（外すと保存先の既存リマップ設定は変更しない）。繋ぎ方（Loop）は常に crafts と一緒に上書きされる（チェックボックスでの選択肢はない。理由は「テンプレートの適用」節参照）。
- 保存直前、フォームの `loops` フィールドは `parseLoopsField()` → `toSubmittableLoops()` の順で `craftIndex` 参照の `TemplateLoop[]` へ変換してから送信し、apply 経路（`createPresetWithCrafts` / `applyCraftsToExistingPreset`）へ渡す。
- 保存処理はテンプレート適用と共通のサーバーヘルパー（`app/lib/search-craft-apply.server.ts` の `createPresetWithCrafts` / `applyCraftsToExistingPreset`）を使用する。

### セクション構成（SearchCraftWorkbench）

編集セクションは共有コンポーネント **`SearchCraftWorkbench`**（`app/components/search-craft-workbench.tsx`）に集約されており、**Playground とテンプレートエディタ（作成・編集）で同一構成**を共有する。crafts / remaps / loops / layout の状態は親が持ち、ワークベンチは制御コンポーネントとして動作する（`WorkbenchRemap` 型・`effectiveRemapsFrom()`・`normalizeLayout()` / `LAYOUT_OPTIONS` もここから export）。

1. **バーチャルキーボード**: `VirtualKeyboard`（`showRemaps`）でリマップ割り当てを表示。US / JIS / US_TKL / JIS_TKL のレイアウト切替付き。**キーをクリックするとリマップ登録モーダルが開く**（`/me/keybindings` のキー編集ダイアログと同じ `DialogRemapRow` を使用。修飾キー組み合わせのトグル・出力タイプ選択に対応し、クリックしたキーを起点とする既存リマップが一覧表示され、「追加」で新しい組み合わせを登録できる）。カードヘッダー右上に**タイピングテストを開くボタン**がある。
2. **キーリマップ編集**: `/me/keybindings` のリマップタブと**同一のUI・UX**。共通コンポーネント `RemapRow`（`app/components/remap-row.tsx`、`useRemapOutputType` フック含む）を共用する。リマップ元は修飾キー組み合わせ対応の `KeyCaptureButton`（`app/components/key-capture-button.tsx`）、変更先はキー / 文字 / 無効の3タイプ。キーラベルは選択中のキーボードレイアウトに追従する。
3. **サーチクラフト編集**: `SearchCraftListEditor` によるアイテムごとの登録・編集（アイテム選択ダイアログ・タイミング・コメント・並べ替え・削除）。サーチ文字列を編集すると、現在のリマップ設定で実際に押すキーが `getActualKeyInfos()`（逆方向変換）でリアルタイムにプレビュー表示される。
4. **繋ぎ方（Loop）編集**: `SearchCraftLoopListEditor`（`app/components/search-craft-loop-editor.tsx`）によるステップの追加・並べ替え・削除。サーチクラフト行の削除に連動して、削除された `craftId` を参照する Loop ステップを自動除去する（生存参照は温存、2件未満になった Loop は自動除去。詳細は [`docs/items-searchcraft.md`](items-searchcraft.md) の「繋ぎ方（Loop）」参照）。

このほか、**タイピングテスト**（フォーカスしてキーを押すとリマップ適用後の出力文字と押したキーの履歴を表示。`simulateRemapOutput()` の順方向シミュレーションを使用）は、バーチャルキーボードカード右上のボタンから開く**モーダル**として表示される。

### simulateRemapOutput()（`app/lib/remap-utils.ts`）

物理キー入力（修飾キー組み合わせ）にリマップを**順方向**に適用し出力文字を求める。`getActualKeyInfos()`（文字→押すキーの逆引き）の対になる関数。

解決順序:
1. 修飾キー込みの完全一致リマップ
2. 基底キーのみ一致（Shift のみの組み合わせは出力の大文字化として扱う）
3. リマップなし: 印字可能キーはそのままの文字、それ以外・Ctrl/Alt/Meta を含む未定義の組み合わせは出力なし

ユニットテスト: `app/lib/__tests__/remap-utils.test.ts`、`app/lib/__tests__/search-craft-templates.test.ts`、`app/lib/__tests__/search-craft-loops.test.ts`

---

## 表示コンポーネント

`app/components/search-craft-template-view.tsx`（プロフィールのサーチクラフトタブ・テンプレート詳細で共用。`ActualKeyBadges` は編集UI `search-craft-editor.tsx` のライブプレビューでも使用）:

| コンポーネント | 説明 |
|---|---|
| `SearchCraftGroupedList` | サーチクラフト一覧の正典表示。タイミング別グループカード（色ドット + 件数）+ 3カラム表形式（アイテム / サーチ文字列 / 入力キー、lg未満は縦積み）。シーケンス番号・サーチ文字列のクリックコピー・コメント表示付き。`fingerAssignments` は任意（プロフィールのみ渡す） |
| `KeyBadge` / `ActualKeyBadges` | 実入力キーのバッジ（指割り当て色・リマップring・Shift琥珀・ツールチップ）。`ActualKeyBadges` はサーチ文字列から `getActualKeyInfos()` で導出 |
| `KeyBadgeLegend` | キーバッジ装飾の凡例（`showFingers` で指割り当て凡例を表示、`showCraftMarker` で Loop のクラフト実行マーカーの凡例を表示） |

テンプレート詳細のリマップ表示はチップ一覧ではなく **`VirtualKeyboard`（`showRemaps`）** で行い、閲覧者がレイアウト（US / JIS / US_TKL / JIS_TKL）を切り替えられる。

繋ぎ方（Loop）は `app/components/search-craft-loop-view.tsx` の `SearchCraftLoopList`（プロフィール・テンプレート詳細で共用）で表示する。テンプレート詳細では `parseTemplateLoops(template.loopsData, crafts.length)` で `craftIndex` を `craft-${idx}` 形式の合成 id へ解決してから渡す。詳細は [`docs/items-searchcraft.md`](items-searchcraft.md) の「繋ぎ方（Loop）」を参照。

## 関連ファイル

| ファイル | 役割 |
|---|---|
| `app/lib/schema.ts` | `searchCraftTemplates`（`loopsData` 列含む）テーブル定義 |
| `app/lib/search-craft-templates.ts` | パース・シリアライズ・制限値ユーティリティ（`TemplateLoop` 関連含む） |
| `app/lib/search-craft-loops.ts` | 繋ぎ方（Loop）の共有ロジック（遷移導出・参照解決・idリマップ。詳細は [`docs/items-searchcraft.md`](items-searchcraft.md)） |
| `app/lib/search-craft-apply.server.ts` | テンプレート適用・Playground保存の共通サーバーヘルパー（crafts/loops/remaps のライブ置換・プリセット反映） |
| `app/lib/remap-utils.ts` | `simulateRemapOutput()`、`getActualKeyInfos()`、`sanitizeRemapTargetKey()` |
| `app/routes/my-guides/templates.tsx` | テンプレート管理（一覧・公開切替・削除） |
| `app/routes/my-guides/template-new.tsx` / `template-edit.tsx` | テンプレート作成・編集ページ |
| `app/components/template-editor.tsx` | テンプレートエディタフォーム（作成・編集で共通） |
| `app/components/search-craft-workbench.tsx` | 編集ワークベンチ（Playground とテンプレートエディタで共通の4セクション構成） |
| `app/components/search-craft-editor.tsx` | サーチクラフト編集UI（`/me/search-craft` とワークベンチで共通） |
| `app/components/search-craft-loop-editor.tsx` | 繋ぎ方（Loop）編集UI（`SearchCraftLoopListEditor`） |
| `app/components/search-craft-loop-view.tsx` | 繋ぎ方（Loop）表示UI（`SearchCraftLoopList` 等） |
| `app/lib/game-languages.ts` | ゲーム内言語リスト（日本語名併記、例: `Svenska（スウェーデン語）`） |
| `app/components/content-tabs.tsx` | タブナビゲーション（汎用 `ContentTabs` + `MyContentTabs` / `GuidesContentTabs`） |
| `app/routes/guides/templates/index.tsx` | 公開テンプレート一覧 |
| `app/routes/guides/templates/view.tsx` | テンプレート詳細・適用action |
| `app/routes/playground.tsx` | Playground |
| `app/components/search-craft-template-view.tsx` | 共有表示コンポーネント |
| `app/components/remap-row.tsx` | リマップ編集行 + `useRemapOutputType`（me/keybindings と共通） |
| `app/components/key-capture-button.tsx` | キーキャプチャボタン（me/keybindings と共通） |
