# ホーム画面・ライブ機能 仕様書

## ホーム画面 (/)

### 概要

Minefolioのトップページ。登録ユーザーのアクティビティ、ガイド、動画フィード（YouTube動画 + Twitch VOD）、PaceManペース、ライブランをまとめて表示するフィードを提供する。

### 認証・登録チェック

- `getOptionalSession()` でセッションを取得（未ログインでもアクセス可能）
- セッションがある場合、`users` テーブルから `discordId` で登録済みユーザーを検索
- ホームの SSR / `.data` 応答は閲覧者依存（ログイン状態・表示設定・並び順）なので `headers()` で `Cache-Control: private, no-store` を返す（ブラウザ・CDN の共有キャッシュに載せない）
- 登録済みの場合 `isRegistered = true` を返し、ユーザーの表示設定（`showPacemanOnHome`, `showYoutubeOnHome`, `showTwitchOnHome`）を取得

### ホームの構成（2026-11 全面改修）

**ログイン状態で先頭（ヒーロー / おかえりバー）を分け、以降は共通**。各欄は `section` + `aria-labelledby`（h2、`id` 付き。例 `home-live`）。欄の見出しは「アイコン + h2 + 件数 + 右のリンク」のみで、英大文字の eyebrow・格子背景・ヒーローの統計タイルは無い（公開プロフィール数は「プロフィール」欄の見出し、ライブ人数は「ライブ」欄の見出しに移した。「記録ペース」の件数と `countHomeRecordedPaces` は廃止）。共通の欄枠は `app/components/page-section.tsx` の `PageSection`。

- **外枠は箱なしの1種類**: 上罫線 `border-t border-foreground/15 pt-6`（`--border` より濃く、欄の切れ目を見せる）＋見出し左のアイコン（丸背景チップ無し。色は呼び出し側: ライブは `text-primary`、お気に入りのハートは `text-favorite`、動画・ガイド・プロフィールは無彩色）。大型パネルはヒーロー・おかえりバー・注目の走者（ワイド）だけ。ページ背景に直接載るライブ欄のカード（`live-rail.tsx` の `CARD_CLASS`）は不透明の `bg-card`（終了カードは枠 `/40` のまま面は同じ）。
- **見出し行は折り返さない**（`flex-nowrap`）。h2 は `text-xl` で truncate 可、モバイルはチップと隙間を詰める。右のリンク（「すべて見る」「ペース一覧」）は `SectionHeaderLink` で、sm 未満はアイコンのみ（44px 角・ラベルは sr-only）。プロフィール欄の公開プロフィール数はモバイルでは出さない。

| 順 | ゲスト | ログイン済み（登録済み） |
|---|---|---|
| 1 | ヒーロー（`GuestHero`。左: h1〈強調語の前でスキンが入れ替わる〉・説明・「プロフィールを作る」「走者を探す」、右: 「注目の走者」〈枠で包まない〉） | おかえりバー（アバター・「おかえりなさい、{name}さん」〈アカウント作成から24時間以内は「ようこそ、{name}さん」〉・「プロフィールを編集」「マイプロフィール」「お気に入り」・設定）。h1 は `sr-only`（`home.pageHeading`「Minefolio ホーム」。meta の `home.title` とは別キー） |
| 2 | お気に入り走者の動き（ブラウザにお気に入りがある場合のみ） | お気に入り走者の動き（常に出す） |
| 3 | ライブ / ペース（横レール） | ライブ / ペース（お気に入りを先頭・「お気に入り」ピル） |
| 4 | 最新動画（YouTube カード3本 + Twitch「Twitchライブ」6行） | 同左 |
| 5 | 新着ガイド（4件、著者1人1件） | 同左 |
| 6 | （ヒーロー右に出すので無し） | 注目の走者（横長版） |
| 7 | プロフィール（最近の更新 / よく見られている の2列コンパクト行、各4件） | 同左 |

#### 欄の並び順・表示の設定（ログイン済みのみ）

上表の2〜7行目（ゲストでは「注目の走者」はヒーロー内）のうち、ログイン済みの6欄（お気に入り走者の動き `favoriteActivity` / ライブ `live` / 注目の走者 `featured` / 最新動画 `videos` / 新着ガイド `guides` / プロフィール `profiles`）の並びと表示は、おかえりバーの設定ボタン（`Settings2` アイコン）のモーダル（`app/components/home/home-settings-dialog.tsx`）で変更できる。おかえりバーは先頭固定で対象外。ログイン時の「注目の走者」（`FeaturedRunnerCard`）の見出しは他の欄と同じアイコン（丸背景チップ無し）＋h2 `text-xl font-bold`（「別の走者」は見出し行の右）、ゲストのヒーロー内は小見出し。ゲストは常に既定順・全欄表示。

- **ライブの帯**（`app/components/home/live-teaser.tsx`、ゲストのみ）: ヒーロー左列（モバイルは縦積みのヒーロー内）の CTA の注記の下（注目の走者より上。ヒーローの直下だとライブ欄のすぐ手前になり1画面目に入らないため。`GuestHero` の `liveTeaser` スロット）に「● ライブ N人 →」（`home.liveTeaser`、高さ44px以上）を出し、タップで `#home-live`（ライブ欄を非表示にしているときは `/paces`）へ送る。人数はおかえりバーと同じ `liveSettled ? liveCount : 0`（新しい取得は増やさない）。0人・取得前・取得失敗は描かない（出ると以降の欄が帯の高さ分下がる）。lg 以上も同じ位置に内容幅（`lg:w-fit`）で出し、左列の下の空きを埋める。
- **ホーム設定ダイアログのフォーカス戻し**: `welcome-bar.tsx` は制御型で `DialogTrigger` を使わないので、`HomeSettingsDialog` の `returnFocusRef`（「カスタマイズ」ボタン）経由の `onCloseAutoFocus` で、キャンセル・Esc・保存のどれで閉じてもそのボタンへフォーカスを戻す。
- **おかえりバー**（`welcome-bar.tsx`）: DOM 順（＝フォーカス順）はアバター（モバイルのみ）・挨拶 → 「プロフィールを編集」（outline。塗りの主ボタンではない）→「マイプロフィール」（sm 以上のみ。モバイルは `max-sm:hidden`）→「お気に入り」→ 設定。アバターは幅で2つを描き分ける: sm 未満は `aria-label`＝「マイプロフィール」・フォーカスリング付きの正規のリンク（44px 以上、モバイルのマイプロフィールの入口）、sm 以上は同じ行き先の「マイプロフィール」ボタンがあるので、クリックだけ受けるリンク（`tabIndex=-1`・`aria-hidden`）にして Tab 停止点を1つにする。`order-*` による並べ替えは使わない。設定ボタンは sm 以上は「カスタマイズ」の文字付きで右端、モバイルは2段目（2段目＝編集・お気に入り・カスタマイズがすべて文字付き）の末尾にアイコン＋「カスタマイズ」の文字（アイコンだけでは並べ替えと分からないため）。いずれも44px。挨拶の下に、ライブ中の走者がいるときだけ丸ピル（高さ44px以上）の「● {n}人が走行中」（`home.welcomeLiveChip`）＋いちばん先の区間の区間アイコンのリンクを出す。リンク先は `#home-live`（ライブ欄を非表示にしているときは `/paces`）。`aria-live` は付けない（件数の読み上げはライブ欄の見出し側）。`aria-label` は付けず、見える文言（WCAG 2.5.3 label in name）がそのままアクセシブルネーム（ライブの帯 `live-teaser.tsx` も同様）。`#home-live` 等の見出しが sticky ヘッダー（65px）の下に来るのは、`:root` の `scroll-padding-top`（既定 4.5rem。`app/app.css`）による（`PageSection` 自身は scroll-mt を持たない）。「お気に入り走者の動き」欄はお気に入り0人（取得完了後）のときだけ見出しを `home.favFindTitle`「お気に入りにする走者を探す」に切り替え、見出し右のリンクを `/browse` にする（1人以上は `/favorites/activity`）。ライブのカードの「Twitch で見る」は sr-only で走者名を後ろに足し（`home.liveWatchOf`）、同名リンクを区別する。
- **ID・正規化**: `app/lib/home-sections.ts`（非 `.server`）。既定順は上記の並び。`normalizeHomeLayout` は JSON 文字列 / 配列 / オブジェクトを受けて `{ order, hidden }` を返す。旧形式（並びのみの配列）も読める（hidden は空）。解釈不能なら既定、未知 ID と重複を除き、order の欠けは既定順で末尾に補う（欄を増やしても既存の保存値が壊れない）。hidden が全欄を覆う値は hidden 空として扱う（全部消えたホームにしない）。`serializeHomeLayout` が保存用文字列を作り、`isDefaultHomeLayout`（既定順かつ全欄表示）なら `null`。
- **保存先**: `users.home_section_order`（nullable、JSON 文字列 `{"order":[...],"hidden":[...]}`）。既定（既定順かつ全欄表示）を保存するときは `null` にして既定へ戻す。**`users.updatedAt` は更新しない**（お気に入り走者の動きに「プロフィールを更新」と誤って出るため）。
- **loader / action**: loader が正規化済みの `layout`（`{ order, hidden }`）を返し、SSR の段階から `order` のうち `hidden` に無い欄だけをその順で描画する（読み込み後の入れ替えなし）。保存は home ルートの action（`_action=saveHomeSectionOrder`、`order` / `hidden` = JSON 配列。未ログインは 401）。全欄を非表示にする保存は 400 で拒否し、不正な JSON も 400。保存後は home の loader が再検証される（`_layout` には `shouldRevalidate` を付けない）。
- **モーダル**: 各行に表示の Switch（ラベル「{欄名}をホームに表示」。欄名もスイッチのラベルでタップ切替）、非表示の行は欄名を muted にする。表示中の最後の1つは Switch を無効化し、理由を表示する。上へ／下へのアイコンボタン（端は disabled、移動後もフォーカスが追従）で並べ替え、移動は `aria-live` で「{欄名}を{n}番目に移動しました」と読み上げる。開いた直後のフォーカスは先頭行の Switch。変更が無ければ保存ボタンは無効。「初期設定に戻す」は並び・表示とも既定へ戻す。編集中はモーダル内の state のみ（キャンセルで破棄）。保存は共有キーの `useFetcher` で送信し、保存中は `fetcher.formData` から楽観的にホームへ反映、成功でトースト＋閉じる、失敗でエラートースト。
- **欄が非表示のときの取得**: クライアントの初回取得は、動画（`youtube-videos` / `twitch-vods`）は `videos` 欄、過去のペース（`recent-paces`）は `live` 欄が表示されているときだけ行う。非表示 → 表示（設定モーダルの保存直後の楽観反映を含む）に切り替わった時点で未取得なら取り、取得済みなら再表示で取り直さない。ライブのポーリング（`live-runs` / `ranked-live` / `twitch-streams`）は `live` 欄が非表示でも続ける（おかえりバーの「N人が走行中」チップと動画欄の Twitch 一覧が使うため）。
- **loader の DB 往復**: 最近の更新・よく見られているのカードの `mainCategory` は、各クエリで `playstyles`（`userId` が一意なので行は増えない）を leftJoin して同時に取る。新着ガイドの翻訳（`getGuideTranslations`）は新着ガイドの取得直後から他の取得と並行して始める。結果、loader の DB 待ちは1段（最も遅い取得）だけ。
- 欄の表示条件（ガイド0件なら出さない等）は並び順・表示設定に依らず従来どおり（非表示にした欄はそれに加えて出ない）。

レイアウトの型は欄ごとに変える（ヒーロー＝左右分割 / ライブ＝モバイル横レール・md 以上グリッド / お気に入りの動き＝縦タイムライン / ガイド＝カバー付きグリッド / プロフィール＝コンパクト行 / 動画＝メディアグリッド + リスト行）。時刻は `m:ss`（1時間以上は `h:mm:ss`。`app/lib/home-format.ts` の `formatClock`）で、ミリ秒はペースカードのタイムラインモーダル内だけ。タップ領域はモバイルで 44px 以上。モーションはライブ進行バーの遷移（200ms）とホバーだけで、`motion-reduce` では止める。

#### サーバーサイドで取得（loader）

| データ | ソース | 条件 |
|--------|--------|------|
| 最近更新されたプロフィール | `users` テーブル | `profileVisibility = "public"`、視聴者除外、`updatedAt` 降順、最大4件 |
| よく見られているプロフィール | `page_view_stats` + `users` JOIN | `targetType = "profile"`、公開、`pageviews` 降順。「最近の更新」に出た人は除き、最大4件。右端は `home.views7d`（7日で n 閲覧） |
| 新着ガイド | `guides` + `users` JOIN | 公開済み・著者が公開プロフィール、`updatedAt` 降順。**同じ著者は1件まで**、最大4件。注目順の段は廃止（並べ替えは `/guides` 側） |
| 公開プロフィール数 | `users` COUNT | 「プロフィール」欄の見出しに表示 |
| 注目の走者（ゲストのみ） | `getHomeSpotlight`（`app/lib/home-featured.server.ts`） | 下記。10分キャッシュ（ロケール非依存） |

