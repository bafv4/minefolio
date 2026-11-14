import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDbAt, seedUser, schema, SHARED_MEMORY_URL, type TestDb } from "./helpers/test-db";
import {
  updateUserRankings,
  upsertEloSnapshot,
  cleanupOldEloSnapshots,
  toUtcDateString,
} from "../rankings-update.server";

let db: TestDb;

beforeEach(async () => {
  db = await createTestDbAt(SHARED_MEMORY_URL);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubRanked(eloRate: number | null, bestTime?: number) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        status: "success",
        data: { uuid: "u", nickname: "n", eloRate, eloRank: 1, statistics: { season: bestTime ? { bestTime: { ranked: bestTime } } : {} } },
      }),
    }))
  );
}

async function snapshotsOf(userId: string) {
  return db.query.rankedEloSnapshots.findMany({ where: eq(schema.rankedEloSnapshots.userId, userId) });
}

describe("Ranked レート日次スナップショット", () => {
  it("同日に2回記録しても1行で、レートは後の値になる", async () => {
    const user = await seedUser(db, { slug: "snap1", mcid: "snap1", uuid: "uuid-snap1" });
    const day = new Date("2026-11-10T01:00:00Z");
    await upsertEloSnapshot(db, user.id, 1500, day);
    await upsertEloSnapshot(db, user.id, 1550, new Date("2026-11-10T13:00:00Z"));

    const rows = await snapshotsOf(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ snapshotDate: "2026-11-10", eloRate: 1550 });
  });

  it("日付が変われば別行になり、日付は UTC で決まる", async () => {
    const user = await seedUser(db, { slug: "snap2", mcid: "snap2", uuid: "uuid-snap2" });
    // JST では 11/11 だが UTC では 11/10
    expect(toUtcDateString(new Date("2026-11-10T20:00:00Z"))).toBe("2026-11-10");
    await upsertEloSnapshot(db, user.id, 1500, new Date("2026-11-10T20:00:00Z"));
    await upsertEloSnapshot(db, user.id, 1510, new Date("2026-11-11T00:00:00Z"));
    expect((await snapshotsOf(user.id)).map((r) => r.snapshotDate).sort()).toEqual([
      "2026-11-10",
      "2026-11-11",
    ]);
  });

  it("30日を超えた古い行だけ削除される（ちょうど30日前の日付は残る）", async () => {
    const user = await seedUser(db, { slug: "snap3", mcid: "snap3", uuid: "uuid-snap3" });
    const now = new Date("2026-11-14T00:00:00Z");
    await db.insert(schema.rankedEloSnapshots).values([
      { userId: user.id, snapshotDate: "2026-10-14", eloRate: 1000 }, // 31日前 → 削除
      { userId: user.id, snapshotDate: "2026-10-15", eloRate: 1001 }, // 30日前 → 残る
      { userId: user.id, snapshotDate: "2026-11-14", eloRate: 1002 },
    ]);

    const removed = await cleanupOldEloSnapshots(db, now);
    expect(removed).toBe(1);
    expect((await snapshotsOf(user.id)).map((r) => r.snapshotDate).sort()).toEqual([
      "2026-10-15",
      "2026-11-14",
    ]);
  });

  it("updateUserRankings はレート取得時にスナップショットを記録し、同日の再実行で1行のまま更新する", async () => {
    const user = await seedUser(db, { slug: "snap4", mcid: "snap4", uuid: "uuid-snap4" });
    const input = { id: user.id, mcid: "snap4", uuid: "uuid-snap4", speedruncomId: null, speedruncomUsername: null };

    stubRanked(1600);
    await updateUserRankings(db, [], input);
    stubRanked(1650);
    await updateUserRankings(db, [], input);

    const rows = await snapshotsOf(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].eloRate).toBe(1650);
    expect(rows[0].snapshotDate).toBe(toUtcDateString(new Date()));
  });

  it("レートが取れない（null）・未登録（uuid なし）のユーザーは書かない", async () => {
    const user = await seedUser(db, { slug: "snap5", mcid: "snap5", uuid: "uuid-snap5" });
    stubRanked(null);
    await updateUserRankings(db, [], {
      id: user.id, mcid: "snap5", uuid: "uuid-snap5", speedruncomId: null, speedruncomUsername: null,
    });
    await updateUserRankings(db, [], {
      id: user.id, mcid: "snap5", uuid: null, speedruncomId: null, speedruncomUsername: null,
    });
    expect(await snapshotsOf(user.id)).toHaveLength(0);
  });
});

describe("ranked_pb の recordDate", () => {
  const today = () => toUtcDateString(new Date());
  async function pbRow(userId: string) {
    return db.query.playerRankings.findFirst({
      where: (r, { and, eq }) => and(eq(r.userId, userId), eq(r.rankingType, "ranked_pb")),
    });
  }
  const input = (id: string, slug: string) => ({
    id, mcid: slug, uuid: `uuid-${slug}`, speedruncomId: null, speedruncomUsername: null,
  });

  it("初回挿入では recordDate を null にする（全員が PB 更新扱いにならない）", async () => {
    const user = await seedUser(db, { slug: "pb1", mcid: "pb1", uuid: "uuid-pb1" });
    stubRanked(1500, 600000);
    await updateUserRankings(db, [], input(user.id, "pb1"));
    const row = await pbRow(user.id);
    expect(row?.timeMs).toBe(600000);
    expect(row?.recordDate).toBeNull();
  });

  it("PB が速くなったときだけ当日（UTC）の recordDate が入る", async () => {
    const user = await seedUser(db, { slug: "pb2", mcid: "pb2", uuid: "uuid-pb2" });
    stubRanked(1500, 600000);
    await updateUserRankings(db, [], input(user.id, "pb2"));
    stubRanked(1500, 590000);
    await updateUserRankings(db, [], input(user.id, "pb2"));
    const row = await pbRow(user.id);
    expect(row?.timeMs).toBe(590000);
    expect(row?.recordDate).toBe(today());
  });

  it("PB が変わらない・遅くなる更新では既存の recordDate を書き換えない", async () => {
    const user = await seedUser(db, { slug: "pb3", mcid: "pb3", uuid: "uuid-pb3" });
    await db.insert(schema.playerRankings).values({
      userId: user.id, rankingType: "ranked_pb", timeMs: 600000, timeFormatted: "10:00.000",
      recordDate: "2026-01-02",
    });
    stubRanked(1500, 600000);
    await updateUserRankings(db, [], input(user.id, "pb3"));
    expect((await pbRow(user.id))?.recordDate).toBe("2026-01-02");
    stubRanked(1500, 650000);
    await updateUserRankings(db, [], input(user.id, "pb3"));
    expect((await pbRow(user.id))?.recordDate).toBe("2026-01-02");
  });
});
