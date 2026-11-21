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
| isPublished | boolean | 公開フラグ（列のデフォルトは true だが、画面からの作成は `false` を明示して**非公開**で作る） |
| applyCount | integer | 適用された回数（デフォルト: 0、自分自身による適用はカウントしない） |
| createdAt / updatedAt | timestamp | 作成・更新日時。`updatedAt` は公開版の更新日時（下書き保存では動かない） |
| publishedAt | timestamp (nullable) | **初めて公開した日時**（`publishedAt ?? now` で初回の公開時にだけ入る。非公開に戻して再公開しても変えない）。公開一覧の新着順の基準。未公開のまま保存した行は null |
| draftTitle / draftDescription / draftGameLanguage / draftCraftsData / draftRemapsData / draftLoopsData | text (nullable) | **下書き**（公開中のテンプレートの「下書き保存」）。公開版の対応する列と同じ形式 |
| draftUpdatedAt | timestamp (nullable) | 下書きの保存日時。**下書きの有無はこの列が null でないかだけで判定する**（NULL 可の下書き列は「空にした」を表すので、`??` で公開版へ落とさない） |
| gameLanguage | text (nullable) | サーチ文字列が想定するゲーム内言語コード（例: `ja_jp`、最大32文字。一覧・詳細・管理画面にバッジ表示） |
| loopsData | text (JSON, nullable) | 繋ぎ方（Loop）のスナップショット（`PresetSearchCraftLoopData[]` と同一形式。`TemplateLoop[]` として読み書きする、下記） |

- インデックス: `idx_search_craft_templates_user_id`、`idx_search_craft_templates_published_created`
- **データ形式は `config_presets` のスナップショット（`searchCraftsData` / `remapsData` / `searchCraftLoopsData`）と同一**。シリアライズには `app/lib/preset-utils.ts` の `serializeSearchCrafts()` / `serializeRemaps()` をそのまま使用する。
- 制限: 1ユーザーあたり最大 **20件**（`MAX_TEMPLATES_PER_USER`）。

### パースユーティリティ（`app/lib/search-craft-templates.ts`）

| 関数 | 説明 |
|---|---|
| `parseTemplateCrafts(craftsData)` | `PresetSearchCraftData[]` JSON → 表示用 `TemplateCraft[]`（items の二重エンコードを解決、sequence順ソート、timing正規化。`variations` は `resolveVariations()` で正準化〈旧データ＝searchStr/withShift のみのスナップショットも1件のバリエーションとして扱う〉。不正データは空配列） |
| `parseTemplateRemapData(remapsData)` | `PresetRemapData[]` JSON をパース（不正データは空配列） |
| `parseTemplateRemaps(remapsData)` | 表示・シミュレーション用 `UiRemapInfo[]` に変換（`outputMode: "character"` は `outputCharacter` を出力先として扱う） |
| `serializeTemplateCrafts()` / `serializeTemplateRemaps()` | 上記の逆変換。編集状態や Playground の一時データをDB保存用JSONにする |
| `parseTemplateLoops(loopsData, craftCount)` | `loopsData` JSON（`craftSeq = craftIndex + 1`）→ `TemplateLoop[]`。`craftCount` の範囲外を指す `craftSeq` のステップは除去し、残り2件未満の Loop は除去。不正JSON・要素は捨てる（例外を投げない） |
| `serializeTemplateLoops(loops)` | `TemplateLoop[]` → `loopsData` JSON 文字列（`parseTemplateLoops` の逆変換） |
| `parseLoopsField(formData, craftCount)` | フォームの `loops` フィールド（`TemplateLoop[]` 形状、`craftIndex` 参照）を検証。構造不正（非配列・`craftIndex` 範囲外・`bsCount`/`arrowCount` 非負整数でない等）は `{ error: true }` |
| `toSubmittableLoops(crafts, loops)` | 編集用 Loop（`craftId` 参照）を送信直前に現在の `crafts` 配列内の位置（`craftIndex`）へ変換。`crafts` に見つからない `craftId` を含むステップがあれば、その Loop ごと除外する安全網 |
| `parseEditorSubmission(formData)` | テンプレートエディタの送信を検証してDB保存形式へ変換（不正なら `{ error }`。`loopsData` も含む） |
| `toEditorCrafts()` / `toEditorRemaps()` | パース済みデータにエディタ用の安定したIDを付与 |

#### サーチクラフト: `TemplateCraft`

```typescript
type TemplateCraft = {
  items: string[];
  comment: string | null;
  timing: SearchCraftTiming | null;
  /** 複数サーチ文字列バリエーション（単一の真実。searchStr/withShift スカラーは持たない） */
  variations: SearchCraftVariation[]; // { str: string; withShift: boolean }[]
};
```

