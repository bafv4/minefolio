# コーディング規約

## インポート順序
1. React / フレームワーク (`react`, `react-router`)
2. 内部ライブラリ (`@/lib/*`)
3. UIコンポーネント (`@/components/ui/*`)
4. ドメインコンポーネント (`@/components/*`)
5. アイコン (`lucide-react`)
6. 型は `type` キーワードで通常importに統合

## エクスポート
- **ルートコンポーネント**: `export default function PageName()`
- **共通コンポーネント**: `export function ComponentName()` （名前付きエクスポート）

## 命名
- 変数・関数・プロパティはすべて **camelCase**
- コンポーネントは **PascalCase**

## CSS
- 基本は Tailwind クラスを直接記述
- 条件付きクラスの場合のみ `cn()` を使用: `className={cn("base", condition && "extra")}`

## ルートファイル
- 型は `import type { Route } from "./+types/<ファイル名>"` からインポート
- Loader: `Route.LoaderArgs`、Action: `Route.ActionArgs`、Meta: `Route.MetaFunction`
- 新ルートは必ず `app/routes.ts` に登録

## Loader / Action パターン
```typescript
// Loader（環境変数は getEnv()＝process.env 経由。React Router 8 の context は使わない）
const env = getEnv();
const db = createDb();
const auth = createAuth(db, env);
const session = await getOptionalSession(request, auth);

// Action
const formData = await request.formData();
const actionType = formData.get("_action") as string;
// → 成功: { success: true, action: "..." }
// → 失敗: { error: t("..."), action: "..." }
```

### 主要ヘルパーの所在（Loader/Action から使う）
- `getEnv()` … `app/lib/env.server.ts`（`process.env` の型付きラッパ、返り値は `Env`）
- `createDb(url?, authToken?)` … `app/lib/db.ts`（`Database` 型・`isUniqueConstraintError()` も同ファイル）
- `createAuth(db, env)` … `app/lib/auth.ts`（better-auth インスタンス）
- 認証セッション … `app/lib/session.ts`
  - `getSession(request, auth)`（認証必須）/ `getOptionalSession(request, auth)`（任意）
  - `getCurrentUser` / `getCurrentUserOrOnboarding` / `isAuthenticated`
- DBスキーマ … `app/lib/schema.ts`（Drizzle、SQLite/Turso 方言）

## エラー処理
- Loader: `throw new Response(t("key"), { status: 404 })`
- Action: `return { error: t("key") }`
- トースト: `toast.success(t("key"))` / `toast.error(t("key"))`（sonner）

## 翻訳（i18n）
- import は `import { t } from "@/lib/messages"`（現行の主系統。約76ファイルで使用）
- `t("dotPath.key")` でアクセス（例: `t("meEdit.mcidRequired")`）。キー実体は `app/lib/messages/pages-ja.ts`（ネストしたオブジェクト）
- パラメータ補間: `t("key", { count: 5 })` → 文言中の `{count}` を置換
- **文言の追加は `app/lib/messages/pages-ja.ts`（日本語・全キーの基準）に入れる**。英語 `pages-en.ts` は任意（部分集合でよく、未翻訳キーは日本語へフォールバックする）
- **コンポーネントでは `t()` を直接呼ばず `useT()`（`@/hooks/use-locale`）を使う**。`t()` はモジュールレベルの純粋関数でリクエスト文脈を持たないため、直接呼ぶと常に日本語になる
- ローダー / meta ではロケールを明示する: `t(key, params, locale)`。locale は `resolveLocale(request)` / `localeFromMatches(matches)`（`@/lib/locale`）で得る
- UIテキストは原則として翻訳キー経由、ハードコードしない。キーが無ければ `pages-ja.ts` に追加してから使う
- 対応ロケールと検出（Cookie → Accept-Language → 既定）は `app/lib/locale.ts` が単一情報源。詳細は `docs/i18n.md`
- 旧 `@/lib/i18n`（カテゴリ方式）は**削除済み**。ロケール関連は `@/lib/locale` に集約されている

## DB クエリ
- リレーション読み込みは `with` を使用（別クエリにしない）
- `db.query.users.findFirst({ where: eq(...), with: { ... } })`
- 演算子: `eq`, `and`, `desc`, `asc`, `like`, `sql`

## `.server` モジュール
- `*.server.ts` はクライアントバンドルへ入れられない。コンポーネントから**値**として import すると
  `pnpm build` が `Server-only module referenced by client` で失敗する
- **`pnpm typecheck` も `pnpm test` もこれを検出しない**（型としては正しく、テストは Node 環境で動くため）。
  クライアント側のファイルを触ったら `pnpm build` まで通すこと
- 型だけなら `import type { ... } from "@/lib/xxx.server"` でよい（消えるので問題ない）
- 集計サーバーと描画側が同じ**値**（センチネル・定数）を共有する場合は、`.server` ではない
  モジュールに置いて両方からそれを import する（例: `app/lib/keybindings-stats-shared.ts`）

## その他注意点
- まず使用するフレームワークのドキュメントを確認してください
- 実装はなるべく疎結合に、特にユーティリティやUI部品は他の部分にも転用できるように設計してください
- 既存の実装パターンを踏襲する
- 仕様は`docs`配下にあります
- 仕様変更・機能内容の追加変更が発生する場合：
  - `docs`配下のドキュメントを追加・修正する
  - チェンジログ（@app/content/changelog.md、`/developers/changelog` で公開される）は**都度記載しない**。
    バージョン番号とともにリリース指示があった段階でまとめて作成する（CLAUDE.md「バージョン管理・Changelog」参照）