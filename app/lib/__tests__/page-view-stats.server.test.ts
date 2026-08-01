// ページビュー集計（Vercel Web Analytics → page_view_stats）の同期と、
// 「人気順」で使う相関サブクエリの検証。
//
// ここで守りたい回帰は 3 つ:
// 1. 取得した path が対象（users / guides）へ正しく解決されること（大小文字の合算、
//    (著者, ガイド slug) の組一致、未知 slug のスキップ）
// 2. 種別ごとの全置換と、片側失敗時に旧スナップショットを壊さないこと
// 3. 相関サブクエリが外側の行ごとに解決されること（内側の id へシャドーイングすると
//    SQL エラーにならないまま全行同値／常に 0 になる）
//
// 同期は delete → insert を 1 トランザクションで行うため、DB は createTransactionalTestDb()
// （shared cache の in-memory）を使う。素の `:memory:` だとトランザクション後に別接続＝空 DB を
// 見てしまう（helpers/test-db.ts のコメント参照）。
import { describe, it, expect, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  createTransactionalTestDb,
  seedUser,
  seedGuide,
  seedPageViewStat,
  schema,
  type TestDb,
} from "./helpers/test-db";
import {
  syncPageViewStats,
  guidePageViewsSql,
  profilePageViewsSql,
  PAGE_VIEW_WINDOW_DAYS,
} from "../page-view-stats.server";
import type { Env } from "../../env";

/** Analytics API を叩ける最小限の Env（他の値は同期経路で使われない） */
function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    TURSO_DATABASE_URL: ":memory:",
    DISCORD_CLIENT_ID: "client",
    DISCORD_CLIENT_SECRET: "secret",
    APP_URL: "http://localhost:5173",
    BETTER_AUTH_SECRET: "test-secret",
    VERCEL_API_TOKEN: "vercel-token",
    VERCEL_PROJECT_ID: "prj_test",
    ...overrides,
  };
}

/** Analytics API が返す 1 行。キー名の揺れも試すため緩い型にする */
type AnalyticsRow = Record<string, unknown> | null;

/** 接頭辞ごとの応答。配列＝成功、Error＝そのリクエストが失敗する */
interface AnalyticsSides {
  profile?: AnalyticsRow[] | Error;
  guide?: AnalyticsRow[] | Error;
}

/**
 * Vercel Web Analytics API をスタブする。
 * どちらの接頭辞への問い合わせかは filter クエリ（startswith(requestPath, '/player/')）で振り分ける。
 */
