---
name: db-apply
description: Minefolio のDBスキーマ変更をローカル/リモート(Turso)に反映する。`pnpm db:push` が TRUNCATE（データ損失）を提案した場合の回避手順、`.env` / `.env.remote` の接続先分離、一回限り適用スクリプトの書き方を含む。「リモートDBに反映」「マイグレーションを適用」「db:push で TRUNCATE を聞かれた」などの依頼で使う。
---

# DBスキーマの反映（ローカル / リモート Turso）

## 大前提：接続先の分離（破ると事故る）

- **`.env` は常に `TURSO_DATABASE_URL=file:local.db` 固定。**
- リモート Turso の接続情報は **`.env.remote`**（gitignore 済み）に置く。
- **`.env` を一時的にリモート URL へ書き換える運用は禁止。**
  起動中の dev サーバーや別スクリプトが巻き添えでリモート DB に接続する。
- ガード: `.env` にリモート URL が入ると `drizzle.config.ts`・`scripts/lib/db-env.ts`・
  `/dev/login`（`isDevAuthEnabled()`）がすべて拒否する。

**リモートへの適用は破壊的操作。実行前に必ずユーザーの承認を取る。**

## 反映ルートの選び方

```
スキーマ(app/lib/schema.ts)を変更した
        │
        ├─ ローカル(local.db)に反映   → pnpm db:push
        │
        └─ リモート(Turso)に反映      → pnpm db:push:remote
                                          （drizzle.remote.config.ts が .env.remote を読む）
                │
                └─ push が「TRUNCATE しますか？」を提案した
                        → ★ push しない。下の「手動DDLスクリプト」へ
```

`pnpm db:generate` はマイグレーション履歴として生成しておく。ただし
**`pnpm db:migrate` はこの Windows 環境でエラー詳細なしにサイレント失敗する**ため、
実際の反映経路ではない（`__drizzle_migrations` は作られるが1件も適用されない）。

## ★ TRUNCATE を提案されたとき（頻出）

drizzle-kit push は `.default(false)` などの **falsy デフォルトを「デフォルト無し」と誤認**し、
NOT NULL 列の追加でテーブル再作成（＝データ損失）を提案する。

この場合は push せず、`scripts/` に**一回限りの tsx スクリプト**を作って手動 DDL で適用する。

### スクリプトの型（既存に倣う）

前例: `scripts/add-with-shift.ts`, `scripts/apply-0019.ts`,
`scripts/add-page-view-stats-table.ts`, `scripts/add-like-tables.ts`

```ts
// <何を追加するか> の一回限りのスクリプト。
//
// 背景: <なぜ db:push ではなく手動DDLなのか>
//
// 実行:
//   pnpm exec tsx scripts/<name>.ts                   # ローカル(.env)に dry-run
//   pnpm exec tsx scripts/<name>.ts --apply           # ローカルに適用
//   pnpm exec tsx scripts/<name>.ts --remote          # リモート(.env.remote)に dry-run
//   pnpm exec tsx scripts/<name>.ts --remote --apply  # リモートに適用（要ユーザー承認）
import { createClient } from "@libsql/client";
import { loadDbEnv } from "./lib/db-env";

const { url, authToken } = loadDbEnv();   // --remote フラグを自動判定＋URLスキーム検証
const apply = process.argv.includes("--apply");
const client = createClient({ url, authToken });

console.log(`モード: ${apply ? "APPLY（実際に適用します）" : "DRY-RUN（表示のみ・変更なし）"}`);
```

必須の作法:

- **dry-run が既定。`--apply` を明示したときだけ実行する。**
- 接続先の読み分けは必ず `loadDbEnv()`（`scripts/lib/db-env.ts`）を使う。
  自前で dotenv を読まない（URL スキーム検証と取り違え中断が効かなくなる）。
- DDL は `pnpm gen:test-schema`（drizzle-kit export）の出力と一致させ、
  再実行に備えて `IF NOT EXISTS` を付ける。
- 適用前に `sqlite_master` / `PRAGMA table_info` で存在チェックし、
  既に適用済みならスキップして報告する。
- 既存データを変更する UPDATE を含む場合は、影響行数を dry-run で先に出す。

### 実行の流れ

1. ローカルで dry-run → 内容をユーザーに提示
2. ローカルに `--apply` → `pnpm dev` で動作確認
3. **ユーザーの承認を取ってから** `--remote` で dry-run → `--remote --apply`

## リモートの中身を確認したいとき

```bash
pnpm db:studio:remote        # drizzle studio（.env.remote）
```

読み取りだけの確認なら `scripts/` に dry-run スクリプトを足してもよい。

## 参照

- スキーマ本体: `app/lib/schema.ts`
- 全体像・ER図・整合性ポリシー: `docs/database.md`
- ローカル開発環境の立ち上げ: `docs/local-development.md`
