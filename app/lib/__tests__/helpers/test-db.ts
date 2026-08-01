// loader / DB / インフラ層のテスト用ハーネス。
//
// 本番と同一の Drizzle スキーマ（app/lib/schema.ts）を in-memory の libSQL に構築した
// 「使い捨ての実 DB」を提供する。モック DB では表現できない SQL レベルの挙動（LIKE /
// 可視性フィルタ / count / リレーション読み込み / UNIQUE 制約など）を、実データを入れて
// 検証できる。
//
// スキーマは `drizzle/` のマイグレーション履歴を replay するのではなく、現行スキーマから
// 生成した単一 DDL（test-schema.sql）を一括適用する。Turso 方言の履歴マイグレーションは
// テーブル再構築と DROP INDEX の順序が新規 replay と噛み合わず（例: users_slug_unique）、
// in-memory への逐次適用が失敗するため、この方式を採る。
//
// スキーマ変更時は test-schema.sql を再生成すること:
//   pnpm gen:test-schema        （= drizzle-kit export をこのファイルへ書き出す。package.json 参照）
//   もしくは: pnpm exec drizzle-kit export --dialect=sqlite --schema=./app/lib/schema.ts > app/lib/__tests__/helpers/test-schema.sql
//
// 使い方:
//   const db = await createTestDb();
//   const user = await seedUser(db, { slug: "runner1", profileVisibility: "public" });
//   ... db.query.users.findMany(...) 等で検証 ...
//
// createTestDb() は毎回まっさらな独立 DB を返す（テスト間で状態を共有しない）。
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { createId } from "@paralleldrive/cuid2";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "../../schema";

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

const HELPER_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_SQL_PATH = path.join(HELPER_DIR, "test-schema.sql");

// DDL は一度だけ読み込んで文へ分割する（テストごとの I/O を避ける）。
// drizzle-kit export は文を空行区切りで出力するため、`;` を終端に文単位へ割る。
const SCHEMA_STATEMENTS: string[] = readFileSync(SCHEMA_SQL_PATH, "utf8")
  .split(/;\s*(?:\r?\n|$)/)
  .map((s) => s.trim())
  .filter((s) => s.length > 0 && !s.startsWith("--"));

// DDL 内の全テーブル名（DROP TABLE IF EXISTS で再適用を可能にするため）。
const SCHEMA_TABLE_NAMES: string[] = SCHEMA_STATEMENTS.flatMap((stmt) => {
  const m = stmt.match(/^CREATE TABLE `([^`]+)`/i);
  return m ? [m[1]] : [];
});

/**
 * 指定 URL の libSQL DB に現行スキーマの DDL を適用して返す。
 * 既存テーブルは先に DROP するため、共有メモリ URL（file::memory:?cache=shared）を
 * 使い回すテスト（createDb() を内部で呼ぶローダーの検証など）でもテスト間でクリーンに
 * 貼り直せる。`:memory:` の場合は DROP は no-op。
 */
export async function createTestDbAt(url: string): Promise<TestDb> {
  const client = createClient({ url });
  for (const table of SCHEMA_TABLE_NAMES) {
    await client.execute(`DROP TABLE IF EXISTS \`${table}\``);
  }
  for (const stmt of SCHEMA_STATEMENTS) {
    await client.execute(stmt);
  }
  return drizzle(client, { schema });
}

/**
 * まっさらな in-memory libSQL DB を作成し、現行スキーマの DDL を適用して返す。
 * `:memory:` は接続ごとに独立するため、テストごとに呼べば状態は隔離される。
 *
 * ※ 検証対象が `db.transaction()` を使う場合は createTransactionalTestDb() を使うこと
 *   （理由はそちらのコメント参照）。
 */
export async function createTestDb(): Promise<TestDb> {
  return createTestDbAt(":memory:");
}

/**
 * 同一プロセス内で共有される in-memory DB の URL。
 * createDb() を内部で呼ぶコード（別クライアントから同じ DB を見る必要がある）と、
 * トランザクションを使うコードの検証で使う。
 */
export const SHARED_MEMORY_URL = "file::memory:?cache=shared";

/**
 * `db.transaction()` を含むコードの検証用 DB。
 *
 * @libsql/client のローカル実装は transaction() を開始した時点でクライアントの接続を手放し、
 * 次のクエリで**新しい接続を遅延生成する**。素の `:memory:` は接続ごとに別の DB なので、
 * トランザクションを 1 回通すと以降のクエリが「no such table」になる（＝テーブルどころか
 * データごと消えたように見える）。shared cache の in-memory DB なら同一プロセス内の
 * 全接続が同じ DB を指すため、本番と同じ挙動で検証できる。
 *
 * 同一 URL を共有するので、DDL を貼り直す createTestDbAt() 経由でテストごとに初期化する
 * （Vitest はテストファイルごとに別プロセス・ファイル内は直列実行なので衝突しない）。
 */
