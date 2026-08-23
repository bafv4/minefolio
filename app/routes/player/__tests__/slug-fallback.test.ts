// /player/:slug ・ /player/:slug/stats の loader が 404 直前に呼ぶ
// slug フォールバックリダイレクト（resolvePlayerSlugFallback: slug_history → Mojang API の
// 2段解決。app/lib/player-slug-fallback.server.ts）の loader レベル回帰テスト。
//
// resolvePlayerSlugFallback 自体の単体テストは
// app/lib/__tests__/player-slug-fallback.server.test.ts にあるが、ここでは
// loader からの呼び出し〜 throw redirect（または404維持）までを通しで検証する。
//
// ハーネス方針は app/routes/guides/__tests__/user.test.ts と同じ（セッションはモック、
// ルート本体は実DBで検証。Mojang は fetchUuidFromMcid のみ差し替え、MojangError は実クラス）。
//
// 大文字小文字違いのslug解決（lower()一致）は profile.tsx については既に
// app/routes/player/__tests__/profile.test.ts の「loader - slug の解決」で検証済みのため、
// ここでは未カバーだった stats.tsx 側のみ検証する（重複を避ける）。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createTestDbAt,
  seedUser,
  SHARED_MEMORY_URL,
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

import { loader as profileLoader } from "../profile";
import { loader as statsLoader } from "../stats";

const ENV_KEYS = ["TURSO_DATABASE_URL", "BETTER_AUTH_SECRET", "APP_URL"] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

let db: TestDb;

async function callProfileLoader(slug: string, search = ""): Promise<Record<string, unknown>> {
  const request = new Request(`https://minefolio.app/player/${slug}${search}`);
  return profileLoader({ request, params: { slug }, context: {} } as never) as Promise<
    Record<string, unknown>
  >;
}

async function callStatsLoader(slug: string, search = ""): Promise<Record<string, unknown>> {
  const request = new Request(`https://minefolio.app/player/${slug}/stats${search}`);
  return statsLoader({ request, params: { slug }, context: {} } as never) as Promise<
    Record<string, unknown>
  >;
}

/** loader が throw した Response を取り出す（正常終了した場合は失敗させる） */
async function expectThrownResponse(promise: Promise<unknown>): Promise<Response> {
  const thrown = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(thrown).toBeInstanceOf(Response);
  return thrown as Response;
}

beforeEach(async () => {
  vi.clearAllMocks();
  mojangMocks.fetchUuidFromMcid.mockReset();
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

describe("profile.tsx loader - slugフォールバックリダイレクト", () => {
  it("slug_historyヒット＋参照先publicなら現slugへ302（クエリ文字列引き継ぎ）", async () => {
    const owner = await seedUser(db, {
      slug: "current-owner",
      discordId: "discord-current-owner",
      mcid: null,
      profileVisibility: "public",
    });
    await recordSlugChange(db, {
      userId: owner.id,
      oldSlug: "OldPlayerName",
      newSlug: "current-owner",
    });

    const thrown = await expectThrownResponse(
      callProfileLoader("OldPlayerName", "?preset=xxxx"),
    );

    expect(thrown.status).toBe(302);
    expect(thrown.headers.get("Location")).toBe("/player/current-owner?preset=xxxx");
    // slug_history でヒットしたので Mojang 側へは進まない
    expect(mojangMocks.fetchUuidFromMcid).not.toHaveBeenCalled();
  });

  it("slug_historyヒット＋参照先privateならリダイレクトせず404のまま", async () => {
    const owner = await seedUser(db, {
      slug: "current-private-owner",
      discordId: "discord-current-private-owner",
      mcid: null,
      profileVisibility: "private",
    });
    await recordSlugChange(db, {
      userId: owner.id,
      oldSlug: "old-private-name",
      newSlug: "current-private-owner",
    });

    const thrown = await expectThrownResponse(callProfileLoader("old-private-name"));

    expect(thrown.status).toBe(404);
  });

  it("slug_historyにもMojangにも無い場合は404（MCID形状でないslugはMojangを呼ばない）", async () => {
    const thrown = await expectThrownResponse(callProfileLoader("no-such-player"));

    expect(thrown.status).toBe(404);
    expect(mojangMocks.fetchUuidFromMcid).not.toHaveBeenCalled();
  });
});

describe("stats.tsx loader - slugフォールバックリダイレクト", () => {
  it("slug_historyヒット＋参照先publicなら現slugの/statsへ302（クエリ文字列引き継ぎ）", async () => {
    const owner = await seedUser(db, {
      slug: "current-owner",
      discordId: "discord-current-owner",
      mcid: null,
      profileVisibility: "public",
    });
    await recordSlugChange(db, {
      userId: owner.id,
      oldSlug: "OldPlayerName",
      newSlug: "current-owner",
    });

    const thrown = await expectThrownResponse(
      callStatsLoader("OldPlayerName", "?preset=xxxx"),
    );

    expect(thrown.status).toBe(302);
    expect(thrown.headers.get("Location")).toBe("/player/current-owner/stats?preset=xxxx");
    // slug_history でヒットしたので Mojang 側へは進まない
    expect(mojangMocks.fetchUuidFromMcid).not.toHaveBeenCalled();
  });

  it("slug_historyヒット＋参照先privateならリダイレクトせず404のまま", async () => {
    const owner = await seedUser(db, {
      slug: "current-private-owner",
      discordId: "discord-current-private-owner",
      mcid: null,
      profileVisibility: "private",
    });
    await recordSlugChange(db, {
      userId: owner.id,
      oldSlug: "old-private-name",
      newSlug: "current-private-owner",
    });

    const thrown = await expectThrownResponse(callStatsLoader("old-private-name"));

    expect(thrown.status).toBe(404);
  });

  it("slug_historyにもMojangにも無い場合は404（MCID形状でないslugはMojangを呼ばない）", async () => {
    const thrown = await expectThrownResponse(callStatsLoader("no-such-player"));

    expect(thrown.status).toBe(404);
    expect(mojangMocks.fetchUuidFromMcid).not.toHaveBeenCalled();
  });

  it("大文字小文字違いのslugでも統計情報が解決される（404にならない）", async () => {
    await seedUser(db, {
      slug: "runner",
      discordId: "discord-runner",
      mcid: null,
      profileVisibility: "public",
    });

    const data = await callStatsLoader("RUNNER");

    expect(data.slug).toBe("runner");
  });
});
