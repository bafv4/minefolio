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
// Loader
const env = context.env ?? getEnv();
const db = createDb();
const auth = createAuth(db, env);
const session = await getOptionalSession(request, auth);

// Action
const formData = await request.formData();
const actionType = formData.get("_action") as string;
// → 成功: { success: true, action: "..." }
// → 失敗: { error: t("..."), action: "..." }
```

## エラー処理
- Loader: `throw new Response(t("key"), { status: 404 })`
- Action: `return { error: t("key") }`
- トースト: `toast.success(t("key"))` / `toast.error(t("key"))`（sonner）

## 翻訳
- `t("dotPath.key")` でアクセス（例: `t("meEdit.mcidRequired")`）
- パラメータ補間: `t("key", { count: 5 })`
- UIテキストは原則として翻訳キー経由、ハードコードしない

## DB クエリ
- リレーション読み込みは `with` を使用（別クエリにしない）
- `db.query.users.findFirst({ where: eq(...), with: { ... } })`
- 演算子: `eq`, `and`, `desc`, `asc`, `like`, `sql`

## その他注意点
- まず使用するフレームワークのドキュメントを確認してください
- 実装はなるべく疎結合に、特にユーティリティやUI部品は他の部分にも転用できるように設計してください
- 既存の実装パターンを踏襲する
- 仕様は`docs`配下にあります
- 仕様変更・機能内容の追加変更が発生する場合：
  - `docs`配下のドキュメントを追加・修正する
  - @app/content/changelog.md にチェンジログを記載する（`/developers/changelog` で公開される）