// GET /api/guides/templates-search（loader）の回帰テスト。
// ガイドエディタのテンプレート埋め込み用検索。可視性フィルタ・LIKE エスケープ・自分のテンプレートの
// 先頭固定・未ログイン時の ORDER BY（定数 0 は SQLite で列番号と解釈され 500 になっていた）を実DBで検証する。
//
// セッションはモックし、ルート本体を実DBで検証する（app/routes/api/__tests__/favorites.test.ts と同じ方針）。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createTestDbAt,
  seedUser,
  seedSearchCraftTemplate,
  daysAgo,
  SHARED_MEMORY_URL,
  type TestDb,
} from "@/lib/__tests__/helpers/test-db";

const sessionMocks = vi.hoisted(() => ({
  getOptionalSession: vi.fn(),
  getSession: vi.fn(),
  getCurrentUser: vi.fn(),
  getCurrentUserOrOnboarding: vi.fn(),
  isAuthenticated: vi.fn(),
}));

vi.mock("@/lib/session", () => sessionMocks);

import { loader } from "../templates-search";

const ENV_KEYS = ["TURSO_DATABASE_URL", "BETTER_AUTH_SECRET", "APP_URL"] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

let db: TestDb;

type TemplateItem = {
  id: string;
  title: string;
  gameLanguage: string | null;
  craftCount: number;
  isPublished: boolean;
  isOwn: boolean;
  authorName: string;
};

async function callLoader(
  params: { q?: string; id?: string } = {},
): Promise<{ status: number; templates: TemplateItem[] }> {
  const sp = new URLSearchParams();
  if (params.q !== undefined) sp.set("q", params.q);
  if (params.id !== undefined) sp.set("id", params.id);
  const url = `https://minefolio.app/api/guides/templates-search?${sp.toString()}`;
  const res = (await loader({
    request: new Request(url),
    params: {},
    context: {},
  } as never)) as Response;
  const body = (await res.json()) as { templates: TemplateItem[] };
  return { status: res.status, templates: body.templates };
}

function signInAs(discordId: string) {
  sessionMocks.getOptionalSession.mockResolvedValue({ user: { id: discordId } });
}

