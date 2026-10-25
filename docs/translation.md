# 利用者コンテンツの自動翻訳 仕様書

## 概要

ガイド本文とプロフィール文（bio）を、閲覧ロケールに応じて**自動翻訳して表示する**機構。

UI 文言の多言語化（`docs/i18n.md`）とは別系統。あちらは開発者が書いた固定文言をカタログで持つ仕組みで、
こちらは**利用者が書いた可変のコンテンツ**を機械翻訳して保存・配信する。`docs/i18n.md` の
「利用者が書いた内容は翻訳しない」という原則に対する、明示的な例外となる。

> **状態: Phase 1・2 実装済み。** 基盤（スキーマ・中核ライブラリ・初期設定画面の呼び出し）、
> Phase 1 の画面側（プロフィール表示・`/me/edit`）、Phase 2 の画面側（ガイド閲覧・一覧・編集の設定と公開フック）と
> Cron ルート（`/api/cron/translations`）は実装済み。Phase 3 は未着手。
> 方針は「エンジンは Claude API」「公開ガイドと bio は既定オン＋著者オプトアウト」で決定済み。

---

## 対象

| 対象 | 列 | 形式 | Phase |
|---|---|---|---|
| プロフィール | `users.bio` | Markdown（500字以内） | 1 |
| プロフィール | `users.shortBio` | プレーンテキスト（50字以内） | 1 |
| ガイド | `guides.title` | プレーンテキスト | 2 |
| ガイド | `guides.summary` | プレーンテキスト | 2 |
| ガイド | `guides.content` | HTML（TipTap の `getHTML()`） | 2 |
| テンプレート | `searchCraftTemplates.title` / `description` | プレーンテキスト | 3 |

**翻訳しないもの**: 表示名（`displayName` は利用者自身が `displayNameAlphabet` を登録する。
`docs/profiles.md` 参照）、MCID、タグ、URL、カテゴリ名。

**ドラフト（`draftTitle` / `draftContent` 等）は翻訳しない。** ガイドエディタのオートセーブは
2秒 debounce で走るため、下書きを対象にすると API を叩き潰す。翻訳は**公開時のみ**。

---

## 中核: HTML をモデルに直接渡さない

ガイド本文は HTML 文字列で保存されている。これを丸ごと「翻訳して」と渡す方式は採らない。

理由は、壊れ方が**検出できない**こと。`sanitizeGuideHtml()` は XSS を防ぐが、
`div[data-keybind-embed]` の `data-user-slug` が書き換わった／`<pre>` 内のコマンドが訳された／
`data-columns` が落ちた、といった破損はサニタイズを素通りする。

代わりに**テキストノードだけを抽出して配列で往復**させる。

```
HTML
  → パース（サーバー側 HTML パーサ）
  → テキストノードを配列で取り出す（除外ルールは下記）
  → 翻訳（配列 in / 配列 out。要素数の一致を強制し、不一致なら失敗扱い）
  → 元のノードへ書き戻す
  → sanitizeGuideHtml()
```

モデルはマークアップに一切触れないため、タグ・属性・埋め込みは**定義上壊れない**。

### 抽出から除外するもの

- `<code>` / `<pre>` の中身（コマンド・座標・seed・キーコード）
- `<kbd>` の中身（キー名）
- 埋め込み `div`（`data-keybind-embed` / `data-searchcraft-embed` / `data-guide-link`）
  — atom なのでテキストノードを持たないが、明示的にスキップする
- すべての属性値（`href` / `src` / `data-*`）
- ただし `img[alt]` は**翻訳する**（読み上げ用途のため）

### bio（Markdown）

`users.bio` は Markdown で、表示は `react-markdown` + `rehype-sanitize`。
500字以内と短いため、テキストノード抽出はせず**Markdown 全体を渡し、記法を保持させる**。
コードフェンスの中身を訳さないことをプロンプトで指示する。

`shortBio` はプレーンテキストなのでそのまま渡す。

---

## 用語集

MCSR 記事の機械翻訳は固有の用語で崩れる（ブラインド / バスティオン / ピース / 分岐 / EE / RSG / Any% …）。
`app/lib/translation-glossary.ts` に ja↔en の対訳を置き、プロンプトへ載せる。

- 用語集はコードとしてレビュー・バージョン管理する
- **用語集のバージョンを翻訳キャッシュのキーに含める**。用語を直したら再翻訳が走る

---

## 保存先

汎用テーブル1枚で、ガイド・bio・将来のテンプレートをすべて載せる。

```ts
content_translations
  id
  targetType   // "guide" | "userBio" | 将来 "template"
  targetId
  locale
  sourceHash        // 原文のハッシュ。失効判定の唯一の根拠
  glossaryVersion   // 用語集のバージョン。上げると全件が失効する
  title, summary, content
  status            // "pending" | "ready" | "failed"
  engine, model
  error
  createdAt, updatedAt

  unique(targetType, targetId, locale)
```

