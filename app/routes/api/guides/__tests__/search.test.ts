// GET /api/guides/search（loader）の回帰テスト。
// 未認証の検索API。可視性フィルタ（限定公開・非公開の著者を除外）と、LIKE のワイルドカード
// （%, _）エスケープをルート内にインラインで実装しているため、実DBで検証する
// （app/lib/__tests__/browse-query.server.test.ts の LIKE 検索観点と同じ方針）。
//
// 認証不要のルートのためセッションのモックは不要。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createTestDbAt,
  seedUser,
  seedGuide,
  SHARED_MEMORY_URL,
  type TestDb,
} from "@/lib/__tests__/helpers/test-db";

import { loader } from "../search";

const ENV_KEYS = ["TURSO_DATABASE_URL"] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

let db: TestDb;

async function callLoader(q: string): Promise<{
  guides: Array<{ title: string; slug: string; authorSlug: string }>;
}> {
  const url = `https://minefolio.app/api/guides/search?q=${encodeURIComponent(q)}`;
  const res = (await loader({
    request: new Request(url),
    params: {},
    context: {},
  } as never)) as Response;
  return res.json() as never;
}

beforeEach(async () => {
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
  process.env.TURSO_DATABASE_URL = SHARED_MEMORY_URL;
  db = await createTestDbAt(SHARED_MEMORY_URL);
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe("loader - 可視性フィルタ", () => {
  it("限定公開（unlisted）著者の公開ガイドは結果に出ない", async () => {
    const author = await seedUser(db, {
      slug: "unlisted-author",
      profileVisibility: "unlisted",
    });
    await seedGuide(db, author.id, {
      title: "Unlisted Speedrun Guide",
      slug: "unlisted-guide",
      isPublished: true,
    });

    const res = await callLoader("Speedrun");

    expect(res.guides).toEqual([]);
  });

  it("非公開（private）著者の公開ガイドは結果に出ない", async () => {
    const author = await seedUser(db, {
      slug: "private-author",
      profileVisibility: "private",
    });
    await seedGuide(db, author.id, {
      title: "Private Speedrun Guide",
      slug: "private-guide",
      isPublished: true,
    });

    const res = await callLoader("Speedrun");

    expect(res.guides).toEqual([]);
  });

  it("公開著者の未公開（isPublished=false）ガイドは結果に出ない", async () => {
    const author = await seedUser(db, { slug: "author", profileVisibility: "public" });
    await seedGuide(db, author.id, {
      title: "Draft Speedrun Guide",
      slug: "draft-guide",
      isPublished: false,
    });

    const res = await callLoader("Speedrun");

    expect(res.guides).toEqual([]);
  });

  it("公開著者の公開ガイドは結果に出る", async () => {
    const author = await seedUser(db, { slug: "author", profileVisibility: "public" });
    await seedGuide(db, author.id, {
      title: "Public Speedrun Guide",
      slug: "public-guide",
      isPublished: true,
    });

    const res = await callLoader("Speedrun");

    expect(res.guides.map((g) => g.slug)).toEqual(["public-guide"]);
  });
});

describe("loader - LIKE ワイルドカードのエスケープ（セキュリティ回帰）", () => {
  it('"%" はワイルドカードにならずリテラル一致する', async () => {
    const author = await seedUser(db, { slug: "author", profileVisibility: "public" });
    await seedGuide(db, author.id, { title: "a%b guide", slug: "pct-guide" });
    await seedGuide(db, author.id, { title: "axb guide", slug: "axb-guide" });

    // "a%b" はリテラルの "a%b" にのみ一致する（% がワイルドカードなら axb にもヒットする）
    const res = await callLoader("a%b");

    expect(res.guides.map((g) => g.slug)).toEqual(["pct-guide"]);
  });

  it('"_" は1文字ワイルドカードにならずリテラル一致する', async () => {
    const author = await seedUser(db, { slug: "author", profileVisibility: "public" });
    await seedGuide(db, author.id, { title: "a_b guide", slug: "underscore-guide" });
    await seedGuide(db, author.id, { title: "aXb guide", slug: "axb-guide" });

    // "_" がワイルドカードなら aXb guide にもヒットするはずだが、リテラル扱いなのでヒットしない
    const res = await callLoader("a_b");

    expect(res.guides.map((g) => g.slug)).toEqual(["underscore-guide"]);
  });
});

describe("loader - 入力の境界", () => {
  it("空文字は空配列を即返す（DBアクセスなし）", async () => {
    const res = await callLoader("");
    expect(res.guides).toEqual([]);
  });
});