beforeEach(async () => {
  vi.clearAllMocks();
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
  process.env.TURSO_DATABASE_URL = SHARED_MEMORY_URL;
  process.env.BETTER_AUTH_SECRET = "test-secret";
  process.env.APP_URL = "https://minefolio.app";
  db = await createTestDbAt(SHARED_MEMORY_URL);
  sessionMocks.getOptionalSession.mockResolvedValue(null);
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe("loader - 未ログインの一覧（q なし）", () => {
  it("200 で templates 配列を返す（ORDER BY 定数による 500 の回帰）", async () => {
    const author = await seedUser(db, { slug: "author", profileVisibility: "public" });
    const t = await seedSearchCraftTemplate(db, author.id, { title: "Hello" });

    const res = await callLoader();

    expect(res.status).toBe(200);
    expect(res.templates.map((x) => x.id)).toEqual([t.id]);
  });

  it("テンプレートが無くても 200 で空配列", async () => {
    const res = await callLoader();

    expect(res.status).toBe(200);
    expect(res.templates).toEqual([]);
  });

  it("更新日時の新しい順に並ぶ", async () => {
    const author = await seedUser(db, { slug: "author", profileVisibility: "public" });
    const old = await seedSearchCraftTemplate(db, author.id, { updatedAt: daysAgo(3) });
    const recent = await seedSearchCraftTemplate(db, author.id, { updatedAt: daysAgo(1) });

    const res = await callLoader();

    expect(res.templates.map((x) => x.id)).toEqual([recent.id, old.id]);
  });
});

describe("loader - LIKE のエスケープ", () => {
  it('q="%" はタイトルに % を含むものだけ返す', async () => {
    const author = await seedUser(db, { slug: "author", profileVisibility: "public" });
    const pct = await seedSearchCraftTemplate(db, author.id, { title: "100% speed" });
    await seedSearchCraftTemplate(db, author.id, { title: "plain title" });

    const res = await callLoader({ q: "%" });

    expect(res.status).toBe(200);
    expect(res.templates.map((x) => x.id)).toEqual([pct.id]);
  });

  it('q="a_b" は _ をワイルドカードにしない', async () => {
    const author = await seedUser(db, { slug: "author", profileVisibility: "public" });
    const under = await seedSearchCraftTemplate(db, author.id, { title: "a_b tpl" });
    await seedSearchCraftTemplate(db, author.id, { title: "aXb tpl" });

    const res = await callLoader({ q: "a_b" });

    expect(res.templates.map((x) => x.id)).toEqual([under.id]);
  });

  it('q="\\" はバックスラッシュ自体にマッチし、エラーにならない', async () => {
    const author = await seedUser(db, { slug: "author", profileVisibility: "public" });
    const bs = await seedSearchCraftTemplate(db, author.id, { title: "a\\b tpl" });
    await seedSearchCraftTemplate(db, author.id, { title: "ab tpl" });

    const res = await callLoader({ q: "\\" });

    expect(res.status).toBe(200);
    expect(res.templates.map((x) => x.id)).toEqual([bs.id]);
  });

  it("通常の部分一致で絞り込める", async () => {
    const author = await seedUser(db, { slug: "author", profileVisibility: "public" });
    const hit = await seedSearchCraftTemplate(db, author.id, { title: "Nether Entry" });
    await seedSearchCraftTemplate(db, author.id, { title: "Other" });

    const res = await callLoader({ q: "nether" });

    expect(res.templates.map((x) => x.id)).toEqual([hit.id]);
  });
});

describe("loader - 可視性（discovery）", () => {
  for (const q of [undefined, "Tpl"] as const) {
    const label = q === undefined ? "q なし" : "q あり";

    it(`${label}: 公開済み＋作者 public は出る`, async () => {
      const author = await seedUser(db, { slug: "author", profileVisibility: "public" });
      const t = await seedSearchCraftTemplate(db, author.id, { title: "Tpl public" });

      const res = await callLoader({ q });

      expect(res.templates.map((x) => x.id)).toEqual([t.id]);
    });

    it(`${label}: 作者が unlisted / private のものは出ない`, async () => {
      const unlisted = await seedUser(db, { slug: "unl", profileVisibility: "unlisted" });
      const priv = await seedUser(db, { slug: "prv", profileVisibility: "private" });
      await seedSearchCraftTemplate(db, unlisted.id, { title: "Tpl unlisted" });
      await seedSearchCraftTemplate(db, priv.id, { title: "Tpl private" });

      const res = await callLoader({ q });

      expect(res.templates).toEqual([]);
    });

    it(`${label}: 他人の非公開（isPublished=false）は出ない（ログイン中でも）`, async () => {
      const author = await seedUser(db, { slug: "author", profileVisibility: "public" });
      await seedUser(db, { slug: "viewer", discordId: "viewer-discord" });
      await seedSearchCraftTemplate(db, author.id, { title: "Tpl draft", isPublished: false });

      expect((await callLoader({ q })).templates).toEqual([]);

      signInAs("viewer-discord");
      expect((await callLoader({ q })).templates).toEqual([]);
    });
  }
});

describe("loader - ?id= 指定", () => {
  it("公開済み＋作者 public は返る", async () => {
    const author = await seedUser(db, { slug: "author", profileVisibility: "public" });
    const t = await seedSearchCraftTemplate(db, author.id);

    const res = await callLoader({ id: t.id });

    expect(res.templates.map((x) => x.id)).toEqual([t.id]);
  });

  it("公開済み＋作者 unlisted は返る", async () => {
    const author = await seedUser(db, { slug: "author", profileVisibility: "unlisted" });
    const t = await seedSearchCraftTemplate(db, author.id);

    const res = await callLoader({ id: t.id });

    expect(res.templates.map((x) => x.id)).toEqual([t.id]);
  });

  it("作者が private のものは返らない", async () => {
    const author = await seedUser(db, { slug: "author", profileVisibility: "private" });
    const t = await seedSearchCraftTemplate(db, author.id);

    const res = await callLoader({ id: t.id });

    expect(res.templates).toEqual([]);
  });

  it("他人の非公開テンプレートは返らない", async () => {
    const author = await seedUser(db, { slug: "author", profileVisibility: "public" });
    await seedUser(db, { slug: "viewer", discordId: "viewer-discord" });
    const t = await seedSearchCraftTemplate(db, author.id, { isPublished: false });

    expect((await callLoader({ id: t.id })).templates).toEqual([]);

    signInAs("viewer-discord");
    expect((await callLoader({ id: t.id })).templates).toEqual([]);
  });

  it("形式外の ID は空配列（200）", async () => {
    const author = await seedUser(db, { slug: "author", profileVisibility: "public" });
    await seedSearchCraftTemplate(db, author.id);

    for (const id of ["../x", "ABC", "short", "a'; drop table users;--"]) {
      const res = await callLoader({ id });
      expect(res.status).toBe(200);
      expect(res.templates).toEqual([]);
    }
  });
});

describe("loader - ログイン時", () => {
  it("自分のテンプレートは非公開・作者 private でも返り、isOwn / isPublished が正しい", async () => {
    const me = await seedUser(db, {
      slug: "me",
      discordId: "me-discord",
      profileVisibility: "private",
    });
    const other = await seedUser(db, { slug: "other", profileVisibility: "public" });
    const mine = await seedSearchCraftTemplate(db, me.id, { title: "Mine draft", isPublished: false });
    const theirs = await seedSearchCraftTemplate(db, other.id, { title: "Theirs" });
    signInAs("me-discord");

    const res = await callLoader();

    const byId = new Map(res.templates.map((x) => [x.id, x]));
    expect(byId.get(mine.id)).toMatchObject({ isOwn: true, isPublished: false });
    expect(byId.get(theirs.id)).toMatchObject({ isOwn: false, isPublished: true });
  });

  it("自分のものは更新日時に関係なく、他人の新しいものより先頭に来る", async () => {
    const me = await seedUser(db, { slug: "me", discordId: "me-discord" });
    const other = await seedUser(db, { slug: "other", profileVisibility: "public" });
    const theirsNew = await seedSearchCraftTemplate(db, other.id, { updatedAt: daysAgo(0) });
    const mineOld = await seedSearchCraftTemplate(db, me.id, { updatedAt: daysAgo(30) });
    const mineNewer = await seedSearchCraftTemplate(db, me.id, { updatedAt: daysAgo(10) });
    signInAs("me-discord");

    const res = await callLoader();

    expect(res.templates.map((x) => x.id)).toEqual([mineNewer.id, mineOld.id, theirsNew.id]);
  });

  it("q 指定でも自分の非公開テンプレートが検索に出る", async () => {
    const me = await seedUser(db, { slug: "me", discordId: "me-discord" });
    const mine = await seedSearchCraftTemplate(db, me.id, { title: "Tpl mine", isPublished: false });
    signInAs("me-discord");

    const res = await callLoader({ q: "Tpl" });

    expect(res.templates.map((x) => x.id)).toEqual([mine.id]);
  });

  it("自分の非公開テンプレートを ?id= で引ける", async () => {
    const me = await seedUser(db, {
      slug: "me",
      discordId: "me-discord",
      profileVisibility: "private",
    });
    const mine = await seedSearchCraftTemplate(db, me.id, { isPublished: false });
    signInAs("me-discord");

    const res = await callLoader({ id: mine.id });

    expect(res.templates).toHaveLength(1);
    expect(res.templates[0]).toMatchObject({ id: mine.id, isOwn: true, isPublished: false });
  });

  it("discordId に対応するユーザーが居ないセッションは未ログイン扱い（200）", async () => {
    const author = await seedUser(db, { slug: "author", profileVisibility: "public" });
    const t = await seedSearchCraftTemplate(db, author.id);
    signInAs("ghost-discord");

    const res = await callLoader();

    expect(res.status).toBe(200);
    expect(res.templates.map((x) => x.id)).toEqual([t.id]);
    expect(res.templates[0].isOwn).toBe(false);
  });
});

describe("loader - 返す項目", () => {
  it("craftCount は craftsData の配列長、gameLanguage を返す", async () => {
    const author = await seedUser(db, { slug: "author", profileVisibility: "public" });
    await seedSearchCraftTemplate(db, author.id, {
      craftsData: JSON.stringify([{ a: 1 }, { a: 2 }, { a: 3 }]),
      gameLanguage: "ja_jp",
    });

    const res = await callLoader();

    expect(res.templates[0]).toMatchObject({ craftCount: 3, gameLanguage: "ja_jp" });
  });

  it("gameLanguage 未設定は null、craftsData が空配列なら craftCount 0", async () => {
    const author = await seedUser(db, { slug: "author", profileVisibility: "public" });
    await seedSearchCraftTemplate(db, author.id);

    const res = await callLoader();

    expect(res.templates[0]).toMatchObject({ craftCount: 0, gameLanguage: null });
  });

  it("authorName は displayName → mcid → slug の順", async () => {
    const withDisplay = await seedUser(db, {
      slug: "s1",
      mcid: "mc1",
      displayName: "Display One",
      profileVisibility: "public",
    });
    const withMcid = await seedUser(db, { slug: "s2", mcid: "mc2", profileVisibility: "public" });
    const slugOnly = await seedUser(db, { slug: "s3", profileVisibility: "public" });
    const t1 = await seedSearchCraftTemplate(db, withDisplay.id, { updatedAt: daysAgo(1) });
    const t2 = await seedSearchCraftTemplate(db, withMcid.id, { updatedAt: daysAgo(2) });
    const t3 = await seedSearchCraftTemplate(db, slugOnly.id, { updatedAt: daysAgo(3) });

    const res = await callLoader();

    const byId = new Map(res.templates.map((x) => [x.id, x.authorName]));
    expect(byId.get(t1.id)).toBe("Display One");
    expect(byId.get(t2.id)).toBe("mc2");
    expect(byId.get(t3.id)).toBe("s3");
  });
});
