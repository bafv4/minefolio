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
// いいね数順が非公開プロフィールの投稿を上位に押し上げるため本機能で追加した。その回帰テスト。
// ※ テンプレートの並び順は `?sort=likes`（旧 `?sort=popular`。ページビュー集計を持たないため
//   ガイド専用の「人気順」とは基準が違い、ラベルどおり「いいね数順」に改名した）。

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

  it("新着順は publishedAt の降順（作成が古くても、後から公開したテンプレートが上に来る）", async () => {
    const pub = await seedUser(db, { slug: "pub", profileVisibility: "public" });
    await seedSearchCraftTemplate(db, pub.id, {
      title: "created-new-published-early",
      createdAt: new Date("2026-06-01"),
      publishedAt: new Date("2026-06-02"),
    });
    await seedSearchCraftTemplate(db, pub.id, {
      title: "created-old-published-late",
      createdAt: new Date("2026-01-01"),
      publishedAt: new Date("2026-09-01"),
    });

    const { templates } = await callLoader();

    expect(templates.map((t) => t.title)).toEqual([
      "created-old-published-late",
      "created-new-published-early",
    ]);
  });

  it("publishedAt が null の公開行（バックフィル前）は createdAt で並ぶ", async () => {
    const pub = await seedUser(db, { slug: "pub", profileVisibility: "public" });
    await seedSearchCraftTemplate(db, pub.id, {
      title: "null-created-mid",
      createdAt: new Date("2026-05-01"),
      publishedAt: null,
    });
    await seedSearchCraftTemplate(db, pub.id, {
      title: "published-early",
      createdAt: new Date("2026-01-01"),
      publishedAt: new Date("2026-03-01"),
    });
    await seedSearchCraftTemplate(db, pub.id, {
      title: "null-created-new",
      createdAt: new Date("2026-07-01"),
      publishedAt: null,
    });

    const { templates } = await callLoader();

    expect(templates.map((t) => t.title)).toEqual([
      "null-created-new",
      "null-created-mid",
      "published-early",
    ]);
  });

  it("いいね数順はいいね数の降順（いいね数を各行に含める）", async () => {
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

    const { templates } = await callLoader("?sort=likes");

    expect(templates.map((t) => t.title)).toEqual(["two-likes", "one-like", "zero-likes"]);
    expect(templates.map((t) => t.likeCount)).toEqual([2, 1, 0]);
  });

  it("いいね数順は LIMIT より前に SQL で並べる（古くていいねの多い1件が先頭に来る）", async () => {
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

    const { templates } = await callLoader("?sort=likes");

    expect(templates[0]?.title).toBe("oldest-but-liked");
  });

  it("いいね数が同数のときの順序が2回呼んでも一致する（タイブレーク）", async () => {
    const pub = await seedUser(db, { slug: "pub", profileVisibility: "public" });
    const sameTime = new Date("2026-03-03T00:00:00Z");
    for (let i = 0; i < 5; i++) {
      await seedSearchCraftTemplate(db, pub.id, { title: `tie-${i}`, createdAt: sameTime });
    }

    const first = await callLoader("?sort=likes");
    const second = await callLoader("?sort=likes");

    expect(first.templates.map((t) => t.id)).toEqual(second.templates.map((t) => t.id));
  });
});

describe("作成者での絞り込み（?author=<slug>）", () => {
  async function callWithAuthor(search: string) {
    return (await callLoader(search)) as unknown as {
      templates: Array<{ title: string; authorSlug: string }>;
      author: string;
      authorFilterName: string;
    };
  }

  it("slug の大文字小文字を区別せず、その作成者のテンプレートだけを返す", async () => {
    const steve = await seedUser(db, { slug: "Steve", profileVisibility: "public", displayName: "スティーブ" });
    const alex = await seedUser(db, { slug: "alex", profileVisibility: "public" });
    await seedSearchCraftTemplate(db, steve.id, { title: "steve-one" });
    await seedSearchCraftTemplate(db, alex.id, { title: "alex-one" });

    const res = await callWithAuthor("?author=sTEVE");

    expect(res.templates.map((t) => t.title)).toEqual(["steve-one"]);
    expect(res.author).toBe("sTEVE");
    expect(res.authorFilterName).toBe("スティーブ");
  });

  it("公開プロフィールでない作成者を指定すると0件で、名前は引かず入力の slug をそのまま出す", async () => {
    for (const [slug, visibility] of [
      ["hidden", "private"],
      ["unl", "unlisted"],
    ] as const) {
      const user = await seedUser(db, { slug, profileVisibility: visibility, displayName: `name-${slug}` });
      await seedSearchCraftTemplate(db, user.id, { title: `${slug}-one` });

      const res = await callWithAuthor(`?author=${slug}`);

      expect(res.templates).toEqual([]);
      expect(res.authorFilterName).toBe(slug);
    }
  });
});

describe("言語ごとの件数（languageCounts）", () => {
  async function callCounts(search = "") {
    return (await callLoader(search)) as unknown as {
      templates: Array<{ title: string }>;
      languageCounts: Record<string, number>;
    };
  }

  it("公開プロフィールの公開テンプレートだけを言語ごとに数え、言語なしは数えない", async () => {
    const pub = await seedUser(db, { slug: "pub", profileVisibility: "public" });
    const priv = await seedUser(db, { slug: "priv", profileVisibility: "private" });
    const unl = await seedUser(db, { slug: "unl", profileVisibility: "unlisted" });
    await seedSearchCraftTemplate(db, pub.id, { gameLanguage: "ja_jp" });
    await seedSearchCraftTemplate(db, pub.id, { gameLanguage: "ja_jp" });
    await seedSearchCraftTemplate(db, pub.id, { gameLanguage: "en_us" });
    await seedSearchCraftTemplate(db, pub.id, { gameLanguage: null });
    await seedSearchCraftTemplate(db, pub.id, { gameLanguage: "en_us", isPublished: false });
    await seedSearchCraftTemplate(db, priv.id, { gameLanguage: "en_us" });
    await seedSearchCraftTemplate(db, unl.id, { gameLanguage: "zh_cn" });

    const { languageCounts } = await callCounts();

    expect(languageCounts).toEqual({ ja_jp: 2, en_us: 1 });
  });

  it("件数はいまの絞り込み（言語・検索語・作成者）に依らない", async () => {
    const a = await seedUser(db, { slug: "a", profileVisibility: "public" });
    const b = await seedUser(db, { slug: "b", profileVisibility: "public" });
    await seedSearchCraftTemplate(db, a.id, { title: "alpha", gameLanguage: "ja_jp" });
    await seedSearchCraftTemplate(db, b.id, { title: "beta", gameLanguage: "en_us" });
    const expected = { ja_jp: 1, en_us: 1 };

    for (const search of ["?lang=ja_jp", "?q=beta", "?author=a", "?lang=en_us&author=a&q=zzz"]) {
      const res = await callCounts(search);
      expect(res.languageCounts, search).toEqual(expected);
    }
    // 一覧そのものは絞り込まれている
    expect((await callCounts("?lang=ja_jp")).templates.map((t) => t.title)).toEqual(["alpha"]);
  });
});