ガイドには自動翻訳（[`docs/translation.md`](./translation.md)）を反映する（表示する4件の id を `getGuideTranslations` に1回で渡す）。

##### 注目の走者（ゲストはヒーロー右、ログイン時は横長版）
- **実装の分担**: 回す処理（候補→ランダム取得・Alt+クリックで `/secret-grid`・aria-live・失敗トースト・`aria-busy`）は `useFeaturedRotation`、ボタンは `FeaturedNextButton`、理由行（審査中リンク含む）は `FeaturedReasonRow`、キー部分（主要9操作の `KeyChip` とホットバー行、末尾に右寄せで `/keybindings` への「みんなの操作設定を見る」リンク）は `FeaturedKeys` として `featured-runner-card.tsx` から export し、ログイン時の `FeaturedRunnerCard`（ワイド版のみ）とゲストの `GuestHero`（`guest-hero.tsx`）で共有する。
- **ゲストのヒーロー（`GuestHero`）**: 外枠は `rounded-2xl border border-border/70 bg-card p-6 sm:p-8`（影なし）、中は `lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]`・`xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]`（左列を広めに取り、ja の1行目「RTAを［スキン］パーソナリティから」を lg 以上で1行に収める。モバイルは「RTAを／［スキン］パーソナリティから／みてみよう。」の3行）。h1 はモバイル `text-2xl`・sm 以上は `text-4xl` で一定（画面幅で大きくせず上下に余白を残す。モバイルをこれより大きくすると1行目が語の途中で折れる）。右列は枠で包まず、`lg:border-l lg:pl-10` で左と区切る。縦の並びは 見出し行（h2「注目の走者」＋「別の走者」）→ 理由行 → 顔と名前の行（`size-28` の顔タイル〈アバター96px〉・名前〈`text-xl font-bold`〉・カテゴリ・PB・感度）→ キー部分（`border-t`）。**オーバーレイリンクは使わず**、リンクは顔タイルと名前だけ。候補も日替わりも無いときは `featuredEmptyTitle` / `featuredEmptyDescription` の説明だけを出し、「別の走者」は出さない（取得できる人がいないので押しても何も起きないため。走者を探す〈`/browse`〉への導線は左列の CTA が担う）。
- **見出しのスキン**（`RotatingHeadingSkins`）: h1 は `home.heroTitle`（`{emphasis}` を含む）を目印文字で前後に分け、間に［スキン］＋強調語（`home.heroTitleEmphasis`、ja「パーソナリティ」/ en "runners"）を差し込む。［スキン］＋強調語は `inline-block border-b-[3px] border-brand` で1本の下線にまとめ、直後の非空白文字（ja の「から」）までを `whitespace-nowrap` の1まとまりにして途中で改行させない（下線は「から」には引かない）。目印が見つからないときは文全体をそのまま出す。スキンは `heroFaces`（最大12人）を全員分の枠で重ね、opacity のクロスフェード（300ms）で約8秒ごとに入れ替える。**中の `MinecraftAvatar` は「表示中の人と次に出す人（除外対象を飛ばした次）」だけ描画**し（開いた直後に `/api/skin` を12本出さない）、一度描画した人は state（`loaded`）に残して以後も描画したままにする（また回ってきたときに読み込み直さずクロスフェードできる）。SSR・ハイドレーション初期は「表示中＋次」で決定的で、入れ替え・「別の走者」による除外の変化のたびに新しい人を足す（空白を出さない）。48px で描いて CSS で 1.1em の枠に合わせる。**右列に出ている注目の走者（`useFeaturedRotation` の `current`）はスキンに出さない**（`excludeSlug`。リストは絞り込まず、表示する人を「index の人、除外対象なら次の除外対象でない人」と導出するので、「別の走者」で `current` が変わってもスキンが飛ばず、タイマーも張り直さない。タイマーも除外対象を飛ばして進む）。初期表示は、除外対象を除いた先頭の人（SSR と同じ決定的な結果）。出せる人が0人なら枠ごと出さず、1人ならタイマーを張らない。`prefers-reduced-motion: reduce` と非表示タブでは入れ替えない。装飾なので `aria-hidden`。0人ならスキンの枠を出さず強調語だけに下線。公開プロフィール数の表示は無い。 loader の `heroFaces`: **ゲストのときだけ** `listedRunnerCondition` かつ `uuid` か `customSkinUrl` がある人を `updatedAt` 降順で12人（列は `slug` / `mcid` / `uuid` / `customSkinUrl` / `displayName` / `displayNameAlphabet` のみ）。ログイン時は DB に行かず空配列。
- **表示設定**: video 理由はその動画のプラットフォームの設定（`forHome` で除外）、`rankedPb` / `eloGain` は `showRankedStats`。speedrun.com 理由に表示設定は無いが、**オーナーが非表示にした記録は出さない**（`users.hiddenSpeedrunRecords` の run ID、および `category_records.isVisible = false` のカテゴリの記録。`/rankings` と同じ条件）。

- **候補**: 直近7日の出来事から1人1件（最も点数の高いもの）を採用し、点数順（同点は新しい順）に最大5人。点数は `app/lib/home-featured.ts` の `scoreFeaturedReason`: speedrun.com の新規申請 90 > Ranked の PB 更新 80 > 新しい動画 60。Ranked のレート上昇は 40 + 上昇幅/5（上昇幅300で頭打ち＝最大100）。
  - speedrun.com / Ranked PB: `player_rankings` の `recordDate`（`YYYY-MM-DD`）が期間内。`verificationStatus` が `new` でも対象（`rejected` は除く）。**ranked_pb 行は現状 `recordDate` が保存されないため、この出来事は日付が入るまで発火しない**
  - speedrun.com の理由は `{ type, timeMs, categoryName, status }`。`categoryName` は `player_rankings.category_id` → `speedrun_categories.name`（未設定は null）、`status` は `verificationStatus`（`new`＝審査中 / `verified`＝承認済み。null は verified 扱い）。文言は「speedrun.com に {category} {time} を申請（審査中）」/「speedrun.com で {category} {time} が承認」（カテゴリ無しは category を省く）。**審査中のときだけ**理由行の右端に「審査中の記録を見る」リンク（`relative z-10`、縦余白でタップ約44px、理由文は truncate・リンクは shrink-0）を出し、`/player/<slug>?tab=stats&srcPending=1`（プロフィール側で審査中の記録を表示）へ飛ばす。承認済みは記録タブに既に出るためリンク無し
  - Ranked レート上昇: `ranked_elo_snapshots`（cron `update-rankings` が日次で記録）の期間内最古と最新の差が20以上。最古のスナップショットが6日以上前でない間（導入後7日分たまるまで）は対象外
  - 新しい動画: `getPublicVideoFeed`（YouTube / Twitch のキャッシュ）の公開日時が期間内
  - Ranked 系（PB・レート上昇）は `users.show_ranked_stats = false` の人を除く。いずれも公開プロフィール・視聴者除外
- **カードの内容**: スキン（`MinecraftAvatar` の2D）・名前・メインカテゴリ・自己ベスト（`m:ss`。**公式記録だけ**: ranked は `player_rankings` の `ranked_pb_all_time`〈全期間ベスト。`show_ranked_stats = false` の人は出さない〉、rsg / ssg は `officialCategorySlug(mainCategory, mainVersion)`〈`home-featured.ts`。RSG 1.16-1.19 / SSG 1.16-1.19 / SSG 1.20+ だけ対応〉で引いた `speedrun_categories` の `speedruncom` 行のうち `verified` の最速〈オーナーが非表示にした run は除く〉。バージョン未設定・Bedrock・定義の無い範囲・AA / CE / other は null。手入力の記録〈`category_records`〉と外部 API は使わない。ラベルは「{カテゴリ}の自己ベスト」で、ranked 以外はバージョンを添える。PB が無ければ「メイン: {カテゴリ}（{バージョン}）」）・感度（`n% · x.x cm/180°`）→ 理由の1行（`home.featuredReason*`。行頭に「直近7日」のラベル `home.featuredReasonLabel`。名前の下に置く。理由の無い人は行ごと出さない）→ 主要9操作（前進・後退・左・右〈WASD〉・ジャンプ・スニーク・ダッシュ・インベントリ・オフハンド）のキーチップ。キー配置が無い人は主要操作のチップ行を出さない。その下に**ホットバー1〜9**（`hotbar1`〜`hotbar9`、`FeaturedRunner.hotbar`）を、番号ラベル無しの9列等幅グリッド（見出し「ホットバー（1〜9）」）（`HotbarRow`）で1行に出す。狭幅（モバイル・ゲストヒーロー右側）でも折り返さないよう、チップは `min-w-0` で `truncate`（全文は `title`）、未割り当てのスロットは薄い「-」。ホットバーの割り当てが1つも無い人も9スロット（すべて「-」）を出し、走者の切り替え時にカードの高さが跳ねないようにする。`FeaturedRunnerCard`（ログイン時のワイド版）は右列（`lg:w-[38rem]`）に主要9操作とホットバーを2段で縦に並べ、両段とも9列グリッドで列を揃える（主要操作の列数はビューポートではなくキー領域（`@container`）の幅で決める: 約16rem〈モバイル〉は3列、24rem 以上は4列〈ゲストのヒーローで 4+4〉、35rem 以上は9列。チップは `max-w-full` + `truncate`（全文は `title`）、9列時は `text-xs`。アバターは64px。外枠は大型パネル（`rounded-2xl bg-card/70 p-5 sm:p-6`。ヒーロー・おかえりバーと同系統）で、ページ幅のパネルは浮かせず、ホバーは枠色のみ。「プロフィールを見る」行は無く、名前リンクのオーバーレイでカード全体が遷移する。ラベルは通常の操作名のまま、truncate せず、日本語は語の途中で折らない〈`break-keep`。9列時に「インベントリ」が列幅より数px 広くても1行のまま中央に置き、列からはみ出す〉。英語は空白で折り返す）。注目の走者の10分キャッシュキーは `home:spotlight:v7`（v7 は自己ベストを公式記録だけにして `mainVersion` を足したため、v6 は設定の取得元を公開用のメインプリセットへ変えたため〈次項〉、v5 は `FeaturedKey` から `isRemapped` / `gameKeyCode` を外したため、v4 は注目の走者の動画理由からホーム表示をオフにした人を除外するため。それ以前は `hotbar`・speedrun.com 理由のカテゴリ名/審査状態の追加で形状が変わったため版を上げた）。**キー・感度・リマップの取得元は、プロフィール・操作設定一覧と同じ規則**（`docs/presets.md`）: メインプリセット（`isMain`）が非アクティブ（`isActive = false`）ならそのスナップショット（`decodePresetConfig`。`null` の種別は空として扱いライブへフォールバックしない）、メインが無い／編集中ならライブテーブル（`shouldUsePresetSnapshot` が単一の決定点）。編集中のプリセットの内容を公開面に出さないため。日替わり・ランダムの母集団（キー4つ以上・感度あり・メインカテゴリあり。キャッシュキー `home:featured-pool:v2`）も同じ取得元で判定する。チップはゲーム内キーを出すために実際に押す物理キー（trigger 文脈の単一キーリマップの source）を出し。リマップの有無による強調（リング・枠色・ツールチップ）は出さず、全チップ同じ見た目（物理キーの位置のみ）。見た目は KeyBadge 系と同じクラスだが、`KeyBadge` の import が `item-icon`・`virtual-keyboard` をホームの初期表示へ引き込むため、指割り当て色・ツールチップを省いたホーム専用実装（`featured-runner-card.tsx` の `KeyChip`）。カード全体が走者プロフィールへのリンク。
- **SSR の初期表示**: 候補の1位。候補が0人なら日替わり（キー配置〈主要9操作のうち4つ以上〉・感度・メインカテゴリが揃った公開プロフィールから、UTC 日付をシードに1人。理由の行は出さない）。それも0人なら、ログイン時は欄ごと出さない（`home.tsx` の `featuredEmpty`）。カスタマイズのダイアログの「注目の走者」の行には、表示オンのとき「今日は該当なし」（`home.settingsEmptyToday`）を添える（スイッチの設定は有効のまま）。ゲストは上記ヒーローの右列の説明。
- **「別の走者」ボタン**（常に出す。`min-h-11`）: 押すと、まず SSR で渡した候補を点数順に順番に表示し、出し切った後・候補が無い日は `GET /api/home-featured?exclude=<表示中>,<直前>` で、揃った公開プロフィールからランダムに1人取得する（理由なし。母集団が尽きたら表示を据え置き、トースト「ほかに表示できる走者がいません」で知らせる。取得に失敗したときもエラートースト。`Cache-Control: no-store`）。取得中は中身を薄くして `aria-busy`（高さは変えない）。切り替え後は `aria-live="polite"` で新しい走者の名前を読み上げる。

