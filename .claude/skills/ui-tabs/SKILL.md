---
name: ui-tabs
description: Minefolio のフォルダ型タブ（app/components/ui/tabs.tsx）の内部構造。タブUIそのものを改修する、タブの見た目を変える、Dialog や縦サイドバーでカード化を打ち消す、タブ周りの表示崩れ（境界に線が出る・タブが浮く・パネルが同時表示される・横スクロールが効かない）を直すときに使う。消費側で Tabs を使うだけなら `.claude/rules/ui.md`「タブ」節の不変条件で足りる。
---

# フォルダ型タブの構造（`app/components/ui/tabs.tsx`）

タブ列とコンテンツ全体が 1 枚のカードに収まり、その中でアクティブタブがコンテンツ面と
一続きに見える「フォルダ型」デザイン。**1px 単位の重なりで成立している**ため、
各パーツの役割を理解せずに触ると崩れる。

## 成立させている構造

- **カード**: `Tabs` ルート自体が `rounded-xl border bg-card overflow-hidden` の 1 枚のカードとして
  タブ列 + コンテンツを囲む
- **タブ帯**: `TabsList` はカード上部の帯（`bg-muted/40` + `px-1.5 pt-1.5` = `p-1.5` 相当）。
  上下左右で余白量を揃え、カード枠線との間に均等な余白を持たせる
  （下方向は `-mb-px` の重なり機構のため pb なし）
- **ベースライン**: 帯とコンテンツの境の 1px 横線は `TabsContent` の上ボーダー（`border-t`）が担う
  （**TabsList 自体は下線を持たない**）
- **連結**: `TabsList` が `-mb-px` でコンテンツに 1px 重なり、`relative z-[1]` で手前に描画される
- **アクティブタブ**: `bg-card` + 全周ボーダーのうち**下だけ透明**。bg-card が透明な下ボーダー帯まで
  塗られ、ベースラインを覆ってコンテンツ面と連結する
- **非アクティブタブ**: 常時 1px 枠（`border-border`）+ `bg-muted/50` のくぼんだ面。
  アクティブとの色差で選択状態を示す
- **アクセント**: アクティブタブ上辺内側にブランド色バー（`before:` 疑似要素 + `bg-brand`）
- **横スクロール**: TabsList 自身が `overflow-x-auto`。ネイティブスクロールバーは非表示
  （帯内に高さを取りタブがベースラインから浮くため）で、代わりに `useTabScrollbar`
  （`app/hooks/use-tab-scrollbar.tsx`）のオーバーレイ型カスタムスクロールバー
  （スクロール可能時のみ表示・ドラッグ可・レイアウト高さゼロ）を重ねる。
  Link ベースの `ContentTabs` / `ViewSwitcher` も同じフックを使用
- **カード化の打ち消し**: Dialog 内や独自レイアウト（プロフィールの縦サイドバー等）では、
  ルートに `rounded-none border-0 bg-transparent overflow-visible`、`TabsList` に
  `bg-transparent p-0` を指定して素の構造に戻す。プロフィールの縦サイドバーでは
  `TabsContent` も `rounded-none border-0 bg-transparent p-0 sm:p-0` で素通しにし、枠は中身の
  各 Card に任せる（**パネル自体をカード化すると中の Card と二重枠になるため行わない**）

## 消費側の不変条件（`.claude/rules/ui.md` と同一。破ると崩れる）

1. `TabsList` と `TabsContent` の間に `gap-*` / `space-y-*` を入れない
   （1px の重なりが壊れ、タブとパネルの間に線が見える）
2. `TabsContent` に display ユーティリティ（`block` / `flex` / `grid` 等）を足さない
   （非アクティブパネルの `hidden` 属性が無効化され同時表示される）
3. `TabsTrigger` に外側リング・`shadow`・`-mb-px` を足さない
   （TabsList のスクロールコンテナにクリップされる）
4. `TabsList` を別のスクロールコンテナ（`overflow-x-auto` の div 等）で包まない
   （基底が対応済み。包むと 1px 重なりがクリップされる）
5. `dark:` バリアント禁止 — テーマトークン（`bg-card` / `border` / `bg-brand` / `ring-ring`）のみで
   3 テーマ（light / dark / ultra-dark）に対応する
6. Dialog 内など枠付きパネルが過剰な場面では、`TabsContent` に
   `rounded-none border-0 border-t bg-transparent p-0 pt-4`、`TabsTrigger` に
   `data-[state=active]:bg-background` を付けるデグレード構成を使う

## 変更したら確認すること

3 テーマ（light / dark / ultra-dark）× デスクトップ/モバイル幅で、

- タブ帯とコンテンツの境に**余計な線が出ていない**か（重なりが壊れていないサイン）
- アクティブタブがコンテンツ面と**連続して見える**か
- 幅を狭めたときにタブが見切れず、カスタムスクロールバーが出るか
- 非アクティブパネルが同時表示されていないか

`ui-verifier` サブエージェントに委譲してもよい（この確認項目を必須手順として持っている）。
