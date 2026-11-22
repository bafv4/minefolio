import { describe, it, expect } from "vitest";
import {
  excludeViewersCondition,
  isRankedStatsVisible,
  listedRunnerCondition,
  publiclyReferencableCondition,
  rankedStatsVisibleCondition,
} from "../users-filter";
import { createTestDb, seedUser } from "./helpers/test-db";

describe("excludeViewersCondition", () => {
  it("viewer ロールのみ除外し、runner / role=null は含む", async () => {
    const db = await createTestDb();
    await seedUser(db, { slug: "runner", role: "runner" });
    await seedUser(db, { slug: "viewer", role: "viewer" });
    await seedUser(db, { slug: "norole", role: null });

    const rows = await db.query.users.findMany({ where: excludeViewersCondition });
    expect(rows.map((r) => r.slug).sort()).toEqual(["norole", "runner"]);
  });
});

describe("publiclyReferencableCondition", () => {
  it("public / unlisted は含み、private のみ除外する（名指し参照可否）", async () => {
    const db = await createTestDb();
    await seedUser(db, { slug: "pub", profileVisibility: "public" });
    await seedUser(db, { slug: "unl", profileVisibility: "unlisted" });
    await seedUser(db, { slug: "prv", profileVisibility: "private" });

    const rows = await db.query.users.findMany({ where: publiclyReferencableCondition });
    expect(rows.map((r) => r.slug).sort()).toEqual(["pub", "unl"]);
  });
});

describe("listedRunnerCondition", () => {
  it("公開プロフィールかつ視聴者以外だけ（unlisted / private / viewer は除く）", async () => {
    const db = await createTestDb();
    await seedUser(db, { slug: "ok", profileVisibility: "public", role: "runner" });
    await seedUser(db, { slug: "norole", profileVisibility: "public", role: null });
    await seedUser(db, { slug: "unl", profileVisibility: "unlisted", role: "runner" });
    await seedUser(db, { slug: "prv", profileVisibility: "private", role: "runner" });
    await seedUser(db, { slug: "vw", profileVisibility: "public", role: "viewer" });

    const rows = await db.query.users.findMany({ where: listedRunnerCondition });
    expect(rows.map((r) => r.slug).sort()).toEqual(["norole", "ok"]);
  });
});

describe("rankedStatsVisibleCondition / isRankedStatsVisible", () => {
  it("false だけを除き、NULL（未設定）と true は含む（SQL 版と JS 版が同じ意味）", async () => {
    const db = await createTestDb();
    await seedUser(db, { slug: "on", showRankedStats: true });
    await seedUser(db, { slug: "unset", showRankedStats: null });
    await seedUser(db, { slug: "off", showRankedStats: false });

    const rows = await db.query.users.findMany({ where: rankedStatsVisibleCondition });
    expect(rows.map((r) => r.slug).sort()).toEqual(["on", "unset"]);

    expect(isRankedStatsVisible({ showRankedStats: true })).toBe(true);
    expect(isRankedStatsVisible({ showRankedStats: null })).toBe(true);
    expect(isRankedStatsVisible({ showRankedStats: undefined })).toBe(true);
    expect(isRankedStatsVisible({ showRankedStats: false })).toBe(false);
  });
});
