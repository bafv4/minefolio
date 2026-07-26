// ガイド一覧の並び順（特に「おすすめ順」）の検証。
//
// おすすめ順は「直近のいいね数」を主軸にするため、created_at の比較が正しく効くことが要。
// created_at は integer(mode:"timestamp") ＝ 秒で格納されるので、ミリ秒のまま比較すると
// 条件が常に偽になり、**エラーにならないまま人気順へ退化する**。実 DB で順序そのものを
// 確認してこれを防ぐ。
import { describe, it, expect } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  createTestDb,
  seedUser,
  seedGuide,
  seedGuideLike,
  seedSearchCraftTemplate,
  seedTemplateLike,
  daysAgo,
  schema,
} from "./helpers/test-db";
import {
  guideLikeCountSql,
  templateLikeCountSql,
  guideListOrderBy,
  recentLikeCutoff,
  recentGuideLikeCountSql,
  RECENT_LIKE_WINDOW_DAYS,
} from "../likes.server";
import type { ContentSort } from "../content-sort";

type Db = Awaited<ReturnType<typeof createTestDb>>;

/** 一覧ローダーと同じ条件・同じ並び順でスラッグを取り出す */
async function listSlugs(db: Db, sort: ContentSort): Promise<string[]> {
  const rows = await db
    .select({ slug: schema.guides.slug })
    .from(schema.guides)
    .innerJoin(schema.users, eq(schema.guides.authorId, schema.users.id))
    .where(
      and(
        eq(schema.guides.isPublished, true),
        eq(schema.users.profileVisibility, "public"),
      ),
    )
    .orderBy(...guideListOrderBy(sort));
  return rows.map((r) => r.slug);
}

/** いいねを付ける人を必要な数だけ用意する（1ユーザー1いいねの制約があるため） */
async function seedLikers(db: Db, count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const user = await seedUser(db);
    ids.push(user.id);
  }
  return ids;
}

// 相関サブクエリの列参照が修飾されていないと、内側のテーブルの同名列
// （guide_likes.id など）に解決されて **常に 0 件** になる。SQL エラーにならず
// 「いいね 0」と表示されるだけなので、クエリの形ごとに実値で確認する。
describe("いいね数の相関サブクエリ（クエリの形に依存しない）", () => {
  it("join ありの select で数えられる（一覧ページの形）", async () => {
    const db = await createTestDb();
    const author = await seedUser(db);
    const guide = await seedGuide(db, author.id, { slug: "g" });
    for (const liker of await seedLikers(db, 3)) {
      await seedGuideLike(db, liker, guide.id);
    }

    const rows = await db
      .select({ likeCount: guideLikeCountSql() })
      .from(schema.guides)
      .innerJoin(schema.users, eq(schema.guides.authorId, schema.users.id));

    expect(Number(rows[0].likeCount)).toBe(3);
  });

  it("RQB の extras で数えられる（著者別一覧・プロフィールのガイドタブの形）", async () => {
    const db = await createTestDb();
    const author = await seedUser(db);
    const guide = await seedGuide(db, author.id, { slug: "g" });
    for (const liker of await seedLikers(db, 3)) {
      await seedGuideLike(db, liker, guide.id);
    }

    const rows = await db.query.guides.findMany({
      where: eq(schema.guides.authorId, author.id),
      columns: { slug: true },
      extras: { likeCount: guideLikeCountSql().as("like_count") },
    });

    expect(Number(rows[0].likeCount)).toBe(3);
  });

  it("テンプレートも同様に数えられる", async () => {
    const db = await createTestDb();
    const owner = await seedUser(db);
    const template = await seedSearchCraftTemplate(db, owner.id);
    for (const liker of await seedLikers(db, 2)) {
      await seedTemplateLike(db, liker, template.id);
    }

    const joined = await db
      .select({ likeCount: templateLikeCountSql() })
      .from(schema.searchCraftTemplates)
      .innerJoin(schema.users, eq(schema.searchCraftTemplates.userId, schema.users.id));
    const rqb = await db.query.searchCraftTemplates.findMany({
      columns: { id: true },
      extras: { likeCount: templateLikeCountSql().as("like_count") },
    });

    expect(Number(joined[0].likeCount)).toBe(2);
    expect(Number(rqb[0].likeCount)).toBe(2);
  });
});

describe("recentGuideLikeCountSql", () => {
  it("期間内のいいねだけを数える（秒/ミリ秒の取り違えがあれば 0 になる）", async () => {
    const db = await createTestDb();
    const author = await seedUser(db);
    const guide = await seedGuide(db, author.id, { slug: "g" });
    const likers = await seedLikers(db, 3);

    await seedGuideLike(db, likers[0], guide.id, daysAgo(1));
    await seedGuideLike(db, likers[1], guide.id, daysAgo(RECENT_LIKE_WINDOW_DAYS - 1));
    // 期間外
    await seedGuideLike(db, likers[2], guide.id, daysAgo(RECENT_LIKE_WINDOW_DAYS + 1));

    const [row] = await db
      .select({ recent: recentGuideLikeCountSql(recentLikeCutoff()) })
      .from(schema.guides)
      .where(eq(schema.guides.id, guide.id));

    expect(Number(row.recent)).toBe(2);
  });

  it("いいねが無ければ 0 を返す", async () => {
    const db = await createTestDb();
    const author = await seedUser(db);
    const guide = await seedGuide(db, author.id, { slug: "g" });

    const [row] = await db
      .select({ recent: recentGuideLikeCountSql(recentLikeCutoff()) })
      .from(schema.guides)
      .where(eq(schema.guides.id, guide.id));

    expect(Number(row.recent)).toBe(0);
  });
});

