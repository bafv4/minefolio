// /me/edit の set_mcid / remove_mcid が recordSlugChange で slug_history に旧slugを
// 記録することの回帰テスト。db.transaction を使う経路なので createTestDbAt(SHARED_MEMORY_URL)
// を使う（app/routes/me/__tests__/edit.test.ts と同じ方針）。
//
// @/lib/mojang のモック方針は app/routes/__tests__/onboarding.test.ts と同じ（fetchUuidFromMcid のみ
// 差し替え、MojangError は実クラスをそのまま使う）。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  createTestDbAt,
  seedUser,
  SHARED_MEMORY_URL,
  type TestDb,
} from "@/lib/__tests__/helpers/test-db";
import { users, slugHistory } from "@/lib/schema";

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

import { action } from "../edit";

const ENV_KEYS = ["TURSO_DATABASE_URL", "BETTER_AUTH_SECRET", "APP_URL"] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

let db: TestDb;

function makeRequest(formData: FormData): Request {
  return new Request("https://minefolio.app/me/edit", {
    method: "POST",
    body: formData,
  });
}

async function callAction(formData: FormData) {
  return action({ request: makeRequest(formData), params: {}, context: {} } as never);
}

function signInAs(discordId: string) {
  sessionMocks.getSession.mockResolvedValue({ user: { id: discordId } });
}

beforeEach(async () => {
  vi.clearAllMocks();
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
  process.env.TURSO_DATABASE_URL = SHARED_MEMORY_URL;
  process.env.BETTER_AUTH_SECRET = "test-secret";
  process.env.APP_URL = "https://minefolio.app";
  db = await createTestDbAt(SHARED_MEMORY_URL);
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

async function findHistoryBySlug(slug: string) {
  return db.query.slugHistory.findFirst({ where: eq(slugHistory.slug, slug) });
}

describe("action - set_mcid の履歴記録", () => {
  it("MCID変更で旧slugが slug_history に記録され、新slugへの参照に置き換わる", async () => {
    const user = await seedUser(db, {
      slug: "old-mcid-slug",
      discordId: "discord-runner",
      mcid: "OldMcid",
    });
    signInAs("discord-runner");
    mojangMocks.fetchUuidFromMcid.mockResolvedValue("11111111-1111-1111-1111-111111111111");

    const fd = new FormData();
    fd.set("_action", "set_mcid");
    fd.set("mcid", "NewMcid");

    const res = await callAction(fd);

    expect(res).toEqual({ success: true, action: "mcid", newSlug: "NewMcid" });

    const updated = await db.query.users.findFirst({ where: eq(users.id, user.id) });
    expect(updated?.slug).toBe("NewMcid");
    expect(updated?.mcid).toBe("NewMcid");

    const historyRow = await findHistoryBySlug("old-mcid-slug");
    expect(historyRow?.userId).toBe(user.id);
  });
});

describe("action - remove_mcid の履歴記録", () => {
  it("MCID削除で旧slugが slug_history に記録され、新slug（@discordId形式）へ更新される", async () => {
    const user = await seedUser(db, {
      slug: "somemcid",
      discordId: "discord-runner",
      mcid: "SomeMcid",
      uuid: "22222222-2222-2222-2222-222222222222",
    });
    signInAs("discord-runner");

    const fd = new FormData();
    fd.set("_action", "remove_mcid");

    const res = await callAction(fd);

    expect(res).toEqual({ success: true, action: "mcid_removed", newSlug: "@discord-runner" });

    const updated = await db.query.users.findFirst({ where: eq(users.id, user.id) });
    expect(updated?.slug).toBe("@discord-runner");
    expect(updated?.mcid).toBeNull();

    const historyRow = await findHistoryBySlug("somemcid");
    expect(historyRow?.userId).toBe(user.id);
  });
});