`searchStr`/`withShift` は `PresetSearchCraftData`（DB保存形式）側にのみミラーとして残る。`serializeTemplateCrafts()` は `variationMirror(c.variations)` で第1バリエーションを `searchStr`/`withShift` へミラーしつつ、`variations` フィールドも常に書き込む。詳細は [`docs/items-searchcraft.md`](items-searchcraft.md) の「複数サーチ文字列バリエーション」を参照。

#### 繋ぎ方（Loop）: `TemplateLoop`

```typescript
type TemplateLoop = {
  steps: { craftIndex: number; transition: LoopTransition | null; variationIndex?: number }[];
  comment: string | null;
  timing: SearchCraftTiming | null;
};
```

`variationIndex` は参照先クラフトのバリエーション index（0始まり）。`parseTemplateLoops`/`parseLoopsField`/`toSubmittableLoops` は欠落・不正値を 0 に矯正し、`serializeTemplateLoops` は 0 を省略してシリアライズする（`PresetLoopStepData.variationIndex` と同じ規則。詳細は [`docs/items-searchcraft.md`](items-searchcraft.md) 参照）。

テンプレート・Playground は `crafts` に安定した行 id を持たない（`/me/search-craft` の `search_crafts.id` と異なり、編集中は毎回配列の位置が変わりうる）ため、ステップの参照先は **`craftIndex`（0始まりの配列位置）** で表す。保存形式は `config_presets.search_craft_loops_data` と同一の `PresetSearchCraftLoopData[]`（`craftSeq` 参照）を流用し、`serializeTemplateCrafts()` が常に `sequence = index + 1` を書くことを利用して **`craftSeq = craftIndex + 1` を恒等関係**として変換する（`docs/presets.md` の `PresetLoopStepData` 参照）。

上限は JSON爆弾対策のサニティ値（意味的な仕様上限ではない）: `MAX_TEMPLATE_LOOPS = 50`（1テンプレートあたりの Loop 数）、`MAX_LOOP_STEPS = 100`（1 Loop あたりのステップ数）。

### 管理・エディタ（/my-guides/templates）

