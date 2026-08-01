// いいね数の相関サブクエリと、ガイド一覧の並び順の検証。
//
// いいね数はクエリの形（join あり select / RQB）によって内側テーブルの同名列へ
// 解決されてしまう罠があり、**エラーにならないまま常に 0** になる。実 DB で
// 実際の値と順序を確認してこれを防ぐ。
import { describe, it, expect } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  createTestDb,
  seedUser,
  seedGuide,
  seedGuideLike,
  seedPageViewStat,
  seedSearchCraftTemplate,
  seedTemplateLike,
  daysAgo,
  schema,
} from "./helpers/test-db";
import {
  guideLikeCountSql,
  templateLikeCountSql,
  guideListOrderBy,
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

describe("guideListOrderBy", () => {
  it("いいね数順は総いいね数が多い順に並ぶ", async () => {
    const db = await createTestDb();
    const author = await seedUser(db);
    const many = await seedGuide(db, author.id, { slug: "many", updatedAt: daysAgo(100) });
    const few = await seedGuide(db, author.id, { slug: "few", updatedAt: daysAgo(100) });
    const likers = await seedLikers(db, 7);

    for (let i = 0; i < 5; i++) {
      await seedGuideLike(db, likers[i], many.id, daysAgo(60));
    }
    await seedGuideLike(db, likers[5], few.id, daysAgo(2));
    await seedGuideLike(db, likers[6], few.id, daysAgo(3));

    expect(await listSlugs(db, "likes")).toEqual(["many", "few"]);
  });

  it("いいねが 1 件も無ければ更新順に落ちる（並びが破綻しない）", async () => {
    const db = await createTestDb();
    const author = await seedUser(db);
    await seedGuide(db, author.id, { slug: "older", updatedAt: daysAgo(10) });
    await seedGuide(db, author.id, { slug: "newer", updatedAt: daysAgo(1) });

    expect(await listSlugs(db, "likes")).toEqual(["newer", "older"]);
    expect(await listSlugs(db, "new")).toEqual(["newer", "older"]);
  });

  it("いいね数が同じなら更新日時が新しい方が上", async () => {
    const db = await createTestDb();
    const author = await seedUser(db);
    const stale = await seedGuide(db, author.id, { slug: "stale", updatedAt: daysAgo(20) });
    const fresh = await seedGuide(db, author.id, { slug: "fresh", updatedAt: daysAgo(2) });
    const likers = await seedLikers(db, 2);

    await seedGuideLike(db, likers[0], stale.id, daysAgo(1));
    await seedGuideLike(db, likers[1], fresh.id, daysAgo(1));

    expect(await listSlugs(db, "likes")).toEqual(["fresh", "stale"]);
  });

  it("すべて同値でも順序が安定する（id で全順序になっている）", async () => {
    const db = await createTestDb();
    const author = await seedUser(db);
    const sameTime = daysAgo(5);
    await seedGuide(db, author.id, { id: "aaa", slug: "a", updatedAt: sameTime });
    await seedGuide(db, author.id, { id: "bbb", slug: "b", updatedAt: sameTime });
    await seedGuide(db, author.id, { id: "ccc", slug: "c", updatedAt: sameTime });

    const first = await listSlugs(db, "likes");
    const second = await listSlugs(db, "likes");
    expect(first).toEqual(["a", "b", "c"]);
    expect(second).toEqual(first);
  });
});

describe("guideListOrderBy - 閲覧数順（views）", () => {
  it("累計閲覧数（guides.view_count）が多い順に並ぶ", async () => {
    const db = await createTestDb();
    const author = await seedUser(db);
    // 更新日時は閲覧数と逆順にして、閲覧数が第一キーであることを分かるようにする
    await seedGuide(db, author.id, { slug: "few", viewCount: 3, updatedAt: daysAgo(1) });
    await seedGuide(db, author.id, { slug: "many", viewCount: 300, updatedAt: daysAgo(100) });
    await seedGuide(db, author.id, { slug: "mid", viewCount: 30, updatedAt: daysAgo(50) });

    expect(await listSlugs(db, "views")).toEqual(["many", "mid", "few"]);
  });

  it("いいねが多くても閲覧数が少なければ下に来る", async () => {
    const db = await createTestDb();
    const author = await seedUser(db);
    const liked = await seedGuide(db, author.id, { slug: "liked", viewCount: 1 });
    await seedGuide(db, author.id, { slug: "read", viewCount: 100 });
    for (const liker of await seedLikers(db, 3)) {
      await seedGuideLike(db, liker, liked.id);
    }

    expect(await listSlugs(db, "views")).toEqual(["read", "liked"]);
  });

  it("閲覧数が同じならいいね数 → 更新日時の順で決まる", async () => {
    const db = await createTestDb();
    const author = await seedUser(db);
    const liked = await seedGuide(db, author.id, {
      slug: "liked",
      viewCount: 10,
      updatedAt: daysAgo(30),
    });
    await seedGuide(db, author.id, { slug: "stale", viewCount: 10, updatedAt: daysAgo(20) });
    await seedGuide(db, author.id, { slug: "fresh", viewCount: 10, updatedAt: daysAgo(2) });
    const [liker] = await seedLikers(db, 1);
    await seedGuideLike(db, liker, liked.id);

    expect(await listSlugs(db, "views")).toEqual(["liked", "fresh", "stale"]);
  });
});

describe("guideListOrderBy - 人気順（popular）", () => {
  it("直近のページビュー（page_view_stats）が多い順に並ぶ", async () => {
    const db = await createTestDb();
    const author = await seedUser(db);
    const hot = await seedGuide(db, author.id, { slug: "hot", updatedAt: daysAgo(100) });
    const warm = await seedGuide(db, author.id, { slug: "warm", updatedAt: daysAgo(50) });
    await seedGuide(db, author.id, { slug: "cold", updatedAt: daysAgo(1) });
    await seedPageViewStat(db, "guide", hot.id, 120);
    await seedPageViewStat(db, "guide", warm.id, 30);

    expect(await listSlugs(db, "popular")).toEqual(["hot", "warm", "cold"]);
  });

  it("累計閲覧数ではなく直近のページビューで並ぶ（views との違い）", async () => {
    const db = await createTestDb();
    const author = await seedUser(db);
    const sameTime = daysAgo(10);
    const allTime = await seedGuide(db, author.id, {
      slug: "all-time",
      viewCount: 9999,
      updatedAt: sameTime,
    });
    const trending = await seedGuide(db, author.id, {
      slug: "trending",
      viewCount: 0,
      updatedAt: sameTime,
    });
    await seedPageViewStat(db, "guide", allTime.id, 1);
    await seedPageViewStat(db, "guide", trending.id, 50);

    expect(await listSlugs(db, "popular")).toEqual(["trending", "all-time"]);
    expect(await listSlugs(db, "views")).toEqual(["all-time", "trending"]);
  });

  it("ページビューが同数ならいいね数で決まる", async () => {
    const db = await createTestDb();
    const author = await seedUser(db);
    const sameTime = daysAgo(5);
    const liked = await seedGuide(db, author.id, { slug: "liked", updatedAt: sameTime });
    const plain = await seedGuide(db, author.id, { slug: "plain", updatedAt: sameTime });
    await seedPageViewStat(db, "guide", liked.id, 10);
    await seedPageViewStat(db, "guide", plain.id, 10);
    const [liker] = await seedLikers(db, 1);
    await seedGuideLike(db, liker, liked.id);

    expect(await listSlugs(db, "popular")).toEqual(["liked", "plain"]);
  });

  it("集計がまだ無ければ（全件0）いいね数 → 更新日時へ落ちる（並びが破綻しない）", async () => {
    const db = await createTestDb();
    const author = await seedUser(db);
    const liked = await seedGuide(db, author.id, { slug: "liked", updatedAt: daysAgo(30) });
    await seedGuide(db, author.id, { slug: "older", updatedAt: daysAgo(20) });
    await seedGuide(db, author.id, { slug: "newer", updatedAt: daysAgo(1) });
    const [liker] = await seedLikers(db, 1);
    await seedGuideLike(db, liker, liked.id);

    expect(await listSlugs(db, "popular")).toEqual(["liked", "newer", "older"]);
  });
});