##### 「お気に入りの動き」（縦タイムライン）
- **表示設定**: ペースは `showPacemanOnHome`、動画はプラットフォーム別の設定で、オフにした人の分を除く。

- `POST /api/home-favorite-activity`（`app/routes/api/home-favorite-activity.ts` → `getFavoriteActivity`）。応答は `private, no-store`。ログイン済みは**サーバーのお気に入り**（`getFavoritesFromDb`、本文は無視）、未ログインは**ブラウザのお気に入りを本文 `{ slugs }` で受ける**（URL に載せない。上限100件・公開プロフィールのみ解決）。
- 種類: ペース（直近7日・保持期間内。同じランは最深区間、1人2件まで）・動画（YouTube/Twitch キャッシュ）・プロフィール更新（`users.updatedAt`）・ガイド（公開済みの `updatedAt`。公開日時の列が無いため「公開・更新」の文言）。新しい順に10件。各1クエリ（お気に入りの userId 群に対して）。
- 種類（追加分）: **rankTierUp**（Ranked のレート帯 UP。`ranked_elo_snapshots` を `getRankTier`〈division 含む。Gold III→Emerald I、Emerald I→II も対象〉で段階化し、期間前の最新スナップショット〈無ければ期間内の最初〉を基準に「それまでの最高段階を更新した日」だけを出す。境目の行き来では増やさず、複数段階上がった日は到達段階1件。文面「{name} が {tier} に昇格」）・**rankedPb**（`player_rankings` の `ranked_pb` で `recordDate` が期間内。「{name} が Ranked PB を更新：{time}」）・**srcSubmit**（speedrun.com への新規申請。`verificationStatus = "new"` で行の `createdAt`〈cron が初めて検知した時刻〉と `recordDate`〈ランの日付〉がともに期間内。連携直後に古い審査中記録が「今提出した」ように見えるのを防ぐ。rejected は出さず、オーナーが非表示にした run〈`hiddenSpeedrunRecords`〉も除く。時刻は `createdAt`）・**settings**（操作設定の変更。**メインプリセットに関わる変更のみ**: メインプリセットへの切替〈初回のメイン作成を含む。文面「プリセットを変更」〉と、メイン＝編集中プリセットの公開設定の保存だけ。`config_history` を `publicConfigChangeCondition()`〈`app/lib/config-history.ts`。`presetId IS NOT NULL` かつ `createdAt >= PUBLIC_CONFIG_HISTORY_SINCE`〉で絞り、`change_type` は種別ラベル（文面・アイコン）に使う。メインでない編集・編集対象の切替は出さない。そのうえで1人・1日〈UTC〉・`changeType` ごとに最新1件へ集約し、文面・アイコンは changeType で分ける: keybinding=キー配置 / device=デバイス設定 / game_setting=ゲーム設定〈アイテム配置・サーチクラフト・プリセットへの保存・テンプレート適用が混在〉 / remap=リマップ〈現状この種別を書く箇所は無い〉 / preset_switch=プリセット。`changeDescription` は書き込み時のロケールの文字列なので表示に使わない）。
- 精度: rankTierUp〈`snapshotDate`〉・rankedPb〈`recordDate`〉は日付までしか分からないため `FavoriteActivityItem.dateOnly = true`、`at` はその UTC 日の正午（now を超えない）。ホームの相対表示は「今日／昨日／N日前」（UTC 日単位）、一覧ページの時刻列は空欄。srcSubmit・settings は時刻つき。
- 1人あたりの上限: ホームは rankTierUp・srcSubmit・settings とも1件（一覧は3件、rankedPb は常に1件）。
- 除外: Ranked 系（rankTierUp・rankedPb）は `users.showRankedStats === false` の人を除く（プロフィールの Ranked 表示と同じ条件。MCSR Ranked 側の非公開を示すデータはアプリ内に無い）。いずれも公開プロフィールのみ・視聴者除外。各取得は独立に失敗させる（`.catch(() => [])`）。
- 遷移先: rankTierUp・rankedPb→`/player/{slug}?tab=stats`、srcSubmit→`/player/{slug}?tab=stats&srcPending=1`、settings→`?tab=keybindings`（keybinding・remap・preset_switch・game_setting〈混在する種別のため汎用の文面にし、遷移先もキー配置タブにする〉）/`devices`（device）。
- お気に入り0人（解決できる公開プロフィールが0人）: 「走者をお気に入りに追加すると、ここに動きが並びます」＋よく見られている走者3人（`ProfileFeedCard` に `showFavoriteButton` を渡し、ヘッダー右端にお気に入りの追加ボタンを出す。追加すると `useFavorites` が変わり、欄は動きの取得（`/api/home-favorite-activity`）を経て動きの一覧に切り替わる。ボタンを出すカードでは「お気に入り」ピルは出さない。3枚の高さは `className="flex-1"` で揃える）。sm 未満は横スクロールの1列（scroll-snap、カード幅 83% で次のカードの端を覗かせる。ライブ欄のレールと同じ作法）にして、欄の高さをカード1枚分＋説明文に抑える（ライブ欄をファーストビューから押し下げないため）。sm 以上は3列グリッド。動きが0件: 「直近7日の動きはありません」。
- 未ログインでお気に入りが無い（Cookie 未同意を含む）ときは欄ごと出さない。お気に入りの一覧は画面表示後にブラウザから取得するため、欄は2行のスケルトンで高さを確保してから埋める（動きの件数は読み込むまで分からない〈0〜10件〉ため少なめに描き、少なかったときに下の欄が大きく上へ動かないようにする）。
- **「すべて見る」の遷移先は `/favorites/activity`**（動きの一覧ページ。仕様は [favorites.md](./favorites.md#お気に入り走者の動き一覧-favoritesactivity)）。
- **ペース行の挙動**: PaceMan のペース行（`kind: "pace"`。応答に `runId` を含む）は、行全体がタイムラインモーダル（`PaceTimelineModal`、`app/components/pace-timeline-modal.tsx`。`/paces` のペースカードと共用）を開くボタン（`aria-haspopup="dialog"`）になる。アバターは装飾（リンクではない）。走者プロフィールへは、モーダルの `profileHref` prop（`pace-timeline-modal.tsx` の任意 prop。あるときだけ走者のプロフィールへのリンクを出す）経由で行ける（ホームの動きの行からのみ渡す。`/paces` のペースカードからは出さない）。動画・ガイド・プロフィール更新の行は従来どおり該当ページへのリンク。
- **行の見た目**（`FavoriteActivityRow`、ホームと `/favorites/activity` 共通）: 記録系（Ranked PB・完走〈ペースの Finish〉＝アイコン `text-gold`、ティア昇格＝`text-success`、speedrun.com 申請＝`text-info`）は文を `font-medium text-foreground`、プロフィール更新・設定系は文を muted、それ以外（途中区間のペース・動画・ガイド）は通常。文は値（タイム・ティア）を切り詰めない: モバイルは2行（1行目＝名前と文脈、2行目＝値と述語）、sm 以上は1行で前半だけ省略する。読み上げは sr-only の全文。
- API は本文の `windowDays`（既定7・最大30）・`limit`（既定10・最大100）で期間・件数を指定でき、サーバー側（`clampFavoriteActivityOptions`）で検証・クランプする（不正値は既定）。ホーム欄は指定しない（7日・10件）。取得ロジックはフック `useFavoriteActivity`（`app/hooks/use-favorite-activity.ts`）、行の描画・文言は `FavoriteActivityRow`（`app/components/favorite-activity-row.tsx`）をホーム欄と一覧ページで共用する。

「よく見られている」は `page_view_stats` のスナップショット行を起点に `innerJoin` する（PV スナップショットが無い環境では自然に0件。UI は件数だけで列を出すか判定）。

#### クライアントサイドで遅延取得（/api/home-feed）

| データ | キャッシュキー | CDNキャッシュ (s-maxage) | stale-while-revalidate |
|--------|---------------|--------------|------|
| YouTube動画（`type=youtube-videos`） | `youtube_videos` | 30分 | 1日 |
| Twitch VOD（`type=twitch-vods`） | `twitch_vods`（`twitch_vod_cache` テーブル読み） | 15分（空は60秒） | 1日 |
| YouTubeライブ配信 | `youtube_live` | 1分 | 2分 |
| PaceManペース（`type=recent-paces`） | `recent_paces` | 5分 | 1日 |
| Twitchストリーム（`type=twitch-streams`） | `twitch_streams` | 30秒 | 60秒 |
| ライブラン（`type=live-runs`、v2 キャッシュ） | `live_runs` | 30秒 | 60秒 |
| Ranked 対戦中（`type=ranked-live`、応答に `fetchedAt`） | `home-feed:ranked-live:v3`（30秒） | 30秒 | 60秒 |
| Ranked の結果（`type=ranked-result`） | `home:ranked-latest:v1:{uuid}`（上流の最新1試合を15秒） | `no-store` | なし |

DBキャッシュ系（PaceManペース / YouTube動画）はデータ鮮度がcron更新間隔（30分 / 2時間）で決まるため、s-maxage を長めに取り、TTL切れ後も stale-while-revalidate（1日）でエッジから即時配信しつつバックグラウンド再検証する。

`youtube-videos` / `twitch-vods` は `perRunner=1`（ホームが付ける）で**同じ走者（slug）の動画・VODを新しい順の先頭1件に絞って**から10件に切る（`/videos` 等の既存の呼び出しは従来どおり）。

##### ライブ欄（横レール `app/components/home/live-rail.tsx`）
- **表示設定**: PaceMan ライブラン・最近のペースは `showPacemanOnHome`、Twitch 配信中は `showTwitchOnHome` で除外（Ranked 対戦中は `showRankedStats` のみ）。

- 見出し「ライブ」＋件数（赤い点1つ。`aria-live="polite"` の件数テキストは人数が変わったときだけ文字列が変わる）。見出し右のリンクは「ペース一覧」（`home.pacesLink`、`/paces`）。見出しと LiveRail の間に**区間分布の帯**（`app/components/home/live-split-strip.tsx`）を置く: 7段（進行バーと同じ並び）で、各段に区間アイコンと人数 `×n`、人数のある段はピル `bg-brand`（無い段は `bg-muted`・アイコン薄め）。区間名は人数のある段なら sm 未満でも出し（`truncate`）、人数の無い段は sm 以上だけ出す。アイコンの下に淡い地 `rounded bg-foreground/15 p-0.5` を敷く（ネザーラック・ネザーレンガ・泣く黒曜石は dark / ultra-dark の背景とほぼ同じ暗さで沈むため。共有部品 `PaceManSplitMark` は変えず、この帯だけ）、sm 以上は段名。見た目は `aria-hidden`、読み上げは sr-only の1文（`aria-live` は付けない）。**誰もいなくても7段（空のバー・人数なし）を描く**（高さを常に確保し、人が来た瞬間に下が押し下がらない）。初回取得中は枠だけで要約を出さず、取得に失敗して一度も成功していないときだけ出さない（空の帯が「誰もいない」と誤読されるため。一度成功していれば前回値のまま）。0人のときは sr-only 要約を出さない（0件の文言は欄の本文が出し、終了カードが残っているときはカードが状態を伝えるため、重ねて読ませない）。終了カード（保持中）は人数に含めない。区間の求め方は `app/lib/home-live.ts` の `liveEntrySplit` / `countLiveStages`（おかえりバーのチップと共通）。`/api/home-feed?type=live-runs`・`ranked-live`・`twitch-streams` を初回取得＋**15秒間隔で自動更新**（タブ非表示中は停止、復帰時に即更新。ranked-live / twitch-streams の失敗は直前の値を保ち、欄全体のエラーにはしない）。更新ボタンは廃止。**最終更新の表示**（`app/components/home/live-updated-at.tsx`）: 見出し直下・区間の帯の上に、右寄せの `text-xs` muted で「N秒前に更新」（1分以上は「N分前に更新」、`home.liveUpdatedSecondsAgo` / `home.liveUpdatedMinutesAgo`）を出す。基準は `liveRunsCheckedAt`（PaceMan のライブ取得が成功した時刻。Ranked / Twitch の失敗は欄全体の失敗にしないので、PaceMan 成功を「取得成功」とする）。一度も成功していなければ出さず、失敗が続いても最後の成功時刻からの経過を出し続ける。1秒ごとに再描画（タブ非表示中は停止）。hydration ずれを避けるためマウント後にだけ描き、マウント前は高さ（`min-h-4`）だけ確保。`aria-live` なし・`tabular-nums`・`<time dateTime>`。
- md 未満（モバイル・小型タブレット）は横レール（scroll-snap。モバイル約1.2枚・sm 約2.5枚見え）、**md 以上は折り返すグリッド**（md=2 / lg=3 / xl=4 列。カードは行内で同じ高さ）。md 以上は最初の2行分（md=4 / lg=6 / xl=8 件）だけ出し、超える分があれば「さらに表示（残り N 人）」で全件展開・「折りたたむ」で戻す（`aria-expanded`）。件数の切り替えは CSS（超過項目に `md:hidden` / `md:max-xl:hidden` / `md:max-lg:hidden`）で行い JS の画面幅判定は使わない（SSR とずれない）。モバイルはレールで全件見られるためボタンを出さない。お気に入りの走者は先頭＋「お気に入り」の小さなピル（塗りハート＋文言、地は `bg-favorite/10`、文字は前景色。表示専用の `FavoriteMark`〈`app/components/favorite-mark.tsx`、/browse のカードと共通〉。ライブ欄にお気に入りのカードが1枚以上あるときだけ、見出しと区間の帯の間に /browse と同じ見た目の補足行 `home.liveFavoritesFirstNote` を出す。終了カードも数える）。**並び順は PaceMan 本家に倣う**: PaceMan と Ranked を混ぜて「区間が深い順 → 同じ深さなら到達タイムが速い順」（`compareLiveEntries` / `liveSortKey`、`app/lib/home-live.ts`）。深さは Ranked が `splitStage(progress.split)`、PaceMan は構造物を**到達順**で数える（最新区間が Bastion / Fortress のとき、eventList の `rsg.enter_bastion` / `rsg.enter_fortress` のうち到達済みの数で 1つ目=2・2つ目=3。それ以外は `splitStage`、second_portal は 4）。タイムはカードの大きな数字（PaceMan は最新区間の IGT、Ranked は `progress.timeMs`）。区間の無い PaceMan・Ranked（Ranked は経過時間の長い順）はその後、Twitch のみのカードが最後。お気に入りの先頭化は従来どおり（各グループ内でこの順）。同点は取得順を保つ（安定ソート）。終了カードは並べ替えの対象外で、直前の位置に残す。カードは3種類:
  - **PaceMan のライブラン**（ネザー入り以降のみ。PaceMan liveruns の範囲）: アバター・名前（その下は `@mcid`）、データ元の1行（`PaceManSourceLine`。「PaceMan」＋カテゴリ「RSG Any%」〈PaceMan が追跡するのは RSG Any% のみ。英語固有名のため翻訳しない〉＋バージョン。Ranked カードの「Ranked 対戦中」ラベルと同じ段）、7点の区間進行バー（Nether → Bastion → Fortress → Blind → Stronghold → End → Finish。到達済みは塗り・現在区間を強調。`app/lib/home-live.ts` の `splitStage`）、最新区間の IGT（大きめ等幅・`aria-label` は「m分s秒」）、ラベル行の右端に小さく**経過時間**（「現在 14:23」。大きな数字は区間に着いたタイムなので、それより新しい今のタイムとして区間名から離して置く。区間に入ってからの時間ではなくランの現在のタイムと読めるよう「経過」ではなく「現在」。RTA。ライブ API にラン開始時刻は無いが `lastUpdated` は最後のイベント〈eventList / contextEventList〉の時刻なので、全イベントの最大 rta に `lastUpdated` からの経過を足す。`paceElapsedRtaMs`。Ranked カードと共通の `ElapsedShort`。完走・終了カードでは出さない）、**ベスト比**。PaceMan に区間別 PB が無いため、ベスト比は「蓄積ペース（`paceman_paces`、直近2か月）内の同じ区間の最小 IGT との差」（進行中のランを比較対象にしないよう直近3時間の行は除外。`live-runs` 応答の `splitBests`）。ベストが無い走者は出さない。**ベスト比は 2つ目の構造物（Second Structure）以降だけ出す**（ネザー入り・1つ目の構造物の段階の差はシードの運に大きく左右され、比較の意味が薄いため。構造物は Bastion / Fortress の種類ではなく到達順で数える〈並び順と同じ `liveSortKey` の深さが 3 以上〉。`paceBestKey`（深さ3未満は null））。2つ目の構造物にいるランの比較相手は、種類別（Bastion / Fortress）のベストではなく**2つ目の構造物どうしのベスト**（蓄積ペースは構造物を種類でしか持たないため、同じラン〈`paceman_run_id`〉で Bastion・Fortress の両方に着いたものの遅い方を2つ目とし、その最小。`splitBests` のキー `Second Structure`〈`SECOND_STRUCTURE_BEST_KEY`〉、カード側は同じ `paceBestKey` で引く）。1つ目の構造物の速い記録と比べて常に「+」になるのを避けるため。最新区間（`getLatestSplit`）は区間の進行順で決めるが、構造物（Bastion / Fortress）は同じ順位として**着いた順で後の方**を最新にする（Fortress → Bastion と進んだランで、Bastion に着いた後も Fortress を出さないため）。カードの進行バーの段も並び順と同じ深さ（構造物は着いた順で 1つ目=2・2つ目=3）。区間分布の帯は区間名で数える。`splitStage` の対応表は PaceMan の正準タイムライン名（`pacemanPaces.timeline`）→ 段階のみ持ち、スプリットID（`rsg.*`）は `getSplitTimeline` で変換して引く。`Obtain Blaze Rods`（Fortress 内の区間）は Fortress と同じ段階（3）。
  - **Ranked 対戦中**: MCSR Ranked の `GET https://mcsrranked.com/api/live`（`app/lib/ranked-live.server.ts`。応答は `data.liveMatches[].{currentTime(ms), players[], data[uuid].{liveUrl, timeline:{time(ms), type}|null}}`）のうち、Minefolio 登録者（`users.uuid` をハイフン無し・小文字に正規化して照合。公開プロフィール・視聴者除外・`show_ranked_stats` が false でない）が出ている試合を1試合1カードに。相手・両者のレート・経過時間を出す（本人のレートは「Ranked 対戦中」の行の右端、相手の情報は右下。下記「表示」）。サーバー側 30秒キャッシュ（レート制限 500回/10分に十分収まる）。
    - **試合の進捗**: 両選手の `timeline`（最新1イベントのみ。途中経過・過去の区間の到達時刻は API に無い）を `RankedLiveMatch.progress`（登録走者）/ `opponent.progress`（相手）に載せる（`{stage, split, timeMs}`。timeline 無し・未知の type は null）。対応は `app/lib/home-live.ts` の `rankedStage` / `rankedSplitName`: `story.enter_the_nether`→1 Enter Nether / `nether.find_bastion`→2 Bastion / `nether.find_fortress`→3 Fortress / `projectelo.timeline.blind_travel`→4 First Portal（Blind） / `story.follow_ender_eye`→5 Enter Stronghold / `story.enter_the_end`→6 Enter End（Finish=7 は Ranked の timeline に無く、バーは End までで止まる）。
    - **表示**: 状態帯は上に小さな「Ranked 対戦中」ラベル（Swords＋`text-[11px]`）、下に登録走者の `StageBar`。大きな数字は PaceMan カードと同じく「ランのタイム」に揃える: progress があれば最新区間の到達時刻（例: Fortress の 5:12）を大きく出し、ラベルは区間マーク＋区間名で、小さな「現在 6:32」（試合の経過時間。`home.liveElapsedShort`、PaceMan と共通の `ElapsedShort`）はラベル行の右端に寄せる。progress が無ければラベル「現在」（`home.liveElapsedShort`）＋大きな数字は試合の経過時間。登録走者本人のレートは状態帯の「Ranked 対戦中」の行の右端（「レート」ラベル＋ `text-sm font-semibold`）に出す。右側（右下）は相手の情報だけの2行（右寄せ・下揃え）: 1行目「vs 相手名 (レート)」（truncate）、2行目「相手: 区間マーク＋区間名」（相手が timeline 無しなら2行目なし）。時間ブロックはラベル行（区間名。右端に「現在」）がカードの全幅を使い、右の補足（ベスト比・相手の情報・相対時刻）は大きな数字と同じ行に置く（ラベルが長いときに補足が押しつぶされて折れないように。数字は `shrink-0`、補足は `min-w-0`）。
  - **Twitch 配信中**（`TwitchLiveCard`）: `twitch-streams` で配信中と確認できた Minefolio 登録者。アバター・名前、状態帯に小さく配信時間（`started_at` から。「配信 15分」「配信 1時間5分」のように時間・分の単位付き。`home.twitchDurationMinutes` / `twitchDurationHours`）と視聴者数、時間ブロックの位置に配信タイトル（2行 clamp）、「Twitch で見る」。**大きな等幅の数字は使わない**（ライブ欄の大きな数字は「ランのタイム」専用。配信時間を同じ見た目で出すとランのタイムと取り違えるため）。**優先順位は PaceMan > Ranked > Twitch**: PaceMan のライブラン・Ranked 対戦中として既に出ている人は Twitch カードを出さない（slug、および PaceMan の `liveAccount`・Ranked の `liveUrl` の Twitch ログイン名〔小文字〕で照合。`pickTwitchOnlyStreams` / `twitchLoginFromUrl`、`app/lib/home-live.ts`）。**対象は Minecraft カテゴリ（`game_id === "27471"` または `game_name === "Minecraft"`）のみ**: スピードランのサイトのライブ欄に他ゲームの配信が並ぶのを避けるため（登録者が雑談・他ゲームで配信中でも出さない。「Twitchライブ」欄の `TwitchRecentList` はカテゴリで絞らない）。サムネイルは使わない（カード寸法を他2種に揃え、プライバシーポリシーに記載のない Twitch CDN 画像のブラウザ直接取得を増やさないため）。自分の `showTwitchOnHome = false` は自分の Twitch カードを隠す。
  - 件数（見出し・`aria-live`）は3種類の合計。見た目は短い「{count}人」（en: "{count} live"、`home.liveCount`）で、読み上げ用に sr-only で「{count}人がライブ中」（`home.liveCountAria`）を併記する。3種類がすべて0件のときだけ下記「0件のとき」に切り替わる。
  - 自分の `showPacemanOnHome = false` はライブ（PaceMan）・最近のペースで自分を隠す（Ranked 対戦中は PaceMan 設定の対象外。`getHiddenPaceMcid` / `filterOwnPaces`、`app/lib/pace-visibility.ts`）。
- **終了カード（一覧から消えたカードを少しの間残す）**: PaceMan・Ranked のカードが一覧から消えたとき、「どうなったか」を伝えるため `LIVE_ENDED_HOLD_MS`（2分）だけ「終了」として残す。判定は `app/lib/home-live.ts` の純関数 `advanceLiveEnded`（状態 `FeedState.liveEnded`、reducer の `SET_LIVE_RUNS` で更新）。
  - **差分の取り方**: 成功したポーリング同士の生データ（`feed.liveRuns` / `feed.rankedMatches`。自分の表示設定での絞り込み前）で、前回あって今回無いもの（PaceMan は `worldId`、Ranked は `key`）を終了とする。差分を取らない: 初回／今回の取得が失敗（`live-runs` 失敗は reducer を通らず前回のスナップショットが残る。Ranked は null）／前回の成功から `LIVE_DIFF_MAX_GAP_MS`（35秒＝2ポーリング＋余裕。1回失敗した直後は差分を取り、タブ復帰など長い空白は取らない）を超えて空いた（何が起きたか分からないので黙って消す）。取得に失敗し続けても `PRUNE_LIVE_ENDED` で保持時間を過ぎたものは消える。
  - **完走は保持しない**: 最後のスナップショットに `rsg.credits` がある PaceMan ランは、一覧に残っている間すでに「完走」表示（下記）なので、消えたらそのまま消す。
  - **復活・差し替え**: 同じ id が再び現れたら live に戻す。同じ人（mcid の小文字。PaceMan の nickname と Ranked の登録 mcid）の新しいライブ（PaceMan・Ranked どちらでも）が現れたら終了カードは捨てる。自分の `showPacemanOnHome = false` の除外は終了カードにもかける（表示側）。
  - **数え方**: 見出しの件数・読み上げ・区間の帯・おかえりバーのライブチップ・「0件のとき」への切り替え判定には含めない。ただし終了カードが残っている間は 0件表示に切り替えずレールに出す。`pickTwitchOnlyStreams` の除外には含める（同じ人の Twitch カードが並ばないように）。
  - **見た目**: 枠を `border-border/40` に弱め、進行バーは `StageBar` の `muted`（現在区間の強調なし・到達済み `bg-brand/40`）。本文テキストの濃さは変えない。カード高さ・段構成は他カードと同じ。「配信中」の印・Twitch リンクは今も配信中（`streamingSlugs`）のときだけ（消える直前の `liveAccount` / `liveUrl` は使わない）。
  - **PaceMan の完走（一覧に残っている間）**: 状態帯の PaceMan 行の先頭に「完走」（`text-gold`、`home.liveFinished`）。大きな数字は完走タイム（Finish 区間の IGT）。PaceMan は完走したランを `credits` 付きで数分一覧に残す（実測）。
  - **PaceMan の終了**（credits 無しで消えた）: 「リセット」（`home.liveRunReset`）。PaceMan のライブ一覧から credits 無しで消えるのは実際上ほぼリセットのためその名前で出す（ゲーム終了・タイムアウトも厳密には区別できないが、表示上はリセットとして扱う）。時間ブロックは最後に確認できた区間とタイム。
  - **Ranked の終了**: 状態帯のラベルを「試合終了」に替え、結果が取れたら「 · 勝利 / 敗北 / 引き分け / 相手の降参で勝利 / 降参」（勝利 `text-success`・敗北 `text-destructive`）と、本人のレート横にレート増減（`+14` 等）を出す。勝利で降参でなければ大きな数字は完走タイム（`result.time`、ラベルは Finish マーク）。それ以外は最後に確認できた状態のまま。結果待ちの間は「結果を確認中」、保持期限までに取れなければ「試合終了」のみ。
  - **Ranked の結果取得**: `GET /api/home-feed?type=ranked-result&uuid=<登録走者>&opponent=<相手uuid>&since=<試合開始推定ms>`（`fetchRankedResult`、`ranked-live.server.ts`）。応答は `{ status: "pending" }` または `{ status: "done", outcome: "win"|"lose"|"draw", forfeited, timeMs, eloChange }`（outcome は登録走者から見た勝敗、`timeMs` は登録走者の勝利時の `result.time`）。`uuid` は `getRegisteredByUuid` と同じ条件の登録者に限り、それ以外・`opponent` が32桁hexでない・上流失敗・未確定はすべて同じ `pending`（登録の有無を判別させない。任意 UUID のプロキシにしない）。上流は `GET https://mcsrranked.com/api/users/{登録済みuuid}/matches?count=1&type=2`（UUID は照会値ではなく登録者一覧のものを使う。MCSR Ranked への UUID 送信は既存の範囲）。最新1件の `players` に両 uuid が含まれ、`date*1000 >= since − 60秒` のときだけ採用（再戦で前の試合を拾わない。`judgeRankedResult`）。応答は `no-store`、上流の最新1試合だけを uuid 単位で15秒サーバーキャッシュ（失敗はキャッシュしない）。試合開始の推定は「`ranked-live` 応答の `fetchedAt`（サーバー取得時刻）− `currentTimeMs`」（ブラウザ時計・CDN 遅延の影響を受けない。旧応答は受信時刻で代用）。クライアントはライブのポーリングが成功するたび（タブ非表示中は止まる）、結果が `done` になるまで問い合わせる。結果は終了カードの id と `endedAt` の両方が一致するものにだけ載せる（再戦の別カードに載せない）。
  - 既知の限界: 走者が表示設定を変えた・非公開にした・上限20件の外に出た場合も、開いているタブでは2分間「終了」と出る。終了直後に matches に載るまでの遅延は未確認のため、載るまで再試行する設計。
- **ライブ取得の失敗**: `fetchLiveRuns()`（PaceMan）・`fetchRankedLiveMatches()` は上流の非 2xx・例外を `null`（0件の `[]` と区別）で返し、`/api/home-feed` の `live-runs` / `ranked-live` は 502（`Cache-Control: no-store`）でサーバー・CDN ともキャッシュしない。クライアントは `live-runs` 失敗を欄のエラー（前回データは保持）、`ranked-live` 失敗を前回値の保持として扱い、いずれも終了判定の差分に使わない（一瞬の上流障害で全カードが「終了」にならない）。**上流失敗の負キャッシュ**: `live-runs` / `ranked-live` は上流が `null` を返したら、その事実を10秒だけサーバーのメモリに覚える（キー `<成功キャッシュのキー>:fail`、`UPSTREAM_FAILURE_TTL`）。その間の同種別の要求は上流を呼ばずに即同じ 502 + `no-store` を返し、10秒を過ぎた次の要求で上流を再試行する（障害中に全タブの15秒ポーリングが上流へ届き、タイムアウト〈PaceMan 10秒・Ranked 8秒〉まで関数が待ち続けるのを防ぐ。復旧の反映は最大10秒遅れる）。覚えるのは上流（PaceMan / MCSR Ranked）の失敗だけで、`live-runs` の DB 側の一時エラーは覚えない（ただし `ranked-live` は `fetchRankedLiveMatches` が内部の DB エラーも `null` に畳むため、それも10秒覚える）。インスタンス単位のメモリで、CDN には載せない。成功時のキャッシュ（サーバー30秒・CDN）は変わらない。
- **配信リンク**: PaceMan の `user.liveAccount` と Ranked の `liveUrl`（`sanitizeTwitchUrl` で Twitch のみ通す）があれば「Twitch で見る」。赤い「配信中」の印（`StreamingBadge`）は次のいずれかのとき出す: (a) Twitch 配信カード（`TwitchLiveCard`）は常に、(b) PaceMan カードは `run.user.liveAccount` がある（PaceMan 上で配信中。非配信者は null）とき、Ranked カードは `liveUrl` があるとき、(c) Minefolio に Twitch を登録していて `twitch-streams`（Helix の Get Streams）で配信中と確認できた人（slug で照合。`streamingSlugs`）。**「ホーム画面にTwitch配信を表示」（`showTwitchOnHome = false`）の人は、サーバー側で PaceMan の `liveAccount`（`live-runs`、キャッシュキー v3）と Ranked の `liveUrl`（`ranked-live`、v2）を null にする**ため、「Twitch で見る」リンクも印も出ず、Twitch カード・`twitch-streams` にも出ない（優先順位の重複除外 `pickTwitchOnlyStreams` は、その人の Twitch カードが元から無いので影響しない）。**YouTube の配信中表示は無い**（`youtube_live_cache` はレート制限のため不使用）。
  - **カードの段構成（全種別共通）**: ヘッダー（`CardHead`）→ 状態帯（`StateBand`、`h-10` 固定。PaceMan/最近のペース＝「PaceMan RSG Any%」の1行＋進行バー、Ranked＝小さな「対戦中」ラベル＋本人のレート＋登録走者の進行バー、Twitch＝配信時間・視聴者数の1行）→ 時間ブロック（`TimeBlock`、ラベル行 `h-5`〈`text-xs`、区間マークのアイコン 16px〉＋隙間 `gap-1`＋時刻 `leading-8`。右側の補足〈ベスト比・相手の情報・相対時刻〉は下端揃え。Twitch は `TimeBlock` を使わず同じ高さ `h-14` の枠にタイトル2行）→ リンク行（`LinkRow`、`mt-auto`＋`min-h-11 sm:min-h-8`。ライブ欄の3種別はリンクが無いカードも同じ高さの空行を確保。0件時の「最近のペース」カードはライブカードと同じグリッドに並ばず、リンクも無いので置かない）。種別・状態によらず時間ブロックとリンクの縦位置が一致する。
- **0件のとき**: 「いまライブ中の走者はいません」1行（隣に次の行き先として「最近のペースを見る →」〈`/paces`、`home.liveEmptyPacesLink`〉。見出し右の「ペース一覧」と同じ行き先だが、ライブも注目の走者も空のときに上半分が空振りで終わらないよう目に入る位置にも置く）＋「最近のペース」3件（読み込み中のスケルトンは件数が分からないので、モバイルは1枚・md 以上は1段ぶんの3枚）（同じ走者は2件まで・同じカードの静止版、すべて見るは `/paces`）に差し替える。独立した「過去のペース」欄・`LivePaceList` は廃止。取得失敗の帯は欄内で最大1本: ライブと最近のペースが両方失敗してライブ0件のときは1本（`home.liveAllFetchFailed`）にまとめ、再試行で両方を取り直す。ライブの失敗帯には補足「15秒ごとに自動で再試行」（`home.liveRetryNote`）を添える。帯の部品は下記「取得失敗の帯」。
- **区間進行バー**（`StageBar`、`app/components/pace-stage-bar.tsx`）: ライブ欄カード・最近のペースカード・`/paces` の `PaceFeedCard`（ヘッダー直下、IGT・区間バッジの上）で共有。`PaceFeedCard` は過去のペースなので、そのランの最深区間（`splitStage(run.timeline)`）を現在区間として強調する。現在区間は `bg-brand`、到達済みは `bg-brand/40`、未到達は `bg-muted`。バーは `aria-hidden`（区間名はバッジのテキストで出る）。
- **区間到達の動き**（ライブ欄。15秒ごとの更新で、同じカード〈同じ id〉の区間が進んだ瞬間だけ）: 純粋な計算は `app/lib/live-motion.ts`（`reachedStages` / `computeLiveFlip`）、DOM 側は `app/components/home/use-live-motion.ts` と `StageBar`。すべて Web Animations API（再レンダーで途切れないよう、クラスの付け外しにしない。続けて更新が来たら `cancel()` して取り直す）。初回表示・マウント時・ハイドレーションでは動かさず、`will-change` は付けない。
- **完走の特別感**（ライブ欄）: (1) `StageBar` に任意の `finished`。真かつ最後の段（Finish）に到達していれば、その段を `bg-gold`（「完走」の文字と同じ `--gold`）にする。`muted`（終了カード）でも金色は保ち、強調の高さ（`h-2.5`）だけ現在区間のルールどおり付けない。他の段・`finished` を渡さない呼び出し（`/paces` 等）は従来どおり。`LiveRunCard` は `isFinishedRun(run)`、`RankedMatchCard` は `finishTimeMs != null` を渡す。(2) `useStageReachPulse(stage, disabled, finished)` は、完走に到達した更新だけ色を `--gold`・長さを約2秒にする（通常は brand・1.2秒）。判定は純粋関数 `reachedFinish`（`app/lib/live-motion.ts`）: stage が最後の段へ増えた、または finished が false→true。PaceMan では credits が最後の段（`liveSortKey` の深さ 7）に対応し両者は同時に成り立つが、片方だけ先に変わる更新も取りこぼさないよう OR にしている。初回表示・終了カードでは出さず、reduced-motion でも出す（色だけの変化）。色は計算済みトークン値を keyframes に埋め込む。
  - **帯が伸びる**（`StageBar`）: 新しく到達した段を左から右へ `scaleX(0→1)`（`origin-left`、450ms、`cubic-bezier(0.16, 1, 0.3, 1)`。複数段飛んだときは段ごとに 80ms ずらす）。終了カード（`muted`）は動かさない。
  - **色の合図**（`useStageReachPulse`）: 区間名の行（`TimeBlock` のラベル）に `brand` 15% の淡い面を出して 1.2 秒で消す。色の変化だけで、reduced-motion でも出す。終了カードは出さない。
  - **並べ替えで滑る**（`useLiveFlip`）: `entries` の id 列が変わったコミットだけ、各カードを前回位置から 300ms で滑らせる（FLIP。位置は `offsetLeft/offsetTop` のレイアウト座標で、スクロール・ホバーの transform に影響されない。md 未満のレール・md 以上のグリッド共通）。新規カードは opacity 0→1（200ms）。消えるカードは即時。「もっと見る」の開閉・初回表示・タブが裏（`document.hidden`）・差 1px 未満は動かさない。
  - **reduced-motion**: WAAPI には `app.css` の全体ルールが効かないため JS で `matchMedia` を見て、帯の伸びと滑り（translate）をやめる。色の合図と新規カードの opacity は残す。
- **取得失敗の帯**（`FeedErrorNotice`、`app/components/home/feed-error-notice.tsx`）: `role="status"`、文言は本文色（`text-foreground`）で赤はアイコンと枠だけ、任意の補足 `note`（`text-xs` muted）と再試行ボタン。ホームの各欄とお気に入りの動き一覧（`/favorites/activity`）で共用する。
- **過去のペースカードのタイムラインモーダル**: `PaceFeedCard`（`app/components/pace-feed-card.tsx`、`/paces` 一覧で使用）のカードをクリックすると、そのランの全スプリット（Enter Netherを含む進行順）を表示するモーダルが開く。データは `/api/home-feed?type=pace-timeline&mcid=...&runId=...`（`getRunTimeline()`）で、モーダルを開くたびに遅延取得する。時刻は `formatClock`（`app/lib/home-format.ts`。1時間以上は h:mm:ss）で他の欄と揃える。HTTP エラー（`!res.ok`）は「区間データがありません」ではなくエラー表示にする。**応答は公開プロフィール（視聴者除外）として登録されている mcid（`getUserData().registeredMcids`、小文字比較）に限る**。非公開・視聴者・未登録の mcid は、存在しない場合と同じ `{ timeline: [] }` を返し、登録の有無を応答から判別できないようにする。PaceMan.gg への外部リンクはモーダル下部。

### /api/home-feed

遅延読み込み対応のAPIエンドポイント。クエリパラメータ `type` で取得するデータ種別を指定する。

- **レスポンスはユーザー非依存**: セッション・お気に入りを一切参照しない（お気に入りを先頭に出す並べ替えはクライアント側 `useFavorites()` で適用）。これによりレスポンスがユーザー間で完全に共有可能になり、CDNキャッシュが正しく機能する
- **UserDataCache**: 登録ユーザーのMCID・UUID・表示名・カスタムスキンURLをインメモリキャッシュ（TTL: 1分）。`app/lib/home-user-data.server.ts` の `getUserData()` に共通化されており、`/api/home-feed` と `app/lib/paces-feed.server.ts`（`/paces`・`/api/paces`）が同一キャッシュを参照する（毎リクエストの全ユーザースキャンを回避）。ホームの SSR loader（`home.tsx`）はこのマップを返さない
- **応答に載せるマップは表示アイテム分のみ**: キャッシュは全公開ユーザー分だが、`/api/home-feed` の応答（ライブラン・ペース）には `pickUserDataForMcids` で表示アイテムの mcid 分だけに絞ったマップ（`mcidToUuid` / `mcidToSlug` / `mcidToDisplayName` / `mcidToDisplayNameAlphabet` / `mcidToSkinUrl`）を載せる
- **TwitchLinkCache**: Twitchソーシャルリンク一覧をキャッシュ（TTL: 5分。キー `home-feed:twitch-links:v2`）。配信中応答（`home-feed:twitch:all:v2`）の各要素（`HomeTwitchStream`、`app/lib/home-live.ts`）は `displayNameAlphabet` を含み、表示側が `pickDisplayName` でロケールに応じた名前に解決する（他の欄と揃える）
- **HomeHiddenUsers**: ホームの表示設定をオフにした人の一覧（`getHomeHiddenUsers`）を60秒キャッシュ（キー `home:hidden-users:v1`。純関数 `isHiddenOnHome(user, kind)` が「`false` のときだけ隠す」判定の単一定義）
- **Ranked ライブの登録者一覧**: `getRegisteredByUuid`（公開・視聴者除外・Ranked 統計を表示する人）を60秒キャッシュ（キー `home:ranked-registered:v1`）
- **CDNキャッシュヘッダー**: `Cache-Control: public, s-maxage=N, stale-while-revalidate=M` を設定（上記の表を参照）

### 動画フィード（YouTube + Twitch VOD）
- **表示設定**: ホームの呼び出し（`perRunner=1`）は `showYoutubeOnHome` / `showTwitchOnHome` をオフにした人の動画を除く。`/videos` は対象外。

- YouTube動画（`type=youtube-videos`、`youtube_video_cache`）と Twitch 配信アーカイブ
  （`type=twitch-vods`、`twitch_vod_cache`）を並列取得し、クライアント側で
  統一形式 `FeedVideo`（`app/components/feed-video-card.tsx`）にマージして新しい順に表示する
- **どちらも cron 蓄積の専用テーブル読み**（YouTube: `youtube-update` 2時間毎 / Twitch: `twitch-update` 30分毎）。
  保持期間は**90日**（`app/lib/feed-video.ts` の `VIDEO_FEED_RETENTION_DAYS`。cron がそれ以前の行を削除）
  - **Twitch VOD取得**（`getRecentVods()`、`app/lib/twitch.ts`）: 連携済み全チャンネルが対象（旧: 先頭10件のみ）。
    チャンネルごとに `/videos?type=archive` を保持期間（90日）に達するまでページング取得する
    （1ページ100件、安全上限500件/チャンネル＝最大5ページ。同時5チャンネルまで並列。Helixレート制限
    800pt/分への配慮）。`viewable === "private"` のVODを除外してキャッシュする（フィールド欠落は
    public 扱い＝欠落時に差分削除で全消ししないための安全側）。API呼び出しに成功し全件取得しきれた
    チャンネル（0件応答も含む）は取得結果との差分でキャッシュ行を削除し、VOD削除・非公開化・
    チャンネル全体の非公開化を反映する。login解決不可・API呼び出し失敗など判定不能なチャンネルと、
    安全上限（500件）で打ち切られ未取得分が残りうるチャンネル（`incompleteLogins`）は削除しない
    （フェイルオープン）。`verify` cron（8時間毎、VOD IDの存在確認）はこの差分削除の取りこぼしに対する
    安全網として引き続き稼働する
  - **YouTube動画取得**（`resolveUploadsPlaylists()` + `fetchUploadsPlaylistItems()`、`app/lib/youtube.ts`）:
    Search API（1回100ユニット）ではなく、アップロード再生リスト方式（`channels.list` でチャンネルの
    uploadsプレイリストIDを解決 + `playlistItems.list` で最新10件取得。いずれも1ユニット/リクエスト）で
    クォータを節約する。連携済み全チャンネルを毎回処理し、`privacyStatus === "public"` の動画のみ
    キャッシュする。非公開化・削除の検知は従来どおり `verify` cron（12時間毎、動画IDの存在確認）が担う
- **ホームの動画欄は YouTube と Twitch を分ける**（個人設定 `showYoutubeOnHome` / `showTwitchOnHome` は従来どおりクライアント側で効く）。「すべて見る」は `/videos`（`/videos` は従来どおり `FeedVideoCard` の混在一覧）
  - **YouTube**（`app/components/home/home-video-card.tsx`）: 3本・同じ走者は1本まで。デスクトップ3列、モバイルは横レール。カード全体がその場で再生（`youtube-nocookie.com` の埋め込み）、外部リンクは右上の 44px アイコンボタン（Tab 停止点は再生・外部リンク・走者リンク）
  - **Twitch「Twitchライブ」**（`app/components/home/twitch-recent-list.tsx`）: 1人1行（その人の最新アーカイブ）で6行、サムネイル・埋め込みは使わない。配信中の人（`twitch-streams`）を先頭に「配信中」の印付きで出し、その人の VOD 行は重複させない。行は左にアバターと名前、その右にタイトル → ゲーム名（`twitch_vod_cache.game_name`。null なら省く。配信中は Helix の `game_name`）→ 時間（相対時刻＋アーカイブの長さ `h:mm:ss`。配信中は経過時間）。行全体が Twitch への外部リンク（新しいタブ・アイコン付き・高さ 44px 以上）。`game_name` は cron が取り込み時点のチャンネルのカテゴリを保存する（取り込みが配信終了から遅れると次の配信のカテゴリになることがある）
- 各取得は独立にスケルトン（1段・YouTube カード3枚分）→失敗時は1行の再試行（YouTube・Twitch の片方だけ失敗なら失敗した側だけ再取得）。マージ後0件なら箱にせず muted の1文（`home.noVideos` + `home.noVideosDescription`。導線は欄見出しの「すべて見る」）。プロフィール欄の0件・お気に入りの勧める走者が居ない0件も同様に muted の1文。ライブが0人のときは7段の帯を `opacity-60`（`LiveSplitStrip muted`）にして、0件の1文と「ペースを見る」の下（`LiveRail` の `emptyStrip`）へ置く
- 旧 `FeedVideoCard` は `/videos` が引き続き使う（埋め込みURL生成 `getEmbedUrl` / `getFeedVideoUrl` はホームのカードも共用）。カード内の旧「サムネイルクリックで再生」「タイトルから視聴ページ」の挙動は `/videos` のまま

### 設定変更時の自動リフレッシュ（cronを待たない反映）

プロフィール編集の保存時、cronの次回実行（YouTube最大2時間・Twitch最大30分）を待たずに**対象ユーザー分だけ**
即時反映するトリガーが `app/lib/targeted-refresh.server.ts` に集約されている。action がレスポンスを返した
「後」に `runAfterResponse()`（内部は `@vercel/functions` の `waitUntil()`）でバックグラウンド実行するため、
保存の応答速度には影響しない。各関数は内部でエラーを握り、失敗しても action を失敗・ブロックさせない
（fire-and-forget）。呼び出し元は `app/routes/me/edit.tsx`（保存本体は `app/lib/profile-edit.server.ts`。`/me/account` の保存も同じ本体を通るが、リンク・MCID を送らないのでキックは走らない）。

| トリガー | 実行内容 |
|---|---|
| Twitch/YouTubeリンクの追加・変更 | 新チャンネルのVOD/動画を即時取得（`refreshTwitchVodsForLogin` / `refreshYoutubeForChannel`） |
| Twitch/YouTubeリンクの変更・削除 | 旧チャンネルのキャッシュ行を削除（`deleteTwitchVodsForLogin` / `deleteYoutubeVideosForChannelIdentifier`）。**他の走者の登録分は消さない**（下記） |
| Speedrun.comユーザー名の変更（ソーシャルリンク欄・基本情報フォームのどちらの経路でも） | Speedrun.com/MCSR Rankedランキングを即時更新（`refreshSrcRankingsForUser`） |
| MCID変更 | `youtube_video_cache.minefolio_mcid` の紐付けを新MCIDへ更新（`updateYoutubeCacheMcid`。旧MCIDのまま残ると一覧から消えるため）＋YouTube連携があれば新MCIDで即時再取得 |
| プロフィールを非公開→公開へ再公開 | 非公開中は cron の走査対象外（`getPublicTwitchLinks` / `getRegisteredYouTubeChannels` は公開プロフィールのみを走査）だったため取りこぼしていたTwitch/YouTubeキャッシュを追いつかせる |

cron（YouTube 2時間毎・Twitch 30分毎）は全体の定期同期として引き続き稼働し、この即時リフレッシュを
置き換えるものではない（未ログイン操作や外部サービス側での削除・非公開化は cron 側の `verify` が拾う）。

**リンク解除時の削除は、他の走者の登録分を消さない。** `twitch_vod_cache`（チャンネルの login 単位）と
`youtube_video_cache`（`channelId` ＋ `minefolioMcid`）はチャンネル単位の共有キャッシュで、ソーシャルリンクは
自己申告のため、他人のチャンネル名でリンクを作って外すだけで他人の動画が次の cron まで消えてしまう。これを防ぐため、
削除関数には「外した本人」（`LinkOwner` = `userId` と MCID）を渡し、判定は削除と同じ関数の中で行う:

- **Twitch**: `social_links` に、`platform = 'twitch'` かつ `lower(identifier)` が同じ login で `userId` が本人以外の行が
  1件でもあれば削除しない（1クエリ）。判定のクエリが失敗したときも消さない。
- **YouTube**: `channelId`（ハンドルは解決して UC-ID に）が同じで、`minefolioMcid`（大文字小文字無視）が本人の MCID に
  一致する行だけを削除する。行は最初に取得した走者の MCID に帰属し（`upsertVideoCache` は衝突時に `minefolioMcid` を更新しない）、
  他の走者の MCID に帰属した行は消えない。同じ保存で MCID を変える／外すときは `updateYoutubeCacheMcid` と並行になるため、
  旧・新の両方を渡す。本人の MCID が無ければ（取得がスキップされるので帰属行も無い）何も消さない。
- 旧→新の identifier 変更は、従来どおり「削除 → 取得」の順に直列化する。

### 表示制御フラグ

ユーザーごとに以下のフラグで表示/非表示を制御する（`users` テーブル）。**オフにした人の該当コンテンツは、誰のホームにも出さない**（本人の画面だけでなく全員のホームから除外）。

| フラグ | デフォルト | 除外されるもの（ホームのみ） |
|--------|-----------|------|
| `showPacemanOnHome` | `true` | ライブ欄の PaceMan ライブラン（`type=live-runs`）・最近のペース（`type=recent-paces`）・お気に入りの動きのペース。ライブカードの「同区間ベスト」はライブランから派生するので同時に消える |
| `showTwitchOnHome` | `true` | ライブ欄の Twitch 配信中カードと「Twitchライブ」の配信中行（`type=twitch-streams`）、最新動画の Twitch「Twitchライブ」（`type=twitch-vods&perRunner=1`）、注目の走者・お気に入りの動きの Twitch 動画 |
| `showYoutubeOnHome` | `true` | 最新動画の YouTube カード（`type=youtube-videos&perRunner=1`）、注目の走者・お気に入りの動きの YouTube 動画 |

- **適用範囲はホームのみ**。`/videos`・`/paces`・プロフィール等では従来どおり表示する（設定文言が「ホーム画面に」であるため）。`getPublicVideoFeed(db, filters, { forHome: true })` のオプションでホーム用の呼び出しだけが除外を行い、`/videos` と共用のフィード本体（`videos:feed:all`）は変えない。`type=youtube-videos` / `twitch-vods` は `perRunner=1`（ホームが付ける）のときだけ除外する
- 除外は**サーバー側**（`app/lib/home-visibility.server.ts` の `getHomeHiddenUsers`＝フラグが明示的に `false` の人の mcid / slug 一覧）で行う。PaceMan のライブランは mcid（大文字小文字無視）で照合する。応答は閲覧者非依存のままなので CDN 共有キャッシュと矛盾しない。**設定を変えてから他人の画面に反映されるまでの最悪値**は、CDN の `s-maxage` ＋ `stale-while-revalidate` と、サーバー側キャッシュの合算（古い応答がエッジに残る間は、サーバー側を更新しても反映されない）:

  | 対象 | CDN（s-maxage + SWR） | サーバーキャッシュ |
  |---|---|---|
  | YouTube 動画（`youtube-videos`） | 30分 + 1日 | 動画フィード 60秒、非表示一覧 60秒 |
  | Twitch VOD（`twitch-vods`） | 15分 + 1日 | 同上 |
  | ペース（`recent-paces`） | 5分 + 1日 | ユーザーデータ 60秒、非表示一覧 60秒 |
  | ライブラン・配信中 | 30秒 + 60秒（既定は s-maxage の2倍） | ライブラン 30秒、配信中 1分、Twitch リンク 5分、ユーザーデータ 60秒、非表示一覧 60秒 |
  | 注目の走者 | なし（SSR は `private, no-store`） | 10分（母集団 10分） |
  | Ranked 対戦中 | 30秒 + 60秒 | 登録者一覧 60秒 |

  つまりペース・動画は最悪で「s-maxage ＋ 1日」ほど古い応答が残りうる（SWR 中は古い応答を返しつつ再検証するため、低トラフィック時ほど長く残る）。即時性が要る自分の画面だけは下記のクライアント側除外で補う
- **Ranked 対戦中**（`type=ranked-live`）は PaceMan 設定の対象外。`showRankedStats=false` の人だけを除外する（既存）。注目の走者の `rankedPb` / `eloGain` 理由も `showRankedStats`。speedrun.com 理由に表示設定は無い（非表示にした記録は除く）
- 本人の画面だけは、設定変更の直後にキャッシュ TTL を待たず消えるよう、`home.tsx` で自分の分を従来どおりクライアント側でも除外する（冗長だが即時反映のため残している）

### カスタムスキン対応

- `mcidToSkinUrl` マップ: MCIDからカスタムスキンURLへのマッピング（`/api/home-feed` の応答に表示アイテム分のみ含まれる）
- カスタムスキンが設定されているユーザーは、Mojang APIの代わりにカスタムスキンURLを使用
- `customSkinUrl` は Vercel Blob に保存

### フィード状態管理

クライアントサイドでは `useReducer` によるFeed状態管理を行う:

```
interface FeedState {
  recentVideos: FeedVideo[];
  twitchVods: FeedVideo[];
  twitchStreams: HomeTwitchStream[];
  recentPaces: CachedPace[];
  liveRuns: PaceManLiveRun[];
  rankedMatches: RankedLiveMatch[];
  liveEnded: LiveEndedState; // 終了カードの保持（上記「終了カード」）
  splitBests: Record<string, Record<string, number>>;
  mcidToUuid: Record<string, string>;
  mcidToSlug: Record<string, string>;
  mcidToDisplayName: Record<string, string>;
  mcidToDisplayNameAlphabet: Record<string, string>;
  mcidToSkinUrl: Record<string, string>;
  loading: { videos; twitchVods; paces; liveRuns: boolean };
  errors: { videos; twitchVods; paces; liveRuns: boolean };
  liveRunsCheckedAt: number | null;
}
```

mcid マップは SSR では持たず、`SET_PACES` / `SET_LIVE_RUNS` で受けた `/api/home-feed` 応答のマップを `mergeMcidMaps` で既存 state に**蓄積マージ**する（ライブとペースで別々の mcid が返るため、後勝ち置換ではなく和集合にする。応答にキーが無い場合はそのまま保持）。

### メタタグ

- `og:type`: `website`
- `og:title`: `t("home.title")`
- `og:image`: `/icon.png`
- `twitter:card`: `summary`

---

## ペース一覧画面 (/paces)

### 概要

ホームの「最近のペース」フィードの全件表示版。DBキャッシュ（`pacemanPaces` テーブル、**過去2か月分**を保持）にあるペースを検索・無限スクロールで閲覧できる。

### データ取得

共通ロジックは `app/lib/paces-feed.server.ts` に集約（loaderと `/api/paces` で共用）。レスポンスをCDNキャッシュ可能にするため、セッション非依存の一覧取得と、ログインユーザー固有の表示設定取得を2関数に分離している:

- **`getPublicPaceFeed(filters)`**（セッション非依存。戻り値は `{ items, userData }`）
  - 登録ユーザー（MCID・UUIDあり、視聴者ロール除外）の情報は `getUserData()` の共通キャッシュから取得。SSR 1ページ目・`/api/paces` はいずれも `withPaceProfiles` で応答ページ分の `items[].profile`（`uuid` / `displayName` / `displayNameAlphabet` / `skinUrl`）を付与し、全ユーザー分のマップは応答に載せない
  - `getPaceFeedEntries(registeredMcids, query)`（`app/lib/paceman-cache.ts`）で取得
    - Enter Nether を除外、保持期間（2か月）外をガード
    - 同一 `pacemanRunId` は最も進んだ Split（rta最大）のみ採用（区間指定時はその区間の行）
    - 日時降順ソート（同秒タイは `pacemanRunId` 降順でタイブレーク — offsetページングの安定性のため）。ホームフィードはこの共通関数に `{ limit: 12 }` を渡して利用する
  - フィード全体は区間キー毎にインメモリキャッシュ（キー `paces:feed:v3:*`、TTL 60秒。保持するのは `items` 配列のみ）し、無限スクロールのページ毎にテーブル全体を走査しない。プレイヤー・時期・タイムはキャッシュ済みリストへのJSフィルタで適用
  - 「自分のペースを隠す」設定（`showPacemanOnHome`）はここでは適用しない（レスポンスをユーザー間で共有可能にするため）
  - プロフィールを非公開化しても、フィードキャッシュ・`getUserData` キャッシュ（各TTL 60秒）の都合で反映は最大約120秒遅れうる
- **`getViewerPacePrefs(db, auth, request)`**（セッション依存）: `getOptionalSession()` でセッションを取得し、ログインユーザーの `mcid` / `showPacemanOnHome` を返す（未ログイン・未登録ユーザーはフィルタなし扱い）
- 「自分のペースを隠す」フィルタは `getViewerPacePrefs` の結果を使い、`/paces` ページのクライアント側（`paces.tsx`）でMCID一致除外として適用する（ホームの `/api/home-feed` と同じパターン）

### 検索

URLクエリパラメータで指定（`parsePaceSearchParams()` で解析、共有可能なURL）:

| パラメータ | 条件 | 備考 |
|-----------|------|------|
| `q` | プレイヤー | MCID・表示名の部分一致（大文字小文字無視） |
| `split` | 区間 | `PACE_FEED_SPLITS`（`app/lib/pace-splits.ts`）のいずれか。指定時はその区間のIGTで表示・絞り込み |
| `from` / `to` | 時期 | `YYYY-MM-DD`（JSTとして解釈、`to` はその日の終わりまで） |
| `maxTime` | タイム上限 | `m:ss` 形式。表示される区間のIGTに対して適用 |
| `sort` | 並び順 | `time`＝表示タイム（IGT）の昇順（同タイムは新しい順）。未指定・不正値は新しい順。`split` と併用すると区間別最速になる。キャッシュ済みベースのコピーに対して `getPublicPaceFeed` 内でソートする |

検索 UI の挙動（`app/routes/paces.tsx`）:

- 検索条件パネル（面は `rounded-xl border border-border/70 bg-card`。大型パネルの見た目にはしない）はモバイルで畳める（開閉ボタンは高さ44px）。畳んだ間も、URL に適用済みの条件を丸ピル（`rounded-full` のチップ）で表示する（入力中の下書きは含めない）。走者の欄のラベルは「走者」（`paces.filterPlayer`）
- 一覧のグリッドは `sm:grid-cols-2 xl:grid-cols-4`（4件のグリッドの規約）
- ヘッダーは「アイコンチップ＋h1＋件数ピル（右端 `ml-auto`）」（`/videos`・`/rankings` と同じ形。件数は 0 のとき出さない）。並び順はフォームの外の「表示の設定」の行（`justify-end`、ラベル＋セレクトだけ）にあり、セレクト変更で即時に URL へ反映する（/browse と同じ）。他欄の未送信の入力は保持し、URL 上の適用済み条件に `sort` だけを足す。`sort` 以外のパラメータが変わったときだけ入力欄を URL に同期し直す。並び順は適用中チップ・「N件適用中」の件数に入らず、「条件をリセット」でも残る
- タイム上限は `m:ss`（`^\d{1,3}:[0-5]?\d$`、サーバーの `parseTimeParamToMs` と同じ）をクライアントで検証し、不正なら送信せず入力欄の下にエラーを表示する（`aria-invalid` / `aria-describedby` でエラー文・ヒント文を関連付け）
- 開始日が終了日より後なら送信せず、期間の欄の下にエラー（`paces.filterPeriodError`、`role="alert"`、/videos と同じ）を出す。日付入力には `min`（保持期間の開始日＝過去2か月）と `max`（今日・JST）を付ける。値は loader が `toJstDateString`（`paces-feed.server.ts`）で作って返す（SSR とクライアントで「今日」がずれない）
- 折りたたみバッジ「N件適用中」の N は、下に並ぶチップの数と同じ（開始日・終了日は「時期」の1件。並び順は絞り込みではないので数えない）
- 絞り込み・並び替えの再取得中（`useNavigation` が `/paces` 内の `loading`）は、一覧（または空状態）を差し替えず `opacity-50` ＋ `aria-busy` で残す（`/rankings` と同じ。`navigation-progress.tsx` は同一パス内の遷移では何も出さないため）
- 絞り込みの無い空状態は「どうすれば載るか」を説明する（`paces.emptyHint`: MCID を登録して公開プロフィールにした走者の、PaceMan に記録された過去2か月のペース。`getUserData` の条件に対応）。ログイン中の人には `/me/edit` への `action`（loader の `signedIn`）。未ログインは説明だけ

区間名（セレクトの選択肢・カード・バッジ）は日本語ロケールでも **PaceMan の英語正規名**（Bastion / Fortress / Enter Stronghold 等）のまま表示する（ユーザー判断。`app/lib/paceman.ts` の `getSplitTimeline` / `PaceManSplitMark` が語彙の基準）。

### 遅延ロード・無限スクロール

- loader（SSR）は先頭60件と総件数のみ返す
- 追加ロードは /videos と共通の `use-infinite-scroll` フック（`/api/paces?page=N` + 検索条件、
  レスポンスは `{ items, page, hasMore }` 規約）。検索条件の変更はフックの `resetDeps` でリセット
- フックは素の `fetch` で取得する（`useFetcher` の `load` は失敗を最寄りの ErrorBoundary へ送り、ページ全体がエラー表示になるため）。
  失敗（通信エラー・2xx 以外）は戻り値の `loadError` で返し、一覧の末尾の「もっと読み込む」の代わりに `FeedErrorNotice`（`paces.loadMoreFailed`）と再試行（`retry`）を出す。
  失敗時は page を進めず、失敗中はセンチネルからの自動読み込みを止める（再試行は操作で）。`/browse` は `loadError` を表示していない

### /api/paces

ページング+検索用APIエンドポイント。`{ items, page, total, hasMore }` を返す（`page` は1始まり、1ページ60件）。レスポンスは `getPublicPaceFeed()` ＋ `withPaceProfiles`（`items[].profile` 付与）のみを使いセッション非依存（「自分のペースを隠す」フィルタは適用しない）のため、`Cache-Control: public, s-maxage=30, stale-while-revalidate=300` を付与しCDNキャッシュ可能にしている。

---

## 動画一覧画面 (/videos)

### 概要

ホームの動画フィードの全件表示版。`youtube_video_cache`（YouTube動画）と `twitch_vod_cache`（Twitch VOD）に
蓄積された**直近90日**の動画を、検索・無限スクロールで閲覧できる。カードはホームと同じ `FeedVideoCard`
（埋め込み再生 + 外部リンク）。/paces と同じ構成。

### データ取得

共通ロジックは `app/lib/videos-feed.server.ts` に集約（loaderと `/api/videos` で共用）:

- **`getPublicVideoFeed(db, filters)`**（セッション非依存）
  - 両テーブルの保持期間内・`isAvailable=true` の行を取得し、統一形式 `FeedVideo` にマージして新しい順にソート
  - 可視性: 公開プロフィール（viewer除外）に紐付く動画・VODのみ（/paces と同じ「公開のみ」ルール）。
    YouTube は `minefolioMcid`、Twitch は `userLogin` → `social_links.identifier` で読み時に紐付ける
  - フィード全体はインメモリキャッシュ（キー `videos:feed:all`、TTL 60秒）。フィルタはJSで適用
- **`getViewerVideoPrefs(db, auth, request)`**（セッション依存）: `mcid` / `showYoutubeOnHome` / `showTwitchOnHome` を返す。
  「自分の動画を隠す」フィルタはクライアント側でプラットフォーム別に適用

### 検索

| パラメータ | 条件 | 備考 |
|-----------|------|------|
| `q` | プレイヤー | MCID・表示名・slug・チャンネル名の部分一致（大文字小文字無視） |
| `platform` | プラットフォーム | `youtube` / `twitch` |
| `from` / `to` | 時期 | `YYYY-MM-DD`（JSTとして解釈、`to` はその日の終わりまで） |

空状態の説明（`videos.emptyHint`: YouTube か Twitch のリンクを登録して公開プロフィールにした走者の、直近90日の動画・配信アーカイブ）と `/me/edit` への `action`（ログイン中のみ）、再取得中の `opacity-50` ＋ `aria-busy`、日付入力の `min`（直近90日の開始日）/ `max`（今日・JST）、バッジ件数＝チップ数は `/paces` と同じ。`FeedVideoCard` の全面リンクは `tabIndex={-1}` ＋ `aria-hidden`（Tab 停止点・読み上げはタイトルのリンクに一本化。外部リンクアイコンも同様）。

検索 UI は `/paces` と同じ作り（`app/routes/videos.tsx`）: モバイルでは既定で畳み、畳んだ間も適用中の条件をチップと件数（`videos.filterActiveCount`）で示す。走者の欄のラベルは「走者」、期間は見出し「時期」の下に「開始日」「終了日」の2欄。開始日が終了日より後なら送信せず、欄の下にエラー（`videos.filterPeriodError`、`aria-invalid` / `role="alert"`）を出す。解除の文言は「条件をリセット」（`common.resetFilters`）。0件は `EmptyState`（絞り込み中なら「条件をリセット」の操作つき）。動画カードのサムネイルは `alt=""`（タイトルはカードの見出しと再生ボタンの名前で読まれるので二重にしない）。

### 遅延ロード・無限スクロール

- loader（SSR）は先頭24件と総件数のみ返す
- 追加ロードは `/browse` と共通の `use-infinite-scroll` フック（`/api/videos?page=N` + 検索条件、
  レスポンスは `{ items, page, hasMore }` 規約）。検索条件の変更はフックの `resetDeps` でリセット。
  追加の取得に失敗したら、一覧の末尾に `FeedErrorNotice`（`videos.loadMoreFailed`）と再試行を出す（`/paces` と同じ）

---

## 旧ライブ画面 (/live) — 廃止済み

- v1.9.0 で `/live` ルートは廃止。**ライブペースはホームのペースフィード内へ移設**した（上記「ホームフィードの構成」参照）
- 旧URLへのアクセスは `app/routes/live-redirect.ts` がホーム（`/`）へリダイレクトする（ブックマーク・外部リンク対策）
- 旧画面にあった配信中セクション（Twitch / YouTube Live）の表示面は廃止。`/api/home-feed` の `twitch-streams` / `youtube-live` エンドポイント自体は公開APIとして残存
- `StreamCard` / `YouTubeLiveCard` コンポーネントは未使用となったため削除済み（必要になればgit履歴から復元可能）

---

## キャッシュテーブル

### youtubeVideoCache

YouTube動画のキャッシュ。

| カラム | 型 | 説明 |
|--------|-----|------|
| `videoId` | text (UNIQUE) | YouTube動画ID |
| `channelId` | text | チャンネルID |
| `minefolioMcid` | text | Minefolioユーザーとの紐付け |
| `title` | text | 動画タイトル |
| `description` | text | 動画説明 |
| `thumbnailUrl` | text | サムネイルURL |
| `channelTitle` | text | チャンネル名 |
| `publishedAt` | timestamp | 公開日時 |
| `lastVerifiedAt` | timestamp | 最終確認日時 |
| `isAvailable` | boolean | 動画が利用可能か |

保持期間は90日（`VIDEO_FEED_RETENTION_DAYS`）。cron `youtube-update?action=update` が超過行を削除する。

### twitchVodCache

Twitch配信アーカイブ（VOD）のキャッシュ。cron `/api/cron/twitch-update` が30分毎に蓄積する。

| カラム | 型 | 説明 |
|--------|-----|------|
| `vodId` | text (UNIQUE) | Twitch VOD ID |
| `userLogin` | text | 配信者のlogin名（小文字）。`social_links.identifier` と読み時に突合 |
| `title` | text | VODタイトル |
| `thumbnailUrl` | text | サムネイルURL（処理中VODは null） |
| `channelTitle` | text | 配信者の表示名 |
| `durationSeconds` | integer | 配信時間（秒） |
| `publishedAt` | timestamp | 公開日時 |
| `lastVerifiedAt` | timestamp | 最終確認日時 |
| `isAvailable` | boolean | VODが利用可能か（Twitch側で自動削除されたものは false） |
| `gameName` | text (nullable) | 取り込み時点の**チャンネルの現在のカテゴリ名**（Helix `GET /channels` の `game_name`。VOD個別のカテゴリではない）。新規行にだけ保存し既存行は上書きしない。取得失敗・カテゴリ未設定は null |

`gameName` は `getRecentVods`（`app/lib/twitch.ts`）が /users 解決後に全チャンネル分を `/channels?broadcaster_id=…`（100件ずつ）で一括取得して付与する（チャンネルごとのN回呼び出しはしない）。失敗しても取り込みは続行する。

保持期間は90日。`verify` アクション（8時間毎）が削除済みVODを `isAvailable=false` にマークする
（Twitch VODは配信者設定により14〜60日で自動削除されるため）。

### youtubeLiveCache

YouTubeライブ配信のキャッシュ。**既知の制限: 現在このテーブルへの書き込みは停止中**（YouTube Search API の
クォータコスト〈1リクエスト100ユニット〉が高く、日次クォータ〈10,000ユニット〉をすぐ消費してしまうため、
更新ロジック自体〈`fetchAndCacheLiveStreams()`、`app/lib/youtube-cache.ts`〉は残存するが `vercel.json` の
crons から `action=live` を外してある）。`/api/home-feed?type=youtube-live` は常に空配列を返し、ホームに
YouTubeライブ配信は表示されない。将来的にRSS/Atomフィード等での再実装を検討中。

| カラム | 型 | 説明 |
|--------|-----|------|
| `videoId` | text (UNIQUE) | YouTube動画ID |
| `channelId` | text | チャンネルID |
| `minefolioMcid` | text | Minefolioユーザーとの紐付け |
| `title` | text | 配信タイトル |
| `thumbnailUrl` | text | サムネイルURL |
| `liveBroadcastContent` | enum | `live` / `upcoming` / `none` |
| `scheduledStartTime` | timestamp | 配信予定開始時刻 |
| `actualStartTime` | timestamp | 実際の開始時刻 |
| `concurrentViewers` | integer | 同時視聴者数 |
| `lastCheckedAt` | timestamp | 最終チェック日時 |

### pacemanPaces

PaceManペースのキャッシュ。Cron（`/api/cron/update-paceman-cache`）がPaceMan APIから直近1週間分を取得し、**蓄積型**で保存する:

- 取得したランと同じ `pacemanRunId` の既存行のみ削除して挿入（取得ウィンドウ外の過去ペースは保持）
- 削除→挿入→プルーニングは `db.batch`（1トランザクション）で実行（途中失敗による蓄積データの消失を防ぐ）
- 保持期間は**過去2か月**。それより古い行はCron実行時に削除される
- 読み取り側（`getPaceFeedEntries`）にも保持期間ガードがあり、Cronが止まっても期間外データは配信されない
- **`user_id` の再リンク**: INSERT 時に `lower(mcid)` が一致する users（公開/視聴者判定なし）の id を `user_id` に入れる。後から MCID を登録・変更したユーザーの既存行は INSERT 時には紐づかないため、Cron が毎回 `relinkPacemanPaceUsers()`（`app/lib/paceman-cache.ts`）を実行し、保持期間内の行の `user_id` を「現在の `lower(users.mcid)` 一致のユーザー」に合わせ直す（未登録・MCID 変更/解除後の旧 MCID 行は `null`、別ユーザーが同 MCID を登録済みならそのユーザーへ付け替え。冪等）。取得結果が0件・登録ユーザー0人でも実行する
- ホームの「お気に入りの動き」「おかえりバーの最新ペース」は `paceman_paces.user_id` で絞る（`idx_paceman_paces_user_id`）。公開プロフィール・視聴者除外などの表示判定はユーザー側の条件で行う
- 許容している一時的なずれ: MCID の登録・変更から次の Cron（30分間隔）までの間は、該当ユーザーの過去行が `user_id` で引けない。他のフィード（`/paces` 等）は mcid 文字列で絞るため影響しない

### apiCache

汎用APIキャッシュ。

| カラム | 型 | 説明 |
|--------|-----|------|
| `cacheKey` | text (UNIQUE) | キャッシュキー |
| `cacheType` | enum | `youtube_videos` / `recent_paces` / `twitch_streams` / `live_runs` / `social_stats` / `twitch_vods` |
| `data` | text | JSONデータ |
| `expiresAt` | timestamp | 有効期限 |

---

## 関連ファイル

### ルート
- `app/routes/home.tsx` - ホーム画面
- `app/routes/paces.tsx` - ペース一覧画面（検索・無限スクロール）
- `app/routes/videos.tsx` - 動画一覧画面（検索・無限スクロール）
- `app/routes/live-redirect.ts` - 旧 `/live` のホームへのリダイレクト
- `app/routes/api/home-feed.ts` - ホームフィード遅延読み込みAPI
- `app/routes/api/paces.ts` - ペース一覧のページング+検索API
- `app/routes/api/videos.ts` - 動画一覧のページング+検索API
- `app/routes/api/cron/twitch-update.ts` - Twitch VODキャッシュ更新Cron
- `app/routes/api/cron/youtube-update.ts` - YouTube動画キャッシュ更新Cron

### ライブラリ
- `app/lib/youtube.ts` - YouTube API連携（アップロード再生リスト解決・取得、チャンネル統計）
- `app/lib/youtube-cache.ts` - YouTube動画・ライブキャッシュ管理
- `app/lib/twitch.ts` - Twitch API連携（トークン取得、ストリーム取得、VODページング取得）
- `app/lib/twitch-vod-cache.ts` - Twitch VODキャッシュ管理（蓄積・差分削除・存在確認・クリーンアップ）
- `app/lib/targeted-refresh.server.ts` - 設定変更時の1ユーザー/1チャンネル単位の即時リフレッシュ（`runAfterResponse` 経由）
- `app/lib/feed-video.ts` - 動画フィードの共有ドメイン型・ユーティリティ（`FeedVideo` / 保持期間定数 / 自分の動画非表示フィルタ）
- `app/lib/videos-feed.server.ts` - 動画一覧の共通ロジック（マージ・可視性・検索条件解析）
- `app/lib/home-visibility.server.ts` - ホーム表示設定をオフにした人（mcid / slug）の一覧
- `app/lib/paceman.ts` - PaceMan API連携（ライブラン取得）
- `app/lib/paceman-cache.ts` - PaceManペースキャッシュ管理（蓄積・保持期間・フィード取得）
- `app/lib/home-featured.ts` / `home-featured.server.ts` - 注目の走者（点数・候補・日替わり・ランダム）
- `app/lib/home-favorite-activity.server.ts` - お気に入りの動き
- `app/lib/ranked-live.server.ts` - MCSR Ranked のライブ試合
- `app/lib/home-live.ts` / `home-format.ts` - 区間進行バー・時刻整形などの純粋ロジック
- `app/routes/api/home-featured.ts` / `home-favorite-activity.ts` - 「別の走者」/お気に入りの動き API
- `app/lib/paces-feed.server.ts` - ペース一覧の共通ロジック（検索条件解析・表示対象の絞り込み）
- `app/lib/pace-splits.ts` - フィード対象区間の定数、スプリットID → ラベル/タイムライン名、進行順（`getSplitOrder`）・最新区間（`getLatestSplit`）。クライアントからも使うため DB・cache を引き込まない軽量モジュール（`paceman.ts` からも re-export）
- `app/lib/cache.ts` - 汎用インメモリキャッシュ（`getCached`, `setCached`）

### コンポーネント
- `app/components/home/` - ホーム専用（`home-section` 欄枠 / `welcome-bar` / `featured-runner-card` / `live-rail` / `favorite-activity` / `compact-profiles` / `home-video-card` / `twitch-recent-list`）
- `app/components/feed-video-card.tsx` - 動画フィードカード（`/videos` 用。YouTube/Twitch VOD統一・埋め込み再生対応）
- `app/components/pace-feed-card.tsx` - ペースフィードカード（ペース一覧で使用）
- `app/components/profile-feed-card.tsx` - プロフィールフィードカード（お気に入り0人時のおすすめで使用）
- `app/components/paceman-split-mark.tsx` - PaceManスプリットマーク
- `app/components/page-views-meta.tsx` - 直近7日PV表示（`PageViews7dMeta`。ガイドカード・プロフィールカードで共有）