- `/my-guides/templates`（`app/routes/my-guides/templates.tsx`）で管理する。ガイド管理（`/my-guides`）と同じ「自分の公開コンテンツ」エリアに置かれ、両ページ間は `MyContentTabs`（`app/components/content-tabs.tsx`）のタブで行き来する。管理ページの action は `delete` のみ（公開・非公開の切替は編集画面の保存に一本化した。`toggle-publish` は不明な操作として拒否する。いいねは `/api/likes` が担当）。一覧の行は、公開状態のピルに加え、公開中で下書きがあれば「未公開の変更あり」のピル、非公開なら「編集画面で公開できる」旨の補足を出す。並びは更新日時（`updatedAt`）の新しい順で、時刻は「{time}に更新」（`meGuides.updatedAgo`）。行はマイガイドの行と同じ作りで、行全体（タイトルのリンクの `::after`）が**編集**へ、公開ページへは右の Globe ボタン（公開中のときだけ・新しいタブ）、削除と並べて 44px 四方（sm 以上 32px。`ROW_ACTION_CLASS`）。
- **作成 `/my-guides/templates/new`**（`app/routes/my-guides/template-new.tsx`）・**編集 `/my-guides/templates/:templateId/edit`**（`app/routes/my-guides/template-edit.tsx`）: テンプレートエディタでテンプレートの内容そのものを直接編集する。**プリセットや現在の設定を経由せずゼロから作成できる**。
  - 構成: 基本情報（テンプレート名・説明・ゲーム内言語 = `GAME_LANGUAGE_OPTIONS` の Combobox、任意）+ **`SearchCraftWorkbench`**（`app/components/search-craft-workbench.tsx`）。ワークベンチは **Playground と同じ部品**で、`craftFirst` によりサーチクラフト編集を先頭に置く（サーチクラフト編集 → バーチャルキーボード → キーリマップ編集。Playground はバーチャルキーボード → キーリマップ → サーチクラフト。タイピングテストはバーチャルキーボード欄のボタンから開くモーダル。詳細は後述「Playground > セクション構成」参照）。
  - サーチクラフト＋繋ぎ方（Loop）編集部は **`SearchCraftTimingBoard`**（`app/components/search-craft-editor.tsx`）によるタイミングブロック型UI（「指定なし」+ 6種のタイミング、計7ブロックを常時表示。timing の変更はブロック間D&D）。クラフト行はアイテムチップ + サーチ文字列 + 「Shiftを押しながら」チェックボックス + コメント常時表示。`remaps` prop を渡すと**入力キーのライブプレビュー**（`ActualKeyBadges`）が各行に表示される（ワークベンチは編集中のリマップ、`/me/search-craft` はユーザーの現在のリマップを使用）。withShift が有効な行のプレビューは Shift 押下前提の逆引きになり、先頭に「⇧ Shift」バッジが付く。詳細は [`docs/items-searchcraft.md`](items-searchcraft.md) の「編集UI（タイミングブロック型）」を参照。
  - 「現在の設定を読み込む」ボタンでライブテーブル（`search_crafts` / `key_remaps`）の内容を編集中の内容に読み込める（確認ダイアログ付き）。
  - 送信は `parseEditorSubmission()` でサーバー側検証（タイトル必須・各クラフトにアイテム1件以上とサーチ文字列必須・上限チェック・未入力リマップ行と重複 sourceKey の除外）。検証は下書き保存と公開（保存）の両方に掛ける。
  - **作成**: 作成すると**非公開**（`isPublished: false`・`publishedAt: null`）。確定ボタンは「作成」で、成功すると編集画面（`/my-guides/templates/:id/edit`）へ移る（ガイドの新規作成と同じ）。公開は編集画面の保存で行う。確定ボタンの下に「作成後、編集画面で公開できます」の補足（`submitHint`）を出す。
  - **保存の経路（ガイドと同じ。公開版と下書きを分ける）**: 編集画面の action は `_action` の allowlist（`draft` / `publish` / `discard`。未知の値は拒否）で判定する。他人のテンプレートへの操作は拒否する。
    - `draft`（**公開中のテンプレートだけ**。非公開に送ると拒否）: 下書き列だけを書き `draftUpdatedAt` を更新する。公開版の列・`isPublished`・`updatedAt`・`publishedAt` は変えない。成功は `{ success: true, action: "draft" }`（編集を続けるので遷移しない）。
    - `publish`: 送信された値を公開版へ書き、`isPublished`（フォームの公開スイッチ `isPublished=true|false`）と `updatedAt` を更新し、初回の公開なら `publishedAt` を入れ、下書き列をすべて null にする。未公開のままの「保存」もこの経路。成功は `{ success: true, action: "publish" }`（保存後は編集画面にとどまる。ガイドと同じ）。
    - `discard`: 下書き列をすべて null にする（「公開版に戻す」。確認ダイアログつき）。成功は `{ success: true, action: "discard" }`。
  - **編集画面の表示**: loader は下書きがあれば下書きの内容、なければ公開版を返し、`isPublished`・`hasDraft`・`draftUpdatedAt` も返す（フォームは `key` に `draftUpdatedAt` を含め、破棄・保存の後に中身が入れ替わる）。操作バーに「公開する」スイッチを置き、未保存の判定に含める。送信ボタンは、公開中は「下書き保存」（outline）＋主ボタン（スイッチがオンなら「更新を公開」、オフなら「非公開にする」）、未公開は主ボタン1つ（スイッチがオフなら「保存」、オンなら「公開」。`getPublishAction` / `hasDraftSave`＝ガイドと共有）。下書きがあるときは上部に `NoticeBanner` で「未公開の変更があります」と「公開版に戻す」を出す。
  - **公開側は下書き列を読まない**: 詳細 loader・「反映」action（`guides/templates/view.tsx`）と `/playground?template=` は `columns` で下書き列を除く。一覧・ガイド埋め込み・`api/guides/templates-search`・いいね・作者ページは列を明示して読むので下書き列は入らない。本人向けの下書きプレビューは無い。
  - **離脱確認**: 名前・説明・ゲーム内言語・サーチクラフト・リマップ・Loop のいずれかが、開いたときの値（保存に成功した後は、その送信内容）と違う間は未保存として扱う。キーボード配列の表示切替は数えない。未保存のままアプリ内で遷移しようとすると確認ダイアログ（「編集を続ける」「保存せず離れる」）を出し、タブを閉じる・再読み込みではブラウザの警告を出す（`useUnsavedWarning` / `UnsavedChangesDialog`）。
  - **保存後**: 編集画面（新規作成は作成後に編集画面）にとどまり、保存に成功したら未保存を解消する。公開版への保存のトーストには「一覧へ」のボタン（`/my-guides/templates`）を付ける。失敗したときは入力を残す。「公開版に戻す」の確定ボタンは destructive（取り消せない破棄）。
  - **送信ボタン**: 上端の操作バーと文書の末尾の両方に同じボタンを置く（文書が長いので、上へ戻らずに送れるように）。
  - **検証エラー**: クライアントの検証（テンプレート名・サーチクラフト0件・アイテム未選択・サーチ文字列未入力・Loop のステップ不足・Loop の未選択）はトーストに加えて画面にも出す。テンプレート名は欄に `aria-invalid` と欄の下の文（`aria-describedby`）。サーチクラフト・Loop の誤りはワークベンチの中の個々の欄までは指せないので、ワークベンチの直前に文を出す。最初の誤り（文書順でテンプレート名が先）へフォーカスを移す。直すと消える
  - **見出しの段**: ページの h1 の下の欄名（基本情報・ワークベンチの3つの欄）は h2（ワークベンチは `sectionHeadingLevel="h2"`）。