export async function createTransactionalTestDb(): Promise<TestDb> {
  return createTestDbAt(SHARED_MEMORY_URL);
}

/** N日前（小数可）の Date。時系列データのシード用 */
export function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

type UserRow = typeof schema.users.$inferInsert;

/**
 * users を 1 件挿入して返す。必須列（discordId / slug）は未指定なら一意な値を自動生成する。
 * profileVisibility は既定 "public"。テスト側は必要な列だけ上書きすればよい。
 */
export async function seedUser(
  db: TestDb,
  overrides: Partial<UserRow> = {},
): Promise<typeof schema.users.$inferSelect> {
  const id = overrides.id ?? createId();
  const suffix = id.slice(0, 8);
  const values: UserRow = {
    id,
    discordId: overrides.discordId ?? `discord-${suffix}`,
    slug: overrides.slug ?? `user-${suffix}`,
    ...overrides,
  };
  const [row] = await db.insert(schema.users).values(values).returning();
  return row;
}

type GuideRow = typeof schema.guides.$inferInsert;

/** guides を 1 件挿入して返す。authorId は必須（seedUser の戻り値の id を渡す）。 */
export async function seedGuide(
  db: TestDb,
  authorId: string,
  overrides: Partial<GuideRow> = {},
): Promise<typeof schema.guides.$inferSelect> {
  const id = overrides.id ?? createId();
  const suffix = id.slice(0, 8);
  const values: GuideRow = {
    id,
    authorId,
    slug: overrides.slug ?? `guide-${suffix}`,
    title: overrides.title ?? `Guide ${suffix}`,
    content: overrides.content ?? "<p>body</p>",
    isPublished: overrides.isPublished ?? true,
    ...overrides,
  };
  const [row] = await db.insert(schema.guides).values(values).returning();
  return row;
}

type SearchCraftTemplateRow = typeof schema.searchCraftTemplates.$inferInsert;

/**
 * search_craft_templates を 1 件挿入して返す。userId は必須（seedUser の戻り値の id）。
 * craftsData の既定は "[]"（公開一覧が json_array_length を実行するため、必ず有効なJSON配列にする）。
 */
export async function seedSearchCraftTemplate(
  db: TestDb,
  userId: string,
  overrides: Partial<SearchCraftTemplateRow> = {},
): Promise<typeof schema.searchCraftTemplates.$inferSelect> {
  const id = overrides.id ?? createId();
  const suffix = id.slice(0, 8);
  const values: SearchCraftTemplateRow = {
    id,
    userId,
    title: overrides.title ?? `Template ${suffix}`,
    craftsData: overrides.craftsData ?? "[]",
    isPublished: overrides.isPublished ?? true,
    ...overrides,
  };
  const [row] = await db.insert(schema.searchCraftTemplates).values(values).returning();
  return row;
}

/**
 * guide_likes を 1 件挿入する（いいね済み状態を用意するショートカット）。
 * createdAt を渡すと「いつ付いたいいねか」を指定できる。
 */
export async function seedGuideLike(
  db: TestDb,
  userId: string,
  guideId: string,
  createdAt?: Date,
): Promise<void> {
  await db.insert(schema.guideLikes).values({ userId, guideId, ...(createdAt && { createdAt }) });
}

/** search_craft_template_likes を 1 件挿入する。 */
export async function seedTemplateLike(
  db: TestDb,
  userId: string,
  templateId: string,
): Promise<void> {
  await db.insert(schema.searchCraftTemplateLikes).values({ userId, templateId });
}

type PageViewStatRow = typeof schema.pageViewStats.$inferInsert;

/**
 * page_view_stats を 1 件挿入して返す（「人気順」のシード）。
 * 集計窓（windowStart / windowEnd / fetchedAt）は cron 直後を模した既定値を入れるので、
 * テスト側は対象と PV 数だけ渡せばよい。
 */
export async function seedPageViewStat(
  db: TestDb,
  targetType: "profile" | "guide",
  targetId: string,
  pageviews: number,
  overrides: Partial<PageViewStatRow> = {},
): Promise<typeof schema.pageViewStats.$inferSelect> {
  const now = new Date();
  const values: PageViewStatRow = {
    targetType,
    targetId,
    pageviews,
    windowStart: daysAgo(7),
    windowEnd: now,
    fetchedAt: now,
    ...overrides,
  };
  const [row] = await db.insert(schema.pageViewStats).values(values).returning();
  return row;
}