### 読み取り規則

```
sourceHash === 現在の原文のハッシュ
  && glossaryVersion === 現在の用語集バージョン
  && status === "ready"
```

**このすべてを満たすときだけ翻訳を使う。それ以外は必ず原文へフォールバックする。**
「編集したのに古い翻訳が出る」が構造的に起きない設計にすること。

---

## 翻訳を走らせるタイミング

1. **公開時** — action がレスポンスを返したあと `waitUntil()` で翻訳する
   （`@vercel/functions` が必要。`void translate()` は serverless ではレスポンス後に打ち切られる）
2. **Cron** — `pending` / `failed` / ハッシュ不一致の行を定期的に掃除する保険。
   `vercel.json` の crons に追加し、`CRON_SECRET` で保護する（既存の cron ルートと同じ構成）

失敗しても表示は原文のままなので、**翻訳の失敗がページを壊すことはない**。

---

## 表示（UX）

自動翻訳を著者の言葉として黙って出さないことが必須条件。

- 記事上部にバナー: 「この記事は自動翻訳です · 原文（日本語）を表示」
- 原文への切替を必ず用意する
- 翻訳が無い／失敗している場合は黙って原文を出す（英語UIに日本語本文が出る状態を許容する）
- 一覧カードのタイトル・要約も、翻訳があればそちらを使う

### 著者の制御

- **ガイドと bio の両方**に「自動翻訳を許可する」オプトアウトがある（**既定オン**）。
  列は `guides.allow_auto_translation`（ガイドごと）と `users.allow_auto_translation`（bio / shortBio）
- オフにすると既存の翻訳行も削除し（`removeGuideTranslations` / `removeUserBioTranslations`）、以後翻訳しない
- ガイドはガイド設定、bio は `/me/edit` に置く。`/onboarding` には置かない（既定オンのまま）
- 訳文の手動上書きは Phase 3

---

## エンジン

**Claude API**（`@anthropic-ai/sdk` + `ANTHROPIC_API_KEY`）。

- 用語集をプロンプトに載せられる
- 「配列の要素数を変えずに訳す」という構造上の制約を守らせやすい
- MCSR という文脈を与えられる
- 応答は構造化出力（`output_config.format`、`messages.parse`）で「文字列配列」の形を API 側で保証し、
  コード側は要素数の一致だけを検証する（出力形式をプロンプトで命じたり、文字列から JSON を拾ったりしない）
- Cron の一括処理は Batch API でコストを半減できる

モデルは Haiku 系を既定とし、長文のみ上位モデルへ切り替える。
`ANTHROPIC_API_KEY` が未設定なら**機能ごと無効**（常に原文）。ローカル開発で必須にしない。

### コスト感

3,000字のガイド1本でおよそ1円未満。1,000本あっても運用コストは論点にならない。
判断軸はコストではなく**訳文の品質と UX**。

---

## 既知のリスク

- **技術記事の機械翻訳は意味が反転しうる**。「〜しないでください」「〜の場合のみ」は事故りやすく、
  読者は誤りに気づけない。バナー・原文切替・著者オプトアウトは飾りではなく**この機構の必須条件**
- 原文を編集するたび再翻訳が走る。オートセーブを対象から外すこと（上記）
- ストレージはロケール分だけ増える。2ロケールならガイド本文が約2倍

---

## SEO（対象外）

現状ロケールは Cookie で決まるため、クローラーには常に日本語が返る。翻訳を入れても変わらない。

英語圏からの検索流入を狙うなら `/en/guides/...` のようなパス分離と `hreflang` が要るが、
これはルーティング全体に及ぶため**別プロジェクトとして切り離す**。

---

## 段階

| Phase | 内容 | 状態 |
|---|---|---|
| 0 | 用語集・`content_translations` テーブル・翻訳関数（配列 in/out）・機能フラグ。UI なし | **実装済み** |
| 1 | **bio / shortBio**。短く HTML も無いので試金石に最適 | **実装済み**（`/player/:slug` の表示・切替、`/me/edit` の許可スイッチ。[`docs/profiles.md`](./profiles.md)。一覧カードの `shortBio` は未対応） |
| 2 | ガイド（テキストノード抽出・公開フック・Cron・バナー・著者オプトアウト） | **実装済み**（`/guides/:authorSlug/:guideSlug` のバナー・`?original=1` 切替、一覧のマーカー、編集の許可スイッチと公開フック。[`docs/guides.md`](./guides.md)。Cron は `/api/cron/translations`） |
| 3 | 訳文の手動上書き、テンプレート | 未着手 |

### Phase 0 で入ったもの

