// 期限切れ認証データ削除（cleanupExpiredAuthRows）の検証。
//
// 守りたい回帰:
// 1. expiresAt < now の auth_sessions / auth_verifications だけを削除し、有効な行は残す
// 2. expiresAt === now ちょうどの行は削除しない（lt は厳密未満。better-auth の
//    updateAge によって延長された現役セッションを誤って巻き込まないことの境界確認）
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, daysAgo, schema, type TestDb } from "./helpers/test-db";
import { cleanupExpiredAuthRows } from "../auth-cleanup.server";

async function seedAuthUser(db: TestDb, id: string) {
  await db.insert(schema.authUsers).values({ id });
}

describe("cleanupExpiredAuthRows", () => {
  it("期限切れの auth_sessions / auth_verifications のみを削除する", async () => {
    const db = await createTestDb();
    await seedAuthUser(db, "au1");

    await db.insert(schema.authSessions).values([
      {
        id: "expired-session",
        token: "token-expired",
        userId: "au1",
        expiresAt: daysAgo(1),
      },
      {
        id: "active-session",
        token: "token-active",
        userId: "au1",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    ]);

    await db.insert(schema.authVerifications).values([
      {
        id: "expired-verification",
        identifier: "expired@example.com",
        value: "expired-value",
        expiresAt: daysAgo(1),
      },
      {
        id: "active-verification",
        identifier: "active@example.com",
        value: "active-value",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    ]);

    const result = await cleanupExpiredAuthRows(db);

    expect(result).toEqual({ deletedSessions: 1, deletedVerifications: 1 });

    const remainingSessions = await db.select().from(schema.authSessions);
    expect(remainingSessions.map((row) => row.id)).toEqual(["active-session"]);

    const remainingVerifications = await db.select().from(schema.authVerifications);
    expect(remainingVerifications.map((row) => row.id)).toEqual(["active-verification"]);
  });

  it("expiresAt が now とちょうど同じ行は削除しない（lt は厳密未満）", async () => {
    const db = await createTestDb();
    await seedAuthUser(db, "au2");

    const now = new Date();
    await db.insert(schema.authSessions).values({
      id: "boundary-session",
      token: "token-boundary",
      userId: "au2",
      expiresAt: now,
    });
    await db.insert(schema.authVerifications).values({
      id: "boundary-verification",
      identifier: "boundary@example.com",
      value: "boundary-value",
      expiresAt: now,
    });

    const result = await cleanupExpiredAuthRows(db, now);

    expect(result).toEqual({ deletedSessions: 0, deletedVerifications: 0 });

    const session = await db.query.authSessions.findFirst({
      where: eq(schema.authSessions.id, "boundary-session"),
    });
    expect(session).toBeDefined();

    const verification = await db.query.authVerifications.findFirst({
      where: eq(schema.authVerifications.id, "boundary-verification"),
    });
    expect(verification).toBeDefined();
  });
});
