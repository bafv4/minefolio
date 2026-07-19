# ガイド原稿ドラフト (guide-drafts/)

このディレクトリは、Minefolioの「ガイド」機能で公開する2本の記事のプロトタイプ原稿です。

- [`minefolio-usage-guide.md`](./minefolio-usage-guide.md) — **Minefolio利用ガイド**（サイト全体の使い方）
- [`guide-writing-guide.md`](./guide-writing-guide.md) — **ガイドのガイド**（ガイドエディタの使い方）

## この原稿の位置づけ

生のMarkdownファイルですが、**そのままガイドエディタに流し込む用途ではありません**。ガイドエディタ（TipTapベース）はMarkdownインポート機能を持たないため、公開する際は `/my-guides` で新規ガイドを作成し、この原稿を見ながら該当するブロック（見出し・箇条書き・表・コールアウト・埋め込み等）に手動で組み直してください。原稿の見出し構成はそのままガイドの目次（本文中の見出し2つ以上で自動表示）に対応するようにしてあります。

## 画像プレースホルダーについて

各所に以下の形式でスクリーンショットのプレースホルダーを置いています。

```markdown
![代替テキスト（画像の趣旨）](images/usage-04-edit-videos.png)
*撮影メモ: 実際に何を写すかの指示*
```

- `images/` ディレクトリに、プレースホルダーと同じファイル名でスクリーンショット（PNG推奨）を保存すると、Markdownプレビューでそのまま表示されます。
- 「撮影メモ」に、どの画面のどの状態を写すべきかを具体的に書いてあります。ダミーデータではなく実際に何かしら設定・記録・ガイドが登録された状態のアカウントで撮ると、記事として説得力が出ます。
- 全プレースホルダーの一覧は下表の通りです（チェックリストとして利用できます）。

## スクリーンショット一覧（チェックリスト）

### Minefolio利用ガイド

| # | ファイル名 | 対象ページ | 内容 |
|---|---|---|---|
| 1 | `usage-01-login.png` | `/login` | 「Discordでログイン」ボタンが見える状態 |
| 2 | `usage-02-onboarding-mcid.png` | `/onboarding` | MCID入力欄と「検証して続行」「MCIDなしで登録」の両方が見える状態 |
| 3 | `usage-03-onboarding-confirm.png` | `/onboarding`（MCID検証成功後） | アバタープレビューと「セットアップを完了」ボタン |
| 4 | `usage-04-edit-overview.png` | `/me/edit` | プロフィール編集ページ全体（表示名・自己紹介・スキン・ソーシャルリンクが見える範囲） |
| 5 | `usage-05-edit-videos.png` | `/me/edit` | 「動画」カード。動画を2件以上登録し、うち1件をピン留めした状態 |
| 6 | `usage-06-keybindings.png` | `/me/keybindings` | 仮想キーボードとリマップ編集領域。Trigger/Chat種別を設定したリマップ行が見える状態 |
| 7 | `usage-07-devices.png` | `/me/devices` | マウス設定（DPI・感度・cm/360等）の入力フォーム |
| 8 | `usage-08-presets.png` | `/me/presets` | プリセット一覧。複数プリセットが並び、アクティブなものにバッジが付いた状態 |
| 9 | `usage-09-browse.png` | `/browse` | ランナー一覧のカードグリッド |
| 10 | `usage-10-compare.png` | `/compare?player1=...&player2=...` | 2人のキーバインド・デバイス設定を並べた比較画面 |
| 11 | `usage-11-profile-tabs.png` | `/player/:slug` | プロフィールページのタブ一覧（プロフィール/活動・記録/キー配置/…/ガイド） |
| 12 | `usage-12-profile-remap-toggle.png` | `/player/:slug?tab=keybindings` | 仮想キーボード右上の「Trigger」「Chat」切替ボタンが見える状態 |
| 13 | `usage-13-home-pace.png` | `/`（ホーム） | 「ペース」セクション。「ライブ」の表と「過去のペース」のカード群、更新ボタンが見える状態 |
| 14 | `usage-14-developers-export.png` | `/developers/export` | セクション選択チェックボックスとダウンロードボタン |

### ガイドのガイド

| # | ファイル名 | 対象ページ | 内容 |
|---|---|---|---|
| 1 | `write-01-my-guides.png` | `/my-guides` | ガイド一覧。公開中・下書き・ピン留めの各バッジが1つ以上見える状態 |
| 2 | `write-02-new-guide.png` | `/my-guides/new` | タイトル入力欄と「作成して編集する」ボタン |
| 3 | `write-03-editor-toolbar.png` | `/my-guides/:slug/edit` | エディタ上部ツールバーの「ホーム」タブ全体 |
| 4 | `write-04-insert-tab.png` | `/my-guides/:slug/edit` | ツールバーの「挿入」タブ（キーバインド埋め込み・サーチクラフト埋め込みのボタンが見える） |
| 5 | `write-05-slash-menu.png` | `/my-guides/:slug/edit` | 本文中で `/` を入力してスラッシュコマンドメニューが開いた状態 |
| 6 | `write-06-table.png` | `/my-guides/:slug/edit` | 表を挿入し、列・行ハンドルが見える状態（ホバー時） |
| 7 | `write-07-embed-dialog.png` | `/my-guides/:slug/edit` | 「キーバインド埋め込み」ダイアログ（スラッグ/MCID欄・プリセット名欄） |
| 8 | `write-08-embed-rendered.png` | `/my-guides/:slug/edit` | 埋め込みブロックが本文中に描画された状態（仮想キーボードまたはサーチクラフト一覧） |
| 9 | `write-09-settings-dialog.png` | `/my-guides/:slug/edit` | 「ガイド設定」ダイアログ全体（タイトル・概要・カバー画像・タグ・URL・公開設定） |
| 10 | `write-10-save-buttons.png` | `/my-guides/:slug/edit` | ツールバー右上の「仮保存」「保存」ボタンと保存状態インジケーター |
| 11 | `write-11-published-view.png` | `/guides/:authorSlug/:guideSlug` | 公開後のガイド閲覧ページ（カバー画像・目次・本文の見える範囲） |

## 次のステップ

1. 上記チェックリストに沿ってスクリーンショットを撮影し `images/` に保存
2. 2本の原稿を読みながら `/my-guides` で実際のガイドを作成し、内容を移植
3. 各原稿末尾の「付録」に記載したタイトル・概要・タグ・URLの案をガイド設定に反映
4. 公開前に「プレビュー」ボタンで下書き内容を確認