| ファイル | 役割 |
|---|---|
| `app/lib/translation-glossary.ts` | ja↔en の対訳と `GLOSSARY_VERSION`。**変更したらバージョンを上げる** |
| `app/lib/translate.server.ts` | `translateTexts()`（配列 in/out）・`sourceHash()`・`isTranslationEnabled()` |
| `app/lib/schema.ts` | `contentTranslations` テーブル |
| `scripts/add-content-translations-table.ts` | テーブル追加の一回限りスクリプト（dry-run 既定 / `--apply` / `--remote`） |
| `app/lib/__tests__/translate.server.test.ts` | 契約（要素数一致・壊れた応答の拒否・フォールバック）の回帰テスト |
| `app/lib/content-cleanup.server.ts` | 対象削除時の `content_translations` 削除（`deleteTranslationsForGuide` / `deleteTranslationsForUser`）。schema.ts のコメントにある「対象の削除時は明示的に消す」契約の実装。Phase 0 時点では書き込み経路が無く実データには当たらないが、Phase 1/2 で bio・ガイド翻訳の書き込みが入った後はこの削除経路が前提になる |

`translateTexts()` の契約:

- 入力と**同じ長さ・同じ順序**の配列を返す。長さが違う応答は使わずに `null`
- 空文字・空白のみの要素は API へ送らず素通しする（トークン節約と、モデルが空要素を落とす事故の回避）
- 失敗（API エラー / 形が合わない応答 / 長さ不一致 / キー未設定 / 上限超過）は例外ではなく **`null`**。
  呼び出し側は必ず原文へフォールバックする
- `MAX_INPUT_CHARS`（20,000字）を超える入力は `null`。分割は呼び出し側の責務（Phase 2）
- モデルは `LONG_INPUT_CHARS`（4,000字）を境に Haiku ↔ 上位モデルを切り替える

---

## 原文ロケールと翻訳先

- **原文の言語は文字種で判定する**（`detectSourceLocale()`）: ひらがな・カタカナ・漢字（CJK 統合漢字）を含めば `ja`、含まなければ `en`
- **対象ごとに原文ロケールは 1 つ**。bio は `bio` + `shortBio` を連結、ガイドは `title` + `summary` + 本文テキスト（タグ・属性は除く）を連結して判定する
  （ハッシュとの整合のため、フィールドごとには判定しない）
- 翻訳先は対応ロケール（`app/lib/locale.ts`）のうち**原文ロケール以外のすべて**（`translationTargetLocales()`。現状は 1 つ）。
  同じロケールへは翻訳しない。原文ロケールが変わって翻訳先でなくなったロケールの行は、次の翻訳実行時に削除する

## 列の割り当てとハッシュ

| targetType | `title` | `summary` | `content` |
|---|---|---|---|
| `userBio` | 未使用 | 訳した `users.shortBio`（プレーン） | 訳した `users.bio`（Markdown） |
| `guide` | 訳した `guides.title` | 訳した `guides.summary` | 訳した本文 HTML（`sanitizeGuideHtml()` 済み） |

`sourceHash` は**原文フィールドそのもの**から作る: bio は `[bio, shortBio]`、ガイドは `[title, summary, content の生 HTML]`
（空は `""`）。HTML 抽出後の配列からは作らない — 一覧ページが本文をパースせずに失効判定できるようにするため。

## 実装（基盤）

| ファイル | 役割 |
|---|---|
| `app/lib/content-translation.server.ts` | 下記の読み取り・実行・スケジュール・Cron の関数 |
| `app/lib/guide-translate-html.server.ts` | 本文 HTML の純関数。`extractGuideHtmlTexts(html)` → `{ texts, apply(translated) }`、`chunkTexts()`。parse5 でパースし、`code`/`pre`/`kbd`/`samp`/`script`/`style`/`textarea`/`template` の中身と埋め込み div（`data-keybind-embed` / `data-searchcraft-embed` / `data-guide-link`）を除外、属性値は `img[alt]` のみ翻訳、空白のみのテキストノードは送らず、前後の空白は元のまま保つ。`apply` は未サニタイズの HTML を返す（呼び出し側が `sanitizeGuideHtml()` を通す） |
| `scripts/add-allow-auto-translation-columns.ts` | `users` / `guides` に `allow_auto_translation` 列を追加する一回限りスクリプト |

依存: `parse5`（純粋な HTML パース用。ESM のみだが本アプリのサーバーは ESM）。

### 読み取り（失効判定込み。使えないときは `null`＝呼び出し側が原文を使う）

条件: 機能有効 && オプトアウトでない && `sourceHash` 一致 && `glossaryVersion` 一致 && `status = ready` && 原文ロケール≠閲覧ロケール。

