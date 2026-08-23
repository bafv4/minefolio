// slug_history（旧slug→現ユーザーの履歴）を管理する slug-history.server.ts の回帰テスト。
// 実DB（in-memory libSQL）で upsert・クレームクリーンアップ・可視性フィルタ・cascade を検証する。
// db.transaction を使わない純粋な CRUD のみなので createTestDb()（素の :memory:）でよい
// （app/lib/__tests__/likes.server.test.ts と同じ方針。db.transaction を使う検証が必要な場合のみ
// createTransactionalTestDb() を使う）。
import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedUser, schema, type TestDb } from "./helpers/test-db";
import { recordSlugChange, claimSlug, resolveSlugFromHistory } from "../slug-history.server";

let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
});

async function findHistoryBySlug(slug: string) {
  return db.query.slugHistory.findFirst({ where: eq(schema.slugHistory.slug, slug) });
}

async function countHistoryRows(): Promise<number> {
  return (await db.query.slugHistory.findMany()).length;
}

describe("recordSlugChange", () => {
  it("旧slugが小文字化されて記録される", async () => {
    const user = await seedUser(db, { slug: "NewName" });

    await recordSlugChange(db, { userId: user.id, oldSlug: "OldName", newSlug: "NewName" });

    const row = await findHistoryBySlug("oldname");
    expect(row).toMatchObject({ slug: "oldname", userId: user.id });
  });

  it("同じ旧slugへの再記録（upsert）でuserIdが最新の元所有者へ上書きされる", async () => {
    const userA = await seedUser(db, { slug: "current-a" });
    const userB = await seedUser(db, { slug: "current-b" });

    // userA が一度 "shared" を手放す
    await recordSlugChange(db, { userId: userA.id, oldSlug: "shared", newSlug: "current-a" });
    // 別の機会に userB も "shared" を手放す（同じ旧slugの再利用）
    await recordSlugChange(db, { userId: userB.id, oldSlug: "shared", newSlug: "current-b" });

    const row = await findHistoryBySlug("shared");
    expect(row?.userId).toBe(userB.id);
    // upsertなので行が積み増されない
    expect(await countHistoryRows()).toBe(1);
  });

  it("大文字小文字だけの変更（Foo→foo）は記録しない", async () => {
    const user = await seedUser(db, { slug: "foo" });

    await recordSlugChange(db, { userId: user.id, oldSlug: "Foo", newSlug: "foo" });

    expect(await countHistoryRows()).toBe(0);
  });

  it("newSlugに一致する既存の履歴行が削除される（クレームクリーンアップ）", async () => {
    const original = await seedUser(db, { slug: "used-once" });
    // "abandoned" を手放した履歴を用意
    await recordSlugChange(db, { userId: original.id, oldSlug: "abandoned", newSlug: "used-once" });
    expect(await findHistoryBySlug("abandoned")).toBeDefined();

    // 別ユーザーが新slugとして "abandoned" をクレームする
    const claimer = await seedUser(db, { slug: "abandoned" });
    await recordSlugChange(db, { userId: claimer.id, oldSlug: "temp2", newSlug: "abandoned" });

    // 新slugにクレームされたので古い対応付けは削除される
    expect(await findHistoryBySlug("abandoned")).toBeUndefined();
    // 一方 claimer が手放した "temp2" は新規に記録される
    const temp2Row = await findHistoryBySlug("temp2");
    expect(temp2Row?.userId).toBe(claimer.id);
  });
});

describe("claimSlug", () => {
  it("該当slugの履歴行が削除される", async () => {
    const user = await seedUser(db, { slug: "current" });
    await recordSlugChange(db, { userId: user.id, oldSlug: "OldSlug", newSlug: "current" });
    expect(await findHistoryBySlug("oldslug")).toBeDefined();

    await claimSlug(db, "OldSlug");

    expect(await findHistoryBySlug("oldslug")).toBeUndefined();
  });

  it("該当する履歴行がなくてもエラーにならない", async () => {
    await expect(claimSlug(db, "never-existed")).resolves.toBeUndefined();
  });
});

describe("resolveSlugFromHistory", () => {
  it("参照先ユーザーが public なら現在の slug を返す", async () => {
    const user = await seedUser(db, { slug: "current-public", profileVisibility: "public" });
    await recordSlugChange(db, { userId: user.id, oldSlug: "old-public", newSlug: "current-public" });

    const result = await resolveSlugFromHistory(db, "old-public");

    expect(result).toBe("current-public");
  });

  it("参照先ユーザーが unlisted なら現在の slug を返す", async () => {
    const user = await seedUser(db, { slug: "current-unlisted", profileVisibility: "unlisted" });
    await recordSlugChange(db, { userId: user.id, oldSlug: "old-unlisted", newSlug: "current-unlisted" });

    const result = await resolveSlugFromHistory(db, "old-unlisted");

    expect(result).toBe("current-unlisted");
  });

  it("参照先ユーザーが private なら null を返す（存在を漏らさない）", async () => {
    const user = await seedUser(db, { slug: "current-private", profileVisibility: "private" });
    await recordSlugChange(db, { userId: user.id, oldSlug: "old-private", newSlug: "current-private" });

    const result = await resolveSlugFromHistory(db, "old-private");

    expect(result).toBeNull();
  });

  it("該当する履歴がなければ null を返す", async () => {
    const result = await resolveSlugFromHistory(db, "never-existed");

    expect(result).toBeNull();
  });

  it("requestedSlug の大文字小文字が違ってもヒットする", async () => {
    const user = await seedUser(db, { slug: "current-mixed", profileVisibility: "public" });
    await recordSlugChange(db, { userId: user.id, oldSlug: "OldMixedCase", newSlug: "current-mixed" });

    const result = await resolveSlugFromHistory(db, "OLDMIXEDCASE");

    expect(result).toBe("current-mixed");
  });

  it("自己参照ループ（履歴のslugが参照先の現slugと同一）の場合は null を返す", async () => {
    const user = await seedUser(db, { slug: "LoopSlug", profileVisibility: "public" });
    // 理論上起きないはずの状態（履歴が自分自身の現slugを指す）を直接仕込む
    await db.insert(schema.slugHistory).values({ slug: "loopslug", userId: user.id });

    const result = await resolveSlugFromHistory(db, "loopslug");

    expect(result).toBeNull();
  });
});

describe("cascade（設計の前提: libSQL は外部キーを既定で有効にする）", () => {
  it("ユーザーを削除すると slug_history も消える", async () => {
    const user = await seedUser(db, { slug: "current-cascade" });
    await recordSlugChange(db, { userId: user.id, oldSlug: "old-cascade", newSlug: "current-cascade" });
    expect(await findHistoryBySlug("old-cascade")).toBeDefined();

    await db.delete(schema.users).where(eq(schema.users.id, user.id));

    expect(await findHistoryBySlug("old-cascade")).toBeUndefined();
  });
});
