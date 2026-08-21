// /api/browse（「もっと読み込む」用リソースルート）の Cache-Control 出し分けの回帰テスト。
//
// このルートのレスポンスはログイン中だけ閲覧者依存になる（お気に入りが優先ソートされる）。
// ログイン時に public/s-maxage を付けてしまうと、ある利用者のお気に入り順の一覧が
// 共有CDNに載って別人へ配信される。逆に匿名まで no-store にすると CDN が効かない。
//
// クエリ本体（検索・フィルタ・ページング）は app/lib/__tests__/browse-query.server.test.ts が
// 担当するため、ここではヘッダーの出し分けと最低限のレスポンス形だけを見る。
// セッションはモックし、DB は実DBを使う。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createTestDbAt,
  seedUser,
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

import { loader } from "../browse";

// 実装（app/routes/api/browse.ts）と同じ値
const ANONYMOUS_CACHE = "public, s-maxage=30, stale-while-revalidate=300";
const SIGNED_IN_CACHE = "private, no-store";

const ENV_KEYS = ["TURSO_DATABASE_URL", "BETTER_AUTH_SECRET", "APP_URL"] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

let db: TestDb;

async function callLoader(search = ""): Promise<Response> {
  const request = new Request(`https://minefolio.app/api/browse${search}`);
  return loader({ request, params: {}, context: {} } as never);
}

beforeEach(async () => {
  vi.clearAllMocks();
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
  process.env.TURSO_DATABASE_URL = SHARED_MEMORY_URL;
  process.env.BETTER_AUTH_SECRET = "test-secret";
  process.env.APP_URL = "https://minefolio.app";
  db = await createTestDbAt(SHARED_MEMORY_URL);
  sessionMocks.getOptionalSession.mockResolvedValue(null);

  await seedUser(db, {
    slug: "runner1",
    discordId: "discord-runner1",
    mcid: "Runner1",
    role: "runner",
    profileVisibility: "public",
  });
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe("Cache-Control の出し分け", () => {
  it("未ログインは CDN キャッシュ可（public + s-maxage）", async () => {
    const res = await callLoader();

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(ANONYMOUS_CACHE);
  });

  it("ログイン中は private, no-store（お気に入り優先ソートをCDNに載せない）", async () => {
    sessionMocks.getOptionalSession.mockResolvedValue({ user: { id: "discord-runner1" } });

    const res = await callLoader();

    const cacheControl = res.headers.get("Cache-Control") ?? "";
    expect(cacheControl).toBe(SIGNED_IN_CACHE);
    expect(cacheControl).not.toContain("s-maxage");
    expect(cacheControl).not.toContain("public");
    expect(cacheControl).not.toContain("stale-while-revalidate");
  });

  it("セッションはあるが users 行が無い場合も private, no-store", async () => {
    sessionMocks.getOptionalSession.mockResolvedValue({ user: { id: "discord-unknown" } });

    const res = await callLoader();

    expect(res.headers.get("Cache-Control")).toBe(SIGNED_IN_CACHE);
  });

  it("クエリ付き（フィルタ・ページ指定）でも出し分けは変わらない", async () => {
    const anonymous = await callLoader("?q=run&sort=popular&page=2&role=runner");
    expect(anonymous.headers.get("Cache-Control")).toBe(ANONYMOUS_CACHE);

    sessionMocks.getOptionalSession.mockResolvedValue({ user: { id: "discord-runner1" } });
    const signedIn = await callLoader("?q=run&sort=popular&page=2&role=runner");
    expect(signedIn.headers.get("Cache-Control")).toBe(SIGNED_IN_CACHE);
  });
});

describe("レスポンス形", () => {
  it("items / hasMore / totalCount / totalPages / page を返す", async () => {
    const res = await callLoader("?page=1");

    const json = (await res.json()) as Record<string, unknown>;
    expect(Array.isArray(json.items)).toBe(true);
    expect(json).toMatchObject({ hasMore: false, totalCount: 1, totalPages: 1, page: 1 });
  });
});