```ts
getUserBioTranslation(db, { id, bio, shortBio, allowAutoTranslation }, viewerLocale): Promise<TranslatedBio | null>
getUserBioTranslations(db, userIds, viewerLocale): Promise<Map<userId, TranslatedBio>>   // 一覧用。原文は関数内で引く
getGuideTranslation(db, { id, title, summary, content, isPublished, allowAutoTranslation }, viewerLocale): Promise<TranslatedGuide | null>
getGuideTranslations(db, guideIds, viewerLocale): Promise<Map<guideId, TranslatedGuideSummary>>  // 一覧用（title/summary のみ）
```

- 単体版には**ローダーが読んだ現在の原文**を渡す（ガイドは公開版。ドラフトのプレビューでは呼ばない）
- 一覧版は id だけ受け取り、訳文のある行についてだけ現在の原文を読み直して照合する（N+1 にならない・本文を読まない一覧でも使える）
- 結果の `sourceLocale` が「原文（日本語）を表示」バナーの表記に使える

### 実行・スケジュール

```ts
translateUserBio(db, userId, options?): Promise<TranslateOutcome>
translateGuide(db, guideId, options?): Promise<TranslateOutcome>
scheduleTranslation(db, { type: "userBio" | "guide", id }): void   // + scheduleUserBioTranslation / scheduleGuideTranslation
removeUserBioTranslations(db, userId) / removeGuideTranslations(db, guideId)   // オプトアウトに切り替えたとき
processPendingTranslations(db, { limit?, timeBudgetMs? }): Promise<ProcessTranslationsResult>   // Cron 用
```

- `TranslateOutcome` = `"translated" | "upToDate" | "failed" | "skipped" | "removed"`。例外は投げない
- 現在の原文・オプトアウト・機能有効を確認し、最新の訳文があれば API を呼ばない。`pending` 行を upsert →
  翻訳 → `ready`（失敗は `failed` + `error`）。翻訳中に原文が編集されたら結果を捨てる。
  原文が空（bio / shortBio とも空）またはオプトアウトなら行を削除する。**ガイドは公開済みのみ**（ドラフトは `skipped`）
- ガイド本文は `[title, summary, ...テキストノード]` を 8,000 字ごとのチャンクに分けて順に翻訳し、
  1 チャンクでも失敗したら全体を `failed` にする
- `scheduleTranslation` は action の**保存・公開が成功した後**に呼ぶ。`@vercel/functions` の `waitUntil()` で
  レスポンス後に実行する。機能無効なら何もしない。await 不要・throw しない
- 呼び出し済み: `/onboarding` の `save_profile`（bio の保存後）、`/me/edit`（保存成功後。許可オフなら `removeUserBioTranslations` を await）、`/my-guides/:guideSlug/edit` の action（保存〔publish〕の成功後、およびオフ→オンに戻した保存の後に `scheduleGuideTranslation`。許可オフなら `removeGuideTranslations` を await。仮保存＝オートセーブ相当では呼ばない）

### Cron（`processPendingTranslations`）

1 回あたり `limit` 件（既定 10、対象 1 件 = ガイド 1 本 or bio 1 人）までを**同期的**に処理する。ルートは
`/api/cron/translations`（`app/routes/api/cron/translations.ts`）で、`CRON_SECRET` で保護し（`requireCronAuth()`）、
`vercel.json` の crons に **毎時 10 分**（`10 * * * *`）で登録済み。`maxDuration` は 60 秒、`timeBudgetMs` は 48 秒
（`maxDuration` の 80%。これを超えたら新しい対象に着手しない）。対象は公開済みかつオプトアウトでないもののみで、優先順:

1. 再試行すべき行: `pending`（10 分以上経過）／`failed`（6 時間以上経過。失敗し続ける対象で API を叩き潰さない）／`ready` だが用語集バージョン不一致
2. 原文が更新された可能性のある `ready` 行（原文の `updatedAt` > 翻訳行の `updatedAt`。ハッシュ照合は翻訳関数側）
3. 翻訳行がまだ無い翻訳対象（公開ガイド・空でない bio。非公開プロフィールの bio は除く）

全件走査はせず各段階を `limit` 件で打ち切る。`timeBudgetMs` を超えたら新しい対象に着手しない。返り値は
`{ processed, translated, upToDate, failed, skipped, removed }`。

---

## 関連ファイル

| ファイル | 役割 |
|---|---|
| `docs/i18n.md` | UI 文言の多言語化（別系統） |
| `docs/profiles.md` | 表示名のアルファベット表記（利用者が自分で登録する方式） |
| `app/lib/guide-sanitize.server.ts` | 本文の表示時サニタイズ。翻訳後も必ず通す |
| `app/components/guide-editor/extensions/` | 埋め込みノードの HTML 形式（抽出の除外対象） |
| `vercel.json` | Cron 定義 |