- 管理ページの削除の確定ボタンはガイドの削除と同じ destructive。見出しの行の組み方・新規ボタンの高さ（モバイル 44px・sm 以上 36px）はガイド管理と同じ。
- `/me/search-craft` の「テンプレートを作成」ボタンから `/my-guides/templates` へ遷移できる。

### 公開ページ

- **一覧 `/guides/templates`**（`app/routes/guides/templates/index.tsx`）: `isPublished = true` **かつ著者が公開プロフィール（`profileVisibility = "public"`）** のテンプレートを最大100件、ガイド一覧のリスト表示（`GuideListView`）と同様の `divide-y` コンパクト行形式で表示。ゲーム内言語は最重要メタ情報としてタイトル行の右側に大きめに表示する。認証不要。公開ガイド一覧（`/guides`）と `GuidesContentTabs` のタブで行き来する（ヘッダーナビ「ガイド」から到達）。
  - **並び替え**: `?sort=` で「新着順（既定、**初めて公開した日時** `publishedAt` の降順。防御として `coalesce(published_at, created_at)`）」と「いいね数順（総いいね数降順）」を切り替えられる（`ContentSortSelect`、`TEMPLATE_SORTS = ["new", "likes"]`）。`.limit(100)` より前に SQL の `ORDER BY` で並べる（メモリ上で並べ替えると「新しい100件をいいね数順に並べた」結果になるため）。同数時は公開日時 → `id` でタイブレークする。行の相対時刻も公開日時。詳細ページの「更新日時」は公開版の `updatedAt`。旧ラベル「人気順」（`?sort=popular`）は v1.13.0 で「いいね数順」（`likes`）に改名し、旧クエリ値は既定の新着順へフォールバックする（詳細は [`docs/likes.md`](./likes.md#並び替え)）
  - **いいね**: 各行にいいね数を表示し、ログイン中は行内のグッドボタンで直接いいねできる（自分のテンプレートは件数のみ）。詳細は `docs/likes.md`
  - **検索バー**: テンプレート名（`?q=`、部分一致・大文字小文字無視、メモリ上でフィルタ）とゲーム内言語（`?lang=`、SQLで完全一致）で絞り込める。並び順は hidden input で持ち越す。ガイド一覧と同じ `Form method="get"` 方式で、**検索ボタン押下時にページが更新される**。言語はComboboxで選択（`__all` = 絞り込みなし、hidden input でGET送信）。言語の選択肢は公開一覧にテンプレートがある言語だけを件数つきで出す。作成者（`?author=<slug>`）でも絞り込める（著者別のガイド一覧からの導線）。絞り込み結果が0件の場合は解除リンク付きの専用メッセージを表示（検索語があれば見出しに引用する）。詳細は [`docs/guides.md`](./guides.md) の「/guides — ガイド一覧」。
- **詳細 `/guides/templates/:templateId`**（`app/routes/guides/templates/view.tsx`）: テンプレートの内容（リマップ・サーチクラフト一覧）を表示。ゲーム内言語はバッジではなくヘッダー部に大きく表示する（サーチ文字列の前提となる最重要情報のため）。
  - リマップ設定の欄: md 未満では、リマップを「元のキー → 先」の一覧（`/keybindings/visual` の `AssignmentAccordion` と同じ表記）で常に出し、キーボード（約 1120px）は「キーボードを表示」で開く補助にする。md 以上はキーボードを常に出す。リマップ0件のテンプレートでは、サーチクラフト欄の凡例に「リマップ済み」を出さない（`KeyBadgeLegend` の `showRemapped`）
  - 実入力キーはテンプレートに含まれるリマップを前提に `getActualKeyInfos()` で導出して表示する。withShift のエントリは `{ shiftHeld: true }` で導出し「⇧ Shift」バッジ付きで表示する（詳細は docs/items-searchcraft.md の「Shiftを押しながらクラフト」参照）。
  - 非公開テンプレートは作成者本人のみ閲覧可能（他者には404）。**著者のプロフィールが非公開（private）の場合も本人以外は404**（限定公開 unlisted はURL指定なら閲覧可）。
  - アクション行に**いいねボタン**を置く（`ShareButton` の直後）。自分のテンプレートでは押せず件数のみ表示する。
  - アクション行のモバイル（sm 未満）: 主操作の「自分の設定に反映」（未ログインは「ログインして反映」）だけを全幅で1段目に置き、Playground・シェア・いいね・管理は 44px のアイコンだけのボタン（名前は `sr-only`。いいねは件数を残す）で2段目の1行に収める。sm 以上は従来どおり文字つきで1行。作成者名のリンクは押せる高さを負のマージン＋padding で広げる（モバイル 44px、sm 以上 24px）
  - サーチクラフトのグループの開閉ボタンの名前は「グループ名、n件」に固定する（`aria-label`。中身から名前を組むと、見えている数字と sr-only の件数が環境によって両方読まれるため）
  - OGP: `/og-image?title=...` を使用。`ShareButton` で共有可能。

## テンプレートの適用（自分の設定への反映）

`/guides/templates/:templateId` の「自分の設定に反映」ボタン（要ログイン。未ログイン時はログインページへの導線）。

ダイアログで**反映先を選択**する:

- **新しいプリセットとして保存（今の設定は変わりません）**（デフォルト。確定ボタンは「保存する」。既存プリセットへの反映は「反映する」。プリセット名の初期値はテンプレート名）
  - **元となるプリセット**（任意）を選ぶと、そのプリセットの全設定データ（キーバインド・デバイス設定・アイテム配置等）をコピーした上でサーチクラフト（＋リマップ）を上書きする
  - 新規プリセットは**常に非アクティブ**で作成される（ライブ設定は変更されない）。使用するには編集中にする。反映に成功した直後の成功帯に「このプリセットを編集中にする」ボタンが出て、`/me/presets` の action（`intent=apply-preset`）へ `useFetcher` で直接 POST する（成功するとトーストと帯の文言が更新される。action が返す `presetId` を使う。編集中でない既存プリセットへ反映したときも同じ。編集中のプリセットへ反映したときは現在の設定がすでに変わっているので出さず、「自分のサーチクラフト設定を確認する」へのリンクを出す）
- **既存のプリセットに反映**（反映先プリセットを選択）
  - 反映先が**アクティブプリセット**の場合: 「アクティブプリセット = ライブテーブル」の不変条件を保つため、ライブテーブルを全置換して `syncActivePresetSnapshot()` で同期する（警告表示あり）
  - 非アクティブの場合: プリセットのJSON列（`searchCraftsData` / `remapsData` / `searchCraftLoopsData`）のみ更新
- リマップを含むテンプレートは「リマップも反映する」チェックボックスで選択（外すと反映先のリマップは変更されない）
- **ゲーム言語の不一致警告**: テンプレートの `gameLanguage`（未設定は `ja_jp` 扱い）と反映先のゲーム言語が違うとき、**反映先のラジオ（見出し「反映先」で `aria-labelledby`）の直下**に `NoticeBanner tone="warning"` を出す（反映は止めない）。反映先の言語は実際に効く値で比べる: 既存プリセットへ反映するときは、編集中（アクティブ）ならライブの `playerConfigs.gameLanguage`（反映はライブテーブルを置換する）、それ以外は `playerConfigData` のスナップショット。新規プリセットの元にするときは、元プリセットのスナップショット（`createPresetWithCrafts` がコピーするのは元の `playerConfigData` で、古いとライブとずれうる）。**元プリセット「なし」のとき**（既定の経路）は、新規プリセットが `playerConfig` を持たない（`createPresetWithCrafts` が `playerConfigData: null`）ので、閲覧者の編集中プリセットのライブの言語と比べ、文言も「反映先」ではなく「いま編集中のプリセットのゲーム言語は〜」（`templates.applyLanguageMismatchCurrent`）にする。比べる言語が無い（反映先の言語が未設定。既存プリセットは選んだ後）ときは、`tone="info"` で「保存先のゲーム言語は未設定です。このテンプレートは「◯◯」のアイテム名で打つ前提です」と中立に知らせる。loader の `myPresets[].liveGameLanguage`（編集中のみ）と `snapshotGameLanguage` が持つ（ブラウザの表示言語 `viewerItemLang` とは別物）。ダイアログの操作部品はモバイル 44px（ラジオは行全体が `label`、フッターのボタンは `min-h-11 sm:min-h-9`）。既存プリセットが 0 件のときは「既存のプリセットに反映」を無効にし、「プリセットがまだありません」を添える
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
- 「クリア」「自分の設定を読み込む」「テンプレートを再読み込み」で編集中の内容を置き換えるとき、置き換え前のリマップ・サーチクラフト・Loop・読み込み元の表示のどれかが空でなければ、「元に戻す」つきのトーストを10秒出す（キーボード配列は戻さない）。未編集のテンプレートでの「テンプレートを再読み込み」は何もしない。テンプレートを未編集で表示中に置き換える（クリア・自分の設定を読み込む）と、その時点で初めて下書きが上書きされるので、置き換え前に localStorage にあった下書き（文字列のまま）と「下書きを開く」の案内の状態をメモリ上に退避し、「元に戻す」で下書きと案内も元に戻す（新しいキーは足さない）。このとき置き換え前の表示が空でも、下書きが残っていれば「元に戻す」つきのトーストを出す。

### ブラウザへの仮保存（localStorage）

- リマップ・サーチクラフト・**繋ぎ方（Loop）**・キーボードレイアウトの編集内容は `window.localStorage`（キー: `minefolio.playground.draft.v1`）へ変更のたびに自動保存される。サーバーには送信されない。
- ページ再訪問時、`?template=` 指定がなければこの下書きを最優先で復元する（SSRとの表示差異を避けるためマウント後の `useEffect` で復元する）。
- **`?template=` でテンプレートを開いたときは、利用者が編集する（リマップ・サーチクラフト・Loop・配列のどれかを変える）まで下書きを上書きしない**。編集した時点から従来どおり自動保存する。テンプレートを未編集で表示している間に、空でない下書きが別に保存されているときだけ「下書きを開く」の案内を出す。未編集で表示している間は「編集内容はブラウザに自動的に保存されます」の注記を出さない（自動保存していないため）。押すと下書きに切り替わり、URL からテンプレートの指定が外れる。localStorage のキーは増えていない。
- エントリ（サーチクラフト）の削除は、確認ダイアログを出さず「元に戻す」つきのトースト（10秒）にする（編集が即時に下書きへ反映され、保存バーが無いため。「クリア」と同じ作法）。`SearchCraftWorkbench` / `SearchCraftTimingBoard` の `deleteWithUndo` で選ぶ（Playground だけ true）。削除後のフォーカスは同じ区間の次のエントリ、無ければその区間の「アイテム追加」へ移す。`/me/search-craft` とテンプレートエディタは従来どおり確認ダイアログ（「保存するまで確定されません」が正しい）。ログイン中は、上部の注記を「この端末のブラウザに自動保存。アカウントに残すときは「保存」」にし、「保存」の直下に「サーバーには保存されません」と出さない。
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

3つの欄は箱（Card）ではなく `PageSection`（欄区切り）で描く。サーチクラフトが0件のときは区間ブロックを描かず、`SearchCraftTimingBoard` の `emptyState="compact"` で「アイテムを追加」の EmptyState（compact）1つだけを出す（アイテムを追加すると区間ブロックが出る）。`craftFirst` を渡すと欄の順を サーチクラフト → キーボード → リマップ にする（テンプレートエディタ。Playground は既定の順）。

編集セクションは共有コンポーネント **`SearchCraftWorkbench`**（`app/components/search-craft-workbench.tsx`）に集約されており、**Playground とテンプレートエディタ（作成・編集）で同一構成**を共有する。crafts / remaps / loops / layout の状態は親が持ち、ワークベンチは制御コンポーネントとして動作する（`WorkbenchRemap` 型・`effectiveRemapsFrom()`・`normalizeLayout()` / `LAYOUT_OPTIONS` もここから export）。

1. **バーチャルキーボード＋マウス**: `VirtualKeyboard`（`showRemaps`）でリマップ割り当てを表示。US / JIS / US_TKL / JIS_TKL のレイアウト切替付き。下段に `VirtualMouse`（`showRemaps`。`keybindings` / `fingerAssignments` / `customButtons` は Playground・テンプレートエディタに対応データが無いため渡さない）を並べ、Mouse0〜Mouse4 のリマップも同じ導線で扱える。**キー/ボタンをクリックするとリマップ登録モーダルが開く**（`/me/keybindings` のキー編集ダイアログと同じ `DialogRemapRow` を使用。修飾キー組み合わせのトグル・出力タイプ選択に対応し、クリックしたキー/ボタンを起点とする既存リマップが一覧表示され、「追加」で新しい組み合わせを登録できる）。欄の説明の下に**タイピングテストを開くボタン**とレイアウト選択がある。
2. **キーリマップ編集**: `/me/keybindings` のリマップタブと**同一のUI・UX**。共通コンポーネント `RemapRow`（`app/components/remap-row.tsx`、`useRemapOutputType` フック含む）を共用する。リマップ元は修飾キー組み合わせ対応の `KeyCaptureButton`（`app/components/key-capture-button.tsx`）、変更先はキー / 文字 / 無効の3タイプ。キーラベルは選択中のキーボードレイアウトに追従する。
3. **サーチクラフト＋繋ぎ方（Loop）編集**: `SearchCraftTimingBoard`（`app/components/search-craft-editor.tsx`）によるタイミングブロック型エディタ。「指定なし」+ 6種のタイミング、計7ブロックを常時表示し、各ブロック内でアイテムごとの登録・編集（アイテム選択ダイアログ・コメント・並べ替え・削除）と、その下の「繋ぎ方（Loop）」サブセクション（`LoopEditorRow`、`app/components/search-craft-loop-editor.tsx` から再利用）でのステップ追加・並べ替え・削除を行う。timing の変更はブロック間D&D。サーチ文字列を編集すると、現在のリマップ設定で実際に押すキーが `getActualKeyInfos()`（逆方向変換）でリアルタイムにプレビュー表示される。サーチクラフト行の削除に連動して、削除された `craftId` を参照する Loop ステップを自動除去する（生存参照は温存、2件未満になった Loop は自動除去。詳細は [`docs/items-searchcraft.md`](items-searchcraft.md) の「編集UI（タイミングブロック型）」「繋ぎ方（Loop）」参照）。

このほか、**タイピングテスト**（フォーカスしてキーを押すとリマップ適用後の出力文字と押したキーの履歴を表示。`simulateRemapOutput()` の順方向シミュレーションを使用）は、バーチャルキーボード欄のボタンから開く**モーダル**として表示される。

#### タイピングテストの編集モデル

テキストは「バッファ＋カーソル位置＋選択範囲」で管理する（追記型ではない）。編集ロジックは
`app/lib/typing-test-buffer.ts` の純粋関数に切り出されている（`TypingTestArea` の React 状態
から分離。ユニットテスト対象）。

- `applyTypingTestAction(state, action)`: バッファへの操作適用（reducer）。`insert` / `backspace` /
  `arrowLeft` / `home` / `selectAll` / `clear` の6種
- `classifyTypingTestKey(result, shiftHeld)`: `simulateRemapOutput()` の結果（`outputKeyCode` /
  `output`）を上記アクションへ分類する。`outputKeyCode` は物理修飾キーの有無に関わらず正規化済み
  キーコードを返すため（例: 物理 `Shift+Home` でも `outputKeyCode: "Home"`）、Home と
  Shift+Home（全選択）の区別はこの関数だけでは付かない。呼び出し側がキー入力の瞬間の
  `e.shiftKey` を `shiftHeld` として渡すことで判定する

対応する操作（Minecraft のサーチ欄の挙動）:

| 操作 | 挙動 |
|---|---|
| 文字入力 | カーソル位置に挿入してカーソルを進める。選択中は選択範囲を削除してから挿入（上書き） |
| Backspace | カーソル直前の1文字を削除。選択中は選択範囲を削除 |
| ArrowLeft | カーソルを1つ左へ（0未満にはならない）。選択中は選択解除してカーソルを左端（0）へ |
| Home | カーソルを先頭へ。選択中は選択解除してカーソルを先頭へ |
| Shift+Home（`selectAll`） | 先頭（0）から現在のカーソル位置までを選択する（カーソルが末尾なら全選択になる）。物理 `Shift+Home` に加え、リマップで Home に解決されるキー・Shift を押しながらリマップで Home に解決されるキー（⇧Home 相当）のいずれでも発動する |
| ArrowRight / End / Delete | 非対応（アプリの遷移モデルに存在しない）。押下は履歴チップにのみ残る |

出力テキスト表示は選択中のみハイライト背景（`bg-primary/20`）、非選択中は点滅カーソル
（`animate-caret-blink`）を描画する。押されたキーの履歴チップ（時系列ログ）はテキストバッファと
独立しており、Backspace・Home・← などの操作キーも含めてすべて追記のみで保持する（Backspace で
過去のチップを取り消すことはしない）。

さらに、現在のバッファ文字列が登録済みサーチクラフトのいずれかのバリエーション `str` と大文字
小文字を無視した完全一致をする場合、そのクラフトのアイテム（`ItemIcon` + `formatItemName()`）を
出力テキストの下に表示する（複数一致時はすべて表示。空文字列は一致扱いにしない）。

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
| `SearchCraftGroupedList` | サーチクラフト一覧の正典表示。タイミング別グループカード（色ドット + 件数）+ 3カラム表形式（アイテム / サーチ文字列 / 入力キー、lg未満は縦積み）。シーケンス番号・サーチ文字列のクリックコピー・コメント表示付き。`fingerAssignments` は任意（プロフィールのみ渡す）。任意 prop `renderGroupExtra?: (timing: string \| null) => ReactNode` で各グループカードの行リスト後に追加コンテンツを描画できる（タイミングなしの1枚カードでも `renderGroupExtra(null)` を呼ぶ）。任意 prop `extraTimings?: (string \| null)[]` は crafts に存在しない timing でも空のグループカードを出すための補助（該当カードは行リストを省略し `renderGroupExtra` の内容だけを描画）。`search-craft-loop-view.tsx` を直接 import しない疎結合設計（render prop 方式。循環 import 回避） |
| `KeyBadge` / `ActualKeyBadges` | 実入力キーのバッジ（指割り当て色・リマップring・Shift琥珀・ツールチップ）。`ActualKeyBadges` はサーチ文字列から `getActualKeyInfos()` で導出。基底キーが有効なリマップの変更元で、押してもその文字が出ない場合（別の文字・キーへ変わる／無効化。素のキーが生きている修飾キー付きだけのリマップは対象外）は `ActualKeyInfo.unavailable` が付き、バッジは destructive の「入力できない」表示（取り消し線）になり、ツールチップ・読み上げは「Q は P にリマップされているため、q を入力できません」を出す |
| `KeyBadgeLegend` | キーバッジ装飾の凡例（`showFingers` で指割り当て凡例を表示、`showCraftMarker` で Loop の制御キー（BS/←/Home/⇧Home、infoトーン）バッジとクラフト実行マーカーの凡例を表示） |

テンプレート詳細のリマップ表示はチップ一覧ではなく **`VirtualKeyboard`（`showRemaps`）** で行い、閲覧者がレイアウト（US / JIS / US_TKL / JIS_TKL）を切り替えられる。

繋ぎ方（Loop）はプロフィールと同じく、独立セクションを持たずタイミング別グループカード内のサブセクションとして表示する（`app/components/search-craft-loop-view.tsx` の `SearchCraftLoopGroupSection`）。テンプレート詳細では `parseTemplateLoops(template.loopsData, crafts.length)` で `craftIndex` を `craft-${idx}` 形式の合成 id へ解決し、`timing` ごとにグループ化した上で `SearchCraftGroupedList` の `renderGroupExtra(timing)` から該当グループの `SearchCraftLoopGroupSection` を返す。`extraTimings` には Loop が持つ timing の distinct 値を渡し、その timing のクラフトが0件でも Loop 用のグループカードが漏れないようにする。サーチクラフトのセクション見出し行に Loop 件数バッジ（`templates.loopCount`、0件なら非表示）を移設し、`KeyBadgeLegend` の `showCraftMarker` は Loop が1件以上ある場合のみ有効にする。詳細は [`docs/items-searchcraft.md`](items-searchcraft.md) の「繋ぎ方（Loop）」を参照。

## 関連ファイル

| ファイル | 役割 |
|---|---|
| `app/lib/schema.ts` | `searchCraftTemplates`（`loopsData` 列含む）テーブル定義 |
| `app/lib/search-craft-templates.ts` | パース・シリアライズ・制限値ユーティリティ（`TemplateLoop` 関連含む） |
| `app/lib/search-craft-loops.ts` | 繋ぎ方（Loop）の共有ロジック（遷移導出・参照解決・idリマップ。詳細は [`docs/items-searchcraft.md`](items-searchcraft.md)） |
| `app/lib/search-craft-apply.server.ts` | テンプレート適用・Playground保存の共通サーバーヘルパー（crafts/loops/remaps のライブ置換・プリセット反映） |
| `app/lib/remap-utils.ts` | `simulateRemapOutput()`、`getActualKeyInfos()`、`sanitizeRemapTargetKey()` |
| `app/routes/my-guides/templates.tsx` | テンプレート管理（一覧・削除。公開は編集画面） |
| `app/routes/my-guides/template-new.tsx` / `template-edit.tsx` | テンプレート作成・編集ページ |
| `app/components/template-editor.tsx` | テンプレートエディタフォーム（作成・編集で共通） |
| `app/components/search-craft-workbench.tsx` | 編集ワークベンチ（Playground とテンプレートエディタで共通の3セクション構成。3セクション目がタイミングブロック型のサーチクラフト＋Loop編集） |
| `app/components/search-craft-editor.tsx` | サーチクラフト＋繋ぎ方（Loop）のタイミングブロック型編集UI（`SearchCraftTimingBoard`。`/me/search-craft` とワークベンチで共通） |
| `app/components/search-craft-loop-editor.tsx` | 繋ぎ方（Loop）行編集UI（`LoopEditorRow`。`SearchCraftTimingBoard` から再利用される） |
| `app/components/search-craft-loop-view.tsx` | 繋ぎ方（Loop）表示UI（`SearchCraftLoopRow` / `SearchCraftLoopGroupSection` 等） |
| `app/lib/game-languages.ts` | ゲーム内言語リスト（日本語名併記、例: `Svenska（スウェーデン語）`） |
| `app/components/content-tabs.tsx` | タブナビゲーション（汎用 `ContentTabs` + `MyContentTabs` / `GuidesContentTabs`） |
| `app/routes/guides/templates/index.tsx` | 公開テンプレート一覧 |
| `app/routes/guides/templates/view.tsx` | テンプレート詳細・適用action |
| `app/routes/playground.tsx` | Playground |
| `app/components/search-craft-template-view.tsx` | 共有表示コンポーネント |
| `app/components/remap-row.tsx` | リマップ編集行 + `useRemapOutputType`（me/keybindings と共通） |
| `app/components/key-capture-button.tsx` | キーキャプチャボタン（me/keybindings と共通） |