type PaceRow = typeof schema.pacemanPaces.$inferInsert;

/**
 * paceman_paces を 1 件挿入して返す。フィード対象になり得る既定値
 * （isNetherEnter=false・date=現在＝保持期間内）を入れるので、テスト側は
 * mcid / rta / timeline など必要な列だけ上書きすればよい。
 */
export async function seedPace(
  db: TestDb,
  overrides: Partial<PaceRow> = {},
): Promise<typeof schema.pacemanPaces.$inferSelect> {
  const values: PaceRow = {
    pacemanRunId: overrides.pacemanRunId ?? Math.floor(Math.random() * 1_000_000),
    mcid: overrides.mcid ?? "Runner",
    timeline: overrides.timeline ?? "Obtain Blaze Rods",
    rta: overrides.rta ?? 300_000,
    date: overrides.date ?? new Date(),
    ...overrides,
  };
  const [row] = await db.insert(schema.pacemanPaces).values(values).returning();
  return row;
}

type ConfigPresetRow = typeof schema.configPresets.$inferInsert;

/** config_presets を 1 件挿入して返す。userId は必須（seedUser の id）。 */
export async function seedConfigPreset(
  db: TestDb,
  userId: string,
  overrides: Partial<ConfigPresetRow> = {},
): Promise<typeof schema.configPresets.$inferSelect> {
  const values: ConfigPresetRow = {
    userId,
    name: overrides.name ?? "Main",
    ...overrides,
  };
  const [row] = await db.insert(schema.configPresets).values(values).returning();
  return row;
}

type KeybindingRow = typeof schema.keybindings.$inferInsert;

/** keybindings（ライブテーブル）を 1 件挿入して返す。userId は必須。 */
export async function seedKeybinding(
  db: TestDb,
  userId: string,
  overrides: Partial<KeybindingRow> = {},
): Promise<typeof schema.keybindings.$inferSelect> {
  const values: KeybindingRow = {
    userId,
    action: overrides.action ?? "attack",
    keyCode: overrides.keyCode ?? "mouse_left",
    category: overrides.category ?? "combat",
    ...overrides,
  };
  const [row] = await db.insert(schema.keybindings).values(values).returning();
  return row;
}

type SpeedrunCategoryRow = typeof schema.speedrunCategories.$inferInsert;

/** speedrun_categories を 1 件挿入して返す。 */
export async function seedSpeedrunCategory(
  db: TestDb,
  overrides: Partial<SpeedrunCategoryRow> = {},
): Promise<typeof schema.speedrunCategories.$inferSelect> {
  const slug = overrides.slug ?? `cat-${createId().slice(0, 8)}`;
  const values: SpeedrunCategoryRow = {
    name: overrides.name ?? slug,
    slug,
    categoryType: overrides.categoryType ?? "speedruncom",
    ...overrides,
  };
  const [row] = await db.insert(schema.speedrunCategories).values(values).returning();
  return row;
}

type PlayerRankingRow = typeof schema.playerRankings.$inferInsert;

/** player_rankings を 1 件挿入して返す。userId は必須。 */
export async function seedPlayerRanking(
  db: TestDb,
  userId: string,
  overrides: Partial<PlayerRankingRow> = {},
): Promise<typeof schema.playerRankings.$inferSelect> {
  const values: PlayerRankingRow = {
    userId,
    rankingType: overrides.rankingType ?? "speedruncom",
    ...overrides,
  };
  const [row] = await db.insert(schema.playerRankings).values(values).returning();
  return row;
}

type CategoryRecordRow = typeof schema.categoryRecords.$inferInsert;

/** category_records を 1 件挿入して返す。userId は必須。 */
export async function seedCategoryRecord(
  db: TestDb,
  userId: string,
  overrides: Partial<CategoryRecordRow> = {},
): Promise<typeof schema.categoryRecords.$inferSelect> {
  const values: CategoryRecordRow = {
    userId,
    category: overrides.category ?? "any_glitchless",
    categoryDisplayName: overrides.categoryDisplayName ?? "Any% Glitchless",
    recordType: overrides.recordType ?? "speedruncom",
    ...overrides,
  };
  const [row] = await db.insert(schema.categoryRecords).values(values).returning();
  return row;
}

export { schema };
