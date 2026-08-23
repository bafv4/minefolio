// /guides/:authorSlug の loader の回帰テスト。
// 著者slugの解決ポリシー（/player/:slug・/guides/:authorSlug/:guideSlug と同一）:
// lower() 大文字小文字無視の完全一致 → 見つからなければ slug_history → Mojang API の順で
// フォールバック解決し、解決できれば現slugの一覧URLへ302。private な著者は救済しない。
//
// ハーネス方針は app/routes/guides/__tests__/view.test.ts と同じ（セッションはモック、
// ルート本体は実DBで検証。Mojang は fetchUuidFromMcid のみ差し替え、MojangError は実クラス）。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createTestDbAt,
  seedUser,
  type TestDb,
} from "@/lib/__tests__/helpers/test-db";
import { recordSlugChange } from "@/lib/slug-history.server";

const sessionMocks = vi.hoisted(() => ({
  getOptionalSession: vi.fn(),
  getSession: vi.fn(),
  getCurrentUser: vi.fn(),
  getCurrentUserOrOnboarding: vi.fn(),
  isAuthenticated: vi.fn(),
}));

vi.mock("@/lib/session", () => sessionMocks);

const mojangMocks = vi.hoisted(() => ({
  fetchUuidFromMcid: vi.fn(),
}));

vi.mock("@/lib/mojang", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mojang")>();
  return {
    ...actual,
    fetchUuidFromMcid: mojangMocks.fetchUuidFromMcid,
  };
});

import { loader } from "../user";

const SHARED_URL = "file::memory:?cache=shared";
const ENV_KEYS = ["TURSO_DATABASE_URL", "BETTER_AUTH_SECRET", "APP_URL"] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

let db: TestDb;

async function callLoader(authorSlug: string, search = "") {
  const request = new Request(`https://minefolio.app/guides/${authorSlug}${search}`);
  return loader({
    request,
    params: { authorSlug },
    context: {},
  } as never) as Promise<Record<string, unknown>>;
}

beforeEach(async () => {
  vi.clearAllMocks();
  mojangMocks.fetchUuidFromMcid.mockReset();
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
  process.env.TURSO_DATABASE_URL = SHARED_URL;
  process.env.BETTER_AUTH_SECRET = "test-secret";
  process.env.APP_URL = "https://minefolio.app";
  db = await createTestDbAt(SHARED_URL);
  sessionMocks.getOptionalSession.mockResolvedValue(null);
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe("著者slugの解決（大文字小文字無視の一致 + 404フォールバックリダイレクト）", () => {
  it("authorSlugの大文字小文字が違っても著者を解決してガイド一覧を表示する", async () => {
    await seedUser(db, {
      slug: "author",
      discordId: "discord-author",
      profileVisibility: "public",
    });

    const data = await callLoader("AUTHOR");
    const author = data.author as Record<string, unknown>;

    expect(author.slug).toBe("author");
  });

  it("存在しないauthorSlugがslug_historyにあり参照先がpublicなら、現slugの一覧URLへ302（クエリ文字列引き継ぎ）", async () => {
    const author = await seedUser(db, {
      slug: "current-owner",
      discordId: "discord-current-owner",
      profileVisibility: "public",
    });
    await recordSlugChange(db, {
      userId: author.id,
      oldSlug: "OldAuthorName",
      newSlug: "current-owner",
    });

    const thrown = await callLoader("OldAuthorName", "?view=list").then(
      () => null,
      (e: unknown) => e,
    );

    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(302);
    expect((thrown as Response).headers.get("Location")).toBe(
      "/guides/current-owner?view=list",
    );
    // slug_history でヒットしたので Mojang 側へは進まない
    expect(mojangMocks.fetchUuidFromMcid).not.toHaveBeenCalled();
  });

  it("slug_historyの参照先がprivateならリダイレクトせず404を返す", async () => {
    const owner = await seedUser(db, {
      slug: "current-private-owner",
      discordId: "discord-current-private-owner",
      profileVisibility: "private",
    });
    await recordSlugChange(db, {
      userId: owner.id,
      oldSlug: "old-private-name",
      newSlug: "current-private-owner",
    });

    const thrown = await callLoader("old-private-name").then(
      () => null,
      (e: unknown) => e,
    );

    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(404);
  });

  it("slug_historyにもMojangにも無い場合は404（MCID形状でないauthorSlugはMojangを呼ばない）", async () => {
    const thrown = await callLoader("no-such-author").then(
      () => null,
      (e: unknown) => e,
    );

    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(404);
    expect(mojangMocks.fetchUuidFromMcid).not.toHaveBeenCalled();
  });
});
