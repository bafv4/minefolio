# 利用者コンテンツの自動翻訳 仕様書

## 概要

ガイド本文とプロフィール文（bio）を、閲覧ロケールに応じて**自動翻訳して表示する**機構。

UI 文言の多言語化（`docs/i18n.md`）とは別系統。あちらは開発者が書いた固定文言をカタログで持つ仕組みで、
こちらは**利用者が書いた可変のコンテンツ**を機械翻訳して保存・配信する。`docs/i18n.md` の
「利用者が書いた内容は翻訳しない」という原則に対する、明示的な例外となる。

> **状態: Phase 0 実装済み（土台のみ・UI 無し）。Phase 1 以降は未実装。**
> 方針は「エンジンは Claude API」「公開ガイドは既定オン＋著者オプトアウト」で決定済み。

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

- ガイド設定に「自動翻訳を許可する」チェックボックス（**既定オン**）
- オフにすると既存の翻訳行も削除する
- 訳文の手動上書きは Phase 3

---

## エンジン

**Claude API**（`@anthropic-ai/sdk` + `ANTHROPIC_API_KEY`）。

- 用語集をプロンプトに載せられる
- 「配列の要素数を変えずに訳す」という構造上の制約を守らせやすい
- MCSR という文脈を与えられる
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
| 1 | **bio / shortBio**。短く HTML も無いので試金石に最適 | 未着手 |
| 2 | ガイド（テキストノード抽出・公開フック・Cron・バナー・著者オプトアウト） | 未着手 |
| 3 | 訳文の手動上書き、テンプレート | 未着手 |

### Phase 0 で入ったもの

| ファイル | 役割 |
|---|---|
| `app/lib/translation-glossary.ts` | ja↔en の対訳と `GLOSSARY_VERSION`。**変更したらバージョンを上げる** |
| `app/lib/translate.server.ts` | `translateTexts()`（配列 in/out）・`sourceHash()`・`isTranslationEnabled()` |
| `app/lib/schema.ts` | `contentTranslations` テーブル |
| `scripts/add-content-translations-table.ts` | テーブル追加の一回限りスクリプト（dry-run 既定 / `--apply` / `--remote`） |
| `app/lib/__tests__/translate.server.test.ts` | 契約（要素数一致・壊れた応答の拒否・フォールバック）の回帰テスト |

`translateTexts()` の契約:

- 入力と**同じ長さ・同じ順序**の配列を返す。長さが違う応答は使わずに `null`
- 空文字・空白のみの要素は API へ送らず素通しする（トークン節約と、モデルが空要素を落とす事故の回避）
- 失敗（API エラー / 壊れた JSON / 長さ不一致 / キー未設定 / 上限超過）は例外ではなく **`null`**。
  呼び出し側は必ず原文へフォールバックする
- `MAX_INPUT_CHARS`（20,000字）を超える入力は `null`。分割は呼び出し側の責務（Phase 2）
- モデルは `LONG_INPUT_CHARS`（4,000字）を境に Haiku ↔ 上位モデルを切り替える

---

## 関連ファイル

| ファイル | 役割 |
|---|---|
| `docs/i18n.md` | UI 文言の多言語化（別系統） |
| `docs/profiles.md` | 表示名のアルファベット表記（利用者が自分で登録する方式） |
| `app/lib/guide-sanitize.server.ts` | 本文の表示時サニタイズ。翻訳後も必ず通す |
| `app/components/guide-editor/extensions/` | 埋め込みノードの HTML 形式（抽出の除外対象） |
| `vercel.json` | Cron 定義 |
