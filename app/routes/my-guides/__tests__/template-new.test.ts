// /my-guides/templates/new の action の回帰テスト。
// 作成すると非公開（isPublished=false・publishedAt=null）。公開は編集画面の保存で行う。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  createTestDbAt,
  seedUser,
  SHARED_MEMORY_URL,
  type TestDb,
} from "@/lib/__tests__/helpers/test-db";
import { searchCraftTemplates } from "@/lib/schema";

const sessionMocks = vi.hoisted(() => ({
  getOptionalSession: vi.fn(),
  getSession: vi.fn(),
  getCurrentUser: vi.fn(),
  getCurrentUserOrOnboarding: vi.fn(),
  isAuthenticated: vi.fn(),
}));

vi.mock("@/lib/session", () => sessionMocks);

import { action } from "../template-new";

const ENV_KEYS = ["TURSO_DATABASE_URL", "BETTER_AUTH_SECRET", "APP_URL"] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

let db: TestDb;

function form(extra: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set("title", "Brand New");
  fd.set("description", "Desc");
  fd.set("gameLanguage", "ja_jp");
  fd.set("crafts", JSON.stringify([{ items: ["stick"], variations: [{ str: "abc", withShift: false }] }]));
  fd.set("remaps", "[]");
  fd.set("loops", "[]");
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return fd;
}

async function callAction(formData: FormData) {
  const request = new Request("https://minefolio.app/my-guides/templates/new", {
    method: "POST",
    body: formData,
  });
  return action({ request, params: {}, context: {} } as never) as Promise<{
    success?: boolean;
    error?: string;
    templateId?: string;
  }>;
}

beforeEach(async () => {
  vi.clearAllMocks();
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
  process.env.TURSO_DATABASE_URL = SHARED_MEMORY_URL;
  process.env.BETTER_AUTH_SECRET = "test-secret";
  process.env.APP_URL = "https://minefolio.app";
  db = await createTestDbAt(SHARED_MEMORY_URL);
  sessionMocks.getSession.mockResolvedValue({ user: { id: "discord-owner" } });
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe("action", () => {
  it("成功すると templateId を返し、行は isPublished=false・publishedAt=null・下書き列 null", async () => {
    const owner = await seedUser(db, { slug: "owner", discordId: "discord-owner" });

    // isPublished を true で送っても、作成は常に非公開
    const res = await callAction(form({ isPublished: "true" }));

    expect(res.success).toBe(true);
    expect(typeof res.templateId).toBe("string");
    const row = await db.query.searchCraftTemplates.findFirst({
      where: eq(searchCraftTemplates.id, res.templateId!),
    });
    expect(row).toMatchObject({
      userId: owner.id,
      title: "Brand New",
      description: "Desc",
      gameLanguage: "ja_jp",
      isPublished: false,
      publishedAt: null,
      draftTitle: null,
      draftDescription: null,
      draftGameLanguage: null,
      draftCraftsData: null,
      draftRemapsData: null,
      draftLoopsData: null,
      draftUpdatedAt: null,
    });
  });

  it("検証エラー（タイトル空）は error を返し、行は作られない", async () => {
    await seedUser(db, { slug: "owner", discordId: "discord-owner" });

    const res = await callAction(form({ title: "" }));

    expect(res).toHaveProperty("error");
    expect(await db.query.searchCraftTemplates.findMany()).toEqual([]);
  });
});
