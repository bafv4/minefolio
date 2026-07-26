import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createTestDbAt,
  seedUser,
  seedSearchCraftTemplate,
  seedTemplateLike,
  type TestDb,
} from "@/lib/__tests__/helpers/test-db";
import { loader } from "../index";

// 公開テンプレート一覧の可視性ゲートと並び替え。
// 可視性ゲートはガイド側（689222d）で入ったがテンプレートには無く、
// 人気順が非公開プロフィールの投稿を上位に押し上げるため本機能で追加した。その回帰テスト。

const SHARED_URL = "file::memory:?cache=shared";

let db: TestDb;
const originalEnv: Record<string, string | undefined> = {};

beforeEach(async () => {
  originalEnv.TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL;
  originalEnv.APP_URL = process.env.APP_URL;
  process.env.TURSO_DATABASE_URL = SHARED_URL;
  process.env.APP_URL = "https://minefolio.app";
  db = await createTestDbAt(SHARED_URL);
});

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function callLoader(search = ""): Promise<{
  templates: Array<{ id: string; title: string; likeCount: number }>;
}> {
  const request = new Request(`https://minefolio.app/guides/templates${search}`);
  return loader({ request, params: {}, context: {} } as never) as never;
}

describe("可視性ゲート", () => {
  it("公開プロフィールのテンプレートのみを返す（private / unlisted は出さない）", async () => {
    const pub = await seedUser(db, { slug: "pub", profileVisibility: "public" });
    const priv = await seedUser(db, { slug: "priv", profileVisibility: "private" });
    const unl = await seedUser(db, { slug: "unl", profileVisibility: "unlisted" });
    await seedSearchCraftTemplate(db, pub.id, { title: "public-one" });
    await seedSearchCraftTemplate(db, priv.id, { title: "private-one" });
    await seedSearchCraftTemplate(db, unl.id, { title: "unlisted-one" });

    const { templates } = await callLoader();

    expect(templates.map((t) => t.title)).toEqual(["public-one"]);
  });

  it("未公開テンプレートは出さない", async () => {
    const pub = await seedUser(db, { slug: "pub", profileVisibility: "public" });
    await seedSearchCraftTemplate(db, pub.id, { title: "shown" });
    await seedSearchCraftTemplate(db, pub.id, { title: "hidden", isPublished: false });

    const { templates } = await callLoader();

    expect(templates.map((t) => t.title)).toEqual(["shown"]);
  });
});

describe("並び替え", () => {
  it("既定は新着順（作成日の降順）", async () => {
    const pub = await seedUser(db, { slug: "pub", profileVisibility: "public" });
    await seedSearchCraftTemplate(db, pub.id, {
      title: "old",
      createdAt: new Date("2026-01-01"),
    });
    await seedSearchCraftTemplate(db, pub.id, {
      title: "new",
      createdAt: new Date("2026-06-01"),
    });

    const { templates } = await callLoader();

    expect(templates.map((t) => t.title)).toEqual(["new", "old"]);
  });

  it("人気順はいいね数の降順（いいね数を各行に含める）", async () => {
    const pub = await seedUser(db, { slug: "pub", profileVisibility: "public" });
    const [liker1, liker2] = await Promise.all([
      seedUser(db, { slug: "l1" }),
      seedUser(db, { slug: "l2" }),
    ]);
    const two = await seedSearchCraftTemplate(db, pub.id, { title: "two-likes" });
    const one = await seedSearchCraftTemplate(db, pub.id, { title: "one-like" });
    await seedSearchCraftTemplate(db, pub.id, { title: "zero-likes" });
    await seedTemplateLike(db, liker1.id, two.id);
    await seedTemplateLike(db, liker2.id, two.id);
    await seedTemplateLike(db, liker1.id, one.id);

    const { templates } = await callLoader("?sort=popular");

    expect(templates.map((t) => t.title)).toEqual(["two-likes", "one-like", "zero-likes"]);
    expect(templates.map((t) => t.likeCount)).toEqual([2, 1, 0]);
  });

  it("人気順は LIMIT より前に SQL で並べる（古くて人気の1件が先頭に来る）", async () => {
    const pub = await seedUser(db, { slug: "pub", profileVisibility: "public" });
    const liker = await seedUser(db, { slug: "liker" });

    // 最古のテンプレートだけがいいねを持つ。メモリ上で並べ替えていると
    // 「新しい100件」に入らず永久に出てこない
    const oldest = await seedSearchCraftTemplate(db, pub.id, {
      title: "oldest-but-liked",
      createdAt: new Date("2020-01-01"),
    });
    for (let i = 0; i < 100; i++) {
      await seedSearchCraftTemplate(db, pub.id, {
        title: `filler-${i}`,
        createdAt: new Date(2026, 0, 1, 0, i),
      });
    }
    await seedTemplateLike(db, liker.id, oldest.id);

    const { templates } = await callLoader("?sort=popular");

    expect(templates[0]?.title).toBe("oldest-but-liked");
  });

  it("いいね数が同数のときの順序が2回呼んでも一致する（タイブレーク）", async () => {
    const pub = await seedUser(db, { slug: "pub", profileVisibility: "public" });
    const sameTime = new Date("2026-03-03T00:00:00Z");
    for (let i = 0; i < 5; i++) {
      await seedSearchCraftTemplate(db, pub.id, { title: `tie-${i}`, createdAt: sameTime });
    }

    const first = await callLoader("?sort=popular");
    const second = await callLoader("?sort=popular");

    expect(first.templates.map((t) => t.id)).toEqual(second.templates.map((t) => t.id));
  });
});