function stubAnalytics(sides: AnalyticsSides) {
  const fetchMock = vi.fn(async (input: string | URL) => {
    const filter = new URL(String(input)).searchParams.get("filter") ?? "";
    const side = filter.includes("/guides/") ? sides.guide : sides.profile;
    if (side instanceof Error) throw side;
    return { ok: true, json: async () => ({ data: side ?? [] }) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** 保存済みスナップショットを `種別:対象id` → PV のマップで取り出す（順序に依存せず比較する） */
async function statMap(db: TestDb): Promise<Record<string, number>> {
  const rows = await db.query.pageViewStats.findMany();
  return Object.fromEntries(
    rows.map((row) => [`${row.targetType}:${row.targetId}`, row.pageviews]),
  );
}

/** { slug, pageviews } の行群を slug → 数値のオブジェクトへ */
function pageviewsBySlug(rows: Array<{ slug: string; pageviews: unknown }>): Record<string, number> {
  return Object.fromEntries(rows.map((row) => [row.slug, Number(row.pageviews)]));
}

/** console のノイズ（失敗ログ・未解決の警告）を抑える。afterEach の restoreAllMocks で戻る */
function silenceConsole() {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("syncPageViewStats - 正常系", () => {
  it("プロフィール・ガイド両方の path が対象へ解決され保存される", async () => {
    const db = await createTransactionalTestDb();
    const runner = await seedUser(db, { slug: "runner" });
    const author = await seedUser(db, { slug: "author" });
    const guide = await seedGuide(db, author.id, { slug: "my-guide" });

    stubAnalytics({
      profile: [{ requestPath: "/player/runner", visits: 12 }],
      guide: [{ requestPath: "/guides/author/my-guide", visits: 5 }],
    });

    const result = await syncPageViewStats(db, testEnv());

    expect(result).toEqual({
      profiles: { ok: true, count: 1 },
      guides: { ok: true, count: 1 },
    });
    expect(await statMap(db)).toEqual({
      [`profile:${runner.id}`]: 12,
      [`guide:${guide.id}`]: 5,
    });
  });

  it("集計窓（直近 PAGE_VIEW_WINDOW_DAYS 日）と取得時刻を記録する", async () => {
    const db = await createTransactionalTestDb();
    const runner = await seedUser(db, { slug: "runner" });
    stubAnalytics({ profile: [{ requestPath: "/player/runner", visits: 1 }], guide: [] });

    const before = Date.now();
    await syncPageViewStats(db, testEnv());
    const after = Date.now();

    const [row] = await db.query.pageViewStats.findMany();
    expect(row.targetId).toBe(runner.id);
    const windowMs = row.windowEnd.getTime() - row.windowStart.getTime();
    expect(windowMs).toBe(PAGE_VIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    // 秒精度で保存されるため、境界は 1 秒の丸めを見込んで比較する
    expect(row.fetchedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(row.fetchedAt.getTime()).toBeLessThanOrEqual(after + 1000);
  });

  it("大小文字違いのプロフィール path は同一ユーザーへ合算される", async () => {
    const db = await createTransactionalTestDb();
    const runner = await seedUser(db, { slug: "Runner" });

    stubAnalytics({
      profile: [
        { requestPath: "/player/Runner", visits: 3 },
        { requestPath: "/player/runner", visits: 4 },
        { requestPath: "/player/RUNNER/", visits: 2 },
      ],
      guide: [],
    });

    const result = await syncPageViewStats(db, testEnv());

    expect(result.profiles).toEqual({ ok: true, count: 1 });
    expect(await statMap(db)).toEqual({ [`profile:${runner.id}`]: 9 });
  });

  it("著者 slug の大小文字違いのガイド path も同一ガイドへ合算される", async () => {
    const db = await createTransactionalTestDb();
    const author = await seedUser(db, { slug: "Author" });
    const guide = await seedGuide(db, author.id, { slug: "my-guide" });

    stubAnalytics({
      profile: [],
      guide: [
        { requestPath: "/guides/Author/my-guide", visits: 6 },
        { requestPath: "/guides/author/my-guide?ref=twitter", visits: 4 },
      ],
    });

    await syncPageViewStats(db, testEnv());

    expect(await statMap(db)).toEqual({ [`guide:${guide.id}`]: 10 });
  });

  it("(著者, ガイド slug) の組で一致させる（同名 slug の別著者と取り違えない）", async () => {
    const db = await createTransactionalTestDb();
    const alice = await seedUser(db, { slug: "alice" });
    const bob = await seedUser(db, { slug: "bob" });
    const aliceTips = await seedGuide(db, alice.id, { slug: "tips" });
    await seedGuide(db, alice.id, { slug: "handbook" });
    await seedGuide(db, bob.id, { slug: "tips" });
    const bobHandbook = await seedGuide(db, bob.id, { slug: "handbook" });

    // 著者 slug 群 × ガイド slug 群で粗く引くため、SQL には 4 件すべてが載る。
    // 実際に PV が付くのは踏まれた 2 組だけ。
    stubAnalytics({
      profile: [],
      guide: [
        { requestPath: "/guides/alice/tips", visits: 9 },
        { requestPath: "/guides/bob/handbook", visits: 4 },
      ],
    });

    const result = await syncPageViewStats(db, testEnv());

    expect(result.guides).toEqual({ ok: true, count: 2 });
    expect(await statMap(db)).toEqual({
      [`guide:${aliceTips.id}`]: 9,
      [`guide:${bobHandbook.id}`]: 4,
    });
  });
});

describe("syncPageViewStats - 取りこぼしと除外", () => {
  it("存在しない slug の行はスキップし、解決できた行だけ保存する", async () => {
    const db = await createTransactionalTestDb();
    silenceConsole();
    const runner = await seedUser(db, { slug: "runner" });
    const author = await seedUser(db, { slug: "author" });
    const guide = await seedGuide(db, author.id, { slug: "my-guide" });

    stubAnalytics({
      profile: [
        { requestPath: "/player/ghost", visits: 99 },
        { requestPath: "/player/runner", visits: 7 },
      ],
      guide: [
        { requestPath: "/guides/author/deleted-guide", visits: 50 },
        { requestPath: "/guides/nobody/my-guide", visits: 40 },
        { requestPath: "/guides/author/my-guide", visits: 3 },
      ],
    });

    const result = await syncPageViewStats(db, testEnv());

    expect(result).toEqual({
      profiles: { ok: true, count: 1 },
      guides: { ok: true, count: 1 },
    });
    expect(await statMap(db)).toEqual({
      [`profile:${runner.id}`]: 7,
      [`guide:${guide.id}`]: 3,
    });
  });

  it("集約行 Others・パース不能な行・対象外パスはスキップされる", async () => {
    const db = await createTransactionalTestDb();
    silenceConsole();
    const runner = await seedUser(db, { slug: "runner" });

    stubAnalytics({
      profile: [
        { requestPath: "Others", visits: 500 },
        { visits: 3 }, // path が無い
        { requestPath: "/player/runner" }, // 件数が無い
        null, // オブジェクトですらない
        { requestPath: "/player/runner/stats", visits: 70 }, // 対象外パス
        { requestPath: "/player/runner", visits: 4 },
      ],
      guide: [],
    });

    const result = await syncPageViewStats(db, testEnv());

    expect(result.profiles).toEqual({ ok: true, count: 1 });
    expect(await statMap(db)).toEqual({ [`profile:${runner.id}`]: 4 });
  });

  it("path / 件数のキー名が揺れても吸収する（requestPath→key、visits→pageviews→total→count）", async () => {
    const db = await createTransactionalTestDb();
    const a = await seedUser(db, { slug: "a" });
    const b = await seedUser(db, { slug: "b" });
    const c = await seedUser(db, { slug: "c" });
    const d = await seedUser(db, { slug: "d" });
    await seedUser(db, { slug: "zzz" });

    stubAnalytics({
      profile: [
        { key: "/player/a", pageviews: 1 },
        // requestPath が key より優先される
        { requestPath: "/player/b", key: "/player/zzz", visits: 2 },
        { key: "/player/c", total: "3" }, // 数値文字列も受ける
        { key: "/player/d", count: 4 },
      ],
      guide: [],
    });

    await syncPageViewStats(db, testEnv());

    expect(await statMap(db)).toEqual({
      [`profile:${a.id}`]: 1,
      [`profile:${b.id}`]: 2,
      [`profile:${c.id}`]: 3,
      [`profile:${d.id}`]: 4,
    });
  });
});

describe("syncPageViewStats - スナップショットの置き換え", () => {
  it("種別ごとに全置換する（前回の行は残らない・取得 0 件でも消える）", async () => {
    const db = await createTransactionalTestDb();
    const stale = await seedUser(db, { slug: "stale" });
    const fresh = await seedUser(db, { slug: "fresh" });
    const author = await seedUser(db, { slug: "author" });
    const guide = await seedGuide(db, author.id, { slug: "my-guide" });
    await seedPageViewStat(db, "profile", stale.id, 999);
    await seedPageViewStat(db, "guide", guide.id, 999);

    stubAnalytics({
      profile: [{ requestPath: "/player/fresh", visits: 3 }],
      guide: [], // 窓内にアクセスが無かった＝旧行も消す
    });

    const result = await syncPageViewStats(db, testEnv());

    expect(result).toEqual({
      profiles: { ok: true, count: 1 },
      guides: { ok: true, count: 0 },
    });
    expect(await statMap(db)).toEqual({ [`profile:${fresh.id}`]: 3 });
  });

  it("同じ対象を再同期すると値が更新される（重複行にならない）", async () => {
    const db = await createTransactionalTestDb();
    const runner = await seedUser(db, { slug: "runner" });

    stubAnalytics({ profile: [{ requestPath: "/player/runner", visits: 5 }], guide: [] });
    await syncPageViewStats(db, testEnv());
    stubAnalytics({ profile: [{ requestPath: "/player/runner", visits: 11 }], guide: [] });
    await syncPageViewStats(db, testEnv());

    expect(await db.query.pageViewStats.findMany()).toHaveLength(1);
    expect(await statMap(db)).toEqual({ [`profile:${runner.id}`]: 11 });
  });

  it("ガイド側の取得が失敗しても、プロフィールは更新されガイドの旧行は残る", async () => {
    const db = await createTransactionalTestDb();
    silenceConsole();
    const runner = await seedUser(db, { slug: "runner" });
    const author = await seedUser(db, { slug: "author" });
    const guide = await seedGuide(db, author.id, { slug: "my-guide" });
    await seedPageViewStat(db, "profile", runner.id, 1);
    await seedPageViewStat(db, "guide", guide.id, 42);

    stubAnalytics({
      profile: [{ requestPath: "/player/runner", visits: 9 }],
      guide: new Error("network down"),
    });

    const result = await syncPageViewStats(db, testEnv());

    expect(result.profiles).toEqual({ ok: true, count: 1 });
    expect(result.guides.ok).toBe(false);
    expect(result.guides.error).toContain("network down");
    // 失敗した種別は stale なスナップショットを保持する（空にすると並びが崩れるため）
    expect(await statMap(db)).toEqual({
      [`profile:${runner.id}`]: 9,
      [`guide:${guide.id}`]: 42,
    });
  });

  it("API が非 2xx を返した種別も失敗として扱い、もう片側は成功する", async () => {
    const db = await createTransactionalTestDb();
    silenceConsole();
    const runner = await seedUser(db, { slug: "runner" });
    const author = await seedUser(db, { slug: "author" });
    const guide = await seedGuide(db, author.id, { slug: "my-guide" });
    await seedPageViewStat(db, "guide", guide.id, 42);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const filter = new URL(String(input)).searchParams.get("filter") ?? "";
        if (filter.includes("/guides/")) {
          return { ok: false, status: 403, text: async () => "forbidden" };
        }
        return {
          ok: true,
          json: async () => ({ data: [{ requestPath: "/player/runner", visits: 2 }] }),
        };
      }),
    );

    const result = await syncPageViewStats(db, testEnv());

    expect(result.profiles.ok).toBe(true);
    expect(result.guides.ok).toBe(false);
    expect(result.guides.error).toContain("403");
    expect(await statMap(db)).toEqual({
      [`profile:${runner.id}`]: 2,
      [`guide:${guide.id}`]: 42,
    });
  });

  it("応答形状が想定外（data が配列でない）なら失敗として扱い、旧行を消さない", async () => {
    const db = await createTransactionalTestDb();
    silenceConsole();
    const runner = await seedUser(db, { slug: "runner" });
    await seedPageViewStat(db, "profile", runner.id, 8);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ error: "nope" }) })),
    );

    const result = await syncPageViewStats(db, testEnv());

    expect(result.profiles.ok).toBe(false);
    expect(result.guides.ok).toBe(false);
    expect(await statMap(db)).toEqual({ [`profile:${runner.id}`]: 8 });
  });

  it("環境変数が未設定なら両種別とも失敗し、DB は触らない", async () => {
    const db = await createTransactionalTestDb();
    silenceConsole();
    const runner = await seedUser(db, { slug: "runner" });
    await seedPageViewStat(db, "profile", runner.id, 8);
    const fetchMock = stubAnalytics({ profile: [], guide: [] });

    const result = await syncPageViewStats(
      db,
      testEnv({ VERCEL_API_TOKEN: undefined, VERCEL_PROJECT_ID: undefined }),
    );

    expect(result.profiles.ok).toBe(false);
    expect(result.guides.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await statMap(db)).toEqual({ [`profile:${runner.id}`]: 8 });
  });
});

