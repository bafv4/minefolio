// ホームの見本ペース・記録ペース総数（app/lib/home-pace-sample.server.ts）の user_id 結合テスト。
//
// 以前は lower(users.mcid) = lower(paceman_paces.mcid) で結合していた（インデックスが効かない）。
// user_id 結合へ置き換えても、cron の再リンク（relinkPacemanPaceUsers）後は同じ結果になることを、
// 旧結合のクエリを参照実装としてテスト内に持って突き合わせる。
// relinkPacemanPaceUsers は内部で createDb() を呼ぶため共有メモリ DB を使う。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import { createTestDbAt, seedUser, seedPace, schema, SHARED_MEMORY_URL, type TestDb } from "./helpers/test-db";

// 結果キャッシュはテスト間で持ち越さない
vi.mock("../cache", () => ({
  getCached: vi.fn(async () => null),
  setCached: vi.fn(async () => undefined),
}));

import { getHomeSamplePace, countHomeRecordedPaces } from "../home-pace-sample.server";
import { relinkPacemanPaceUsers, getPaceRetentionStart } from "../paceman-cache";
import { excludeViewersCondition } from "../users-filter";

let db: TestDb;
let originalUrl: string | undefined;

beforeEach(async () => {
  originalUrl = process.env.TURSO_DATABASE_URL;
  process.env.TURSO_DATABASE_URL = SHARED_MEMORY_URL;
  db = await createTestDbAt(SHARED_MEMORY_URL);
});

afterEach(() => {
  if (originalUrl === undefined) delete process.env.TURSO_DATABASE_URL;
  else process.env.TURSO_DATABASE_URL = originalUrl;
});

/** 旧実装（lower(mcid) 結合）の件数。参照実装 */
async function legacyCount(): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(distinct ${schema.pacemanPaces.pacemanRunId})` })
    .from(schema.pacemanPaces)
    .innerJoin(schema.users, sql`lower(${schema.users.mcid}) = lower(${schema.pacemanPaces.mcid})`)
    .where(
      and(
        eq(schema.pacemanPaces.isNetherEnter, false),
        gte(schema.pacemanPaces.date, getPaceRetentionStart()),
        eq(schema.users.profileVisibility, "public"),
        excludeViewersCondition,
        isNotNull(schema.users.uuid),
      ),
    );
  return Number(row?.total ?? 0);
}

async function publicUser(mcid: string | null, overrides: Partial<typeof schema.users.$inferInsert> = {}) {
  return seedUser(db, { mcid, uuid: `uuid-${mcid ?? Math.random()}`, profileVisibility: "public", ...overrides });
}

describe("relinkPacemanPaceUsers + user_id 結合", () => {
  it("後から MCID を登録したユーザーの user_id=null 行は、再リンク後にホームの件数へ入る（旧結合と一致）", async () => {
    await seedPace(db, { pacemanRunId: 1, mcid: "LateBird", userId: null });
    expect(await countHomeRecordedPaces(db)).toBe(0); // cron 未実行の窓: 一時的に漏れる

    await publicUser("LateBird");
    expect(await countHomeRecordedPaces(db)).toBe(0);

    await relinkPacemanPaceUsers();
    expect(await countHomeRecordedPaces(db)).toBe(1);
    expect(await legacyCount()).toBe(1);
    expect((await getHomeSamplePace(db))?.run.pacemanRunId).toBe(1);
  });

  it("大文字小文字違いの MCID も紐づく", async () => {
    await publicUser("runner");
    await seedPace(db, { pacemanRunId: 2, mcid: "RUNNER", userId: null });

    await relinkPacemanPaceUsers();
    expect(await countHomeRecordedPaces(db)).toBe(1);
    expect(await legacyCount()).toBe(1);
  });

  it("MCID を変更したユーザーの旧 MCID 行は再リンクで外れ、新 MCID 行だけが残る（旧結合と一致）", async () => {
    const user = await publicUser("OldName");
    await seedPace(db, { pacemanRunId: 3, mcid: "OldName", userId: user.id });
    await seedPace(db, { pacemanRunId: 4, mcid: "NewName", userId: null });
    await db.update(schema.users).set({ mcid: "NewName" }).where(eq(schema.users.id, user.id));

    await relinkPacemanPaceUsers();

    const rows = await db.query.pacemanPaces.findMany();
    const byRun = Object.fromEntries(rows.map((r) => [r.pacemanRunId, r.userId]));
    expect(byRun[3]).toBeNull();
    expect(byRun[4]).toBe(user.id);
    expect(await countHomeRecordedPaces(db)).toBe(1);
    expect(await legacyCount()).toBe(1);
    expect((await getHomeSamplePace(db))?.run.pacemanRunId).toBe(4);
  });

  it("MCID を解除したユーザーの行は紐づかなくなる", async () => {
    const user = await publicUser("Gone");
    await seedPace(db, { pacemanRunId: 5, mcid: "Gone", userId: user.id });
    await db.update(schema.users).set({ mcid: null }).where(eq(schema.users.id, user.id));

    await relinkPacemanPaceUsers();
    expect(await countHomeRecordedPaces(db)).toBe(0);
    expect(await legacyCount()).toBe(0);
  });

  it("非公開ユーザーと視聴者ロールは再リンクされても結合側で除外される", async () => {
    await publicUser("Hidden", { profileVisibility: "private" });
    await publicUser("Watcher", { role: "viewer" });
    await publicUser("Shown");
    await seedPace(db, { pacemanRunId: 6, mcid: "Hidden", userId: null });
    await seedPace(db, { pacemanRunId: 7, mcid: "Watcher", userId: null });
    await seedPace(db, { pacemanRunId: 8, mcid: "Shown", userId: null });

    await relinkPacemanPaceUsers();

    // user_id 自体は非公開・視聴者にも付く（INSERT 時と同じ条件）が、表示判定は結合側
    const hidden = await db.query.pacemanPaces.findFirst({ where: eq(schema.pacemanPaces.pacemanRunId, 6) });
    expect(hidden?.userId).not.toBeNull();
    expect(await countHomeRecordedPaces(db)).toBe(1);
    expect(await legacyCount()).toBe(1);
    expect((await getHomeSamplePace(db))?.run.pacemanRunId).toBe(8);
  });

  it("未登録 MCID の行は null のまま、保持期間外の行は触らない", async () => {
    await publicUser("Known");
    const old = new Date(getPaceRetentionStart().getTime() - 24 * 60 * 60 * 1000);
    await seedPace(db, { pacemanRunId: 9, mcid: "Stranger", userId: null });
    await seedPace(db, { pacemanRunId: 10, mcid: "Known", userId: null, date: old });

    const changed = await relinkPacemanPaceUsers();
    expect(changed).toBe(0);
    const rows = await db.query.pacemanPaces.findMany();
    expect(rows.every((r) => r.userId === null)).toBe(true);
  });

  it("再リンクは冪等（2回目は変更0件）", async () => {
    await publicUser("Twice");
    await seedPace(db, { pacemanRunId: 11, mcid: "Twice", userId: null });
    expect(await relinkPacemanPaceUsers()).toBe(1);
    expect(await relinkPacemanPaceUsers()).toBe(0);
  });
});
