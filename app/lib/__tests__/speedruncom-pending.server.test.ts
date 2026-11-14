import { describe, it, expect } from "vitest";
import { loadPendingSpeedrunRecords } from "../speedruncom-pending.server";
import { createTestDb, seedUser, seedSpeedrunCategory, seedPlayerRanking } from "./helpers/test-db";

describe("loadPendingSpeedrunRecords", () => {
  it("審査中（new）のみを速い順に返し、verified / rejected / 他人の行は含めない", async () => {
    const db = await createTestDb();
    const me = await seedUser(db);
    const other = await seedUser(db);
    const cat = await seedSpeedrunCategory(db, { name: "Any% RSG" });
    const cat2 = await seedSpeedrunCategory(db, { name: "Any% SSG" });

    await seedPlayerRanking(db, me.id, {
      categoryId: cat.id, verificationStatus: "new", timeMs: 900_000, timeFormatted: "15:00",
      speedruncomRunId: "runSlow", runWeblink: "https://www.speedrun.com/mc/runs/runSlow",
    });
    await seedPlayerRanking(db, me.id, {
      categoryId: cat2.id, verificationStatus: "new", timeMs: 600_000, timeFormatted: "10:00",
      speedruncomRunId: "runFast",
    });
    await seedPlayerRanking(db, me.id, {
      categoryId: cat.id, verificationStatus: "verified", timeMs: 100_000, speedruncomRunId: "v",
    });
    await seedPlayerRanking(db, me.id, {
      categoryId: cat.id, verificationStatus: "rejected", timeMs: 100_000, speedruncomRunId: "r",
    });
    await seedPlayerRanking(db, other.id, {
      categoryId: cat.id, verificationStatus: "new", timeMs: 100_000, speedruncomRunId: "o",
    });
    await seedPlayerRanking(db, me.id, {
      rankingType: "ranked_pb", verificationStatus: "new", timeMs: 100_000,
    });

    const rows = await loadPendingSpeedrunRecords(db, me.id);
    expect(rows.map((r) => r.runId)).toEqual(["runFast", "runSlow"]);
    expect(rows[0].categoryName).toBe("Any% SSG");
    // weblink 未保存なら runId から組み立てる
    expect(rows[0].runWeblink).toBe("https://www.speedrun.com/run/runFast");
    expect(rows[1].runWeblink).toBe("https://www.speedrun.com/mc/runs/runSlow");
  });

  it("非表示にした run ID は除外する。0件なら空配列", async () => {
    const db = await createTestDb();
    const me = await seedUser(db);
    const cat = await seedSpeedrunCategory(db);
    expect(await loadPendingSpeedrunRecords(db, me.id)).toEqual([]);
    await seedPlayerRanking(db, me.id, {
      categoryId: cat.id, verificationStatus: "new", timeMs: 1000, speedruncomRunId: "hid",
    });
    expect(await loadPendingSpeedrunRecords(db, me.id, new Set(["hid"]))).toEqual([]);
  });
});