// 相関サブクエリの列参照が内側テーブルの同名列（page_view_stats.id）へ解決されると、
// SQL エラーにならないまま全行が同じ値／常に 0 になる。likes.server.ts と同じ罠なので、
// クエリの形（join あり select / RQB）ごとに実値で確認する。
describe("ページビューの相関サブクエリ（クエリの形に依存しない）", () => {
  it("ガイド: 行があるガイドだけが正の値になり、他のガイドは 0 のまま", async () => {
    const db = await createTransactionalTestDb();
    const author = await seedUser(db);
    const withStats = await seedGuide(db, author.id, { slug: "a" });
    await seedGuide(db, author.id, { slug: "b" });
    await seedPageViewStat(db, "guide", withStats.id, 12);

    const joined = await db
      .select({ slug: schema.guides.slug, pageviews: guidePageViewsSql() })
      .from(schema.guides)
      .innerJoin(schema.users, eq(schema.guides.authorId, schema.users.id));
    const rqb = await db.query.guides.findMany({
      columns: { slug: true },
      extras: { pageviews: guidePageViewsSql().as("page_views") },
    });

    expect(pageviewsBySlug(joined)).toEqual({ a: 12, b: 0 });
    expect(pageviewsBySlug(rqb)).toEqual({ a: 12, b: 0 });
  });

  it("プロフィール: 行があるユーザーだけが正の値になり、他のユーザーは 0 のまま", async () => {
    const db = await createTransactionalTestDb();
    const withStats = await seedUser(db, { slug: "seen" });
    await seedUser(db, { slug: "unseen" });
    await seedPageViewStat(db, "profile", withStats.id, 7);

    const plain = await db
      .select({ slug: schema.users.slug, pageviews: profilePageViewsSql() })
      .from(schema.users);
    const rqb = await db.query.users.findMany({
      columns: { slug: true },
      extras: { pageviews: profilePageViewsSql().as("page_views") },
    });

    expect(pageviewsBySlug(plain)).toEqual({ seen: 7, unseen: 0 });
    expect(pageviewsBySlug(rqb)).toEqual({ seen: 7, unseen: 0 });
  });

  it("種別が違う行は混ざらない（同じ id でも profile / guide を取り違えない）", async () => {
    const db = await createTransactionalTestDb();
    const author = await seedUser(db, { slug: "author" });
    const guide = await seedGuide(db, author.id, { slug: "g" });
    // 著者のプロフィールにだけ PV を入れる
    await seedPageViewStat(db, "profile", author.id, 30);

    const guideRows = await db
      .select({ slug: schema.guides.slug, pageviews: guidePageViewsSql() })
      .from(schema.guides);
    const userRows = await db
      .select({ slug: schema.users.slug, pageviews: profilePageViewsSql() })
      .from(schema.users);

    expect(pageviewsBySlug(guideRows)).toEqual({ [guide.slug]: 0 });
    expect(pageviewsBySlug(userRows)).toEqual({ author: 30 });
  });
});