describe("guideListOrderBy（おすすめ順）", () => {
  it("直近のいいねが多い順に並ぶ（総いいね数が少なくても上に来る）", async () => {
    const db = await createTestDb();
    const author = await seedUser(db);
    const old = await seedGuide(db, author.id, { slug: "old-hit", updatedAt: daysAgo(100) });
    const trending = await seedGuide(db, author.id, { slug: "trending", updatedAt: daysAgo(100) });
    const likers = await seedLikers(db, 7);

    // 昔たくさん伸びた記事（総 5 / 直近 0）
    for (let i = 0; i < 5; i++) {
      await seedGuideLike(db, likers[i], old.id, daysAgo(RECENT_LIKE_WINDOW_DAYS + 10));
    }
    // 最近伸びている記事（総 2 / 直近 2）
    await seedGuideLike(db, likers[5], trending.id, daysAgo(2));
    await seedGuideLike(db, likers[6], trending.id, daysAgo(3));

    expect(await listSlugs(db, "recommended")).toEqual(["trending", "old-hit"]);
    // 人気順は総数で見るので逆になる = 両者が別物であることの確認
    expect(await listSlugs(db, "popular")).toEqual(["old-hit", "trending"]);
  });

  it("直近が同数なら総いいね数で決まる", async () => {
    const db = await createTestDb();
    const author = await seedUser(db);
    const many = await seedGuide(db, author.id, { slug: "many", updatedAt: daysAgo(50) });
    const few = await seedGuide(db, author.id, { slug: "few", updatedAt: daysAgo(50) });
    const likers = await seedLikers(db, 5);

    // 直近はどちらも 1
    await seedGuideLike(db, likers[0], many.id, daysAgo(1));
    await seedGuideLike(db, likers[1], few.id, daysAgo(1));
    // 総数は many が多い
    await seedGuideLike(db, likers[2], many.id, daysAgo(RECENT_LIKE_WINDOW_DAYS + 5));
    await seedGuideLike(db, likers[3], many.id, daysAgo(RECENT_LIKE_WINDOW_DAYS + 6));

    expect(await listSlugs(db, "recommended")).toEqual(["many", "few"]);
  });

  it("いいねが 1 件も無ければ更新順に落ちる（並びが破綻しない）", async () => {
    const db = await createTestDb();
    const author = await seedUser(db);
    await seedGuide(db, author.id, { slug: "older", updatedAt: daysAgo(10) });
    await seedGuide(db, author.id, { slug: "newer", updatedAt: daysAgo(1) });

    expect(await listSlugs(db, "recommended")).toEqual(["newer", "older"]);
    expect(await listSlugs(db, "new")).toEqual(["newer", "older"]);
  });

  it("直近・総数が同じなら更新日時が新しい方が上", async () => {
    const db = await createTestDb();
    const author = await seedUser(db);
    const stale = await seedGuide(db, author.id, { slug: "stale", updatedAt: daysAgo(20) });
    const fresh = await seedGuide(db, author.id, { slug: "fresh", updatedAt: daysAgo(2) });
    const likers = await seedLikers(db, 2);

    await seedGuideLike(db, likers[0], stale.id, daysAgo(1));
    await seedGuideLike(db, likers[1], fresh.id, daysAgo(1));

    expect(await listSlugs(db, "recommended")).toEqual(["fresh", "stale"]);
  });

  it("すべて同値でも順序が安定する（id で全順序になっている）", async () => {
    const db = await createTestDb();
    const author = await seedUser(db);
    const sameTime = daysAgo(5);
    await seedGuide(db, author.id, { id: "aaa", slug: "a", updatedAt: sameTime });
    await seedGuide(db, author.id, { id: "bbb", slug: "b", updatedAt: sameTime });
    await seedGuide(db, author.id, { id: "ccc", slug: "c", updatedAt: sameTime });

    const first = await listSlugs(db, "recommended");
    const second = await listSlugs(db, "recommended");
    expect(first).toEqual(["a", "b", "c"]);
    expect(second).toEqual(first);
  });

  it("期間の境界をまたぐと直近から外れる", async () => {
    const db = await createTestDb();
    const author = await seedUser(db);
    const inside = await seedGuide(db, author.id, { slug: "inside", updatedAt: daysAgo(50) });
    const outside = await seedGuide(db, author.id, { slug: "outside", updatedAt: daysAgo(50) });
    const likers = await seedLikers(db, 2);

    await seedGuideLike(db, likers[0], inside.id, daysAgo(RECENT_LIKE_WINDOW_DAYS - 0.5));
    await seedGuideLike(db, likers[1], outside.id, daysAgo(RECENT_LIKE_WINDOW_DAYS + 0.5));

    // 直近は inside だけ 1、outside は 0。総いいねは同数なので直近が効く
    expect(await listSlugs(db, "recommended")).toEqual(["inside", "outside"]);
  });
});
