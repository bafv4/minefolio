// テストハーネス自体の健全性チェック（スモークテスト）。
// createTestDb がマイグレーションを適用でき、seed ヘルパーとリレーショナルクエリ・
// UNIQUE 制約・可視性列が実 DB として機能することを確認する。
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedUser, seedGuide, schema } from "./test-db";
import { isUniqueConstraintError } from "../../db";

describe("test-db harness", () => {
  it("in-memory DB にマイグレーションを適用して users を読み書きできる", async () => {
    const db = await createTestDb();
    const user = await seedUser(db, { slug: "runner1", displayName: "Runner One" });
    expect(user.slug).toBe("runner1");
    expect(user.profileVisibility).toBe("public"); // 既定値がスキーマ通り効く

    const found = await db.query.users.findFirst({
      where: eq(schema.users.slug, "runner1"),
    });
    expect(found?.displayName).toBe("Runner One");
  });

  it("createTestDb はテストごとに独立した DB を返す（状態を共有しない）", async () => {
    const dbA = await createTestDb();
    await seedUser(dbA, { slug: "only-in-a" });
    const dbB = await createTestDb();
    const inB = await db_count(dbB);
    expect(inB).toBe(0);
  });

  it("リレーション（author → guides）を with で読み込める", async () => {
    const db = await createTestDb();
    const author = await seedUser(db, { slug: "author1" });
    await seedGuide(db, author.id, { slug: "g1", title: "First" });
    await seedGuide(db, author.id, { slug: "g2", title: "Second", isPublished: false });

    const withGuides = await db.query.users.findFirst({
      where: eq(schema.users.id, author.id),
      with: { guides: true },
    });
    expect(withGuides?.guides).toHaveLength(2);
  });

  it("UNIQUE 制約（slug 重複）が実 DB で発火し isUniqueConstraintError で判定できる", async () => {
    const db = await createTestDb();
    await seedUser(db, { slug: "dup" });
    let caught: unknown;
    try {
      await seedUser(db, { slug: "dup" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect(isUniqueConstraintError(caught)).toBe(true);
  });
});

async function db_count(db: Awaited<ReturnType<typeof createTestDb>>): Promise<number> {
  const rows = await db.query.users.findMany();
  return rows.length;
}
