import { describe, it, expect } from "vitest";
import {
  excludeViewersCondition,
  publiclyReferencableCondition,
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
